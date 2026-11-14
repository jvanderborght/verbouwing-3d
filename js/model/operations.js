// Operaties op het model. ALLE wijzigingen (UI, promptveld, Claude Code) lopen hierlangs.
// applyOps is puur: het origineel wordt nooit gemuteerd.
//
// Operatievormen (zie docs/DATAMODEL.md):
//   { op: 'toevoegen',   collectie, item }              id optioneel → automatisch
//   { op: 'wijzigen',    collectie, id, velden }        ondiepe merge; waarde null = optioneel veld wissen
//   { op: 'verwijderen', collectie, id }                met cascade (muur → openingen; niveau → alles erop, ook trappen
//                                                       van/naar dat niveau; ruimte → inrichting.ruimte gewist)
//   { op: 'verplaatsen', collectie, id, dx, dy }        muren/ruimtes/vloeren/daken/trappen/inrichting; openingen: dx = langs muur
//   { op: 'ontwerp',     velden }                       naam / beschrijving / basis / perceel / programma van het ontwerp zelf

import { COLLECTIES, COLLECTIE_NAMEN, VELDEN, ONTWERP_VELDEN } from './schema.js';
import { validate } from './validator.js';

export const OPERATIES = ['toevoegen', 'wijzigen', 'verwijderen', 'verplaatsen', 'ontwerp'];

const kloon = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

