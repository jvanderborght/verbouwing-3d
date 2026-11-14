// Hoog-niveau operaties ("macro's") voor het promptveld (fase 5). Pure functies, getest in tests/ai.test.js.
//
// Claude mag in een variant naast de basisoperaties (toevoegen, wijzigen, verwijderen, verplaatsen, ontwerp) ook
// macro's gebruiken. Vóór de validatie worden ze in volgorde uitgevouwen tot basisoperaties met de bewerkingen uit
// js/model/bewerkingen.js, telkens op het TUSSENRESULTAAT (het model na alle vorige operaties van die variant).
// Het resultaat is een gewone operatielijst: die wordt gevalideerd, getoond en bij "Toepassen" als één stap toegepast.
//
//   { op: 'afbraakZone', ruimtes?: [id…], ids?: [id…], niveau? }      → opsAfbraakZone (ruimtes = zone; ids = precies die elementen)
//   { op: 'zolderNiveau', onderNiveau, naam, id, vloerdikte? }       → opsZolderNiveau
//   { op: 'trapPlaatsen', id, van, naar, type, oorsprong, richting, breedte, draairichting?, aantrede?, aantalTreden?, optrede?, diameter? }
//                                                                    → opsTrapPlaatsen
//   { op: 'inrichtingPlaatsen', id, soort, ruimte, rotatie, positie?, niveau?, breedte?, diepte?, hoogte? }
//                                                                    → opsInrichtingPlaatsen (positie leeg ⇒ plek tegen een wand)
//   { op: 'muurSplitsen', muur, positie, nieuwId }                   → opsMuurSplitsen (positie = mm vanaf muur.start)
//   { op: 'dakkapelPlaatsen', id, dak, zijde, positieX, positieZ, breedte, hoogte, raamBreedte, raamHoogte }
//                                                                    → opsDakkapelPlaatsen (raamBreedte/raamHoogte 0 = geen raam)
//
// Id's: `id` / `nieuwId` = het id dat Claude zelf kiest voor het nieuwe element ("" = automatisch, volgend vrij nummer).
// Id's die de bewerking zelf uitdeelt (bv. de tweede helft van een gesplitste muur in afbraakZone, de zoldervloer) worden
// zo nodig hernummerd zodat ze NOOIT botsen met een id dat Claude elders in dezelfde variant expliciet gebruikt.
// Lege tekst ("") en 0 bij optionele velden betekenen "niet opgegeven" (standaard / berekend).
//
// `item` / `velden` van toevoegen, wijzigen en ontwerp mogen een object zijn of een JSON-TEKST (zo staan ze in het
// antwoordschema: zie prompt.js, limiet op optionele velden van structured outputs).

import { applyOps, volgendId } from '../model/operations.js';
import { COLLECTIE_NAMEN } from '../model/schema.js';
import {
  opsAfbraakZone, opsZolderNiveau, opsTrapPlaatsen, opsInrichtingPlaatsen, opsMuurSplitsen,
} from '../model/bewerkingen.js';
import { opsDakkapelPlaatsen } from '../model/dakkapel-bewerkingen.js';

export const MACROS = Object.freeze(['afbraakZone', 'zolderNiveau', 'trapPlaatsen', 'inrichtingPlaatsen', 'muurSplitsen', 'dakkapelPlaatsen']);
/** Velden die Claude met de operatie `ontwerp` mag wijzigen (basis en perceel beheert de app). */
export const AI_ONTWERP_VELDEN = Object.freeze(['programma', 'naam', 'beschrijving']);

export const isMacro = (op) => !!op && typeof op === 'object' && MACROS.includes(op.op);

const kloon = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
const leeg = (v) => v === undefined || v === null || v === '' || v === 0 || (Array.isArray(v) && !v.length);
const waarde = (v) => (leeg(v) ? undefined : v);

/** Velden die naar een id verwijzen (worden mee hernoemd). */
const REF_VELDEN = ['id', 'niveau', 'muur', 'ruimte', 'vanNiveau', 'naarNiveau', 'dak'];

/** Hernoemt id's in een operatielijst volgens `map` (oud → nieuw). Puur. */
export function hernoemOps(ops, map) {
  if (!map.size) return ops;
  const h = (o) => {
    if (!o || typeof o !== 'object') return o;
    const u = { ...o };
    for (const k of REF_VELDEN) if (typeof u[k] === 'string' && map.has(u[k])) u[k] = map.get(u[k]);
    return u;
  };
  return ops.map((op) => {
    const u = h(op);
    if (op.item) u.item = h(op.item);
    if (op.velden) u.velden = h(op.velden);
    return u;
  });
}

