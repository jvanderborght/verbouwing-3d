// Promptveld (fase 4): systeemprompt, antwoordschema en opbouw van de berichten en het API-verzoek.
// Pure functies zonder DOM of netwerk (getest in tests/ai.test.js).
//
// Cache-opbouw (prompt caching is een prefix-match):
//   system  = SYSTEEMPROMPT (vast, byte-identiek voor elke aanvraag)            ← cache_control
//   user[0] = [ context: ontwerp-JSON + kerncijfers + niveau/selectie          ← cache_control
//              opdracht van de gebruiker ]
//   daarna enkel aanvullen (assistant-antwoord, herstel- of antwoordbericht), nooit eerdere beurten wijzigen.

import { VELDEN, ENUMS, COLLECTIE_NAMEN, COLLECTIES, STATUSSEN, OPENING_TYPES, DAK_TYPES, NOKRICHTINGEN, FUNCTIES } from '../model/schema.js';
import { volgendId } from '../model/operations.js';
import { kerncijfers as berekenKerncijfers } from '../metrics/kerncijfers.js';

// ---------------------------------------------------------------- modellen en instellingen

/**
 * Keuzelijst in Instellingen. `fallbacks`: server-side fallbacks meesturen.
 * Bron: Claude API-documentatie (skill claude-api, shared/models.md), gelezen 2026-11-14:
 * Claude Haiku 5.5 heeft géén server-side fallback (de lijstvorm van `fallbacks` geeft daar 400; met "default" blijft
 * een weigering gewoon een weigering). We sturen voor Haiku dus geen fallbacks mee.
 */
export const MODELLEN = Object.freeze([
  { id: 'claude-opus-5-5', naam: 'Claude Opus 5.5 (standaard)', fallbacks: true },
  { id: 'claude-sonnet-5-5', naam: 'Claude Sonnet 5.5', fallbacks: true },
  { id: 'claude-haiku-5-5', naam: 'Claude Haiku 5.5', fallbacks: false },
]);
export const STANDAARD_MODEL = 'claude-opus-5-5';
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const EFFORT_LABELS = Object.freeze({ low: 'laag', medium: 'gemiddeld (standaard)', high: 'hoog', xhigh: 'zeer hoog', max: 'maximaal' });
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const MAX_VARIANTEN = 4;
/** Ruim: denkwerk telt mee in max_tokens; met streaming is er geen time-out van de SDK voor lange antwoorden. */
export const MAX_TOKENS = 64000;

export const STANDAARD_AI_INSTELLINGEN = Object.freeze({ model: STANDAARD_MODEL, effort: 'medium', fallbacks: true });

/** Normaliseert opgeslagen AI-instellingen (onbekende waarden → standaard). */
export function normaliseerInstellingen(v) {
  const uit = { ...STANDAARD_AI_INSTELLINGEN };
  if (v && MODELLEN.some((m) => m.id === v.model)) uit.model = v.model;
  if (v && EFFORTS.includes(v.effort)) uit.effort = v.effort;
  if (v && typeof v.fallbacks === 'boolean') uit.fallbacks = v.fallbacks;
  return uit;
}

// ---------------------------------------------------------------- antwoordschema (structured outputs)

const OP_COLLECTIES = { type: 'string', enum: [...COLLECTIE_NAMEN] };
const PUNT = { type: 'array', items: { type: 'number' } };

/** Alle elementvelden over alle collecties heen (optioneel). Welke velden bij welke collectie horen, staat in de systeemprompt. */
function elementSchema() {
  const props = {};
  for (const c of COLLECTIE_NAMEN) {
    for (const [naam, type] of VELDEN[c]) {
      if (props[naam] && naam !== 'type') continue;
      if (type === 'string' || type.startsWith('ref:')) props[naam] = { type: 'string' };
      else if (type === 'number') props[naam] = { type: 'number' };
      else if (type === 'punt') props[naam] = PUNT;
      else if (type === 'contour') props[naam] = { type: 'array', items: PUNT };
      else if (type.startsWith('enum:')) {
        const lijst = ENUMS[type.slice(5)];
        const vorig = props[naam]?.enum || [];
        props[naam] = { type: 'string', enum: [...new Set([...vorig, ...lijst])] };
      }
    }
  }
  return { type: 'object', additionalProperties: false, properties: props };
}