/** Volgend vrij id met het voorvoegsel van de collectie (uniek over het hele model). */
export function volgendId(model, collectie) {
  const pre = COLLECTIES[collectie];
  const bezet = new Set(COLLECTIE_NAMEN.flatMap((c) => (model[c] || []).map((x) => x.id)));
  let max = 0;
  for (const id of bezet) {
    const m = new RegExp(`^${pre}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (bezet.has(`${pre}${n}`)) n++;
  return `${pre}${n}`;
}

const rond = (v) => Math.round(v * 10) / 10; // 0,1 mm volstaat
const verschuifPunt = (p, dx, dy) => [rond(p[0] + dx), rond(p[1] + dy)];

/** Past één operatie toe op een (al gekloond, muteerbaar) model. Gooit Error bij ongeldige operatie. */
function pasToe(m, op, nieuweIds) {
  if (!op || typeof op !== 'object') throw new Error('Operatie moet een object zijn.');
  if (!OPERATIES.includes(op.op)) throw new Error(`Onbekende operatie "${op.op}". Kies uit: ${OPERATIES.join(', ')}.`);

  if (op.op === 'ontwerp') {
    const v = op.velden || {};
    for (const k of Object.keys(v)) {
      if (!ONTWERP_VELDEN.includes(k)) throw new Error(`Ontwerpveld "${k}" kan niet gewijzigd worden.`);
      if (v[k] === null) delete m[k]; else m[k] = v[k];
    }
    return;
  }

  const c = op.collectie;
  if (!COLLECTIE_NAMEN.includes(c)) throw new Error(`Onbekende collectie "${c}". Kies uit: ${COLLECTIE_NAMEN.join(', ')}.`);
  if (!Array.isArray(m[c])) m[c] = []; // v2-collecties in een (niet-gemigreerd) model
  const lijst = m[c];

  if (op.op === 'toevoegen') {
    if (!op.item || typeof op.item !== 'object') throw new Error('toevoegen vereist "item".');
    const item = kloon(op.item);
    if (!item.id) item.id = volgendId(m, c);
    if (COLLECTIE_NAMEN.some((cc) => (m[cc] || []).some((x) => x.id === item.id))) throw new Error(`id "${item.id}" bestaat al.`);
    lijst.push(item);
    nieuweIds.push(item.id);
    return;
  }

  const idx = lijst.findIndex((x) => x.id === op.id);
  if (idx < 0) throw new Error(`${c}: id "${op.id}" niet gevonden.`);
  const item = lijst[idx];

  if (op.op === 'wijzigen') {
    const v = op.velden;
    if (!v || typeof v !== 'object') throw new Error('wijzigen vereist "velden".');
    if ('id' in v && v.id !== item.id) throw new Error('id kan niet gewijzigd worden.');
    for (const [k, val] of Object.entries(v)) {
      const def = VELDEN[c].find(([n]) => n === k);
      if (!def) throw new Error(`${c} heeft geen veld "${k}".`);
      if (val === null) {
        if (def[2]) throw new Error(`${k} is verplicht en kan niet gewist worden.`);
        delete item[k];
      } else item[k] = kloon(val);
    }
    return;
  }

  if (op.op === 'verwijderen') {
    lijst.splice(idx, 1);
    if (c === 'muren') m.openingen = m.openingen.filter((o) => o.muur !== op.id);
    if (c === 'niveaus') {
      const murenWeg = new Set(m.muren.filter((x) => x.niveau === op.id).map((x) => x.id));
      m.muren = m.muren.filter((x) => !murenWeg.has(x.id));
      m.openingen = m.openingen.filter((o) => !murenWeg.has(o.muur));
      for (const cc of ['ruimtes', 'vloeren', 'daken', 'inrichting']) if (Array.isArray(m[cc])) m[cc] = m[cc].filter((x) => x.niveau !== op.id);
      if (Array.isArray(m.trappen)) m.trappen = m.trappen.filter((t) => t.vanNiveau !== op.id && t.naarNiveau !== op.id);
    }
    if (c === 'ruimtes' && Array.isArray(m.inrichting)) for (const x of m.inrichting) if (x.ruimte === op.id) delete x.ruimte;
    return;
  }

  if (op.op === 'verplaatsen') {
    const dx = op.dx ?? 0, dy = op.dy ?? 0;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('verplaatsen vereist numerieke dx/dy (mm).');
    if (c === 'muren') { item.start = verschuifPunt(item.start, dx, dy); item.eind = verschuifPunt(item.eind, dx, dy); }
    else if (['ruimtes', 'vloeren', 'daken'].includes(c)) item.contour = item.contour.map((p) => verschuifPunt(p, dx, dy));
    else if (c === 'trappen') item.oorsprong = verschuifPunt(item.oorsprong, dx, dy);
    else if (c === 'inrichting') item.positie = verschuifPunt(item.positie, dx, dy);
    else if (c === 'openingen') item.positie = rond(item.positie + dx);
    else if (c === 'niveaus') item.peil = rond(item.peil + dx);
    return;
  }
}

/**
 * Past een lijst operaties atomair toe.
 * @returns {{ ok: boolean, model: object, fouten: Array<{pad,melding}>, waarschuwingen: Array, nieuweIds: string[] }}
 *   ok=false ⇒ model is het ONGEWIJZIGDE origineel.
 */
export function applyOps(model, ops, { valideer = true } = {}) {
  const lijst = Array.isArray(ops) ? ops : [ops];
  const m = kloon(model);
  const nieuweIds = [];
  for (let i = 0; i < lijst.length; i++) {
    try { pasToe(m, lijst[i], nieuweIds); }
    catch (e) { return { ok: false, model, fouten: [{ pad: `ops[${i}]`, melding: e.message }], waarschuwingen: [], nieuweIds: [] }; }
  }
  if (!valideer) return { ok: true, model: m, fouten: [], waarschuwingen: [], nieuweIds };
  const r = validate(m);
  if (!r.geldig) return { ok: false, model, fouten: r.fouten, waarschuwingen: r.waarschuwingen, nieuweIds: [] };
  return { ok: true, model: m, fouten: [], waarschuwingen: r.waarschuwingen, nieuweIds };
}

/** Kopie van een ontwerp als nieuwe variant (nieuw id/naam, basis = bron). */
export function dupliceer(model, nieuwId, nieuweNaam) {
  const m = kloon(model);
  m.id = nieuwId;
  m.naam = nieuweNaam;
  m.basis = model.id;
  return m;
}
