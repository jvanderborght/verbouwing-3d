// Programma van eisen (fase 5) — DOM: blok in het eigenschappenpaneel (zonder selectie) met het toetsresultaat,
// en een editor-dialoog. Wijzigen gebeurt enkel via de operatie `ontwerp` (callback opWijzig ⇒ één undo-stap).

import { FUNCTIES, INRICHTING_SOORTEN, TRAP_TYPES } from '../model/index.js';
import { h, leeg } from './dom.js';
import { dialoog } from './dialogen.js';
import { leegFormulier, eisNaarFormulier, programmaOps, niveauKeuzes, toetsWeergave } from './programma.js';

const STATUS_TEKST = { voldoet: 'voldoet', 'voldoet niet': 'voldoet niet', onbekend: 'onbekend' };

/**
 * Blok "Programma van eisen" voor onder het ontwerp.
 * @param {object} model
 * @param {{ opBewerk: () => void, opSelecteer?: (id) => void }} o
 */
export function programmaBlok(model, { opBewerk }) {
  const p = model.programma;
  const blok = h('section', { class: 'programma-blok', id: 'programma-blok', 'aria-labelledby': 'programma-kop' },
    h('div', { class: 'blok-kop' },
      h('h3', { id: 'programma-kop' }, 'Programma van eisen'),
      h('button', { type: 'button', class: 'knop klein', id: 'knop-programma', onclick: opBewerk }, p ? 'Bewerken…' : 'Invullen…')));
  if (!p) {
    blok.append(h('p', { class: 'leeg' }, 'Nog geen programma. Vul in wat het ontwerp moet bevatten (bv. 2 slaapkamers op de zolder, een badkamer met lavabo en douche, een trap naar de zolder); de app toetst het ontwerp eraan.'));
    return blok;
  }
  if (p.beschrijving) blok.append(h('p', { class: 'programma-beschrijving' }, p.beschrijving));
  const t = toetsWeergave(model);
  blok.append(h('p', { class: 'programma-samenvatting', id: 'programma-samenvatting' }, t.samenvatting));
  if (t.regels.length) {
    blok.append(h('ul', { class: 'toets-lijst', id: 'toets-lijst' }, ...t.regels.map((r) => h('li', { class: `toets toets-${r.klasse}` },
      h('details', {},
        h('summary', {}, h('span', { class: `toets-chip toets-chip-${r.klasse}` }, STATUS_TEKST[r.status] || r.status), ' ', h('span', { class: 'toets-label' }, r.label)),
        h('p', { class: 'toets-uitleg' }, r.uitleg))))));
  }
  blok.append(h('p', { class: 'veld-uitleg' }, 'Er worden geen normen getoetst: enkel wat in de eisen staat (en trapgrenzen als je die zelf instelt).'));
  return blok;
}

const sel = (opties, waarde, attrs = {}) => {
  const s = h('select', attrs, ...opties.map((o) => (typeof o === 'string' ? h('option', { value: o, selected: o === waarde }, o) : h('option', { value: o.waarde, selected: o.waarde === waarde }, o.label))));
  s.value = waarde ?? '';
  return s;
};

const inp = (waarde, attrs = {}) => h('input', { type: 'text', autocomplete: 'off', value: waarde ?? '', ...attrs });

/** Rij met aanvinkbare chips (meervoudige keuze). */
function chips(opties, gekozen, naam, opWijzig) {
  const set = new Set(gekozen);
  return h('div', { class: 'chips', role: 'group', 'aria-label': naam }, ...opties.map((o) => {
    const cb = h('input', { type: 'checkbox', value: o, checked: set.has(o) });
    cb.addEventListener('change', () => { if (cb.checked) set.add(o); else set.delete(o); opWijzig(opties.filter((x) => set.has(x))); });
    return h('label', { class: 'chip' }, cb, h('span', {}, o));
  }));
}

/**
 * Editor-dialoog. Geeft de operaties terug (of null bij annuleren). Toepassen doet de app (één undo-stap).
 * @returns {Promise<object[]|null>}
 */