/**
 * JSON-schema van het antwoord. Beperkingen van structured outputs: geen recursie, geen min/max,
 * `additionalProperties: false` op elk object. De operatie `ontwerp` (naam/beschrijving) zit er bewust niet in:
 * de app beheert naam en beschrijving van varianten zelf.
 */
export const ANTWOORD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['samenvatting', 'vragen', 'varianten'],
  properties: {
    samenvatting: { type: 'string', description: 'Korte samenvatting (1-3 zinnen) van wat je voorstelt of waarom je vragen stelt.' },
    vragen: { type: 'array', items: { type: 'string' }, description: 'Verduidelijkingsvragen. Leeg als de opdracht duidelijk genoeg is.' },
    varianten: {
      type: 'array',
      description: 'Uitgewerkte varianten. Leeg als je eerst vragen stelt.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['naam', 'beschrijving', 'ops'],
        properties: {
          naam: { type: 'string', description: 'Korte naam van de variant (max. ±40 tekens).' },
          beschrijving: { type: 'string', description: 'Wat er verandert, welke maten je aannam en waarom.' },
          ops: { type: 'array', items: { $ref: '#/$defs/op' } },
        },
      },
    },
  },
  $defs: {
    element: elementSchema(),
    op: {
      anyOf: [
        {
          type: 'object', additionalProperties: false, required: ['op', 'collectie', 'item'],
          properties: { op: { type: 'string', enum: ['toevoegen'] }, collectie: OP_COLLECTIES, item: { $ref: '#/$defs/element' } },
        },
        {
          type: 'object', additionalProperties: false, required: ['op', 'collectie', 'id', 'velden'],
          properties: { op: { type: 'string', enum: ['wijzigen'] }, collectie: OP_COLLECTIES, id: { type: 'string' }, velden: { $ref: '#/$defs/element' } },
        },
        {
          type: 'object', additionalProperties: false, required: ['op', 'collectie', 'id'],
          properties: { op: { type: 'string', enum: ['verwijderen'] }, collectie: OP_COLLECTIES, id: { type: 'string' } },
        },
        {
          type: 'object', additionalProperties: false, required: ['op', 'collectie', 'id', 'dx', 'dy'],
          properties: { op: { type: 'string', enum: ['verplaatsen'] }, collectie: OP_COLLECTIES, id: { type: 'string' }, dx: { type: 'number' }, dy: { type: 'number' } },
        },
      ],
    },
  },
});

// ---------------------------------------------------------------- systeemprompt

function veldenTekst() {
  const uitleg = {
    'niveaus.peil': 'z van de afgewerkte vloer', 'niveaus.hoogte': 'verdiepingshoogte vloer-tot-vloer = standaard muurhoogte',
    'niveaus.vloerdikte': 'dikte vloerpakket onder dit niveau',
    'muren.start': '[x, y] op de AS van de muur', 'muren.eind': '[x, y] op de as', 'muren.hoogte': 'overschrijft de niveauhoogte',
    'openingen.positie': 'afstand langs de muuras van muur.start tot de rand van de opening',
    'openingen.borstwering': 'onderkant boven vloerpeil (deur: 0)',
    'ruimtes.contour': 'NETTO binnencontour [[x,y],…]', 'vloeren.contour': 'BRUTO buitencontour',
    'daken.niveau': 'het dak rust op de bovenkant van dit niveau (peil + hoogte)', 'daken.contour': 'grondvlak zonder overstek',
    'daken.helling': 'graden; plat = 0', 'daken.nokrichting': 'x|y: richting van de nok (zadel/schild) of van de hoge rand (lessenaar, aan de max-zijde)',
  };
  return COLLECTIE_NAMEN.map((c) => {
    const velden = VELDEN[c].map(([n, type, verplicht]) => {
      const t = type.startsWith('enum:') ? ENUMS[type.slice(5)].join('|') : type.startsWith('ref:') ? `id van ${type.slice(4)}` : type;
      const u = uitleg[`${c}.${n}`];
      return `${n}${verplicht ? '' : '?'}: ${t}${u ? ` (${u})` : ''}`;
    });
    return `- ${c} (id-voorvoegsel ${COLLECTIES[c]}): { ${velden.join('; ')} }`;
  }).join('\n');
}

