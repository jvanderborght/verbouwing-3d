// Taakbalk (gereedschappen) + optiebalk per gereedschap. Enkel DOM; de logica zit in gereedschap.js/tekenen.js.

import { GEREEDSCHAPPEN, DIKTES, MIN_DIKTE, MAX_DIKTE, RICHTINGEN, HOEKEN, hintVoor, normaliseerOpties } from './gereedschap.js';
import { STATUSSEN, TRAP_TYPES, INRICHTING_SOORTEN } from '../model/index.js';
import { leesGetal } from './eigenschappen.js';
import { h } from './dom.js';

const ico = (naam) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#i-${naam}`);
  s.append(u);
  return s;
};

const PIJL = { rechts: '→', omhoog: '↑', links: '←', omlaag: '↓' };
const PIJL_LABEL = { rechts: 'naar rechts', omhoog: 'naar achter (omhoog in plan)', links: 'naar links', omlaag: 'naar voor (omlaag in plan)' };
/** Looprichting (graden) ⇄ pijl. */
const HOEK_PIJL = { 0: 'rechts', 90: 'omhoog', 180: 'links', 270: 'omlaag' };
export const TRAP_LABELS = { recht: 'Recht', kwart: 'Kwartdraai', halfdraai: 'Halfdraai (U)', spiraal: 'Spiraal' };

export class Taakbalk {
  /**
   * @param {HTMLElement} el  houder (.taakbalk)
   * @param {{ opKies, opOpties, opLengte, opKlaar, opRechthoek, opAfbreken?, opWisZone?, opties }} o
   */
  constructor(el, o) {
    this.el = el;
    this.o = o;
    this.opties = normaliseerOpties(o.opties);
    this.toestand = { gereedschap: 'selecteren', keten: false, rechthoek: 0, zone: 0, trapNaar: null };
    this._verversers = [];
    this.knoppen = new Map();

    this.balk = h('div', { class: 'gereedschappen', role: 'toolbar', 'aria-label': 'Tekengereedschap' });
    for (const g of GEREEDSCHAPPEN) {
      const k = h('button', {
        type: 'button', class: `gereedschap${g.actie ? ' actie' : ''}`, 'data-gereedschap': g.id,
        title: g.toets ? `${g.label} (${g.toets.toUpperCase()})` : g.label, 'aria-label': g.label,
        'aria-pressed': g.actie ? null : String(g.id === 'selecteren'),
      }, ico(g.id), h('span', { class: 'gereedschap-label' }, g.kort));
      // blur: een gefocuste knop mag niet geactiveerd worden door spatie (= pannen in de plattegrond)
      k.addEventListener('click', () => { k.blur(); o.opKies(g.id); });
      if (g.id === 'trap' || g.id === 'niveau') this.balk.append(h('span', { class: 'scheiding', 'aria-hidden': 'true' }));
      this.balk.append(k);
      this.knoppen.set(g.id, k);
    }
    this.optiebalk = h('div', { class: 'optiebalk', role: 'group', 'aria-label': 'Opties' });
    this.hint = h('span', { class: 'opt-hint', role: 'status', 'aria-live': 'polite' });
    this.panelen = {
      selecteren: h('div', { class: 'opt-paneel' }),
      muur: this._muurPaneel(),
      deur: this._openingPaneel('deur'),
      raam: this._openingPaneel('raam'),
      ruimte: this._ruimtePaneel(),
      verwijderen: h('div', { class: 'opt-paneel' }),
      trap: this._trapPaneel(),
      inrichting: this._inrichtingPaneel(),
      afbraak: this._afbraakPaneel(),
    };
    this.optiebalk.append(...Object.values(this.panelen), this.hint);
    el.append(this.optiebalk, this.balk);
    this.zet(this.toestand);
  }

