// Vergelijkweergave: 2–3 varianten naast elkaar (plattegrond, optioneel 3D) + tabel met alle kerncijfers en de raming,
// Δ t.o.v. de eerste kolom (referentie) en CSV-export. Vergelijken wijzigt geen modellen: de varianten worden
// enkel gelezen (VariantBeheer.leesModel) en nooit geactiveerd.
// Modaal (native <dialog>): de sneltoetsen van de app zijn uitgeschakeld zolang het venster open is.
// Prestaties: hoogstens 3 extra WebGL-contexten (enkel als "3D" aan staat); alles wordt vrijgegeven bij sluiten.

import { vergelijkingsRijen, naarCsv, fmtWaarde, fmtDelta, fmtEenheidsprijs, fmtGetal } from '../metrics/index.js';
import { cijfersVoor, prijsDetails, prijsVoetnoot, ontbrekendUitleg } from './kerncijferspaneel.js';
import { h, leeg } from './dom.js';

const MAX = 3;

export class Vergelijken {
  /** @param {{ beheer: import('./varianten.js').VariantBeheer }} o */
  constructor({ beheer }) {
    this.beheer = beheer;
    this.keuze = [];          // ids (lengte 2 of 3; index 2 mag null zijn)
    this.niveau = null;       // gemeenschappelijke niveaukeuze (niveau-id)
    this.toon3d = false;
    this.modellen = [];       // [{ id, model }]
    this.kolommen = [];       // [{ el, plan, v3d, planEl, v3dEl }]
    this.dlg = null;
    this._rijen = null;
    this._volgnr = 0;
  }

  get isOpen() { return !!this.dlg?.open; }

  /** Opent het venster. Standaard: "Bestaande toestand" (id bestaand) als referentie + het actieve ontwerp. */
  async open({ keuze } = {}) {
    if (this.isOpen) return;
    const lijst = this.beheer.lijst();
    const ids = lijst.map((o) => o.id);
    const actief = this.beheer.actiefId;
    if (keuze?.length >= 2) this.keuze = keuze.slice(0, MAX);
    else {
      const ref = ids.includes('bestaand') ? 'bestaand' : (ids[0] ?? actief);
      const tweede = actief && actief !== ref ? actief : ids.find((x) => x !== ref) ?? ref;
      this.keuze = [ref, tweede, null];
    }
    this._bouw();
    document.body.append(this.dlg);
    this.dlg.showModal();
    this.sluitKnop.focus();
    await this.vernieuw();
  }

  sluit() { if (this.isOpen) this.dlg.close(); }

  #opruimen() {
    for (const k of this.kolommen) { this.#disposeKolom(k); }
    this.kolommen = [];
    this.dlg?.remove();
    this.dlg = null;
    this.modellen = [];
  }

