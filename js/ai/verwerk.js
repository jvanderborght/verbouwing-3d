// Verwerking van een antwoord van Claude (pure functies, getest in tests/ai.test.js):
// stop_reason controleren, JSON lezen, per variant applyOps op een kopie, fouten verzamelen voor één herstelpoging,
// diff + overzicht + voorbeeldpolygonen voor de plattegrond per variant.

import { applyOps } from '../model/operations.js';
import { diff, beschrijfDiff } from '../model/diff.js';
import { muurLengte, muurDeelRechthoek } from '../model/geometry.js';
import { toetsProgramma } from '../model/programma.js';
import { inrichtingContour } from '../model/vormen.js';
import { trapVoetafdruk } from '../model/trappen.js';
import { MAX_VARIANTEN } from './prompt.js';
import { vouwUit, macroInfoTekst } from './macros.js';

export const MAX_HERSTEL = 1;

const WEIGER_CATEGORIE = { cyber: 'cyberveiligheid', bio: 'biologie', reasoning_extraction: 'uitlezen van redeneringen', frontier_llm: 'AI-ontwikkeling' };

/** Tekstblokken samenvoegen; bij een fallback ook de tekst na het laatste fallback-blok apart (terugval bij parsen). */
function teksten(bericht) {
  const c = Array.isArray(bericht?.content) ? bericht.content : [];
  const alles = c.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
  const iFb = c.map((b) => b.type).lastIndexOf('fallback');
  const naFallback = iFb >= 0 ? c.slice(iFb + 1).filter((b) => b.type === 'text').map((b) => b.text || '').join('') : null;
  const fb = iFb >= 0 ? c[iFb] : null;
  return { alles, naFallback, fallback: fb ? { van: fb.from?.model ?? null, naar: fb.to?.model ?? null } : null };
}

/** JSON uit tekst halen (tolerant voor ```json-omhulling of tekst rond het object). */
export function leesJson(tekst) {
  let t = String(tekst || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  try { return { ok: true, waarde: JSON.parse(t) }; } catch { /* verder */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return { ok: true, waarde: JSON.parse(t.slice(a, b + 1)) }; } catch { /* niets */ } }
  return { ok: false };
}

/** Vormcontrole van het antwoordobject. → lijst foutmeldingen (leeg = ok). */
export function controleerVorm(d) {
  const f = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['Het antwoord is geen JSON-object.'];
  if (typeof d.samenvatting !== 'string') f.push('"samenvatting" ontbreekt of is geen tekst.');
  if (d.vragen != null && (!Array.isArray(d.vragen) || d.vragen.some((v) => typeof v !== 'string'))) f.push('"vragen" moet een lijst teksten zijn.');
  if (!Array.isArray(d.varianten)) f.push('"varianten" ontbreekt of is geen lijst.');
  else d.varianten.forEach((v, i) => {
    if (!v || typeof v !== 'object') { f.push(`varianten[${i}] is geen object.`); return; }
    if (typeof v.naam !== 'string' || !v.naam.trim()) f.push(`varianten[${i}].naam ontbreekt.`);
    if (!Array.isArray(v.ops)) f.push(`varianten[${i}].ops moet een lijst operaties zijn.`);
  });
  return f;
}

/**
 * Leest een API-bericht. Controleert EERST stop_reason, pas daarna de inhoud.
 * @returns {{ status: 'ok'|'weigering'|'max_tokens'|'onvolledig'|'ongeldig', data?, melding?, fouten?: string[], fallback?, model? }}
 *   'ongeldig' = geen/foute JSON of vorm ⇒ komt in aanmerking voor de herstelpoging.
 */
