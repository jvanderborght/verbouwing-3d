// Eigenschappenpaneel: toont het geselecteerde element (alle velden uit het schema) of, zonder selectie,
// het ontwerp zelf met een lijst van alle elementen. Getallen, tekst en keuzelijsten zijn bewerkbaar;
// elke wijziging wordt een `wijzigen`- of `ontwerp`-operatie (via de callback `opWijzig`).
// Muren (fase 2): start/eind als x/y-velden (opsMuurEindpunt), bewerkbare lengte (opsMuurLengte) en hoek (info).
// Contouren blijven alleen-lezen. Onderaan: element verwijderen (cascade; niveau met bevestiging, via opVerwijder).

import { VELDEN, ENUMS, COLLECTIE_NAMEN, polygoonOppervlakte, muurLengte, opsMuurEindpunt, opsMuurLengte } from '../model/index.js';
import { h, leeg } from './dom.js';
import { muurHoek } from './gereedschap.js';

export const ENKELVOUD = { niveaus: 'Niveau', muren: 'Muur', openingen: 'Opening', ruimtes: 'Ruimte', vloeren: 'Vloer', daken: 'Dak' };
export const MEERVOUD = { niveaus: 'Niveaus', muren: 'Muren', openingen: 'Openingen', ruimtes: 'Ruimtes', vloeren: 'Vloeren', daken: 'Daken' };

const LABELS = {
  id: 'Id', naam: 'Naam', peil: 'Peil', hoogte: 'Hoogte', vloerdikte: 'Vloerdikte', niveau: 'Niveau',
  start: 'Start (as)', eind: 'Eind (as)', dikte: 'Dikte', status: 'Status', muur: 'Muur', type: 'Type',
  positie: 'Positie', breedte: 'Breedte', borstwering: 'Borstwering', functie: 'Functie', contour: 'Contour',
  helling: 'Helling', nokrichting: 'Nokrichting', overstek: 'Overstek',
};
const EENHEID = { helling: '°' };

/** Zoekt een element op id over alle collecties. → { collectie, item } of null */
export function zoekElement(model, id) {
  if (!model || !id) return null;
  for (const c of COLLECTIE_NAMEN) {
    const item = (model[c] || []).find((x) => x.id === id);
    if (item) return { collectie: c, item };
  }
  return null;
}

/** Niveau-id waarop een element ligt (opening → niveau van haar muur; niveau → zichzelf). */
export function niveauVanElement(model, id) {
  const z = zoekElement(model, id);
  if (!z) return null;
  if (z.collectie === 'niveaus') return z.item.id;
  if (z.collectie === 'openingen') return (model.muren || []).find((m) => m.id === z.item.muur)?.niveau ?? null;
  return z.item.niveau ?? null;
}

/** Element-id uit een validatiepad zoals "muren[2].dikte". */
export function elementUitPad(model, pad) {
  const m = /^([a-z]+)\[(\d+)\]/.exec(pad || '');
  if (!m || !COLLECTIE_NAMEN.includes(m[1])) return null;
  return model?.[m[1]]?.[Number(m[2])]?.id ?? null;
}

const fmtGetal = (v) => (typeof v === 'number' ? v.toLocaleString('nl-BE', { maximumFractionDigits: 1 }) : String(v));

/**
 * Beschrijving van de velden van een element (DOM-vrij).
 * soort: 'getal' | 'tekst' | 'keuze' | 'ref' | 'punt' | 'contour' | 'id'
 * @returns {Array<{ veld, label, soort, waarde, eenheid?, opties?, verplicht, tekst }>}
 */
