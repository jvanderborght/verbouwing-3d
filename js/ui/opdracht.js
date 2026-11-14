// Promptveld "Opdracht aan Claude" (fase 4): opdracht → Claude geeft operaties → validatie → diff-preview → bevestigen.
// Niet-modaal paneel (desktop rechts, telefoon onderaan) zodat de plattegrond het voorbeeld blijft tonen.
// Alle wijzigingen lopen via de callbacks van de app (operaties op de Geschiedenis / nieuwe varianten).

import { h, leeg } from './dom.js';
import { meld } from './dialogen.js';
import { cijfersVoor, totaalTekst } from './kerncijferspaneel.js';
import { fmtM2, fmtM3, fmtBedrag, fmtGetal } from '../metrics/index.js';
import { normaliseerInstellingen, MODELLEN, MAX_VARIANTEN } from '../ai/prompt.js';
import { AiClient, PRIJZEN_BRON } from '../ai/client.js';
import { Gesprek } from '../ai/gesprek.js';
import { voorbeeldHulp } from '../ai/verwerk.js';

const FASE = { vraag: 'Claude denkt na…', herstel: 'Fouten teruggestuurd naar Claude (herstelpoging)…' };
const SOORT_LABEL = { nieuw: 'nieuw', afbraak: 'afbraak', gewijzigd: 'gewijzigd', verwijderd: 'verwijderd' };

const delta = (a, b, fmt) => {
  if (a == null || b == null) return '';
  const d = b - a;
  if (Math.abs(d) < 0.05) return '=';
  return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
};

/** Fase 5: toets aan het programma van eisen van de variant (toetsProgramma), of null. */
function programmaBlok(t) {
  if (!t) return null;
  const s = t.samenvatting;
  return h('details', { class: 'ai-diff ai-programma', open: true },
    h('summary', {}, `Programma van eisen: ${s.voldoet} voldoet, ${s['voldoet niet']} voldoet niet, ${s.onbekend} onbekend`),
    t.fout ? h('p', { class: 'ai-info' }, t.fout) : null,
    h('ul', {}, ...t.resultaten.map((r) => h('li', { 'data-status': r.status }, h('strong', {}, `${r.label}: ${r.status}`), ` — ${r.uitleg}`))));
}

export class OpdrachtPaneel {
  /**
   * @param {{
   *   el: HTMLElement, knop: HTMLElement, beheer, aiOpslag,
   *   context: () => ({ niveau: string|null, selectie: string|null }),
   *   opVoorbeeld: (v: null | { model, hulp: (niveau) => object, niveaus: string[] }) => void,
   *   opToepassen: (ops: Array, label: string) => boolean,
   *   opBewaarNieuw: (lijst: Array<{ model, naam, beschrijving }>, basisId: string) => Promise<void>,
   *   opInstellingen: () => Promise<void>, opNiveau: (id) => void, opOpen?: (open: boolean) => void,
   * }} o
   */
  constructor(o) {
    this.o = o;
    this.el = o.el;
    this.gesprek = null;
    this.resultaat = null;    // laatste beoordeel()-resultaat
    this.actief = 0;          // index van de variant in voorbeeld
    this.bezig = null;        // AbortController
    this.basisId = null;
    this.bouw();
  }

  get isOpen() { return !this.el.hidden; }

  open() {
    this.el.hidden = false;
    this.o.knop?.setAttribute('aria-expanded', 'true');
    this.el.classList.remove('ingeklapt');
    this.vernieuwKey();
    this.o.opOpen?.(true);
    this.toonVoorbeeld();
    setTimeout(() => { if (!this.bezig && this.o.aiOpslag.key()) this.invoer.focus({ preventScroll: true }); }, 0);
  }

  sluit() {
    this.bezig?.abort();
    this.el.hidden = true;
    this.o.knop?.setAttribute('aria-expanded', 'false');
    this.o.opVoorbeeld(null);
    this.o.opOpen?.(false);
  }

  wissel() { if (this.isOpen) this.sluit(); else this.open(); }

  // ---------------------------------------------------------------- opbouw