/** Vaste systeemprompt. Bevat niets dat per aanvraag verandert (anders breekt de prompt-cache). */
export const SYSTEEMPROMPT = `Je bent de ontwerpassistent van "Verbouwing 3D", een schets- en vergelijkingstool om de verbouwing van een woning in 3D te schetsen en varianten te vergelijken. Het is géén BIM/CAD: stabiliteit, EPB en vergunning blijven voor architect/ingenieur. Je spreekt Nederlands (Vlaams).

# Je taak
De gebruiker geeft een opdracht in gewone taal. Je antwoordt UITSLUITEND met één JSON-object volgens het opgelegde schema:
{ "samenvatting": string, "vragen": string[], "varianten": [ { "naam": string, "beschrijving": string, "ops": Operatie[] } ] }
- Geen tekst buiten de JSON, geen markdown, geen codeblokken.
- De app past de "ops" van elke variant toe op een kopie van het HUIDIGE ontwerp (dat je in het eerste gebruikersbericht krijgt), valideert het resultaat en toont een voorbeeld. Elke variant vertrekt van het huidige ontwerp, niet van een andere variant.
- Vraagt de gebruiker N varianten, geef er dan precies N die echt van elkaar verschillen (andere indeling, maat, dakvorm, plaats …). Zonder aantal: één variant.
- Is de opdracht onduidelijk of ontbreekt essentiële informatie (welke ruimte, welk niveau, welke kant)? Stel dan 1-3 korte, concrete vragen in "vragen" en laat "varianten" leeg. Stel geen vragen over details die je redelijk kan aannemen; vermeld aannames dan in de beschrijving.
- "samenvatting": 1-3 zinnen. "beschrijving" per variant: wat er verandert, welke maten je koos en waarom (mm of m).

# Datamodel (schemaVersie 1)
- Alle maten in millimeter (mm), hoeken in graden. Oorsprong [0, 0] = linkerbenedenhoek van het gelijkvloers (buitenhoek links-voor, straatkant).
- Assen: x → rechts (langs de straatgevel), y → naar achter (richting tuin; in de plattegrond omhoog), z → omhoog.
- Elk element heeft een "id", uniek over het HELE ontwerp. Voorvoegsels: N niveau, M muur, O opening, R ruimte, V vloer, D dak.
- status ∈ bestaand | nieuw | afbraak (bestaand = blijft, nieuw = wordt gebouwd, afbraak = wordt afgebroken).
Velden per collectie (? = optioneel):
${veldenTekst()}
Functies van ruimtes: ${FUNCTIES.join(', ')}.
Regels die de validator afdwingt: een opening valt binnen de lengte en de hoogte van haar muur; openingen in dezelfde muur overlappen niet (afbraak-openingen uitgezonderd); contouren hebben minstens 3 punten en een oppervlakte; verwijzingen (niveau, muur) bestaan; id's zijn uniek.

# Operaties
Een variant is een lijst operaties die in volgorde en atomair wordt toegepast:
{ "op": "toevoegen", "collectie": "<collectie>", "item": { …velden… } }            item.id mag je zelf kiezen (aanbevolen, zie id's)
{ "op": "wijzigen", "collectie": "<collectie>", "id": "<id>", "velden": { …enkel de te wijzigen velden… } }
{ "op": "verwijderen", "collectie": "<collectie>", "id": "<id>" }               cascade: muur → haar openingen; niveau → alles erop
{ "op": "verplaatsen", "collectie": "<collectie>", "id": "<id>", "dx": mm, "dy": mm }   muren/ruimtes/vloeren/daken; opening: dx = langs de muur; niveau: dx = peilverschil (dy = 0)
Collecties: ${COLLECTIE_NAMEN.join(', ')}. Openingstypes: ${OPENING_TYPES.join(', ')}. Daktypes: ${DAK_TYPES.join(', ')}. Nokrichtingen: ${NOKRICHTINGEN.join(', ')}. Statussen: ${STATUSSEN.join(', ')}.

Voorbeeld — een bestaande achtergevel M3 van [0, 9000] naar [6000, 9000] (300 mm dik) krijgt een uitbouw van 3 m diep over de volle breedte, met een plat dak:
[
  { "op": "wijzigen", "collectie": "muren", "id": "M3", "velden": { "status": "afbraak" } },
  { "op": "toevoegen", "collectie": "muren", "item": { "id": "M20", "niveau": "N0", "start": [0, 9000], "eind": [0, 12000], "dikte": 300, "status": "nieuw" } },
  { "op": "toevoegen", "collectie": "muren", "item": { "id": "M21", "niveau": "N0", "start": [0, 12000], "eind": [6000, 12000], "dikte": 300, "status": "nieuw" } },
  { "op": "toevoegen", "collectie": "muren", "item": { "id": "M22", "niveau": "N0", "start": [6000, 12000], "eind": [6000, 9000], "dikte": 300, "status": "nieuw" } },
  { "op": "toevoegen", "collectie": "openingen", "item": { "id": "O20", "muur": "M21", "type": "raam", "positie": 1000, "breedte": 4000, "hoogte": 2200, "borstwering": 0, "status": "nieuw" } },
  { "op": "toevoegen", "collectie": "vloeren", "item": { "id": "V20", "niveau": "N0", "contour": [[-150, 9000], [6150, 9000], [6150, 12150], [-150, 12150]], "dikte": 300, "status": "nieuw" } },
  { "op": "toevoegen", "collectie": "daken", "item": { "id": "D20", "niveau": "N0", "type": "plat", "contour": [[-150, 9000], [6150, 9000], [6150, 12150], [-150, 12150]], "helling": 0, "status": "nieuw" } },
  { "op": "wijzigen", "collectie": "ruimtes", "id": "R2", "velden": { "contour": [[150, 6150], [5850, 6150], [5850, 11850], [150, 11850]] } }
]
Voorbeeld — een bestaande opening O4 iets breder maken en een binnenmuur M7 slopen:
[ { "op": "wijzigen", "collectie": "openingen", "id": "O4", "velden": { "breedte": 1200 } },
  { "op": "wijzigen", "collectie": "muren", "id": "M7", "velden": { "status": "afbraak" } } ]

# Regels
1. Antwoord enkel met operaties op het gegeven ontwerp; verzin geen andere velden of collecties. De operatie "ontwerp" (naam/beschrijving van het ontwerp) gebruik je niet: de app beheert dat.
2. Statussen bij een verbouwing:
   - Een BESTAAND element dat verdwijnt (muur slopen, raam dichtmaken, dak vervangen): NIET verwijderen maar "wijzigen" naar status "afbraak". Doe dat ook voor de openingen in een muur die je afbreekt.
   - Alles wat je toevoegt krijgt status "nieuw".
   - Een bestaand element dat blijft maar anders wordt (bv. een raam dat groter wordt) mag je wijzigen; ingrijpende wijzigingen aan iets bestaands modelleer je liever als afbraak + nieuw.
   - Elementen met status "nieuw" (uit een eerdere schets) mag je wel wijzigen of verwijderen.
   - Ruimtes hebben geen status: pas naam/functie/contour aan zodat ze de NIEUWE toestand beschrijven; voeg nieuwe ruimtes toe waar nodig.
3. Id's: hergebruik de bestaande id's om naar bestaande elementen te verwijzen. Geef nieuwe elementen een eigen id met het juiste voorvoegsel, vanaf de "volgende vrije id's" die bij het ontwerp staan (zo kan een nieuwe opening naar een nieuwe muur verwijzen). Elk id slechts één keer gebruiken, ook over varianten heen mag hetzelfde nieuwe id wel (varianten zijn onafhankelijk).
4. Maten: neem maten die de gebruiker geeft EXACT over (omgerekend naar mm). Verzin geen andere maten als de gebruiker ze opgeeft. Ontbreekt een maat, kies dan een gangbare waarde en vermeld die in de beschrijving.
5. Geometrie: muren liggen op hun as; sluit nieuwe muren aan op eindpunten of op de as van bestaande muren (zelfde coördinaten). Laat buitenmuren van een uitbreiding aansluiten op de bestaande gevel. Openingen moeten binnen hun muur passen (positie ≥ 0, positie + breedte ≤ muurlengte, borstwering + hoogte ≤ muurhoogte). Een ruimtecontour = binnenvlak van de muren (as ± halve dikte). Vloer- en dakcontour van een uitbreiding = buitenzijde van de nieuwe muren.
6. Werk op het niveau waar de opdracht over gaat; zonder aanwijzing het actieve niveau uit de context. Een selectie in de context is het element waar de gebruiker naar kijkt ("dit raam", "deze muur").
7. Houd het ontwerp geldig: na jouw operaties moet het hele ontwerp de validatie doorstaan. Krijg je een foutmelding van de app terug, geef dan het VOLLEDIGE verbeterde antwoord opnieuw (alle varianten, met alle operaties).
8. Prijzen en kosten verzin je nooit; de app rekent zelf met de prijzen van de gebruiker.
9. "Afbreken", "slopen", "wegnemen" van een bestaand deel = status "afbraak" zetten (operatie "wijzigen") op ALLE bestaande muren, openingen, vloeren en daken van dat deel — nooit "verwijderen". Herken een deel (bv. "de achterbouw", "garage 2", "de veranda") aan de ruimtenamen en hun contour in het ontwerp-JSON: de muren van dat deel liggen op of rond die contour (as ± halve dikte), de openingen zitten in die muren, de vloeren en daken overlappen die contour. Een muur die het deel scheidt van wat blijft, blijft "bestaand" (hij wordt de nieuwe buitengevel); zijn openingen naar het afgebroken deel dicht je door ze op "afbraak" te zetten. Ruimtes van een afgebroken deel verwijder je (ruimtes hebben geen status) of je geeft ze de nieuwe indeling.
10. Programma van eisen (bv. "2 slaapkamers + kleine badkamer + berging + trap"): maak voor elke gevraagde ruimte een ruimte (met de juiste functie) met een redelijke minimale netto maat, plus de muren/openingen die nodig zijn om ze te begrenzen en te bereiken. Gangbare minima als de gebruiker niets opgeeft: slaapkamer ≥ 9 m² (kortste zijde ≥ 2,7 m), kleine badkamer met lavabo + douche ≥ 3,5 m² (≥ 1,7 × 2,0 m), kleine berging ≥ 1,5 m², draaitrap Ø ≥ 1,4 m vrije ruimte, gang/overloop ≥ 0,9 m breed, binnendeur 830-930 mm breed en 2015 mm hoog. Vermeld de gekozen maten in de samenvatting als aanname ("Aanname: …").
11. Wat schema v1 NIET kan uitdrukken (o.a. trappen als object, draaitrappen, schuine plafonds en vrije hoogte onder een dak, knieschotten, dakkapellen, sanitair en meubilair, houtskelet- of andere opbouwen, isolatie, technieken): verzin GEEN velden, collecties of waarden die het schema niet kent. Meld het expliciet in "samenvatting" als "Niet modelleerbaar in schema v1: …" en doe het best mogelijke met de bestaande elementen, bijvoorbeeld: een ruimte "Trap (draaitrap Ø 1,6 m)" met functie trap; een niveau "Zolder" (id N…) met peil = bovenkant van de bovenste verdieping (peil + hoogte) en een beperkte hoogte, met ruimtes onder het bestaande dak; een ruimte "Badkamer (lavabo + douche)" met functie badkamer. Werk "onder het dak" op het zolderniveau; muren op dat niveau krijgen zo nodig een eigen (lagere) hoogte.`;