export function leesAntwoord(bericht) {
  const model = bericht?.model ?? null;
  const sr = bericht?.stop_reason;
  const { alles, naFallback, fallback } = teksten(bericht);
  if (sr === 'refusal') {
    const cat = bericht?.stop_details?.category;
    const wat = cat && WEIGER_CATEGORIE[cat] ? ` (categorie: ${WEIGER_CATEGORIE[cat]})` : '';
    return { status: 'weigering', model, fallback, melding: `Claude weigerde deze opdracht${wat}. Er werd niets gewijzigd. Herformuleer de opdracht${fallback ? '' : ', of zet server-side fallbacks aan in Instellingen'}.` };
  }
  if (sr === 'max_tokens') {
    return { status: 'max_tokens', model, fallback, melding: 'Het antwoord werd afgebroken omdat de maximale lengte bereikt werd. Vraag minder varianten tegelijk, maak de opdracht kleiner of kies een lagere effort.' };
  }
  if (sr && !['end_turn', 'stop_sequence'].includes(sr)) {
    return { status: 'onvolledig', model, fallback, melding: `Onverwacht einde van het antwoord (${sr}). Probeer opnieuw.` };
  }
  let j = leesJson(alles);
  if ((!j.ok || controleerVorm(j.waarde).length) && naFallback != null) {
    const j2 = leesJson(naFallback);
    if (j2.ok && !controleerVorm(j2.waarde).length) j = j2;
  }
  if (!j.ok) return { status: 'ongeldig', model, fallback, fouten: ['Het antwoord was geen geldige JSON.'] };
  const vorm = controleerVorm(j.waarde);
  if (vorm.length) return { status: 'ongeldig', model, fallback, fouten: vorm };
  const d = j.waarde;
  return {
    status: 'ok', model, fallback,
    data: {
      samenvatting: d.samenvatting.trim(),
      vragen: (d.vragen || []).map((v) => v.trim()).filter(Boolean),
      varianten: d.varianten.slice(0, MAX_VARIANTEN).map((v) => ({ naam: v.naam.trim(), beschrijving: String(v.beschrijving || '').trim(), ops: v.ops })),
    },
  };
}

// ---------------------------------------------------------------- per variant toepassen

/** Soort van een diffregel voor de preview: nieuw (blauw), afbraak (rood), gewijzigd (oranje), verwijderd (rood). */
export function soortVan(r) {
  if (r.soort === 'toegevoegd') return r.nieuw?.status === 'afbraak' ? 'afbraak' : 'nieuw';
  if (r.soort === 'verwijderd') return 'verwijderd';
  const st = r.velden?.find((v) => v.veld === 'status');
  if (st?.nieuw === 'afbraak') return 'afbraak';
  if (st?.nieuw === 'nieuw') return 'nieuw';
  return 'gewijzigd';
}

/** Telling per soort. */
export function telDiff(d) {
  const t = { nieuw: 0, afbraak: 0, gewijzigd: 0, verwijderd: 0 };
  for (const r of d) t[soortVan(r)]++;
  return t;
}

/**
 * Past elke variant toe op (een kopie van) het basisontwerp: eerst de macro's uitvouwen (in volgorde, op het
 * tussenresultaat), dan alles atomair toepassen en valideren.
 * Bij ok: `ops` = de UITGEVOUWEN basisoperaties (die past "Toepassen" toe), `antwoordOps` = de operaties zoals Claude ze gaf,
 * `macroInfo`/`meldingen` uit de bewerkingen, en `programmaToets` (toetsProgramma) als het ontwerp na de variant een
 * programma van eisen heeft. Bij een fout blijft `ops` de lijst van Claude (foutpaden ops[i] verwijzen ernaar).
 * @param {{ instellingen?: object }} o  instellingen (werkwaarden/grenzen) voor trap, inrichting en programmatoets
 * @returns {Array<{ naam, beschrijving, ops, ok, fouten, waarschuwingen, model?, diff?, diffTekst?, telling?, antwoordOps?,
 *   macroInfo?, meldingen?, programmaToets? }>}
 */