function hernoemInfo(info, map) {
  if (!map.size || !info) return info;
  return JSON.parse(JSON.stringify(info), (k, v) => (typeof v === 'string' && map.has(v) ? map.get(v) : v));
}

const alleIds = (model) => new Set(COLLECTIE_NAMEN.flatMap((c) => (model[c] || []).map((x) => x.id)));

/** Vrij id met voorvoegsel van de collectie, buiten `bezet` en boven model.idTeller (vrijgekomen id's niet hergebruiken). */
function vrijId(collectie, bezet, model = {}) {
  return volgendId(model, collectie, [...bezet]);
}

/** Leest een JSON-tekst (item/velden) of laat een object ongemoeid. Gooit Error met een Nederlandse melding. */
function objectVan(v, naam) {
  if (typeof v === 'string') {
    let x;
    try { x = JSON.parse(v); } catch { throw new Error(`"${naam}" is geen geldige JSON-tekst.`); }
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`"${naam}" moet een JSON-object zijn.`);
    return x;
  }
  return v;
}

/**
 * Normaliseert één basisoperatie: JSON-tekst in item/velden → object; ontwerp enkel met programma/naam/beschrijving
 * (`ontwerpVelden`; null = geen extra beperking, dan beslist applyOps — zo gebruikt tools/apply-ops.mjs het).
 * Gooit Error bij een ongeldige vorm.
 */
export function normaliseerOp(op, { ontwerpVelden = AI_ONTWERP_VELDEN } = {}) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('Operatie moet een object zijn.');
  const u = { ...op };
  if (u.op === 'toevoegen' && 'item' in u) u.item = objectVan(u.item, 'item');
  if ((u.op === 'wijzigen' || u.op === 'ontwerp') && 'velden' in u) u.velden = objectVan(u.velden, 'velden');
  if (u.op === 'ontwerp') {
    if (!u.velden || typeof u.velden !== 'object') throw new Error('ontwerp vereist "velden".');
    if (ontwerpVelden) for (const k of Object.keys(u.velden)) if (!ontwerpVelden.includes(k)) throw new Error(`Ontwerpveld "${k}" mag je niet wijzigen; enkel ${ontwerpVelden.join(', ')}.`);
  }
  if (u.op === 'verplaatsen') { u.dx ??= 0; u.dy ??= 0; }
  return u;
}

/** Expliciete id's die Claude in de variant gebruikt (toevoegen item.id, macro id/nieuwId). */
function expliciteIds(ops) {
  const s = new Set();
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'toevoegen') {
      try { const it = objectVan(op.item, 'item'); if (it && typeof it.id === 'string' && it.id) s.add(it.id); } catch { /* fout volgt later */ }
    }
    if (isMacro(op)) for (const k of ['id', 'nieuwId']) if (typeof op[k] === 'string' && op[k]) s.add(op[k]);
  }
  return s;
}