  #disposeKolom(k) {
    try { k.plan?.dispose(); } catch (e) { console.error(e); }
    try { k.v3d?.dispose(); } catch (e) { console.error(e); }
    k.plan = null; k.v3d = null;
  }

  // ---------------------------------------------------------------- opbouw

  _bouw() {
    const dlg = (this.dlg = h('dialog', { class: 'vergelijk', id: 'vergelijk', 'aria-labelledby': 'vg-titel' }));
    dlg.addEventListener('close', () => this.#opruimen());
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); this.sluit(); });

    this.sluitKnop = h('button', { type: 'button', class: 'knop', id: 'vg-sluit', onclick: () => this.sluit() }, 'Sluiten');
    this.kiezers = [0, 1, 2].map((i) => {
      const s = h('select', { id: `vg-variant-${i}`, 'data-kolom': i });
      s.addEventListener('change', () => { this.keuze[i] = s.value || null; this.vernieuw(); });
      return s;
    });
    this.niveauKiezer = h('select', { id: 'vg-niveau' });
    this.niveauKiezer.addEventListener('change', () => { this.niveau = this.niveauKiezer.value; this.#renderViews({ kader: true }); });
    const cb3d = h('input', { type: 'checkbox', id: 'vg-3d', checked: this.toon3d });
    cb3d.addEventListener('change', () => { this.toon3d = cb3d.checked; this.#zet3d(); });
    this.csvKnop = h('button', { type: 'button', class: 'knop', id: 'vg-csv', onclick: () => this.exporteerCsv() }, 'CSV exporteren');
    this.status = h('p', { class: 'vg-status', role: 'status', 'aria-live': 'polite' });

    const veld = (label, ctrl, extra = '') => h('label', { class: `vg-veld ${extra}` }, h('span', { class: 'vg-label' }, label), ctrl);
    this.kolomHouder = h('div', { class: 'vg-kolommen' });
    this.tabelHouder = h('div', { class: 'vg-tabel-houder' });
    this.voet = h('div', { class: 'vg-voet' });

    dlg.append(
      h('div', { class: 'vg-kop' },
        h('h2', { id: 'vg-titel' }, 'Varianten vergelijken'),
        this.sluitKnop),
      h('div', { class: 'vg-bediening' },
        veld('Referentie', this.kiezers[0]),
        veld('Variant 2', this.kiezers[1]),
        veld('Variant 3', this.kiezers[2]),
        veld('Plattegrond', this.niveauKiezer, 'vg-veld-niveau'),
        h('label', { class: 'vinkje vg-vinkje' }, cb3d, h('span', {}, '3D tonen')),
        this.csvKnop),
      h('div', { class: 'vg-inhoud' },
        this.status,
        this.kolomHouder,
        this.tabelHouder,
        this.voet));
  }

  #vulKiezers() {
    const lijst = this.beheer.lijst();
    this.kiezers.forEach((s, i) => {
      leeg(s);
      if (i === 2) s.append(h('option', { value: '' }, '— geen —'));
      for (const o of lijst) s.append(h('option', { value: o.id }, o.naam));
      s.value = this.keuze[i] ?? '';
    });
  }

  // ---------------------------------------------------------------- laden en tekenen

  /** Laadt de gekozen varianten (zonder ze te openen) en tekent alles opnieuw. */
  async vernieuw() {
    const nr = ++this._volgnr;
    this.#vulKiezers();
    const ids = this.keuze.filter(Boolean);
    this.status.textContent = 'Laden…';
    const geladen = await Promise.all(ids.map((id) => this.beheer.leesModel(id).then((r) => ({ id, ...r }))));
    if (nr !== this._volgnr || !this.dlg) return; // intussen opnieuw gekozen of gesloten
    const fout = geladen.filter((g) => !g.ok);
    this.modellen = geladen.filter((g) => g.ok).map((g) => ({ id: g.id, model: g.model }));
    this.status.textContent = fout.length ? fout.map((f) => f.melding).join(' ') : '';
    this.status.classList.toggle('fout', fout.length > 0);
    this.#vulNiveaus();
    await this.#bouwKolommen();
    if (nr !== this._volgnr || !this.dlg) return;
    this.#renderViews({ kader: true });
    this.#tekenTabel();
  }

  #vulNiveaus() {
    const per = new Map();
    for (const { model } of this.modellen) for (const n of model.niveaus) if (!per.has(n.id)) per.set(n.id, n);
    const niveaus = [...per.values()].sort((a, b) => a.peil - b.peil);
    if (!niveaus.some((n) => n.id === this.niveau)) this.niveau = niveaus[0]?.id ?? null;
    leeg(this.niveauKiezer);
    for (const n of niveaus) this.niveauKiezer.append(h('option', { value: n.id }, n.naam));
    this.niveauKiezer.value = this.niveau ?? '';
  }

  async #bouwKolommen() {
    const n = this.modellen.length;
    // overtollige kolommen vrijgeven
    while (this.kolommen.length > n) { const k = this.kolommen.pop(); this.#disposeKolom(k); k.el.remove(); }
    let Plattegrond = null;
    try { ({ Plattegrond } = await import('../views/plan2d.js')); } catch (e) { console.error('Plattegrond niet beschikbaar:', e); }
    for (let i = this.kolommen.length; i < n; i++) {
      const titel = h('div', { class: 'vg-kolom-titel' });
      const planEl = h('div', { class: 'vg-view vg-plan', 'aria-label': 'Plattegrond' });
      const v3dEl = h('div', { class: 'vg-view vg-3d', 'aria-label': '3D-weergave', hidden: !this.toon3d });
      const melding = h('p', { class: 'vg-view-melding', hidden: true });
      const el = h('section', { class: 'vg-kolom' }, titel, h('div', { class: 'vg-view-stapel' }, planEl, melding, v3dEl));
      this.kolomHouder.append(el);
      const k = { el, titel, planEl, v3dEl, melding, plan: null, v3d: null };
      if (Plattegrond) { try { k.plan = new Plattegrond(planEl); } catch (e) { console.error(e); } }
      this.kolommen.push(k);
    }
    this.kolomHouder.style.setProperty('--n', String(Math.max(1, n)));
    this.modellen.forEach(({ model }, i) => {
      const k = this.kolommen[i];
      leeg(k.titel);
      k.titel.append(h('span', { class: 'vg-kolom-naam', title: model.naam }, model.naam));
      if (i === 0) k.titel.append(h('span', { class: 'vg-ref' }, 'referentie'));
    });
    if (this.toon3d) await this.#zet3d({ render: false });
  }

  /** 3D aan/uit: maakt per kolom een Viewer3D (max. 3) of geeft ze vrij. */
  async #zet3d({ render = true } = {}) {
    if (!this.toon3d) {
      for (const k of this.kolommen) { try { k.v3d?.dispose(); } catch (e) { console.error(e); } k.v3d = null; k.v3dEl.hidden = true; }
      return;
    }
    let Viewer3D = null;
    try { ({ Viewer3D } = await import('../views/viewer3d.js')); } catch (e) { console.error('3D niet beschikbaar:', e); }
    for (const k of this.kolommen.slice(0, MAX)) {
      k.v3dEl.hidden = false;
      if (!k.v3d && Viewer3D) {
        try { k.v3d = new Viewer3D(k.v3dEl); } catch (e) { console.error(e); k.v3dEl.textContent = '3D-weergave kon niet gestart worden.'; }
      }
    }
    if (render) this.#renderViews({ kader: true });
  }

  #renderViews({ kader = false } = {}) {
    this.modellen.forEach(({ model }, i) => {
      const k = this.kolommen[i];
      if (!k) return;
      const heeft = model.niveaus.some((n) => n.id === this.niveau);
      k.melding.hidden = heeft;
      k.melding.textContent = heeft ? '' : 'Dit niveau bestaat niet in deze variant.';
      k.planEl.hidden = !heeft;
      try {
        if (heeft && k.plan) { k.plan.render(model, { niveau: this.niveau, toonMaten: false }); if (kader) requestAnimationFrame(() => k.plan?.zoomAlles()); }
      } catch (e) { console.error('Fout bij plattegrond:', e); }
      try {
        if (k.v3d) { k.v3d.render(model, {}); if (kader) requestAnimationFrame(() => k.v3d?.zoomAlles()); }
      } catch (e) { console.error('Fout bij 3D-weergave:', e); }
    });
  }

  // ---------------------------------------------------------------- tabel

  #varianten() {
    return this.modellen.map(({ model }) => ({ naam: model.naam, ...cijfersVoor(model) }));
  }

  #tekenTabel() {
    const vars = this.#varianten();
    leeg(this.tabelHouder);
    leeg(this.voet);
    if (vars.length < 2) {
      this.tabelHouder.append(h('p', { class: 'leeg' }, 'Kies minstens twee varianten.'));
      this._rijen = null;
      return;
    }
    const rijen = (this._rijen = vergelijkingsRijen(vars));
    const kop = h('tr', {}, h('th', { scope: 'col', class: 'vg-kc' }, 'Kerncijfer'),
      ...vars.map((v, i) => h('th', { scope: 'col' }, v.naam, i === 0 ? h('span', { class: 'vg-ref' }, 'referentie') : h('span', { class: 'vg-ref' }, 'Δ t.o.v. referentie'))));
    const body = h('tbody', {});
    let groep = null;
    for (const r of rijen) {
      if (r.groep !== groep) {
        groep = r.groep;
        body.append(h('tr', { class: 'vg-groep' }, h('th', { scope: 'rowgroup', colspan: vars.length + 1 }, groep)));
      }
      const prijs = r.postSleutel ? h('span', { class: 'vg-prijs' }, r.prijs == null ? 'prijs ontbreekt' : fmtEenheidsprijs(r.prijs, r.prijsEenheid, r.valuta), r.bereik ? ` (bereik ${fmtGetal(r.bereik[0], 0)}–${fmtGetal(r.bereik[1], 0)})` : '') : null;
      body.append(h('tr', { class: r.nadruk ? 'vg-nadruk' : '', 'data-rij': r.sleutel },
        h('th', { scope: 'row', class: 'vg-kc' }, r.label, prijs),
        ...r.waarden.map((w, i) => {
          const minst = r.minstens?.[i] && w != null;
          const d = r.deltas[i];
          const klasse = i === 0 || d == null || !r.kleur ? '' : (d > 1e-9 ? 'plus' : d < -1e-9 ? 'min' : '');
          return h('td', { class: w == null ? 'ontbreekt' : '' },
            h('span', { class: 'vg-w' }, minst && w === 0 ? '—' : [minst ? 'minstens ' : '', fmtWaarde(w, r)]),
            i > 0 ? h('span', { class: `vg-delta ${klasse}` }, r.minstens && (r.minstens[i] || r.minstens[0]) ? 'Δ onbekend' : fmtDelta(d, r)) : null);
        })));
    }
    this.tabelHouder.append(h('table', { class: 'vg-tabel', id: 'vg-tabel' }, h('thead', {}, kop), body));
    const r0 = vars[0].raming;
    const onvolledig = vars.some((v) => !v.raming.volledig);
    if (onvolledig) this.voet.append(ontbrekendUitleg(vars.find((v) => !v.raming.volledig).raming));
    else { const u = ontbrekendUitleg(r0); if (u) this.voet.append(u); }
    this.voet.append(prijsDetails(r0, { sleutel: 'vergelijk', titel: 'Prijsdetails (eenheidsprijzen, bereik, bronnen)' }), prijsVoetnoot(r0));
  }

  /** CSV-download van de tabel (";" en decimale komma, voor Excel met Belgische instellingen). */
  exporteerCsv() {
    if (!this._rijen) return null;
    const namen = this.modellen.map(({ model }) => model.naam);
    const r0 = cijfersVoor(this.modellen[0].model).raming;
    const tekst = naarCsv(namen, this._rijen, { btw: r0.btw, bijgewerkt: r0.bijgewerkt, datum: new Date().toLocaleString('nl-BE') });
    const naam = `vergelijking-${this.modellen.map((m) => m.id).join('-')}.csv`;
    const url = URL.createObjectURL(new Blob([tekst], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: naam, hidden: true });
    this.dlg.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    this.status.classList.remove('fout');
    this.status.textContent = `${naam} gedownload.`;
    return { naam, tekst };
  }
}