  /** Werkt de taakbalk bij: actief gereedschap, keten bezig, rechthoekfase. */
  zet(t) {
    this.toestand = { ...this.toestand, ...t };
    const { gereedschap, keten, rechthoek, zone, trapNaar } = this.toestand;
    for (const [id, k] of this.knoppen) if (k.hasAttribute('aria-pressed')) k.setAttribute('aria-pressed', String(id === gereedschap));
    for (const [id, p] of Object.entries(this.panelen)) p.hidden = id !== gereedschap;
    this.el.dataset.gereedschap = gereedschap;
    if (this.klaarKnop) this.klaarKnop.hidden = !keten;
    if (this.rechthoekKnop) {
      this.rechthoekKnop.textContent = rechthoek ? 'Annuleren' : 'Rechthoek';
      this.rechthoekKnop.title = rechthoek ? 'Rechthoek tekenen annuleren' : 'Ruimte als rechthoek tekenen (voor open gebieden)';
    }
    if (this.zoneTekst) {
      this.zoneTekst.textContent = zone ? `${zone} ${zone === 1 ? 'ruimte' : 'ruimtes'}` : 'geen ruimtes';
      this.afbreekKnop.disabled = !zone;
      this.wisZoneKnop.disabled = !zone;
    }
    if (this.trapNaarTekst) this.trapNaarTekst.textContent = trapNaar ? `→ ${trapNaar}` : '→ geen niveau erboven';
    this.hint.textContent = hintVoor(gereedschap, { keten, rechthoek, zone });
  }

  /** Opties van buitenaf gewijzigd (bv. richting na slepen): velden bijwerken. */
  zetOpties(opties) {
    this.opties = normaliseerOpties(opties);
    for (const f of this._verversers) f();
  }

  _wijzigOpties(fn) {
    const o = structuredClone(this.opties);
    fn(o);
    this.opties = normaliseerOpties(o);
    this.o.opOpties(this.opties);
  }

  _statusKeuze(sleutel) {
    return this._keuze('Status', sleutel, 'status', STATUSSEN, {}, 'Status van nieuwe elementen');
  }

  /** Keuzelijst gekoppeld aan opties[sleutel][veld]. */
  _keuze(label, sleutel, veld, waarden, labels = {}, titel = '') {
    const sel = h('select', { class: `opt-keuze opt-${veld}`, 'aria-label': label, title: titel || label, 'data-optie': `${sleutel}.${veld}` },
      ...waarden.map((w) => h('option', { value: w, selected: this.opties[sleutel][veld] === w }, labels[w] || w)));
    sel.addEventListener('change', () => this._wijzigOpties((o) => { o[sleutel][veld] = sel.value; }));
    this._verversers.push(() => { sel.value = this.opties[sleutel][veld]; });
    return h('label', { class: 'opt-veld' }, h('span', { class: 'opt-label' }, label), sel);
  }

