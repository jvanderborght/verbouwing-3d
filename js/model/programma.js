// Programma van eisen (schemaVersie 2): structuurcontrole en toets. Pure functies, geen DOM.
// Vorm (docs/DATAMODEL.md "Programma van eisen"):
//   programma = { beschrijving?, eisen: [eis, …] }
//   ruimte-eis = { functie, aantal? (1), niveau? (id of soort), minOppervlakte? (m², null = niet toetsen),
//                  hoogteGrens? (mm: enkel oppervlakte met vrije hoogte ≥ grens telt voor minOppervlakte),
//                  inrichting? ([soort, …]: elk minstens één keer in de ruimte), naam? (label) }
//   trap-eis   = { trap: { van? (id of soort), naar? (id of soort), type? ([type, …] of type), aantal? (1) }, naam? }
// Toets per eis: 'voldoet' | 'voldoet niet' | 'onbekend' + uitleg. Er worden geen normen getoetst; enkel wat in de eis
// staat (en trapgrenzen als de gebruiker ze in de instellingen invulde).

import { FUNCTIES, INRICHTING_SOORTEN, TRAP_TYPES, NIVEAU_SOORTEN } from './schema.js';
import { polygoonOppervlakte, puntInPolygoon } from './geometry.js';
import { INSTELLINGEN_STANDAARD, metInstellingen, instelling } from './instellingen.js';
import { trapGeometrie } from './trappen.js';
import { oppervlaktePerHoogteband, minVrijeHoogte, trapLoophoogte } from './hoogte.js';
import { inrichtingContour } from './vormen.js';

export const TOETS_STATUSSEN = ['voldoet', 'voldoet niet', 'onbekend'];

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const RUIMTE_EIS_VELDEN = ['functie', 'aantal', 'niveau', 'minOppervlakte', 'hoogteGrens', 'inrichting', 'naam'];
const TRAP_EIS_VELDEN = ['van', 'naar', 'type', 'aantal'];

/** Structuurcontrole. → [{ pad, melding, ernst: 'fout'|'waarschuwing' }] */
export function valideerProgramma(programma) {
  const uit = [];
  const f = (pad, melding) => uit.push({ pad, melding, ernst: 'fout' });
  const w = (pad, melding) => uit.push({ pad, melding, ernst: 'waarschuwing' });
  if (!isObj(programma)) { f('programma', 'programma moet een object { eisen: [...] } zijn.'); return uit; }
  if (!Array.isArray(programma.eisen)) { f('programma.eisen', 'programma.eisen moet een lijst zijn.'); return uit; }
  if (programma.beschrijving !== undefined && typeof programma.beschrijving !== 'string') f('programma.beschrijving', 'beschrijving moet tekst zijn.');
  for (const k of Object.keys(programma)) if (!['eisen', 'beschrijving'].includes(k)) w(`programma.${k}`, `Onbekend veld "${k}".`);
  programma.eisen.forEach((e, i) => {
    const pad = `programma.eisen[${i}]`;
    if (!isObj(e)) { f(pad, 'Eis moet een object zijn.'); return; }
    if (e.naam !== undefined && typeof e.naam !== 'string') f(`${pad}.naam`, 'naam moet tekst zijn.');
    if (e.aantal !== undefined && e.aantal !== null && (!Number.isInteger(e.aantal) || e.aantal < 1)) f(`${pad}.aantal`, 'aantal moet een geheel getal ≥ 1 zijn.');
    if (isObj(e.trap)) {
      const t = e.trap;
      for (const k of ['van', 'naar']) if (t[k] !== undefined && t[k] !== null && typeof t[k] !== 'string') f(`${pad}.trap.${k}`, `${k} moet een niveau-id of -soort zijn.`);
      const types = t.type == null ? [] : (Array.isArray(t.type) ? t.type : [t.type]);
      for (const x of types) if (!TRAP_TYPES.includes(x)) f(`${pad}.trap.type`, `Traptype "${x}" is ongeldig; kies uit: ${TRAP_TYPES.join(', ')}.`);
      if (t.aantal !== undefined && t.aantal !== null && (!Number.isInteger(t.aantal) || t.aantal < 1)) f(`${pad}.trap.aantal`, 'aantal moet een geheel getal ≥ 1 zijn.');
      for (const k of Object.keys(t)) if (!TRAP_EIS_VELDEN.includes(k)) w(`${pad}.trap.${k}`, `Onbekend veld "${k}".`);
      for (const k of Object.keys(e)) if (!['trap', 'naam', 'aantal'].includes(k)) w(`${pad}.${k}`, `Onbekend veld "${k}" naast "trap".`);
      return;
    }
    if (e.trap !== undefined) { f(`${pad}.trap`, 'trap moet een object zijn.'); return; }
    if (!FUNCTIES.includes(e.functie)) { f(`${pad}.functie`, `functie "${e.functie}" is ongeldig; kies uit: ${FUNCTIES.join(', ')}.`); return; }
    if (e.niveau !== undefined && e.niveau !== null && typeof e.niveau !== 'string') f(`${pad}.niveau`, 'niveau moet een niveau-id of -soort zijn.');
    for (const k of ['minOppervlakte', 'hoogteGrens'])
      if (e[k] !== undefined && e[k] !== null && (!isGetal(e[k]) || e[k] <= 0)) f(`${pad}.${k}`, `${k} moet een getal > 0 of null zijn.`);
    if (e.inrichting !== undefined && e.inrichting !== null) {
      if (!Array.isArray(e.inrichting)) f(`${pad}.inrichting`, 'inrichting moet een lijst soorten zijn.');
      else for (const x of e.inrichting) if (!INRICHTING_SOORTEN.includes(x)) f(`${pad}.inrichting`, `Inrichtingssoort "${x}" is ongeldig; kies uit: ${INRICHTING_SOORTEN.join(', ')}.`);
    }
    for (const k of Object.keys(e)) if (!RUIMTE_EIS_VELDEN.includes(k)) w(`${pad}.${k}`, `Onbekend veld "${k}".`);
  });
  return uit;
}

