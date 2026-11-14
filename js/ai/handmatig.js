// Handmatige modus van het promptveld (fase 5c): werken met Claude ZONDER eigen API-key.
// De app zet één tekst op het klembord (systeemprompt + antwoordschema + context + opdracht); de gebruiker plakt die in
// een Claude-chat die de organisatie toelaat, en plakt het JSON-antwoord terug. De verwerking is dezelfde als bij de API:
// macro's uitvouwen, applyOps + validate, diff, kerncijfers, programmatoets (verwerk.js: leesAntwoord + beoordeel).
// Pure functies zonder DOM of netwerk (getest in tests/ai-handmatig.test.js).

import { SYSTEEMPROMPT, ANTWOORD_SCHEMA, contextTekst, opdrachtTekst, antwoordBericht } from './prompt.js';
import { leesAntwoord, beoordeel } from './verwerk.js';

/** Begin van de systeemprompt: herkent een per ongeluk teruggeplakte opdracht. */
const PROMPT_MERKTEKEN = SYSTEEMPROMPT.slice(0, 60);

/** Extra uitleg voor dit kanaal (gaat vóór het schema). Kort houden: de systeemprompt blijft de bron van de regels. */
export const KANAAL_TEKST = `# Werkwijze in dit gesprek (zonder app-koppeling)
De gebruiker heeft deze tekst uit de app gekopieerd en hier geplakt. Er is geen API-koppeling en geen opgelegd schema: de gebruiker kopieert jouw antwoord terug in de app, die het controleert, een voorbeeld toont en pas na bevestiging toepast. Daarom, in afwijking van "geen codeblokken" hierboven:
- Antwoord met precies één JSON-object volgens het antwoordschema hieronder, in één codeblok \`\`\`json … \`\`\`, zonder andere tekst ervoor of erna.
- "item" en "velden" mag je hier als gewoon JSON-object schrijven (aanbevolen, minder kans op fouten) of als JSON-tekst; beide worden aanvaard.
- Plakt de gebruiker later een foutmelding van de app, geef dan het VOLLEDIGE verbeterde JSON-object opnieuw (zelfde vorm). Stel je vragen ("vragen"), dan antwoordt de gebruiker in dit gesprek.`;

export const SLOT_TEKST = 'Antwoord uitsluitend met JSON volgens dit schema: één ```json-codeblok met het volledige object, geen andere tekst.';

/**
 * De tekst die de knop "Kopieer opdracht voor Claude" op het klembord zet. Compact: schema en ontwerp zonder opmaak.
 * @param {object} model  het actieve ontwerp
 * @param {string} opdracht
 * @param {{ aantal?: number, niveau?: string|null, selectie?: string|null, kerncijfers?: object }} o
 */
export function bouwKopieertekst(model, opdracht, { aantal = 1, niveau = null, selectie = null, kerncijfers = null } = {}) {
  return [
    SYSTEEMPROMPT,
    KANAAL_TEKST,
    `# Antwoordschema (JSON Schema)\n${JSON.stringify(ANTWOORD_SCHEMA)}`,
    `# Context\n${contextTekst(model, { niveau, selectie, kerncijfers })}`,
    `# ${opdrachtTekst(opdracht, aantal)}`,
    SLOT_TEKST,
  ].join('\n\n');
}

/** Grootte van een tekst voor de melding in de UI: tekens en kB (UTF-8). */
export function tekstGrootte(t) {
  const s = String(t ?? '');
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length;
  return { tekens: s.length, kB: Math.round(bytes / 102.4) / 10 };
}

// ---------------------------------------------------------------- JSON uit geplakte tekst

/** Einde van een gebalanceerd JSON-object/-lijst vanaf `start` (bewust van strings), of -1 (onvolledig). */
function eindeVan(t, start) {
  const open = t[start];
  const stapel = [open === '{' ? '}' : ']'];
  let inTekst = false;
  for (let i = start + 1; i < t.length; i++) {
    const c = t[i];
    if (inTekst) {
      if (c === '\\') i++;
      else if (c === '"') inTekst = false;
      continue;
    }
    if (c === '"') inTekst = true;
    else if (c === '{') stapel.push('}');
    else if (c === '[') stapel.push(']');
    else if (c === '}' || c === ']') {
      if (stapel.pop() !== c) return -1;
      if (!stapel.length) return i;
    }
  }
  return -1;
}

