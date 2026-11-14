// Programma van eisen (fase 5) — zuivere logica voor de editor in de UI (geen DOM; getest in tests/ui-programma.test.js).
// Het programma zelf staat in het ontwerp (`model.programma`) en wordt enkel gewijzigd via de operatie `ontwerp`.
// De toets komt uit js/model/programma.js (toetsProgramma); hier enkel omzetting formulier ⇄ eis en de weergave.

import { FUNCTIES, INRICHTING_SOORTEN, TRAP_TYPES, NIVEAU_SOORTEN } from '../model/schema.js';
import { valideerProgramma, toetsProgramma } from '../model/programma.js';
import { leesGetal } from './eigenschappen.js';

export const EIS_SOORTEN = Object.freeze(['ruimte', 'trap']);

/** Leeg formulier voor een nieuwe eis. */
export function leegFormulier(soort = 'ruimte') {
  return soort === 'trap'
    ? { soort: 'trap', naam: '', van: '', naar: '', types: [], aantal: '1' }
    : { soort: 'ruimte', naam: '', functie: 'slaapkamer', aantal: '1', niveau: '', minOppervlakte: '', hoogteGrens: '', inrichting: [] };
}

const tekst = (v) => (v == null ? '' : String(v));

/** Eis (uit het model) → formulier (alle waarden als tekst of lijst). */
export function eisNaarFormulier(eis) {
  if (eis && typeof eis === 'object' && eis.trap && typeof eis.trap === 'object') {
    const t = eis.trap;
    return {
      soort: 'trap', naam: tekst(eis.naam), van: tekst(t.van), naar: tekst(t.naar),
      types: t.type == null ? [] : (Array.isArray(t.type) ? [...t.type] : [t.type]),
      aantal: tekst(t.aantal ?? eis.aantal ?? 1),
    };
  }
  const e = eis || {};
  return {
    soort: 'ruimte', naam: tekst(e.naam), functie: FUNCTIES.includes(e.functie) ? e.functie : 'overig',
    aantal: tekst(e.aantal ?? 1), niveau: tekst(e.niveau), minOppervlakte: tekst(e.minOppervlakte), hoogteGrens: tekst(e.hoogteGrens),
    inrichting: Array.isArray(e.inrichting) ? [...e.inrichting] : [],
  };
}

function geheel(t, naam) {
  if (String(t ?? '').trim() === '') return { waarde: 1 };
  const v = leesGetal(t);
  if (!Number.isInteger(v) || v < 1) return { fout: `${naam}: geef een geheel getal ≥ 1.` };
  return { waarde: v };
}

function positief(t, naam) {
  if (String(t ?? '').trim() === '') return { waarde: null };
  const v = leesGetal(t);
  if (!Number.isFinite(v) || v <= 0) return { fout: `${naam}: geef een getal > 0 of laat leeg.` };
  return { waarde: v };
}

/**
 * Formulier → eis. Lege optionele velden worden weggelaten (aantal 1 ook).
 * @returns {{ eis?: object, fout?: string }}
 */