const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Niveaus die overeenkomen met een verwijzing (id of soort). null = verwijzing onbekend. Niveau zonder soort telt als 'verdieping'. */
function niveausVoor(model, ref) {
  if (ref == null) return (model.niveaus || []).map((n) => n.id);
  if ((model.niveaus || []).some((n) => n.id === ref)) return [ref];
  if (NIVEAU_SOORTEN.includes(ref)) return (model.niveaus || []).filter((n) => (n.soort || 'verdieping') === ref).map((n) => n.id);
  return null;
}

/** Inrichting (status ≠ afbraak) die bij een ruimte hoort: via `ruimte`, of zonder `ruimte` met het middelpunt in de contour. */
export function inrichtingVanRuimte(model, r) {
  return (model.inrichting || []).filter((x) => x.status !== 'afbraak' && (x.ruimte === r.id
    || (!x.ruimte && x.niveau === r.niveau && Array.isArray(x.positie) && puntInPolygoon(x.positie, r.contour))));
}

function eisLabel(e) {
  if (e.naam) return e.naam;
  if (isObj(e.trap)) {
    const t = e.trap;
    const types = t.type == null ? '' : ` (${(Array.isArray(t.type) ? t.type : [t.type]).join(' / ')})`;
    return `Trap${t.van || t.naar ? ` ${t.van ?? '?'} → ${t.naar ?? '?'}` : ''}${types}`;
  }
  const n = e.aantal ?? 1;
  const extra = [];
  if (e.niveau) extra.push(`op ${e.niveau}`);
  if (e.inrichting?.length) extra.push(`met ${e.inrichting.join(' + ')}`);
  if (isGetal(e.minOppervlakte)) extra.push(`≥ ${fmt(e.minOppervlakte)} m²${isGetal(e.hoogteGrens) ? ` bij vrije hoogte ≥ ${e.hoogteGrens} mm` : ''}`);
  return `${n} × ${e.functie}${extra.length ? ' ' + extra.join(', ') : ''}`;
}