export function pasVariantenToe(basis, varianten, { instellingen = null } = {}) {
  return varianten.map((v) => {
    const u = vouwUit(basis, v.ops, { instellingen });
    if (!u.ok) return { ...v, ok: false, fouten: u.fouten, waarschuwingen: [], macroInfo: u.macroInfo, meldingen: u.meldingen };
    // applyOps kloont zelf; het basismodel wordt nooit gemuteerd
    const r = applyOps(basis, u.ops);
    if (!r.ok) return { ...v, ok: false, fouten: r.fouten, waarschuwingen: r.waarschuwingen || [], macroInfo: u.macroInfo, meldingen: u.meldingen };
    const d = diff(basis, r.model);
    const uit = {
      ...v, antwoordOps: v.ops, ops: u.ops, ok: true, fouten: [], waarschuwingen: r.waarschuwingen, model: r.model, nieuweIds: r.nieuweIds,
      diff: d, diffTekst: beschrijfDiff(d), telling: telDiff(d), macroInfo: u.macroInfo, meldingen: u.meldingen,
    };
    if (r.model.programma) uit.programmaToets = toetsProgramma(r.model, r.model.programma, instellingen ? { instellingen } : {});
    return uit;
  });
}

/** Foutregels van één variant (voor melding en herstelbericht). */
export function foutRegels(v) {
  return (v.fouten || []).map((f) => {
    const m = /^ops\[(\d+)\]$/.exec(f.pad || '');
    const op = m ? (v.antwoordOps ?? v.ops)?.[Number(m[1])] : null;
    return `${f.pad ? `${f.pad}: ` : ''}${f.melding}${op ? ` — operatie: ${JSON.stringify(op).slice(0, 300)}` : ''}`;
  });
}

/**
 * Tekst voor de herstelpoging (één keer): alle fouten per variant, met de vraag het volledige antwoord opnieuw te geven.
 * @param {{ vormFouten?: string[], varianten?: Array }} o
 */
export function herstelTekst({ vormFouten = [], varianten = [] } = {}) {
  const regels = ['De app kon je antwoord niet toepassen. Geen enkele variant werd getoond. Fouten:'];
  for (const f of vormFouten) regels.push(`- ${f}`);
  varianten.forEach((v, i) => {
    if (v.ok) return;
    regels.push(`Variant ${i + 1} "${v.naam}":`);
    for (const r of foutRegels(v)) regels.push(`- ${r}`);
    if (v.macroInfo?.length) {
      regels.push('  Macro\'s die vóór de fout wel uitgevoerd werden (ter info, met de id\'s die ze aanmaakten):');
      for (const mi of v.macroInfo) regels.push(`  · ${macroInfoTekst(mi)}`);
    }
  });
  regels.push('', 'Operaties (ook macro\'s) worden per variant in volgorde toegepast op het oorspronkelijke ontwerp; daarna wordt het geheel gevalideerd. Geef het VOLLEDIGE verbeterde antwoord opnieuw (alle varianten, met alle operaties), in hetzelfde JSON-formaat. Hergebruik bestaande id\'s; geef nieuwe elementen nog niet gebruikte id\'s.');
  return regels.join('\n');
}

export const herstelBericht = (o) => ({ role: 'user', content: [{ type: 'text', text: herstelTekst(o) }] });

/**
 * Beslist wat er met een gelezen antwoord gebeurt.
 * @returns {{ actie: 'toon'|'vragen'|'herstel'|'fout', varianten?, data?, herstel?, melding? }}
 */
export function beoordeel(basis, gelezen, { herstelPogingen = 0, instellingen = null } = {}) {
  if (gelezen.status === 'weigering' || gelezen.status === 'max_tokens' || gelezen.status === 'onvolledig') return { actie: 'fout', melding: gelezen.melding };
  const magHerstel = herstelPogingen < MAX_HERSTEL;
  if (gelezen.status === 'ongeldig') {
    if (magHerstel) return { actie: 'herstel', herstel: herstelBericht({ vormFouten: gelezen.fouten }) };
    return { actie: 'fout', melding: `Het antwoord van Claude was ook na een herstelpoging onbruikbaar: ${gelezen.fouten.join(' ')} Er werd niets gewijzigd.` };
  }
  const data = gelezen.data;
  if (!data.varianten.length) {
    if (data.vragen.length) return { actie: 'vragen', data };
    return { actie: 'fout', data, melding: `Claude gaf geen varianten en geen vragen terug.${data.samenvatting ? ` (${data.samenvatting})` : ''}` };
  }
  const varianten = pasVariantenToe(basis, data.varianten, { instellingen });
  if (varianten.every((v) => v.ok)) return { actie: 'toon', data, varianten };
  if (magHerstel) return { actie: 'herstel', data, varianten, herstel: herstelBericht({ varianten }) };
  const lijst = varianten.filter((v) => !v.ok).map((v) => `"${v.naam}": ${foutRegels(v).join('; ')}`).join('\n');
  return { actie: 'fout', data, varianten, melding: `Ook na een herstelpoging konden niet alle varianten toegepast worden. Er werd niets gewijzigd.\n${lijst}` };
}