export async function programmaDialoog(model) {
  const p = model.programma || { eisen: [] };
  const formulieren = (p.eisen || []).map(eisNaarFormulier);
  const niveaus = niveauKeuzes(model);
  const naarNiveaus = niveauKeuzes(model, { leegLabel: 'elk' });
  const besch = h('textarea', { id: 'prog-beschrijving', rows: 2, placeholder: 'bv. compact plan onder het dak' }, p.beschrijving || '');
  const lijst = h('ol', { class: 'eis-lijst', id: 'eis-lijst' });
  const fout = h('p', { class: 'dlg-fout', role: 'alert', hidden: true });

  const teken = () => {
    leeg(lijst);
    formulieren.forEach((f, i) => {
      const verwijder = h('button', { type: 'button', class: 'knop klein gevaar', 'aria-label': `Eis ${i + 1} verwijderen`, onclick: () => { formulieren.splice(i, 1); teken(); } }, 'Verwijderen');
      const veld = (label, el, extra = '') => h('label', { class: `eis-veld ${extra}` }, h('span', { class: 'veld-label' }, label), el);
      const bind = (el, sleutel) => { el.addEventListener('change', () => { f[sleutel] = el.value; }); el.addEventListener('input', () => { f[sleutel] = el.value; }); return el; };
      const soort = sel([{ waarde: 'ruimte', label: 'Ruimte' }, { waarde: 'trap', label: 'Trap' }], f.soort, { 'data-veld': 'soort', 'aria-label': 'Soort eis' });
      soort.addEventListener('change', () => { formulieren[i] = { ...leegFormulier(soort.value), naam: f.naam }; teken(); });
      const kop = h('div', { class: 'eis-kop' }, h('strong', {}, `Eis ${i + 1}`), soort, verwijder);
      let velden;
      if (f.soort === 'trap') {
        velden = h('div', { class: 'eis-velden' },
          veld('Van', bind(sel(niveaus, f.van, { 'data-veld': 'van' }), 'van')),
          veld('Naar', bind(sel(naarNiveaus, f.naar, { 'data-veld': 'naar' }), 'naar')),
          veld('Aantal', bind(inp(f.aantal, { inputmode: 'numeric', class: 'kort', 'data-veld': 'aantal' }), 'aantal')),
          veld('Type (leeg = elk)', chips(TRAP_TYPES, f.types, 'Traptypes', (v) => { f.types = v; }), 'breed'),
          veld('Naam (optioneel)', bind(inp(f.naam, { 'data-veld': 'naam' }), 'naam'), 'breed'));
      } else {
        velden = h('div', { class: 'eis-velden' },
          veld('Functie', bind(sel(FUNCTIES, f.functie, { 'data-veld': 'functie' }), 'functie')),
          veld('Aantal', bind(inp(f.aantal, { inputmode: 'numeric', class: 'kort', 'data-veld': 'aantal' }), 'aantal')),
          veld('Niveau', bind(sel(niveaus, f.niveau, { 'data-veld': 'niveau' }), 'niveau')),
          veld('Min. oppervlakte (m²)', bind(inp(f.minOppervlakte, { inputmode: 'decimal', class: 'kort', placeholder: '—', 'data-veld': 'minOppervlakte' }), 'minOppervlakte')),
          veld('Enkel waar vrije hoogte ≥ (mm)', bind(inp(f.hoogteGrens, { inputmode: 'decimal', class: 'kort', placeholder: '—', 'data-veld': 'hoogteGrens' }), 'hoogteGrens')),
          veld('Inrichting in de ruimte', chips(INRICHTING_SOORTEN, f.inrichting, 'Inrichting', (v) => { f.inrichting = v; }), 'breed'),
          veld('Naam (optioneel)', bind(inp(f.naam, { 'data-veld': 'naam' }), 'naam'), 'breed'));
      }
      lijst.append(h('li', { class: 'eis', 'data-soort': f.soort }, kop, velden));
    });
    if (!formulieren.length) lijst.append(h('li', { class: 'leeg' }, 'Nog geen eisen.'));
  };
  teken();

  let ops = null;
  const r = await dialoog({
    titel: 'Programma van eisen',
    klasse: 'breed programma-dialoog',
    inhoud: [
      h('p', { class: 'veld-uitleg' }, 'Wat moet het ontwerp bevatten? Niveau = een niveau-id of een soort (zolder, verdieping, kelder). Leeg gelaten velden worden niet getoetst.'),
      h('label', { class: 'veld-label', for: 'prog-beschrijving' }, 'Beschrijving (optioneel)'), besch,
      lijst,
      h('div', { class: 'eis-toevoegen' },
        h('button', { type: 'button', class: 'knop klein', id: 'eis-plus-ruimte', onclick: () => { formulieren.push(leegFormulier('ruimte')); teken(); } }, '+ Ruimte-eis'),
        h('button', { type: 'button', class: 'knop klein', id: 'eis-plus-trap', onclick: () => { formulieren.push(leegFormulier('trap')); teken(); } }, '+ Trap-eis')),
      fout,
    ],
    knoppen: [{ label: 'Annuleren', waarde: null }, {
      label: 'Bewaren', waarde: 'ok', soort: 'primair',
      controle: () => {
        const x = programmaOps(formulieren, besch.value);
        if (x.fout) { fout.textContent = x.fout; fout.hidden = false; return false; }
        ops = x.ops;
        return true;
      },
    }],
  });
  return r === 'ok' ? ops : null;
}