/**
 * Toetst een ontwerp aan een programma van eisen (standaard model.programma).
 * @returns {{ resultaten: Array<{ index, label, status, uitleg, ruimtes?: string[], trappen?: string[] }>,
 *             samenvatting: { voldoet:number, 'voldoet niet':number, onbekend:number }, fout?: string }}
 */
export function toetsProgramma(model, programma = model?.programma, opties = {}) {
  const inst = opties.instellingen ? metInstellingen(opties.instellingen) : INSTELLINGEN_STANDAARD;
  const leeg = { voldoet: 0, 'voldoet niet': 0, onbekend: 0 };
  if (!programma) return { resultaten: [], samenvatting: leeg, fout: 'Geen programma van eisen.' };
  const structuur = valideerProgramma(programma).filter((p) => p.ernst === 'fout');
  if (!Array.isArray(programma.eisen)) return { resultaten: [], samenvatting: leeg, fout: structuur.map((p) => p.melding).join(' ') };
  const resultaten = programma.eisen.map((e, index) => {
    const label = isObj(e) ? eisLabel(e) : `Eis ${index + 1}`;
    const fouten = structuur.filter((p) => p.pad.startsWith(`programma.eisen[${index}]`));
    if (fouten.length) return { index, label, status: 'onbekend', uitleg: `Eis kan niet getoetst worden: ${fouten.map((p) => p.melding).join(' ')}` };
    return isObj(e.trap) ? toetsTrap(model, e, index, label, inst) : toetsRuimte(model, e, index, label, inst);
  });
  const samenvatting = { ...leeg };
  for (const r of resultaten) samenvatting[r.status]++;
  return { resultaten, samenvatting };
}

function toetsRuimte(model, e, index, label, inst) {
  const niveaus = niveausVoor(model, e.niveau);
  if (!niveaus) return { index, label, status: 'onbekend', uitleg: `Niveau "${e.niveau}" bestaat niet (geen niveau-id en geen soort ${NIVEAU_SOORTEN.join('/')}).` };
  const aantal = e.aantal ?? 1;
  const kandidaten = (model.ruimtes || []).filter((r) => r.functie === e.functie && niveaus.includes(r.niveau));
  const noten = [];
  const passend = [];
  const redenen = [];
  for (const r of kandidaten) {
    const waarom = [];
    let m2 = polygoonOppervlakte(r.contour) / 1e6;
    if (isGetal(e.hoogteGrens)) {
      const b = oppervlaktePerHoogteband(model, r, [e.hoogteGrens], { instellingen: inst });
      m2 = b ? b.banden[b.banden.length - 1].m2 : 0;
    }
    if (isGetal(e.minOppervlakte) && m2 < e.minOppervlakte - 1e-6) waarom.push(`${fmt(m2, 2)} m² < ${fmt(e.minOppervlakte, 2)} m²`);
    if (Array.isArray(e.inrichting) && e.inrichting.length) {
      const items = inrichtingVanRuimte(model, r);
      for (const soort of e.inrichting) {
        const x = items.filter((i) => i.soort === soort);
        if (!x.length) { waarom.push(`geen ${soort}`); continue; }
        const teLaag = x.filter((i) => isGetal(i.hoogte) && (minVrijeHoogte(model, i.niveau, inrichtingContour(i), { instellingen: inst }) ?? Infinity) < i.hoogte - 0.5);
        if (teLaag.length === x.length) waarom.push(`${soort} staat waar de vrije hoogte lager is dan het element`);
      }
    }
    if (waarom.length) redenen.push(`${r.naam} (${r.id}): ${waarom.join(', ')}`);
    else passend.push({ r, m2 });
  }
  if (!isGetal(e.minOppervlakte)) noten.push('geen minimale oppervlakte opgegeven: oppervlakte niet getoetst');
  const waar = e.niveau ? ` op ${e.niveau}` : '';
  const gevonden = passend.map(({ r, m2 }) => `${r.naam} ${fmt(m2, 2)} m²${isGetal(e.hoogteGrens) ? ` (≥ ${e.hoogteGrens} mm)` : ''}`).join('; ');
  const status = passend.length >= aantal ? 'voldoet' : 'voldoet niet';
  let uitleg = `${passend.length} van ${aantal} ${e.functie}${waar} gevonden${gevonden ? `: ${gevonden}` : ''}.`;
  if (redenen.length) uitleg += ` Niet passend: ${redenen.join('; ')}.`;
  if (!kandidaten.length) uitleg += ` Geen ruimtes met functie "${e.functie}"${waar}.`;
  if (noten.length) uitleg += ` (${noten.join('; ')})`;
  return { index, label, status, uitleg, ruimtes: passend.map(({ r }) => r.id) };
}