export function veldRijen(model, collectie, item) {
  return VELDEN[collectie].map(([veld, type, verplicht]) => {
    const waarde = item[veld];
    const rij = { veld, label: LABELS[veld] || veld, verplicht, waarde };
    if (veld === 'id') return { ...rij, soort: 'id', tekst: String(waarde) };
    if (type === 'number') return { ...rij, soort: 'getal', eenheid: EENHEID[veld] || 'mm', tekst: waarde == null ? '' : fmtGetal(waarde) };
    if (type === 'string') return { ...rij, soort: 'tekst', tekst: waarde ?? '' };
    if (type.startsWith('enum:')) return { ...rij, soort: 'keuze', opties: ENUMS[type.slice(5)], tekst: waarde ?? '' };
    if (type.startsWith('ref:')) {
      const doel = type.slice(4);
      const opties = (model[doel] || []).map((x) => x.id);
      const ref = (model[doel] || []).find((x) => x.id === waarde);
      return { ...rij, soort: 'ref', opties, tekst: ref?.naam ? `${waarde} – ${ref.naam}` : String(waarde ?? '') };
    }
    if (type === 'punt') return { ...rij, soort: 'punt', eenheid: 'mm', tekst: Array.isArray(waarde) ? `${fmtGetal(waarde[0])} ; ${fmtGetal(waarde[1])}` : '' };
    if (type === 'contour') {
      const opp = Array.isArray(waarde) ? polygoonOppervlakte(waarde) / 1e6 : 0;
      return { ...rij, soort: 'contour', tekst: Array.isArray(waarde) ? `${waarde.length} punten · ${fmtGetal(Math.round(opp * 100) / 100)} m²` : '' };
    }
    return { ...rij, soort: 'tekst', tekst: String(waarde ?? '') };
  });
}

/** Korte omschrijving van een element voor lijsten. */
export function elementLabel(model, collectie, item) {
  if (item.naam) return `${item.id} · ${item.naam}`;
  if (collectie === 'muren') return `${item.id} · ${Math.round(muurLengte(item))} mm · ${item.status}`;
  if (collectie === 'openingen') return `${item.id} · ${item.type} ${item.breedte}×${item.hoogte} · ${item.status}`;
  if (collectie === 'daken') return `${item.id} · ${item.type} · ${item.status}`;
  if (collectie === 'vloeren') return `${item.id} · ${item.dikte} mm · ${item.status}`;
  return item.id;
}

/**
 * Tekent het paneel.
 * @param {HTMLElement} el
 * @param {{ model, selectie, opWijzig: (ops, label) => {ok}, opSelecteer: (id|null) => void,
 *           opBewerking?: (r: {ops, fout?}, label) => {ok}, opVerwijder?: (id) => void,
 *           ontwerpExtra?: (model) => Node|null }} o   ontwerpExtra: extra blok onder het ontwerp (kerncijfers)
 */
export function tekenEigenschappen(el, { model, selectie, opWijzig, opSelecteer, opBewerking, opVerwijder, ontwerpExtra }) {
  leeg(el);
  if (!model) { el.append(h('p', { class: 'leeg' }, 'Geen ontwerp geopend.')); return; }
  const z = zoekElement(model, selectie);
  if (!z) { tekenOntwerp(el, model, opWijzig, opSelecteer, ontwerpExtra); return; }
  const { collectie, item } = z;

  el.append(h('div', { class: 'eig-kop' },
    h('div', {},
      h('div', { class: 'eig-soort' }, ENKELVOUD[collectie]),
      h('h2', { class: 'eig-titel' }, elementLabel(model, collectie, item))),
    h('button', { type: 'button', class: 'knop klein', onclick: () => opSelecteer(null), title: 'Selectie opheffen' }, 'Sluiten')));
  if (item.status) el.append(h('div', { class: `status-chip status-${item.status}` }, item.status));

  const bewerk = opBewerking || ((r, label) => (r.fout ? { ok: false } : opWijzig(r.ops, label)));
  const lijst = h('dl', { class: 'velden' });
  for (const rij of veldRijen(model, collectie, item)) {
    const forId = rij.soort === 'punt' && collectie === 'muren' ? `veld-${rij.veld}-x` : `veld-${rij.veld}`;
    lijst.append(h('dt', {}, h('label', { for: forId }, rij.label, rij.verplicht ? '' : h('span', { class: 'optioneel' }, ' (optioneel)'))));
    if (rij.soort === 'punt' && collectie === 'muren') {
      lijst.append(h('dd', {}, puntInvoer(rij, (p) => bewerk(opsMuurEindpunt(model, item.id, rij.veld, p), `${rij.veld === 'start' ? 'Startpunt' : 'Eindpunt'} wijzigen`))));
      if (rij.veld === 'eind') {
        const L = Math.round(muurLengte(item) * 10) / 10;
        lijst.append(h('dt', {}, h('label', { for: 'veld-lengte' }, 'Lengte (as)')));
        lijst.append(h('dd', {}, veldInvoer({ veld: 'lengte', soort: 'getal', eenheid: 'mm', verplicht: true, waarde: L },
          (v) => bewerk(opsMuurLengte(model, item.id, v), 'Muurlengte wijzigen'))));
        lijst.append(h('dt', {}, 'Hoek'));
        lijst.append(h('dd', {}, h('output', { class: 'alleen-lezen', id: 'veld-hoek' }, `${fmtGetal(muurHoek(item))}°`)));
      }
      continue;
    }
    lijst.append(h('dd', {}, veldInvoer(rij, (waarde) => opWijzig([{ op: 'wijzigen', collectie, id: item.id, velden: { [rij.veld]: waarde } }], `${LABELS[rij.veld] || rij.veld} wijzigen`))));
  }
  el.append(lijst);
  if (opVerwijder) {
    el.append(h('div', { class: 'eig-acties' },
      h('button', { type: 'button', class: 'knop gevaar', id: 'eig-verwijder', onclick: () => opVerwijder(item.id) },
        `${ENKELVOUD[collectie]} verwijderen`)));
  }
}