  /** Segmentknoppen gekoppeld aan opties[sleutel][veld]. waarden: [{ waarde, tekst, titel }] */
  _segment(label, sleutel, veld, waarden, { klasse = '' } = {}) {
    const groep = h('div', { class: `segment ${klasse}`, role: 'group', 'aria-label': label, 'data-optie': `${sleutel}.${veld}` });
    const toon = () => { for (const b of groep.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.waarde === String(this.opties[sleutel][veld]))); };
    for (const w of waarden) {
      const b = h('button', { type: 'button', class: 'seg-knop', 'data-waarde': String(w.waarde), title: w.titel || w.tekst, 'aria-label': w.titel || w.tekst }, w.tekst);
      b.addEventListener('click', () => { b.blur(); this._wijzigOpties((o) => { o[sleutel][veld] = w.waarde; }); toon(); });
      groep.append(b);
    }
    toon();
    this._verversers.push(toon);
    return h('div', { class: 'opt-veld' }, h('span', { class: 'opt-label' }, label), groep);
  }

  _getalVeld(label, waarde, bijWijziging, { breed = false, titel = '' } = {}) {
    const inp = h('input', { type: 'text', inputmode: 'numeric', class: `opt-getal${breed ? ' breed' : ''}`, value: String(waarde), autocomplete: 'off', title: titel, 'aria-label': `${label} (mm)` });
    inp.addEventListener('change', () => {
      const v = leesGetal(inp.value);
      if (!Number.isFinite(v) || !bijWijziging(v, inp)) inp.value = String(inp.dataset.vorige ?? waarde);
      else inp.dataset.vorige = inp.value;
    });
    inp.dataset.vorige = String(waarde);
    return { inp, el: h('label', { class: 'opt-veld' }, h('span', { class: 'opt-label' }, label), inp) };
  }

  _muurPaneel() {
    const p = h('div', { class: 'opt-paneel' });
    // dikte: vaste knoppen + vrij veld
    const diktes = h('div', { class: 'segment', role: 'group', 'aria-label': 'Muurdikte (mm)' });
    const vrij = h('input', { type: 'text', inputmode: 'numeric', class: 'opt-getal', 'aria-label': 'Vrije muurdikte (mm)', title: 'Vrije dikte (mm)', autocomplete: 'off' });
    const toonDikte = () => {
      const d = this.opties.muur.dikte;
      for (const b of diktes.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.dikte) === d));
      vrij.value = DIKTES.includes(d) ? '' : String(d);
      vrij.placeholder = 'vrij';
    };
    for (const d of DIKTES) {
      const b = h('button', { type: 'button', class: 'seg-knop', 'data-dikte': d, title: `Dikte ${d} mm` }, String(d));
      b.addEventListener('click', () => { b.blur(); this._wijzigOpties((o) => { o.muur.dikte = d; }); toonDikte(); });
      diktes.append(b);
    }
    vrij.addEventListener('change', () => {
      const v = leesGetal(vrij.value);
      if (Number.isFinite(v) && v >= MIN_DIKTE && v <= MAX_DIKTE) this._wijzigOpties((o) => { o.muur.dikte = Math.round(v); });
      toonDikte();
    });
    diktes.append(vrij);
    toonDikte();

    // lengte + richting
    const lengte = h('input', { type: 'text', inputmode: 'numeric', class: 'opt-getal breed', id: 'opt-lengte', placeholder: 'mm', autocomplete: 'off', enterkeyhint: 'done', title: 'Lengte van de volgende muur (mm) + Enter', 'aria-label': 'Lengte van de volgende muur in mm' });
    const geefLengte = (richting) => {
      const v = leesGetal(lengte.value);
      if (!Number.isFinite(v)) { lengte.focus(); return; }
      if (this.o.opLengte(v, richting)) lengte.select();
    };
    lengte.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); geefLengte(null); }
      else if (e.key === 'Escape') { lengte.blur(); }
    });
    const pijlen = h('div', { class: 'segment pijlen', role: 'group', 'aria-label': 'Muur met deze lengte in richting' },
      ...Object.keys(RICHTINGEN).map((r) => {
        const b = h('button', { type: 'button', class: 'seg-knop', title: `Muur met deze lengte ${PIJL_LABEL[r]}`, 'aria-label': `Muur ${PIJL_LABEL[r]}` }, PIJL[r]);
        b.addEventListener('click', () => { b.blur(); geefLengte(RICHTINGEN[r]); });
        return b;
      }));
    this.klaarKnop = h('button', { type: 'button', class: 'knop klein primair opt-klaar', hidden: true }, 'Klaar');
    this.klaarKnop.addEventListener('click', () => { this.klaarKnop.blur(); this.o.opKlaar(); });

    p.append(
      h('div', { class: 'opt-veld' }, h('span', { class: 'opt-label' }, 'Dikte'), diktes),
      this._statusKeuze('muur'),
      h('div', { class: 'opt-veld opt-lengte-veld' }, h('label', { class: 'opt-label', for: 'opt-lengte' }, 'Lengte'), lengte, pijlen),
      this.klaarKnop,
    );
    return p;
  }

  _openingPaneel(type) {
    const p = h('div', { class: 'opt-paneel' });
    const o = this.opties[type];
    const veld = (sleutel, label, min) => this._getalVeld(label, o[sleutel], (v) => {
      if (v < min || v > 20000) return false;
      this._wijzigOpties((x) => { x[type][sleutel] = Math.round(v); });
      return true;
    }).el;
    p.append(veld('breedte', 'Breedte', 100), veld('hoogte', 'Hoogte', 100), veld('borstwering', 'Borstw.', 0), this._statusKeuze(type));
    return p;
  }

  _trapPaneel() {
    const breedte = this._getalVeld('Breedte', this.opties.trap.breedte, (v) => {
      if (v < 300 || v > 5000) return false;
      this._wijzigOpties((x) => { x.trap.breedte = Math.round(v); });
      return true;
    }, { titel: 'Loopbreedte (mm). Vertrekwaarde, geen norm.' });
    this._verversers.push(() => { breedte.inp.value = String(this.opties.trap.breedte); breedte.inp.dataset.vorige = breedte.inp.value; });
    this.trapNaarTekst = h('span', { class: 'opt-info', id: 'opt-trap-naar' });
    return h('div', { class: 'opt-paneel' },
      this._keuze('Type', 'trap', 'type', TRAP_TYPES, TRAP_LABELS),
      breedte.el,
      this._segment('Draai', 'trap', 'draairichting', [{ waarde: 'links', tekst: '↺', titel: 'Draait naar links (tegenwijzerzin)' }, { waarde: 'rechts', tekst: '↻', titel: 'Draait naar rechts (wijzerzin)' }]),
      this._segment('Looprichting', 'trap', 'richting', HOEKEN.map((a) => ({ waarde: a, tekst: PIJL[HOEK_PIJL[a]], titel: `Looprichting ${PIJL_LABEL[HOEK_PIJL[a]]}` })), { klasse: 'pijlen' }),
      this._statusKeuze('trap'),
      this.trapNaarTekst);
  }

  _inrichtingPaneel() {
    return h('div', { class: 'opt-paneel' },
      this._keuze('Soort', 'inrichting', 'soort', INRICHTING_SOORTEN),
      this._segment('Plaats', 'inrichting', 'plaatsing', [{ waarde: 'wand', tekst: 'tegen wand', titel: 'Automatisch tegen een wand van de aangetikte ruimte' }, { waarde: 'punt', tekst: 'op tikpunt', titel: 'Middelpunt op het tikpunt (met de rotatie hiernaast)' }]),
      this._segment('Rotatie', 'inrichting', 'rotatie', HOEKEN.map((a) => ({ waarde: a, tekst: `${a}°`, titel: `Rotatie ${a}° (enkel bij plaatsen op het tikpunt)` }))),
      this._statusKeuze('inrichting'));
  }

  _afbraakPaneel() {
    this.zoneTekst = h('span', { class: 'opt-info', id: 'opt-zone' }, 'geen ruimtes');
    this.afbreekKnop = h('button', { type: 'button', class: 'knop klein gevaar', id: 'knop-afbreken', disabled: true }, 'Afbreken…');
    this.afbreekKnop.addEventListener('click', () => { this.afbreekKnop.blur(); this.o.opAfbreken?.(); });
    this.wisZoneKnop = h('button', { type: 'button', class: 'knop klein', id: 'knop-zone-wissen', disabled: true }, 'Wissen');
    this.wisZoneKnop.addEventListener('click', () => { this.wisZoneKnop.blur(); this.o.opWisZone?.(); });
    return h('div', { class: 'opt-paneel' }, h('span', { class: 'opt-label' }, 'Zone'), this.zoneTekst, this.afbreekKnop, this.wisZoneKnop);
  }

  _ruimtePaneel() {
    this.rechthoekKnop = h('button', { type: 'button', class: 'knop klein' }, 'Rechthoek');
    this.rechthoekKnop.addEventListener('click', () => { this.rechthoekKnop.blur(); this.o.opRechthoek(); });
    return h('div', { class: 'opt-paneel' }, this.rechthoekKnop);
  }
}