  bouw() {
    leeg(this.el);
    this.invoer = h('textarea', {
      id: 'ai-opdracht', rows: 3, enterkeyhint: 'send', spellcheck: 'true', autocapitalize: 'sentences',
      placeholder: 'Bv. "Verleng de keuken 2 m naar de tuin met een plat dak" of "Breek de achterbouw af en maak 2 slaapkamers onder het dak"',
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.genereer(); } },
    });
    this.aantal = h('select', { id: 'ai-aantal', class: 'compact' }, ...Array.from({ length: MAX_VARIANTEN }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    this.genKnop = h('button', { type: 'button', class: 'knop primair', id: 'ai-genereer', onclick: () => this.genereer() }, 'Genereer');
    this.annKnop = h('button', { type: 'button', class: 'knop', id: 'ai-annuleer', hidden: true, onclick: () => this.bezig?.abort() }, 'Annuleren');
    this.voortgang = h('div', { class: 'ai-voortgang', role: 'status', 'aria-live': 'polite' });
    this.geenKey = h('div', { class: 'ai-geen-key', hidden: true });
    this.formulier = h('div', { class: 'ai-formulier' },
      h('label', { class: 'veld-label', for: 'ai-opdracht' }, 'Wat wil je veranderen?'),
      this.invoer,
      h('div', { class: 'ai-rij' },
        h('label', { class: 'ai-aantal', for: 'ai-aantal' }, 'Varianten', this.aantal),
        h('span', { class: 'ai-spatie' }),
        this.annKnop, this.genKnop),
      this.voortgang,
      h('p', { class: 'ai-privacy' }, 'Het actieve ontwerp (JSON met maten) en je opdracht gaan naar de Anthropic API, met je eigen key; de kosten zijn voor je API-account. Er wordt niets toegepast zonder jouw bevestiging.'));
    this.uitvoer = h('div', { class: 'ai-uitvoer', id: 'ai-uitvoer' });
    const kop = h('div', { class: 'ai-kop' },
      h('h2', { id: 'ai-titel' }, 'Opdracht aan Claude'),
      h('button', { type: 'button', class: 'knop klein ai-inklap', 'aria-label': 'In- of uitklappen', title: 'In-/uitklappen (plattegrond bekijken)', onclick: () => this.el.classList.toggle('ingeklapt') }, '▾'),
      h('button', { type: 'button', class: 'knop klein', 'aria-label': 'Sluiten', title: 'Sluiten', onclick: () => this.sluit() }, '×'));
    this.el.append(kop, h('div', { class: 'ai-romp' }, this.geenKey, this.formulier, this.uitvoer));
    this.el.setAttribute('aria-labelledby', 'ai-titel');
  }

  vernieuwKey() {
    const heeft = !!this.o.aiOpslag.key();
    this.geenKey.hidden = heeft;
    this.formulier.classList.toggle('uit', !heeft);
    this.invoer.disabled = !heeft || !!this.bezig;
    this.genKnop.disabled = !heeft || !!this.bezig;
    if (!heeft) {
      leeg(this.geenKey);
      this.geenKey.append(
        h('p', {}, h('strong', {}, 'Nog geen Anthropic API-key op dit toestel.')),
        h('p', {}, 'Het promptveld stuurt je opdracht rechtstreeks vanuit deze browser naar de Anthropic API. Daarvoor heb je een eigen API-key nodig (aan te maken op console.anthropic.com → API Keys; het verbruik wordt aangerekend op dat account).'),
        h('p', {}, 'De key wordt enkel in deze browser bewaard (localStorage), nooit in git of in het ontwerp.'),
        h('button', { type: 'button', class: 'knop primair', id: 'ai-key-instellen', onclick: async () => { await this.o.opInstellingen(); this.vernieuwKey(); } }, 'API-key instellen'));
    }
  }

  // ---------------------------------------------------------------- aanvraag

  #instellingen() { return normaliseerInstellingen(this.o.aiOpslag.instellingen()); }

  async genereer() {
    const tekst = this.invoer.value.trim();
    if (this.bezig) return;
    if (!tekst) { this.invoer.focus(); meld('Typ eerst een opdracht.', 'info', { duur: 2500 }); return; }
    const key = this.o.aiOpslag.key();
    if (!key) { this.vernieuwKey(); return; }
    const basis = this.o.beheer.model;
    if (!basis) return;
    const ctx = this.o.context();
    this.basisId = this.o.beheer.actiefId;
    this.gesprek = new Gesprek({
      client: new AiClient({ apiKey: key }), instellingen: this.#instellingen(), basis,
      niveau: ctx.niveau, selectie: ctx.selectie, aantal: Number(this.aantal.value) || 1,
    });
    this.resultaat = null;
    this.o.opVoorbeeld(null);
    await this.#voerUit((opties) => this.gesprek.start(tekst, opties));
  }

  async beantwoord(tekst) {
    if (!this.gesprek || this.bezig || !tekst.trim()) return;
    await this.#voerUit((opties) => this.gesprek.beantwoord(tekst.trim(), opties));
  }

  async #voerUit(fn) {
    const ac = new AbortController();
    this.bezig = ac;
    this.#zetBezig(true);
    leeg(this.uitvoer);
    this.voortgang.textContent = FASE.vraag;
    const start = Date.now();
    try {
      const r = await fn({
        signal: ac.signal,
        opVoortgang: ({ fase, tekens }) => {
          const s = Math.round((Date.now() - start) / 1000);
          this.voortgang.textContent = `${FASE[fase] || FASE.vraag}${tekens ? ` ${fmtGetal(tekens, 0)} tekens ontvangen` : ''} (${s} s)`;
        },
      });
      this.resultaat = r;
      this.actief = 0;
      this.#nieuwResultaat = true;
      this.voortgang.textContent = '';
      this.render();
    } catch (e) {
      this.voortgang.textContent = '';
      const soort = e?.soort || 'onbekend';
      if (soort === 'geannuleerd') { meld('Aanvraag geannuleerd. Er werd niets gewijzigd.', 'info'); this.#toonFout('Geannuleerd.', true); }
      else {
        // geen e.stack/e.cause loggen: de melding bevat nooit de key, de rest is niet nodig
        this.#toonFout(e?.message || 'Onbekende fout.');
        if (soort === 'auth') this.#knopInstellingen();
      }
    } finally {
      this.bezig = null;
      this.#zetBezig(false);
    }
  }

  #zetBezig(aan) {
    this.annKnop.hidden = !aan;
    this.genKnop.disabled = aan || !this.o.aiOpslag.key();
    this.invoer.disabled = aan;
    this.aantal.disabled = aan;
    this.el.classList.toggle('bezig', aan);
  }

  #toonFout(tekst, zacht = false) {
    leeg(this.uitvoer);
    this.uitvoer.append(h('div', { class: zacht ? 'ai-info' : 'ai-fout', role: zacht ? 'status' : 'alert' }, ...String(tekst).split('\n').flatMap((r, i) => (i ? [h('br'), r] : [r]))));
    this.#usage();
  }

  #knopInstellingen() {
    this.uitvoer.append(h('button', { type: 'button', class: 'knop', onclick: async () => { await this.o.opInstellingen(); this.vernieuwKey(); } }, 'Instellingen openen'));
  }

  // ---------------------------------------------------------------- resultaat

  render() {
    const r = this.resultaat;
    leeg(this.uitvoer);
    if (!r) return;
    const g = this.gesprek;
    if (r.data?.samenvatting) this.uitvoer.append(h('p', { class: 'ai-samenvatting' }, r.data.samenvatting));
    for (const a of g?.aanpassingen || []) this.uitvoer.append(h('p', { class: 'ai-info' }, a));
    for (const f of g?.fallbacks || []) this.uitvoer.append(h('p', { class: 'ai-info' }, `Het gekozen model weigerde; ${f.naar || 'een ander model'} heeft het antwoord afgewerkt (server-side fallback).`));
    if (r.herstelPogingen) this.uitvoer.append(h('p', { class: 'ai-info' }, 'Het eerste antwoord bevatte fouten; Claude heeft het na één herstelpoging verbeterd.'));

    if (r.actie === 'fout') {
      this.uitvoer.append(h('div', { class: 'ai-fout', role: 'alert' }, ...String(r.melding).split('\n').flatMap((x, i) => (i ? [h('br'), x] : [x]))));
    } else if (r.actie === 'vragen') {
      this.#renderVragen(r.data.vragen);
    } else if (r.actie === 'toon') {
      this.#renderVarianten(r.varianten);
    }
    this.#usage();
    this.toonVoorbeeld();
    // resultaat in beeld (vooral op telefoon staat het onder het formulier)
    const romp = this.uitvoer.parentElement;
    if (romp && this.#nieuwResultaat) { romp.scrollTop = Math.max(0, this.uitvoer.offsetTop - romp.offsetTop - 8); this.#nieuwResultaat = false; }
  }

  #nieuwResultaat = false;

  #renderVragen(vragen) {
    const antw = h('textarea', { id: 'ai-antwoord', rows: 3, enterkeyhint: 'send', placeholder: 'Je antwoord…' });
    const stuur = () => this.beantwoord(antw.value);
    antw.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); stuur(); } });
    this.uitvoer.append(h('div', { class: 'ai-vragen' },
      h('h3', {}, 'Claude heeft eerst nog vragen'),
      h('ol', {}, ...vragen.map((v) => h('li', {}, v))),
      h('label', { class: 'veld-label', for: 'ai-antwoord' }, 'Antwoord'),
      antw,
      h('div', { class: 'ai-rij' }, h('span', { class: 'ai-spatie' }), h('button', { type: 'button', class: 'knop primair', id: 'ai-antwoord-stuur', onclick: stuur }, 'Antwoord versturen'))));
    setTimeout(() => antw.focus({ preventScroll: true }), 0);
  }

  #renderVarianten(varianten) {
    const basis = this.gesprek.basis;
    const c0 = cijfersVoor(basis);
    const n = varianten.length;
    const kaarten = varianten.map((v, i) => {
      const c1 = cijfersVoor(v.model);
      const rij = (label, a, b, fmt, fmtD) => h('tr', {}, h('th', {}, label), h('td', {}, fmt(b)), h('td', { class: 'ai-delta' }, delta(a, b, fmtD)));
      const r0 = c0.raming, r1 = c1.raming;
      const tel = v.telling;
      const chips = Object.entries(tel).filter(([, x]) => x).map(([s, x]) => h('span', { class: `ai-chip ai-${s}` }, `${x} ${SOORT_LABEL[s]}`));
      const niveaus = voorbeeldHulp(basis, v.model, v.diff, null).niveaus;
      const nvNaam = (id) => (v.model.niveaus.find((x) => x.id === id) || basis.niveaus.find((x) => x.id === id))?.naam || id;
      return h('article', { class: `ai-variant${i === this.actief ? ' actief' : ''}`, 'data-index': String(i) },
        h('div', { class: 'ai-variant-kop' },
          h('h3', {}, n > 1 ? `${i + 1}. ${v.naam}` : v.naam),
          n > 1 ? h('button', { type: 'button', class: 'knop klein', 'aria-pressed': String(i === this.actief), onclick: () => { this.actief = i; this.render(); } }, i === this.actief ? 'In voorbeeld' : 'Toon voorbeeld') : null),
        v.beschrijving ? h('p', { class: 'ai-beschrijving' }, v.beschrijving) : null,
        h('div', { class: 'ai-chips' }, ...chips),
        niveaus.length ? h('p', { class: 'ai-niveaus' }, 'Wijzigingen op: ', ...niveaus.map((id) => h('button', { type: 'button', class: 'link', onclick: () => { this.actief = i; this.o.opNiveau(id); this.render(); } }, nvNaam(id)))) : null,
        h('table', { class: 'kc-tabel ai-cijfers' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'na'), h('th', {}, 'Δ'))),
          h('tbody', {},
            rij('Bruto', c0.kerncijfers.bruto, c1.kerncijfers.bruto, fmtM2, fmtM2),
            rij('Netto', c0.kerncijfers.netto, c1.kerncijfers.netto, fmtM2, fmtM2),
            rij('Volume', c0.kerncijfers.volume.totaal, c1.kerncijfers.volume.totaal, fmtM3, fmtM3),
            h('tr', {}, h('th', {}, 'Raming'), h('td', {}, totaalTekst(r1)), h('td', { class: 'ai-delta' }, r0.volledig && r1.volledig ? delta(r0.totaal, r1.totaal, (x) => fmtBedrag(x, r1.valuta)) : '')))),
        h('details', { class: 'ai-diff' }, h('summary', {}, `Alle wijzigingen (${v.diff.length})`),
          h('ul', {}, ...v.diffTekst.map((t) => h('li', {}, t)))),
        v.waarschuwingen?.length ? h('p', { class: 'ai-info' }, `${v.waarschuwingen.length} aandachtspunt(en) na toepassen.`) : null,
        programmaBlok(v.programmaToets),
        v.meldingen?.length ? h('details', { class: 'ai-diff ai-meldingen' }, h('summary', {}, `Meldingen van de bewerkingen (${v.meldingen.length})`),
          h('ul', {}, ...v.meldingen.map((t) => h('li', {}, t)))) : null,
        h('div', { class: 'ai-acties' },
          h('button', { type: 'button', class: `knop${n === 1 ? ' primair' : ''}`, 'data-actie': 'toepassen', onclick: () => this.toepassen(i) }, 'Toepassen'),
          n === 1 ? h('button', { type: 'button', class: 'knop', 'data-actie': 'bewaren', onclick: () => this.bewaar([i]) }, 'Als nieuwe variant bewaren') : null));
    });
    this.uitvoer.append(h('div', { class: 'ai-varianten' }, ...kaarten));
    if (n > 1) {
      this.uitvoer.append(h('div', { class: 'ai-acties ai-alle' },
        h('button', { type: 'button', class: 'knop primair', id: 'ai-alle-bewaren', onclick: () => this.bewaar(varianten.map((_, i) => i)) }, `Als ${n} nieuwe varianten bewaren`)));
    }
    this.uitvoer.append(h('p', { class: 'ai-uitleg' }, 'Voorbeeld in de plattegrond: blauw = nieuw, rood = afbraak, oranje = gewijzigd. "Toepassen" wijzigt het actieve ontwerp in één stap (ongedaan maken met Ctrl+Z / ↶).'));
  }

  #usage() {
    const g = this.gesprek;
    if (!g || !g.verbruik.length) return;
    const u = g.usage;
    const kost = u.kost > 0 ? `≈ $${u.kost < 0.01 ? u.kost.toFixed(4) : u.kost.toFixed(3)}${u.kostOnbekend ? ' (deels onbekend)' : ''}` : (u.kostOnbekend ? 'onbekend' : '$0');
    const model = MODELLEN.find((m) => m.id === g.instellingen.model)?.naam.replace(' (standaard)', '') || g.instellingen.model;
    this.uitvoer.append(h('p', { class: 'ai-usage', id: 'ai-usage' },
      `${model}, effort ${g.instellingen.effort} · ${g.verbruik.length} aanvra${g.verbruik.length === 1 ? 'ag' : 'gen'} · tokens: invoer ${fmtGetal(u.input_tokens, 0)}, uit cache gelezen ${fmtGetal(u.cache_read_input_tokens, 0)}, naar cache geschreven ${fmtGetal(u.cache_creation_input_tokens, 0)}, uitvoer ${fmtGetal(u.output_tokens, 0)} · geschatte kost ${kost} (schatting; prijzen: ${PRIJZEN_BRON})`));
  }

  // ---------------------------------------------------------------- voorbeeld en bevestigen

  /** Toont de actieve variant als voorbeeld in 3D en plattegrond (of wist het voorbeeld). */
  toonVoorbeeld() {
    const r = this.resultaat;
    const v = this.isOpen && r?.actie === 'toon' ? r.varianten[this.actief] : null;
    if (!v) { this.o.opVoorbeeld(null); return; }
    const basis = this.gesprek.basis;
    this.o.opVoorbeeld({ model: v.model, hulp: (niveau) => ({ polygonen: voorbeeldHulp(basis, v.model, v.diff, niveau).polygonen }), niveaus: voorbeeldHulp(basis, v.model, v.diff, null).niveaus });
  }

  #basisGewijzigd() {
    return this.o.beheer.actiefId !== this.basisId || this.o.beheer.model !== this.gesprek?.basis;
  }

  toepassen(i) {
    const v = this.resultaat?.varianten?.[i];
    if (!v) return;
    if (this.#basisGewijzigd()) {
      meld('Het actieve ontwerp is intussen gewijzigd of je bekijkt een ander ontwerp. Geef de opdracht opnieuw, of bewaar het voorstel als nieuwe variant.', 'fout');
      return;
    }
    const ok = this.o.opToepassen(v.ops, `Opdracht: ${v.naam}`);
    if (!ok) return;
    this.resultaat = null;
    leeg(this.uitvoer);
    this.uitvoer.append(h('p', { class: 'ai-ok', role: 'status' }, `"${v.naam}" toegepast als één stap. Ongedaan maken kan met Ctrl+Z of de knop ↶.`));
    this.#usage();
    this.o.opVoorbeeld(null);
    meld(`"${v.naam}" toegepast. Ongedaan maken: Ctrl+Z.`, 'ok');
  }

  async bewaar(indexen) {
    const r = this.resultaat;
    if (!r?.varianten) return;
    const basisNaam = this.gesprek.basis.naam;
    const lijst = indexen.map((i) => r.varianten[i]).map((v) => ({ model: v.model, naam: `${basisNaam} – ${v.naam}`, beschrijving: v.beschrijving }));
    await this.o.opBewaarNieuw(lijst, this.basisId);
  }
}