/** Roept de bewerking van een macro op. → { ops, fout?, info?, gevraagd?: { oud, nieuw, collectie } } */
function roepMacro(model, op, instellingen) {
  switch (op.op) {
    case 'afbraakZone': {
      const ruimtes = Array.isArray(op.ruimtes) ? op.ruimtes.filter(Boolean) : (op.ruimtes ? [op.ruimtes] : []);
      const ids = Array.isArray(op.ids) ? op.ids.filter(Boolean) : (op.ids ? [op.ids] : []);
      if (ruimtes.length && ids.length) return { ops: [], fout: 'Geef ofwel "ruimtes" (een zone) ofwel "ids" (precies die elementen), niet beide; gebruik zo nodig twee afbraakZone-operaties.' };
      if (!ruimtes.length && !ids.length && Array.isArray(op.punt)) return opsAfbraakZone(model, { punt: op.punt, niveau: waarde(op.niveau) });
      if (!ruimtes.length && !ids.length) return { ops: [], fout: 'afbraakZone vereist "ruimtes" (ruimte-id\'s van de zone) of "ids" (element-id\'s).' };
      return ids.length ? opsAfbraakZone(model, { ids }) : opsAfbraakZone(model, { ruimte: ruimtes, niveau: waarde(op.niveau) });
    }
    case 'zolderNiveau': {
      const r = opsZolderNiveau(model, { onderNiveau: op.onderNiveau, naam: waarde(op.naam), vloerdikte: waarde(op.vloerdikte) });
      return { ...r, gevraagd: r.info && waarde(op.id) ? { oud: r.info.id, nieuw: op.id } : null };
    }
    case 'trapPlaatsen': {
      const p = { van: op.van ?? op.vanNiveau, naar: op.naar ?? op.naarNiveau, type: op.type, oorsprong: op.oorsprong, richting: op.richting ?? 0, breedte: op.breedte, instellingen };
      for (const k of ['draairichting', 'aantrede', 'aantalTreden', 'optrede', 'diameter']) if (!leeg(op[k])) p[k] = op[k];
      if (op.type === 'recht') delete p.draairichting;
      const r = opsTrapPlaatsen(model, p);
      return { ...r, gevraagd: r.info && waarde(op.id) ? { oud: r.info.id, nieuw: op.id } : null };
    }
    case 'inrichtingPlaatsen': {
      const p = { soort: op.soort, instellingen };
      for (const k of ['ruimte', 'niveau', 'positie', 'breedte', 'diepte', 'hoogte']) if (!leeg(op[k])) p[k] = op[k];
      if (op.rotatie !== undefined && op.rotatie !== null && op.rotatie !== '') p.rotatie = op.rotatie;
      const r = opsInrichtingPlaatsen(model, p);
      return { ...r, gevraagd: r.info && waarde(op.id) ? { oud: r.info.id, nieuw: op.id } : null };
    }
    case 'muurSplitsen': {
      const pos = op.positie ?? op.punt;
      const r = opsMuurSplitsen(model, op.muur, pos);
      return { ...r, gevraagd: r.info && waarde(op.nieuwId) ? { oud: r.info.ids[1], nieuw: op.nieuwId } : null };
    }
    case 'dakkapelPlaatsen': {
      const p = { dak: op.dak, instellingen };
      for (const k of ['zijde', 'positieX', 'breedte', 'hoogte', 'diepte']) if (!leeg(op[k])) p[k] = op[k];
      if (op.positieZ !== undefined && op.positieZ !== null && op.positieZ !== '') p.positieZ = op.positieZ; // 0 = in het gevelvlak
      if (!leeg(op.raamBreedte) && !leeg(op.raamHoogte)) p.raam = { breedte: op.raamBreedte, hoogte: op.raamHoogte };
      const r = opsDakkapelPlaatsen(model, p);
      return { ...r, gevraagd: r.info && waarde(op.id) ? { oud: r.info.id, nieuw: op.id } : null };
    }
    default:
      return { ops: [], fout: `Onbekende macro "${op.op}".` };
  }
}

/**
 * Vouwt de macro's van één variant uit tot basisoperaties (in volgorde, op het tussenresultaat). Valideert NIET het eindresultaat
 * (dat doet applyOps in pasVariantenToe), maar elke operatie moet wel toepasbaar zijn.
 * @param {object} basis  het ontwerp waarop de variant vertrekt (wordt niet gewijzigd)
 * @param {Array} ops     de operaties van Claude (basis + macro's, item/velden als object of JSON-tekst)
 * @param {{ instellingen?: object, ontwerpVelden?: string[]|null }} o  instellingen voor trap/inrichting (werkwaarden, grenzen);
 *   ontwerpVelden: zie normaliseerOp
 * @returns {{ ok: boolean, ops: Array, fouten: Array<{pad, melding}>, macroInfo: Array<{ index, op, info, ids }>, meldingen: string[] }}
 *   ops = uitgevouwen basisoperaties (bij ok); macroInfo = per macro de info van de bewerking (met de definitieve id's).
 */