// ---------------------------------------------------------------- context en berichten

const r1 = (v) => Math.round(v * 10) / 10;

/** Korte kerncijfers als tekst (m², m³). */
export function kerncijfersTekst(model, k = null) {
  try {
    k ||= berekenKerncijfers(model);
  } catch { return 'Kerncijfers: niet beschikbaar.'; }
  const niveaus = k.niveaus.map((n) => `${n.id} ${n.naam}: bruto ${r1(n.bruto)} m², netto ${r1(n.netto)} m²`).join('; ');
  return `Kerncijfers (huidig ontwerp): bruto ${r1(k.bruto)} m², netto ${r1(k.netto)} m², volume ${r1(k.volume.totaal)} m³. Per niveau: ${niveaus || '—'}.`;
}

/** Volgende vrije id per collectie, bv. "muren: M12, openingen: O9, …". */
export function volgendeIdsTekst(model) {
  return COLLECTIE_NAMEN.map((c) => `${c}: ${volgendId(model, c)}`).join(', ');
}

/** Ontwerp compact als JSON (geen opmaak; 'gewijzigd' weggelaten). Deterministisch voor hetzelfde model. */
export function ontwerpJson(model) {
  const { gewijzigd, ...rest } = model;
  return JSON.stringify(rest);
}

/**
 * Contextblok bij de eerste vraag: ontwerp + kerncijfers + actief niveau + selectie.
 * @param {object} model
 * @param {{ niveau?: string|null, selectie?: string|null, kerncijfers?: object }} o
 */