/** Twee getalvelden (x, y) voor een punt; wijzigen ⇒ wijzig([x, y]). Geweigerd ⇒ oude waarden terug. */
function puntInvoer(rij, wijzig) {
  const [x0, y0] = Array.isArray(rij.waarde) ? rij.waarde : [0, 0];
  const mk = (as, w) => h('input', { id: `veld-${rij.veld}-${as}`, type: 'text', inputmode: 'decimal', value: w, 'data-veld': `${rij.veld}.${as}`, autocomplete: 'off', 'aria-label': `${rij.label} ${as}` });
  const ix = mk('x', x0), iy = mk('y', y0);
  const opWijziging = () => {
    const x = leesGetal(ix.value), y = leesGetal(iy.value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === x0 && y === y0) || !wijzig([x, y]).ok) { ix.value = x0; iy.value = y0; }
  };
  ix.addEventListener('change', opWijziging);
  iy.addEventListener('change', opWijziging);
  return h('div', { class: 'punt-invoer' },
    h('span', { class: 'as' }, 'x'), ix, h('span', { class: 'as' }, 'y'), iy, h('span', { class: 'eenheid' }, 'mm'));
}

/**
 * Leest een getal zoals een Vlaamse gebruiker het typt: "1.200" en "1 200" = 1200 (duizendtallen),
 * "2,5" en "2.5" = 2,5. Geeft NaN bij ongeldige invoer.
 */