export function vouwUit(basis, ops, { instellingen = null, ontwerpVelden = AI_ONTWERP_VELDEN } = {}) {
  const lijst = Array.isArray(ops) ? ops : [ops];
  const gereserveerd = expliciteIds(lijst);
  let model = kloon(basis);
  const uit = [];
  const macroInfo = [];
  const meldingen = [];
  const fout = (i, melding) => ({ ok: false, ops: [], fouten: [{ pad: `ops[${i}]`, melding }], macroInfo, meldingen });

  for (let i = 0; i < lijst.length; i++) {
    const op = lijst[i];
    if (!isMacro(op)) {
      let n;
      try { n = normaliseerOp(op, { ontwerpVelden }); } catch (e) { return fout(i, e.message); }
      const r = applyOps(model, [n], { valideer: false });
      if (!r.ok) return fout(i, r.fouten[0]?.melding || 'Operatie kan niet toegepast worden.');
      model = r.model;
      uit.push(n);
      continue;
    }
    const r = roepMacro(model, op, instellingen);
    if (r.fout) return fout(i, `${op.op}: ${r.fout}`);
    // id's: eerst het gevraagde id, daarna botsingen met elders expliciet gebruikte id's vermijden
    const bezet = alleIds(model);
    const map = new Map();
    if (r.gevraagd) {
      if (r.gevraagd.nieuw !== r.gevraagd.oud && bezet.has(r.gevraagd.nieuw)) return fout(i, `${op.op}: id "${r.gevraagd.nieuw}" bestaat al.`);
      map.set(r.gevraagd.oud, r.gevraagd.nieuw);
    }
    const nieuw = r.ops.filter((o) => o.op === 'toevoegen' && o.item?.id && !bezet.has(o.item.id));
    const verboden = new Set([...bezet, ...gereserveerd, ...map.values()]);
    for (const o of nieuw) {
      const id = o.item.id;
      if (map.has(id)) continue;
      // een gegenereerd id dat toevallig gelijk is aan het gevraagde id van deze macro (maar voor een ander element)
      if (r.gevraagd && id === r.gevraagd.nieuw) { const ander = vrijId(o.collectie, verboden, model); verboden.add(ander); map.set(id, ander); continue; }
      if (gereserveerd.has(id)) {
        const ander = vrijId(o.collectie, verboden, model);
        verboden.add(ander);
        map.set(id, ander);
      }
    }
    const macroOps = hernoemOps(r.ops, map);
    const a = applyOps(model, macroOps, { valideer: false });
    if (!a.ok) return fout(i, `${op.op}: ${a.fouten[0]?.melding || 'bewerking kon niet toegepast worden'}`);
    model = a.model;
    uit.push(...macroOps);
    const info = hernoemInfo(r.info, map);
    const ids = macroOps.filter((o) => o.op === 'toevoegen').map((o) => o.item.id);
    macroInfo.push({ index: i, op: op.op, info, ids });
    for (const m of info?.meldingen || []) meldingen.push(`${op.op} (ops[${i}]): ${m}`);
  }
  return { ok: true, ops: uit, fouten: [], macroInfo, meldingen };
}

/** Korte tekst per macro voor het herstelbericht en de UI: welke id's ze aanmaakte / afbrak / splitste. */
export function macroInfoTekst(mi) {
  const d = [];
  const inf = mi.info || {};
  if (mi.ids?.length) d.push(`nieuwe id's ${mi.ids.join(', ')}`);
  if (inf.afbraak?.length) d.push(`op afbraak ${inf.afbraak.join(', ')}`);
  if (inf.verwijderd?.length) d.push(`verwijderd ${inf.verwijderd.join(', ')}`);
  if (inf.gesplitst?.length) d.push(`gesplitst ${inf.gesplitst.map((g) => `${g.id}${g.nieuw.length ? ` → ${g.nieuw.join(', ')}` : ''}`).join('; ')}`);
  if (inf.randMuren?.length) d.push(`blijvende randmuren ${inf.randMuren.join(', ')}`);
  if (inf.maten) d.push(`${inf.maten.aantalTreden} optreden van ${Math.round(inf.maten.optrede * 10) / 10} mm, aantrede ${inf.maten.aantrede} mm`);
  if (inf.hoogte && mi.op === 'zolderNiveau') d.push(`hoogte ${inf.hoogte} mm`);
  if (inf.positie && mi.op === 'inrichtingPlaatsen') d.push(`positie [${inf.positie.join(', ')}], rotatie ${inf.rotatie}°`);
  if (mi.op === 'dakkapelPlaatsen' && inf.diepte != null) d.push(`diepte ${Math.round(inf.diepte)} mm, vrije hoogte eronder ${Math.round(inf.vrijeHoogte)} mm`);
  return `ops[${mi.index}] ${mi.op}: ${d.join('; ') || 'geen wijzigingen'}`;
}