export function formulierNaarEis(f) {
  if (!f || !EIS_SOORTEN.includes(f.soort)) return { fout: 'Onbekende soort eis.' };
  const naam = String(f.naam ?? '').trim();
  const a = geheel(f.aantal, 'Aantal');
  if (a.fout) return { fout: a.fout };
  if (f.soort === 'trap') {
    const t = {};
    if (String(f.van ?? '').trim()) t.van = String(f.van).trim();
    if (String(f.naar ?? '').trim()) t.naar = String(f.naar).trim();
    const types = (f.types || []).filter((x) => TRAP_TYPES.includes(x));
    if (types.length === 1) t.type = types[0];
    else if (types.length > 1) t.type = types;
    if (a.waarde !== 1) t.aantal = a.waarde;
    const eis = { trap: t };
    if (naam) eis.naam = naam;
    return { eis };
  }
  if (!FUNCTIES.includes(f.functie)) return { fout: `Kies een functie (${FUNCTIES.join(', ')}).` };
  const eis = { functie: f.functie };
  if (a.waarde !== 1) eis.aantal = a.waarde;
  if (String(f.niveau ?? '').trim()) eis.niveau = String(f.niveau).trim();
  const opp = positief(f.minOppervlakte, 'Minimale oppervlakte');
  if (opp.fout) return { fout: opp.fout };
  if (opp.waarde != null) eis.minOppervlakte = opp.waarde;
  const hg = positief(f.hoogteGrens, 'Hoogtegrens');
  if (hg.fout) return { fout: hg.fout };
  if (hg.waarde != null) eis.hoogteGrens = hg.waarde;
  const inr = (f.inrichting || []).filter((x) => INRICHTING_SOORTEN.includes(x));
  if (inr.length) eis.inrichting = [...new Set(inr)];
  if (naam) eis.naam = naam;
  return { eis };
}

/**
 * Formulieren + beschrijving → operaties (één `ontwerp`-operatie). Geen eisen en geen beschrijving ⇒ programma wissen.
 * @returns {{ ops?: object[], programma?: object|null, fout?: string }}
 */
export function programmaOps(formulieren, beschrijving = '') {
  const eisen = [];
  for (let i = 0; i < (formulieren || []).length; i++) {
    const r = formulierNaarEis(formulieren[i]);
    if (r.fout) return { fout: `Eis ${i + 1}: ${r.fout}` };
    eisen.push(r.eis);
  }
  const b = String(beschrijving ?? '').trim();
  const programma = eisen.length || b ? { ...(b ? { beschrijving: b } : {}), eisen } : null;
  if (programma) {
    const f = valideerProgramma(programma).filter((p) => p.ernst === 'fout');
    if (f.length) return { fout: f.map((p) => p.melding).join(' ') };
  }
  return { ops: [{ op: 'ontwerp', velden: { programma } }], programma };
}

/** Keuzes voor een niveauverwijzing in een eis: leeg (elk niveau), de soorten en de niveaus van het ontwerp. */
export function niveauKeuzes(model, { leegLabel = 'elk niveau' } = {}) {
  const uit = [{ waarde: '', label: leegLabel }];
  for (const s of NIVEAU_SOORTEN) uit.push({ waarde: s, label: `soort: ${s}` });
  for (const n of [...(model?.niveaus || [])].sort((a, b) => a.peil - b.peil)) uit.push({ waarde: n.id, label: `${n.id} – ${n.naam}` });
  return uit;
}

export const TOETS_KLASSE = { voldoet: 'voldoet', 'voldoet niet': 'voldoet-niet', onbekend: 'onbekend' };

/**
 * Toetsresultaat voor de weergave. Gooit nooit.
 * @returns {{ regels: Array<{ label, status, klasse, uitleg }>, samenvatting: string, fout?: string }}
 */
export function toetsWeergave(model) {
  if (!model?.programma) return { regels: [], samenvatting: 'Geen programma van eisen.' };
  let r;
  try { r = toetsProgramma(model, model.programma); }
  catch (e) { return { regels: [], samenvatting: 'Toets mislukt.', fout: e.message }; }
  if (r.fout && !r.resultaten.length) return { regels: [], samenvatting: r.fout, fout: r.fout };
  const s = r.samenvatting;
  const delen = [`${s.voldoet} voldoet`, `${s['voldoet niet']} voldoet niet`];
  if (s.onbekend) delen.push(`${s.onbekend} onbekend`);
  return {
    regels: r.resultaten.map((x) => ({ label: x.label, status: x.status, klasse: TOETS_KLASSE[x.status] || 'onbekend', uitleg: x.uitleg })),
    samenvatting: `${r.resultaten.length} ${r.resultaten.length === 1 ? 'eis' : 'eisen'}: ${delen.join(', ')}.`,
  };
}