export function leesGetal(tekst) {
  let t = String(tekst).trim().replace(/[\s\u00a0\u202f]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return t === '' || !/^-?(\d+\.?\d*|\.\d+)$/.test(t) ? NaN : Number(t);
}

/** Invoerveld voor één rij. Bij een geweigerde wijziging wordt de oude waarde teruggezet. */
function veldInvoer(rij, wijzig) {
  const id = `veld-${rij.veld}`;
  const terug = (inp, waarde) => { inp.value = waarde; };
  if (rij.soort === 'getal') {
    const inp = h('input', { id, type: 'text', inputmode: 'decimal', value: rij.waarde ?? '', 'data-veld': rij.veld, autocomplete: 'off', placeholder: rij.verplicht ? '' : '—' });
    inp.addEventListener('change', () => {
      const t = inp.value.trim();
      if (t === '' && !rij.verplicht) { if (!wijzig(null).ok) terug(inp, rij.waarde ?? ''); return; }
      const v = leesGetal(t);
      if (!Number.isFinite(v)) { terug(inp, rij.waarde ?? ''); return; }
      if (!wijzig(v).ok) terug(inp, rij.waarde ?? '');
    });
    return h('div', { class: 'invoer-met-eenheid' }, inp, h('span', { class: 'eenheid' }, rij.eenheid));
  }
  if (rij.soort === 'tekst') {
    const inp = h('input', { id, type: 'text', value: rij.waarde ?? '', 'data-veld': rij.veld, autocomplete: 'off' });
    inp.addEventListener('change', () => { if (!wijzig(inp.value).ok) terug(inp, rij.waarde ?? ''); });
    return inp;
  }
  if (rij.soort === 'keuze' || rij.soort === 'ref') {
    const sel = h('select', { id, 'data-veld': rij.veld },
      !rij.verplicht ? h('option', { value: '' }, '—') : null,
      ...rij.opties.map((o) => h('option', { value: o, selected: o === rij.waarde }, o)));
    if (rij.waarde == null) sel.value = '';
    sel.addEventListener('change', () => { if (!wijzig(sel.value === '' ? null : sel.value).ok) sel.value = rij.waarde ?? ''; });
    return sel;
  }
  return h('output', { id, class: `alleen-lezen ${rij.soort}` }, rij.tekst, rij.eenheid && rij.soort === 'punt' ? h('span', { class: 'eenheid' }, ` ${rij.eenheid}`) : null);
}

/** Welke groepen in de elementenlijst open staan (blijft behouden tussen hertekeningen). */
const OPEN_GROEPEN = new Map();

function tekenOntwerp(el, model, opWijzig, opSelecteer, ontwerpExtra) {
  el.append(h('div', { class: 'eig-kop' }, h('div', {}, h('div', { class: 'eig-soort' }, 'Ontwerp'), h('h2', { class: 'eig-titel' }, model.naam))));
  const naam = h('input', { id: 'ontwerp-naam', type: 'text', value: model.naam, autocomplete: 'off' });
  naam.addEventListener('change', () => { if (!opWijzig([{ op: 'ontwerp', velden: { naam: naam.value.trim() } }], 'Hernoemen').ok) naam.value = model.naam; });
  const besch = h('textarea', { id: 'ontwerp-beschrijving', rows: 3 }, model.beschrijving || '');
  besch.addEventListener('change', () => { if (!opWijzig([{ op: 'ontwerp', velden: { beschrijving: besch.value } }], 'Beschrijving wijzigen').ok) besch.value = model.beschrijving || ''; });
  el.append(h('dl', { class: 'velden' },
    h('dt', {}, h('label', { for: 'ontwerp-naam' }, 'Naam')), h('dd', {}, naam),
    h('dt', {}, 'Id'), h('dd', {}, h('output', { class: 'alleen-lezen' }, model.id)),
    h('dt', {}, 'Afgeleid van'), h('dd', {}, h('output', { class: 'alleen-lezen' }, model.basis || '—')),
    h('dt', { class: 'volle-breedte' }, h('label', { for: 'ontwerp-beschrijving' }, 'Beschrijving')), h('dd', { class: 'volle-breedte' }, besch)));

  // fase 3: kerncijfers onder het ontwerp (fout in de berekening mag het paneel niet breken)
  if (ontwerpExtra) {
    try { const x = ontwerpExtra(model); if (x) el.append(x); }
    catch (e) { console.error('Kerncijfers niet beschikbaar:', e); el.append(h('p', { class: 'leeg' }, 'Kerncijfers konden niet berekend worden.')); }
  }
  el.append(h('p', { class: 'hint' }, 'Tik of klik op een element in 3D, 2D of in de lijst hieronder om het te selecteren.'));
  for (const c of COLLECTIE_NAMEN) {
    const items = model[c] || [];
    if (!items.length) continue;
    const d = h('details', { class: 'element-groep', 'data-collectie': c, open: OPEN_GROEPEN.get(c) ?? (c === 'niveaus' || items.length <= 8) },
      h('summary', {}, `${MEERVOUD[c]} `, h('span', { class: 'aantal' }, String(items.length))),
      h('ul', { class: 'element-lijst' }, ...items.map((x) => h('li', {},
        h('button', { type: 'button', class: `element-knop status-rand-${x.status || 'geen'}`, 'data-id': x.id, onclick: () => opSelecteer(x.id) }, elementLabel(model, c, x))))));
    d.addEventListener('toggle', () => OPEN_GROEPEN.set(c, d.open));
    el.append(d);
  }
}