/** Hoe goed een geparste waarde op een antwoord lijkt (hoger = beter). */
function score(w) {
  if (w && typeof w === 'object' && !Array.isArray(w)) {
    if (Array.isArray(w.varianten)) return 3;
    if (Array.isArray(w.ops)) return 2;
    if (typeof w.op === 'string') return 1;
    return 0;
  }
  if (Array.isArray(w) && w.length && w.every((x) => x && typeof x === 'object' && typeof x.op === 'string')) return 2;
  return -1;
}

/**
 * Haalt de JSON uit geplakte tekst: een ```json-codeblok (ook midden in tekst of onafgesloten), de hele tekst, of het
 * grootste JSON-object/-lijst in de tekst (inleidende of afsluitende zinnen worden genegeerd).
 * Bij meerdere kandidaten wint wat het best op een antwoord lijkt (varianten > ops > operatie > ander object), daarna de laatste.
 * @returns {{ ok: true, waarde: any, bron: 'codeblok'|'tekst'|'deel' } | { ok: false, fout: string }}
 */
export function haalJsonUit(tekst) {
  const t = String(tekst ?? '').replace(/^﻿/, '').trim();
  if (!t) return { ok: false, fout: 'Er is niets geplakt.' };
  if (t.includes(PROMPT_MERKTEKEN)) return { ok: false, fout: 'Dit is de opdracht zelf (de gekopieerde tekst voor Claude), niet het antwoord. Plak hier het antwoord dat Claude gaf.' };
  const kandidaten = [];
  const parseFouten = [];
  const probeer = (s, bron) => {
    const x = s.trim();
    if (!x || !/^[[{]/.test(x)) return;
    try { kandidaten.push({ waarde: JSON.parse(x), bron }); } catch (e) { parseFouten.push(e.message); }
  };
  // 1. codeblokken (```json … ``` of ``` … ```); een laatste onafgesloten blok telt ook
  const re = /```[ \t]*[A-Za-z0-9_-]*[^\n]*\n([\s\S]*?)(?:```|$)/g;
  for (let m; (m = re.exec(t));) { probeer(m[1], 'codeblok'); if (m[0].length === 0) re.lastIndex++; }
  // 2. de hele tekst
  if (!kandidaten.length) probeer(t, 'tekst');
  // 3. gebalanceerde stukken {…} / […] in de tekst
  let onvolledig = false;
  if (!kandidaten.length) {
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== '{' && t[i] !== '[') continue;
      const e = eindeVan(t, i);
      // onafgesloten: de rest van de tekst ligt erbinnen ⇒ stoppen (geen losse binnenobjecten als antwoord nemen)
      if (e < 0) { if (t[i] === '[') continue; onvolledig = true; break; }
      // enkel stukken op het hoogste niveau: ook een ongeldig stuk wordt overgeslagen, niet doorzocht
      probeer(t.slice(i, e + 1), 'deel');
      i = e;
    }
  }
  const bruikbaar = kandidaten.filter((k) => score(k.waarde) >= 0);
  if (bruikbaar.length) {
    let beste = bruikbaar[0];
    for (const k of bruikbaar) if (score(k.waarde) >= score(beste.waarde)) beste = k;
    return { ok: true, waarde: beste.waarde, bron: beste.bron };
  }
  if (onvolledig) return { ok: false, fout: 'Het geplakte antwoord lijkt onvolledig (er ontbreken sluithaakjes). Kopieer het volledige antwoord van Claude; was het afgebroken, vraag dan in de chat om het volledige JSON-object opnieuw te geven.' };
  if (parseFouten.length) return { ok: false, fout: `Het antwoord bevat JSON, maar die is ongeldig (${parseFouten[0]}).` };
  return { ok: false, fout: 'Geen JSON gevonden in de geplakte tekst. Plak het JSON-antwoord van Claude (het codeblok).' };
}

/**
 * Zet een geëxtraheerde waarde om naar de antwoordvorm. Mild voor kleine afwijkingen: een losse operatielijst of
 * `{ ops }` wordt één variant; ontbrekende samenvatting/vragen worden aangevuld. De rest controleert controleerVorm.
 */
export function naarAntwoord(w) {
  if (score(w) === 2 || score(w) === 1) {
    const ops = Array.isArray(w) ? w : Array.isArray(w.ops) ? w.ops : [w];
    return { samenvatting: '', vragen: [], varianten: [{ naam: w.naam || 'Variant', beschrijving: w.beschrijving || '', ops }] };
  }
  if (w && typeof w === 'object' && !Array.isArray(w) && Array.isArray(w.varianten)) {
    return { ...w, samenvatting: typeof w.samenvatting === 'string' ? w.samenvatting : '', vragen: w.vragen ?? [] };
  }
  return w;
}