function toetsTrap(model, e, index, label, inst) {
  const t = e.trap;
  const van = niveausVoor(model, t.van), naar = niveausVoor(model, t.naar);
  if (!van) return { index, label, status: 'onbekend', uitleg: `Niveau "${t.van}" bestaat niet.` };
  if (!naar) return { index, label, status: 'onbekend', uitleg: `Niveau "${t.naar}" bestaat niet.` };
  const types = t.type == null ? TRAP_TYPES : (Array.isArray(t.type) ? t.type : [t.type]);
  const aantal = t.aantal ?? e.aantal ?? 1;
  const kandidaten = (model.trappen || []).filter((x) => x.status !== 'afbraak' && van.includes(x.vanNiveau) && naar.includes(x.naarNiveau));
  const passend = [], redenen = [];
  const minLh = instelling(inst, 'trap.minLoophoogte');
  for (const x of kandidaten) {
    if (!types.includes(x.type)) { redenen.push(`${x.id}: type ${x.type} niet gevraagd`); continue; }
    const g = trapGeometrie(model, x, { instellingen: inst });
    if (!g || g.fout) { redenen.push(`${x.id}: ${g?.fout || 'geometrie onvolledig'}`); continue; }
    const grensFout = [['maxOptrede', g.maten.optrede, 1], ['minOptrede', g.maten.optrede, -1], ['maxAantrede', g.maten.aantrede, 1],
      ['minAantrede', g.maten.aantrede, -1], ['minBreedte', x.breedte, -1]]
      .filter(([k, v, r]) => { const gw = instelling(inst, `trap.${k}`); return isGetal(gw) && (r > 0 ? v > gw + 0.5 : v < gw - 0.5); })
      .map(([k, v]) => `${k} ${instelling(inst, `trap.${k}`)} mm (trap: ${fmt(v, 0)} mm)`);
    if (grensFout.length) { redenen.push(`${x.id}: buiten ingestelde grens ${grensFout.join(', ')}`); continue; }
    if (isGetal(minLh)) {
      const lh = trapLoophoogte(model, x, { instellingen: inst });
      if (lh?.min != null && lh.min < minLh - 0.5) { redenen.push(`${x.id}: loophoogte ${Math.round(lh.min)} mm < ingestelde ${minLh} mm`); continue; }
    }
    passend.push({ x, g });
  }
  const status = passend.length >= aantal ? 'voldoet' : 'voldoet niet';
  const besch = passend.map(({ x, g }) => `${x.id} ${x.type} ${x.vanNiveau} → ${x.naarNiveau}: ${g.maten.aantalTreden} optreden van ${fmt(g.maten.optrede, 1)} mm, aantrede ${fmt(g.maten.aantrede, 0)} mm`).join('; ');
  let uitleg = `${passend.length} van ${aantal} passende trap(pen)${besch ? `: ${besch}` : ''}.`;
  if (redenen.length) uitleg += ` Niet passend: ${redenen.join('; ')}.`;
  const getoetst = ['maxOptrede', 'minOptrede', 'minAantrede', 'maxAantrede', 'minBreedte', 'minLoophoogte'].filter((k) => isGetal(instelling(inst, `trap.${k}`)));
  uitleg += getoetst.length ? ` (getoetst aan de ingestelde trapgrenzen: ${getoetst.join(', ')})` : ' (trapcomfort en loophoogte niet getoetst: geen grenzen ingesteld)';
  return { index, label, status, uitleg, trappen: passend.map(({ x }) => x.id) };
}
