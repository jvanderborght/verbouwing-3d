// Ops-bestanden voor Claude Code (tools/apply-ops.mjs, fase 5c): dezelfde vormen en dezelfde verwerking als het promptveld.
// Pure functies (getest in tests/ai-handmatig.test.js). Aanvaarde vormen:
//   - een lijst operaties, één operatie, of { ops: [...], _uitleg?, basis?, naam?, beschrijving? }   → één variant
//   - het antwoordformaat van het promptveld: { samenvatting?, vragen?, varianten: [{ naam, beschrijving, ops }] }
//   - tekst met zo'n JSON erin (bv. een geplakt chatantwoord met ```json-blok)
// Operaties: basisoperaties en macro's (js/ai/macros.js); item/velden als object of als JSON-tekst.

import { dupliceer } from '../model/operations.js';
import { pasVariantenToe, foutRegels } from './verwerk.js';
import { macroInfoTekst } from './macros.js';
import { haalJsonUit } from './handmatig.js';

/**
 * Leest de inhoud van een ops-bestand (tekst of reeds geparste waarde).
 * @returns {{ ok: true, soort: 'ops'|'antwoord', varianten: Array<{ naam, beschrijving, ops }>, basis: string|null, samenvatting: string, vragen: string[] }
 *   | { ok: false, fout: string }}
 */
export function leesOpsBron(bron) {
  let w = bron;
  if (typeof bron === 'string') {
    try { w = JSON.parse(bron); } catch {
      const j = haalJsonUit(bron);
      if (!j.ok) return { ok: false, fout: j.fout };
      w = j.waarde;
    }
  }
  const basis = w && typeof w === 'object' && !Array.isArray(w) && typeof w.basis === 'string' ? w.basis : null;
  if (w && typeof w === 'object' && !Array.isArray(w) && Array.isArray(w.varianten)) {
    const vragen = Array.isArray(w.vragen) ? w.vragen.filter((v) => typeof v === 'string' && v.trim()) : [];
    const fouten = [];
    w.varianten.forEach((v, i) => {
      if (!v || typeof v !== 'object') fouten.push(`varianten[${i}] is geen object.`);
      else if (!Array.isArray(v.ops)) fouten.push(`varianten[${i}].ops moet een lijst operaties zijn.`);
    });
    if (fouten.length) return { ok: false, fout: fouten.join(' ') };
    return {
      ok: true, soort: 'antwoord', basis, samenvatting: typeof w.samenvatting === 'string' ? w.samenvatting : '', vragen,
      varianten: w.varianten.map((v, i) => ({ naam: String(v.naam || `Variant ${i + 1}`).trim(), beschrijving: String(v.beschrijving || '').trim(), ops: v.ops })),
    };
  }
  let ops;
  if (Array.isArray(w)) ops = w;
  else if (w && typeof w === 'object' && Array.isArray(w.ops)) ops = w.ops;
  else if (w && typeof w === 'object' && typeof w.op === 'string') ops = [w];
  else return { ok: false, fout: 'Onbekende vorm: verwacht een lijst operaties, { ops: [...] } of { samenvatting, varianten: [{ naam, beschrijving, ops }] }.' };
  return {
    ok: true, soort: 'ops', basis, samenvatting: '', vragen: [],
    varianten: [{ naam: typeof w.naam === 'string' ? w.naam : '', beschrijving: typeof w.beschrijving === 'string' ? w.beschrijving : '', ops }],
  };
}