// ---------------------------------------------------------------- voorbeeld in de plattegrond

/** Vlak van een element in plan (mm), of null (niveaus, onbekend). */
function vlakVan(model, collectie, x) {
  if (!x) return null;
  if (collectie === 'muren') return muurLengte(x) > 0 ? muurDeelRechthoek(x, 0, muurLengte(x)) : null;
  if (collectie === 'openingen') {
    const m = model.muren.find((w) => w.id === x.muur);
    if (!m || muurLengte(m) <= 0) return null;
    return muurDeelRechthoek({ ...m, dikte: m.dikte + 160 }, x.positie, x.positie + x.breedte);
  }
  if (['ruimtes', 'vloeren', 'daken'].includes(collectie)) return Array.isArray(x.contour) ? x.contour : null;
  if (collectie === 'trappen') { try { return trapVoetafdruk(x, { model }); } catch { return null; } }
  if (collectie === 'inrichting') { try { return Array.isArray(x.positie) ? inrichtingContour(x) : null; } catch { return null; } }
  return null;
}

/** Niveaus waarop een element zichtbaar is (trap: van- én naarNiveau, het trapgat). */
function niveausVan(model, collectie, x) {
  if (!x) return [];
  if (collectie === 'openingen') return [model.muren.find((m) => m.id === x.muur)?.niveau].filter(Boolean);
  if (collectie === 'trappen') return [x.vanNiveau, x.naarNiveau].filter(Boolean);
  return x.niveau ? [x.niveau] : [];
}

const STIJL = { nieuw: 'nieuw', afbraak: 'afbraak', verwijderd: 'afbraak', gewijzigd: 'markering' };

/**
 * toonHulp-gegevens voor het voorbeeld van een variant op één niveau: polygonen per gewijzigd element.
 * Stijlen: 'nieuw' (blauw), 'afbraak' (rood), 'markering' (oranje = gewijzigd).
 * Ruimtes en daken als omtrek; muren/openingen als hun vlak.
 * @returns {{ polygonen: Array<{contour, stijl}>, niveaus: string[] }} niveaus = alle niveaus met wijzigingen
 */
export function voorbeeldHulp(basis, resultaat, d, niveau) {
  const polygonen = [];
  const niveaus = new Set();
  // grote vlakken eerst (onderaan), muren en openingen erboven
  const volgorde = { daken: 0, vloeren: 1, ruimtes: 2, trappen: 3, inrichting: 4, muren: 5, openingen: 6 };
  const regels = d.filter((r) => r.collectie in volgorde).sort((a, b) => volgorde[a.collectie] - volgorde[b.collectie]);
  for (const r of regels) {
    const bron = r.soort === 'verwijderd' ? basis : resultaat;
    const x = r.soort === 'verwijderd' ? r.oud : (bron[r.collectie] || []).find((e) => e.id === r.id);
    const nvs = niveausVan(bron, r.collectie, x);
    for (const nv of nvs) niveaus.add(nv);
    if (!nvs.includes(niveau)) continue;
    const vlak = vlakVan(bron, r.collectie, x);
    if (vlak && vlak.length >= 3) polygonen.push({ contour: vlak, stijl: STIJL[soortVan(r)] });
  }
  return { polygonen, niveaus: [...niveaus] };
}
