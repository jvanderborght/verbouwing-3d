// Taakbalk (gereedschappen) + optiebalk per gereedschap. Enkel DOM; de logica zit in gereedschap.js/tekenen.js.

import { GEREEDSCHAPPEN, DIKTES, MIN_DIKTE, MAX_DIKTE, RICHTINGEN, hintVoor, normaliseerOpties } from './gereedschap.js';
import { STATUSSEN } from '../model/index.js';
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

export class Taakbalk {
  /**
   * @param {HTMLElement} el  houder (.taakbalk)
   * @param {{ opKies, opOpties, opLengte, opKlaar, opRechthoek, opties }} o
   */
  constructor(el, o) {
    this.el = el;
    this.o = o;
    this.opties = normaliseerOpties(o.opties);
    this.toestand = { gereedschap: 'selecteren', keten: false, rechthoek: 0 };
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
      if (g.id === 'niveau' || g.id === 'dak') this.balk.append(h('span', { class: 'scheiding', 'aria-hidden': 'true' }));
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
    };
    this.optiebalk.append(...Object.values(this.panelen), this.hint);
    el.append(this.optiebalk, this.balk);
    this.zet(this.toestand);
  }

  /** Werkt de taakbalk bij: actief gereedschap, keten bezig, rechthoekfase. */
  zet(t) {
    this.toestand = { ...this.toestand, ...t };
    const { gereedschap, keten, rechthoek } = this.toestand;
    for (const [id, k] of this.knoppen) if (k.hasAttribute('aria-pressed')) k.setAttribute('aria-pressed', String(id === gereedschap));
    for (const [id, p] of Object.entries(this.panelen)) p.hidden = id !== gereedschap;
    this.el.dataset.gereedschap = gereedschap;
    if (this.klaarKnop) this.klaarKnop.hidden = !keten;
    if (this.rechthoekKnop) {
      this.rechthoekKnop.textContent = rechthoek ? 'Annuleren' : 'Rechthoek';
      this.rechthoekKnop.title = rechthoek ? 'Rechthoek tekenen annuleren' : 'Ruimte als rechthoek tekenen (voor open gebieden)';
    }
    this.hint.textContent = hintVoor(gereedschap, { keten, rechthoek });
  }

  _wijzigOpties(fn) {
    const o = structuredClone(this.opties);
    fn(o);
    this.opties = normaliseerOpties(o);
    this.o.opOpties(this.opties);
  }

  _statusKeuze(sleutel) {
    const sel = h('select', { class: 'opt-status', 'aria-label': 'Status', title: 'Status van nieuwe elementen' },
      ...STATUSSEN.map((s) => h('option', { value: s, selected: this.opties[sleutel].status === s }, s)));
    sel.addEventListener('change', () => this._wijzigOpties((o) => { o[sleutel].status = sel.value; }));
    return h('label', { class: 'opt-veld' }, h('span', { class: 'opt-label' }, 'Status'), sel);
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

  _ruimtePaneel() {
    this.rechthoekKnop = h('button', { type: 'button', class: 'knop klein' }, 'Rechthoek');
    this.rechthoekKnop.addEventListener('click', () => { this.rechthoekKnop.blur(); this.o.opRechthoek(); });
    return h('div', { class: 'opt-paneel' }, this.rechthoekKnop);
  }
}