export function contextTekst(model, { niveau = null, selectie = null, kerncijfers = null } = {}) {
  const nv = model.niveaus.find((n) => n.id === niveau);
  let sel = 'geen';
  if (selectie) {
    for (const c of COLLECTIE_NAMEN) {
      const x = (model[c] || []).find((e) => e.id === selectie);
      if (x) { sel = `${c} ${selectie}`; break; }
    }
  }
  return [
    'Huidig ontwerp (JSON, maten in mm):',
    ontwerpJson(model),
    '',
    kerncijfersTekst(model, kerncijfers),
    `Actief niveau in de plattegrond: ${nv ? `${nv.id} (${nv.naam})` : 'onbekend'}.`,
    `Geselecteerd element: ${sel}.`,
    `Volgende vrije id's: ${volgendeIdsTekst(model)}.`,
  ].join('\n');
}

/** Tekst van de opdracht, met het gevraagde aantal varianten. */
export function opdrachtTekst(opdracht, aantal = 1) {
  const n = Math.min(MAX_VARIANTEN, Math.max(1, Math.round(Number(aantal) || 1)));
  const wat = n === 1 ? 'Geef één variant (of vragen als de opdracht onduidelijk is).' : `Geef precies ${n} verschillende varianten (of vragen als de opdracht onduidelijk is).`;
  return `Opdracht van de gebruiker:\n${String(opdracht || '').trim()}\n\n${wat}`;
}