/** Slug voor een ontwerp-id: kleine letters, cijfers en '-', zonder accenten (geldig volgens de validator). */
export function slug(tekst, max = 40) {
  const s = String(tekst || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return s || 'variant';
}

/** Vrij id `<voorstel>`, `<voorstel>-2`, … buiten `bezet` (Set). */
export function vrijOntwerpId(voorstel, bezet) {
  if (!bezet.has(voorstel)) return voorstel;
  let n = 2;
  while (bezet.has(`${voorstel}-${n}`)) n++;
  return `${voorstel}-${n}`;
}

/**
 * Past de varianten van een ops-bron toe op een ontwerp (de verwerking van het promptveld: macro's uitvouwen, applyOps + validate).
 * Atomair over alle varianten: faalt er één, dan `ok: false`.
 * @param {object} model  bronontwerp (gemigreerd)
 * @param {ReturnType<typeof leesOpsBron>} bron
 * @param {{ variant?: number|null, als?: string|null, naam?: string|null, bezet?: Set<string>, instellingen?: object }} o
 *   variant = 1-gebaseerd nummer (enkel die variant); als = id van het nieuwe ontwerp (enkel bij één variant);
 *   bij het antwoordformaat zonder `als`: elke variant als nieuw ontwerp `<model.id>-<slug(naam)>`; bij gewone ops zonder `als`: het
 *   bronontwerp zelf wordt bijgewerkt. bezet = bestaande ontwerp-id's (voor automatische id's).
 * @returns {{ ok: boolean, fout?: string, resultaten: Array<{ id, naam, nieuw: boolean, ok, model?, regels: string[], fouten?: string[], programmaToets? }> }}
 */
export function verwerkOpsBron(model, bron, { variant = null, als = null, naam = null, bezet = new Set(), instellingen = null } = {}) {
  let varianten = bron.varianten.map((v, i) => ({ ...v, nummer: i + 1 }));
  if (variant != null) {
    const n = Number(variant);
    if (!Number.isInteger(n) || n < 1 || n > varianten.length) return { ok: false, fout: `--variant ${variant}: kies 1 tot ${varianten.length}.`, resultaten: [] };
    varianten = [varianten[n - 1]];
  }
  if (!varianten.length) return { ok: false, fout: bron.vragen?.length ? `Geen varianten; wel vragen:\n- ${bron.vragen.join('\n- ')}` : 'Geen varianten in het bestand.', resultaten: [] };
  if (als && varianten.length > 1) return { ok: false, fout: `--als kan enkel met één variant; dit bestand heeft er ${varianten.length}. Kies er één met --variant <n>, of laat --als weg (dan wordt elke variant <id>-<naam>).`, resultaten: [] };
  if (als && !/^[a-z0-9][a-z0-9-_]*$/.test(als)) return { ok: false, fout: `--als "${als}": een ontwerp-id bestaat uit kleine letters, cijfers, - of _.`, resultaten: [] };

  const gebruikt = new Set(bezet);
  const resultaten = varianten.map((v) => {
    let id = model.id, nieuw = false, ontwerpNaam = model.naam;
    if (als) { id = als; nieuw = true; ontwerpNaam = naam || v.naam || als; }
    else if (bron.soort === 'antwoord') {
      id = vrijOntwerpId(`${model.id}-${slug(v.naam)}`.slice(0, 60), gebruikt);
      nieuw = true;
      ontwerpNaam = naam && varianten.length === 1 ? naam : `${model.naam} – ${v.naam}`;
    }
    gebruikt.add(id);
    let start = nieuw ? dupliceer(model, id, ontwerpNaam) : model;
    if (nieuw && bron.soort === 'antwoord' && v.beschrijving) start = { ...start, beschrijving: v.beschrijving };
    const [r] = pasVariantenToe(start, [v], { instellingen, ontwerpVelden: null });
    const kop = `Variant ${v.nummer}${v.naam ? ` "${v.naam}"` : ''} → ontwerp "${id}"${nieuw ? ' (nieuw ontwerp)' : ' (bijgewerkt)'}`;
    if (!r.ok) return { id, naam: ontwerpNaam, nieuw, ok: false, fouten: foutRegels(r), regels: [kop] };
    const regels = [kop, ...r.diffTekst.map((t) => `  ${t}`)];
    if (r.macroInfo?.length) regels.push('  Macro\'s:', ...r.macroInfo.map((mi) => `  · ${macroInfoTekst(mi)}`));
    if (r.meldingen?.length) regels.push('  Meldingen:', ...r.meldingen.map((m) => `  ! ${m}`));
    if (r.waarschuwingen?.length) regels.push('  Waarschuwingen:', ...r.waarschuwingen.map((w) => `  ! ${w.pad ? `${w.pad}: ` : ''}${w.melding}`));
    const toets = r.programmaToets || null;
    if (toets) {
      const s = toets.samenvatting;
      regels.push(`  Programma van eisen: ${s.voldoet} voldoet, ${s['voldoet niet']} voldoet niet, ${s.onbekend} onbekend`);
      if (toets.fout) regels.push(`  · ${toets.fout}`);
      for (const e of toets.resultaten) regels.push(`  · ${e.label}: ${e.status} — ${e.uitleg}`);
    }
    return { id, naam: ontwerpNaam, nieuw, ok: true, model: r.model, regels, programmaToets: toets, telling: r.telling };
  });
  const ok = resultaten.every((r) => r.ok);
  return { ok, resultaten };
}