/**
 * Leest geplakte tekst zoals leesAntwoord een API-bericht leest.
 * @returns {{ status: 'ok'|'ongeldig'|'leeg', data?, fouten?: string[], melding?: string }}
 */
export function leesGeplakt(tekst) {
  if (!String(tekst ?? '').trim()) return { status: 'leeg', melding: 'Plak eerst het antwoord van Claude.' };
  const j = haalJsonUit(tekst);
  if (!j.ok) return { status: 'ongeldig', fouten: [j.fout] };
  const nep = { stop_reason: 'end_turn', model: null, content: [{ type: 'text', text: JSON.stringify(naarAntwoord(j.waarde)) }] };
  return leesAntwoord(nep);
}

/** Tekst die de gebruiker na een fout in HETZELFDE gesprek plakt (herstelpoging). */
export function herstelvraagTekst(herstel) {
  const t = herstel?.content?.map((b) => b.text).join('\n') || 'De app kon je antwoord niet toepassen.';
  return `${t}\n\nAntwoord opnieuw uitsluitend met het volledige JSON-object volgens het schema uit mijn eerste bericht (één \`\`\`json-codeblok).`;
}

/** Tekst met het antwoord van de gebruiker op vragen van Claude (in hetzelfde gesprek te plakken). */
export function antwoordTekst(tekst, aantal = 1) {
  return `${antwoordBericht(tekst, aantal).content[0].text}\n\n${SLOT_TEKST}`;
}

// ---------------------------------------------------------------- gesprek

/**
 * Handmatig "gesprek": zelfde rol als Gesprek (gesprek.js), maar de gebruiker brengt de berichten over.
 * Eén herstelpoging, net als bij de API: na een fout geeft verwerk() actie 'herstel' met een `herstelvraag`;
 * is ook het volgende geplakte antwoord fout, dan actie 'fout'.
 */
export class HandmatigGesprek {
  /**
   * @param {{ basis: object, niveau?: string|null, selectie?: string|null, aantal?: number, modelInstellingen?: object }} o
   *   basis = het actieve ontwerp op het moment van kopiëren (blijft de basis voor alle varianten).
   */
  constructor({ basis, niveau = null, selectie = null, aantal = 1, modelInstellingen = null }) {
    this.basis = basis;
    this.niveau = niveau;
    this.selectie = selectie;
    this.aantal = aantal;
    this.modelInstellingen = modelInstellingen;
    this.handmatig = true;
    this.herstelPogingen = 0;
    this.opdracht = null;
    // velden die het promptpaneel ook bij een API-gesprek leest
    this.verbruik = [];
    this.aanpassingen = [];
    this.fallbacks = [];
    this.instellingen = { model: 'handmatig', effort: '' };
  }

  /** De tekst voor het klembord (nieuw gesprek met Claude). */
  kopieertekst(opdracht) {
    this.opdracht = String(opdracht || '').trim();
    this.herstelPogingen = 0;
    return bouwKopieertekst(this.basis, this.opdracht, { aantal: this.aantal, niveau: this.niveau, selectie: this.selectie });
  }

  /** Antwoord op vragen van Claude: tekst om in hetzelfde gesprek te plakken. */
  antwoord(tekst) {
    this.herstelPogingen = 0;
    return antwoordTekst(tekst, this.aantal);
  }

  /**
   * Verwerkt het geplakte antwoord.
   * @returns {{ actie: 'toon'|'vragen'|'herstel'|'fout'|'leeg', varianten?, data?, herstelvraag?, foutTekst?, melding?, herstelPogingen }}
   */
  verwerk(tekst) {
    const gelezen = leesGeplakt(tekst);
    if (gelezen.status === 'leeg') return { actie: 'leeg', melding: gelezen.melding, herstelPogingen: this.herstelPogingen };
    const r = beoordeel(this.basis, gelezen, { herstelPogingen: this.herstelPogingen, instellingen: this.modelInstellingen });
    if (r.actie === 'herstel') {
      this.herstelPogingen++;
      return { ...r, herstelvraag: herstelvraagTekst(r.herstel), foutTekst: r.herstel.content[0].text, herstelPogingen: this.herstelPogingen - 1 };
    }
    const uit = { ...r, herstelPogingen: this.herstelPogingen };
    if (r.actie === 'toon' || r.actie === 'vragen') this.herstelPogingen = 0;
    return uit;
  }
}