/** Eerste gebruikersbericht: contextblok (cachebaar) + opdracht. */
export function eersteBericht(model, opdracht, { aantal = 1, niveau = null, selectie = null, kerncijfers = null } = {}) {
  return {
    role: 'user',
    content: [
      { type: 'text', text: contextTekst(model, { niveau, selectie, kerncijfers }) },
      { type: 'text', text: opdrachtTekst(opdracht, aantal) },
    ],
  };
}

/** Antwoord van de gebruiker op vragen van Claude. */
export function antwoordBericht(antwoord, aantal = 1) {
  const n = Math.min(MAX_VARIANTEN, Math.max(1, Math.round(Number(aantal) || 1)));
  return { role: 'user', content: [{ type: 'text', text: `Antwoord op je vragen:\n${String(antwoord || '').trim()}\n\nGeef nu ${n === 1 ? 'één variant' : `precies ${n} varianten`} (of nog vragen als het echt niet anders kan).` }] };
}

/**
 * Het assistant-antwoord zoals het terug in de geschiedenis gaat: enkel de tekstblokken, ongewijzigd.
 * Denkblokken (thinking) laten we ALLEMAAL weg: het volledig weglaten is toegestaan (geen gedeeltelijke verwijdering
 * midden in de geschiedenis), en zo blijft het verzoek geldig ook na een fallback naar een ander model.
 */
export function assistentBericht(bericht) {
  // Na een fallback middenin de stream: enkel de inhoud ná het laatste `fallback`-blok (het afgebroken antwoord van
  // het geweigerde model hoort niet als 'eigen' vorig antwoord in de geschiedenis).
  const blokken = bericht?.content || [];
  let start = 0;
  blokken.forEach((b, i) => { if (b?.type === 'fallback') start = i + 1; });
  const tekst = blokken.slice(start).filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text.length);
  return { role: 'assistant', content: tekst.length ? tekst.map((b) => ({ type: 'text', text: b.text })) : [{ type: 'text', text: '{}' }] };
}

// ---------------------------------------------------------------- API-verzoek

/**
 * Bouwt de parameters voor `client.beta.messages.stream(...)`.
 * - cache_control op de systeemprompt en op het contextblok, plus op het laatste blok van het laatste bericht
 *   (multi-turn: de vorige beurten worden dan uit de cache gelezen). Max. 4 breekpunten.
 * - Geen `thinking` (Opus 5.5: altijd adaptief), effort via output_config.
 * - Structured outputs via output_config.format (geforceerde tool_choice geeft 400 op Opus/Sonnet 5.5).
 * - Server-side fallbacks bij een weigering: `fallbacks: "default"` + beta-header (niet voor Haiku 5.5).
 * @param {{ model: string, effort: string, fallbacks: boolean }} instellingen
 * @param {Array} berichten  gespreksgeschiedenis (eerste = eersteBericht)
 * @param {{ structured?: boolean }} o  structured=false: zonder output_config.format (terugval als het schema geweigerd wordt)
 */
export function bouwVerzoek(instellingen, berichten, { structured = true, fallbacks = true } = {}) {
  const inst = normaliseerInstellingen(instellingen);
  const modelInfo = MODELLEN.find((m) => m.id === inst.model);
  const messages = berichten.map((b, i) => {
    const content = (Array.isArray(b.content) ? b.content : [{ type: 'text', text: String(b.content) }]).map((x) => ({ ...x }));
    for (const x of content) delete x.cache_control;
    if (i === 0 && content.length > 1) content[0].cache_control = { type: 'ephemeral' };
    return { role: b.role, content };
  });
  const laatste = messages.at(-1);
  if (laatste && messages.length > 1) laatste.content[laatste.content.length - 1].cache_control = { type: 'ephemeral' };
  const p = {
    model: inst.model,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEEMPROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
    output_config: { effort: inst.effort },
  };
  if (structured) p.output_config.format = { type: 'json_schema', schema: ANTWOORD_SCHEMA };
  if (inst.fallbacks && fallbacks && modelInfo?.fallbacks) {
    p.betas = [FALLBACK_BETA];
    p.fallbacks = 'default';
  }
  return p;
}
