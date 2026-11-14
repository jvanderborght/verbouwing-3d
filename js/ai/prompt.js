// Promptveld (fase 4, schema v2 + macro's in fase 5): systeemprompt, antwoordschema en opbouw van de berichten en het API-verzoek.
// Pure functies zonder DOM of netwerk (getest in tests/ai.test.js).
//
// Cache-opbouw (prompt caching is een prefix-match):
//   system  = SYSTEEMPROMPT (vast, byte-identiek voor elke aanvraag)            ← cache_control
//   user[0] = [ context: ontwerp-JSON + kerncijfers + niveau/selectie          ← cache_control
//              opdracht van de gebruiker ]
//   daarna enkel aanvullen (assistant-antwoord, herstel- of antwoordbericht), nooit eerdere beurten wijzigen.

import {
  VELDEN, ENUMS, COLLECTIE_NAMEN, COLLECTIES, STATUSSEN, OPENING_TYPES, DAK_TYPES, NOKRICHTINGEN, FUNCTIES,
  NIVEAU_SOORTEN, TRAP_TYPES, DRAAIRICHTINGEN, INRICHTING_SOORTEN,
} from '../model/schema.js';
import { INSTELLINGEN_STANDAARD } from '../model/instellingen.js';
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
//
// Limieten van structured outputs (Claude API-documentatie, build-with-claude/structured-outputs, "Schema complexity
// limits", gelezen 2026-11-14): max. 24 OPTIONELE parameters en max. 16 parameters met een UNIE (anyOf / type-lijst),
// opgeteld over alle schema's van één aanvraag; geen recursie; additionalProperties: false op elk object.
// Een vrij element-object met alle velden van schema v2 zou alleen al 33 optionele velden hebben (> 24). Daarom:
//  - `item` (toevoegen) en `velden` (wijzigen, ontwerp) zijn een JSON-TEKST (string) met het object; verwerk.js/macros.js
//    parset die en de validator controleert de inhoud (fouten gaan mee in de herstelpoging);
//  - de macro's hebben vaste, getypeerde parameters; parameters met een zinvolle standaard zijn verplicht ("" = automatisch).
// tests/ai.test.js bewaakt de telling (schemaMaat).

const OP_COLLECTIES = { type: 'string', enum: [...COLLECTIE_NAMEN] };
const TEKST = { type: 'string' };
const GETAL = { type: 'number' };
const PUNT = { type: 'array', items: GETAL, description: '[x, y] in mm' };
const IDS = { type: 'array', items: TEKST };
const JSON_TEKST = (wat) => ({ type: 'string', description: `JSON-tekst van het ${wat}-object, bv. "{\\"id\\":\\"M30\\",\\"niveau\\":\\"N0\\"}"` });

/** Eén operatievorm in het schema: `op` + verplichte en optionele parameters. */
function opSchema(naam, verplicht, optioneel = {}, description = undefined) {
  const s = {
    type: 'object', additionalProperties: false,
    required: ['op', ...Object.keys(verplicht)],
    properties: { op: { type: 'string', enum: [naam] }, ...verplicht, ...optioneel },
  };
  if (description) s.description = description;
  return s;
}

export const OP_SCHEMAS = Object.freeze([
  opSchema('toevoegen', { collectie: OP_COLLECTIES, item: JSON_TEKST('element') }),
  opSchema('wijzigen', { collectie: OP_COLLECTIES, id: TEKST, velden: JSON_TEKST('velden') }),
  opSchema('verwijderen', { collectie: OP_COLLECTIES, id: TEKST }),
  opSchema('verplaatsen', { collectie: OP_COLLECTIES, id: TEKST, dx: GETAL, dy: GETAL }),
  opSchema('ontwerp', { velden: JSON_TEKST('ontwerpvelden (programma, naam, beschrijving)') }),
  opSchema('afbraakZone', {}, { ruimtes: IDS, ids: IDS, niveau: TEKST }, 'Gebouwdeel afbreken: ruimtes = zone (ruimte-id\'s), ids = precies die elementen.'),
  opSchema('zolderNiveau', { onderNiveau: TEKST, naam: TEKST, id: TEKST }, { vloerdikte: GETAL }),
  opSchema('trapPlaatsen', {
    id: TEKST, van: TEKST, naar: TEKST, type: { type: 'string', enum: [...TRAP_TYPES] }, oorsprong: PUNT, richting: GETAL, breedte: GETAL,
  }, {
    draairichting: { type: 'string', enum: [...DRAAIRICHTINGEN] }, aantrede: GETAL, aantalTreden: { type: 'integer' }, optrede: GETAL, diameter: GETAL,
  }),
  opSchema('inrichtingPlaatsen', {
    id: TEKST, soort: { type: 'string', enum: [...INRICHTING_SOORTEN] }, ruimte: TEKST, rotatie: GETAL,
  }, { positie: PUNT, niveau: TEKST, breedte: GETAL, diepte: GETAL, hoogte: GETAL }),
  opSchema('muurSplitsen', { muur: TEKST, positie: GETAL, nieuwId: TEKST }),
]);

/**
 * JSON-schema van het antwoord. Geen recursie, geen min/max, `additionalProperties: false` op elk object.
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
  $defs: { op: { anyOf: OP_SCHEMAS } },
});

/** Grenzen uit de documentatie (zie boven). */
export const SCHEMA_LIMIETEN = Object.freeze({ optioneel: 24, unie: 16 });

/**
 * Meet de complexiteit van een schema zoals de limieten van structured outputs ze tellen:
 * optionele parameters (niet in `required`), parameters met een unie (anyOf / type-lijst, ook via items of $ref),
 * recursie ($ref naar een definitie die zichzelf (on)rechtstreeks bevat), objecten zonder additionalProperties: false.
 * Elke $defs-definitie telt één keer.
 */
export function schemaMaat(schema) {
  const defs = schema.$defs || {};
  const los = (s) => (s && s.$ref ? defs[s.$ref.replace('#/$defs/', '')] : s);
  const heeftUnie = (s, diepte = 0) => {
    const x = los(s);
    if (!x || diepte > 10) return false;
    return !!(x.anyOf || Array.isArray(x.type) || (x.items && heeftUnie(x.items, diepte + 1)));
  };
  const uit = { optioneel: 0, unie: 0, objecten: 0, nietGesloten: 0, recursief: false, bytes: JSON.stringify(schema).length };
  const loop = (s) => {
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s)) { s.forEach(loop); return; }
    if (s.type === 'object') {
      uit.objecten++;
      if (s.additionalProperties !== false) uit.nietGesloten++;
      const req = new Set(s.required || []);
      for (const [k, v] of Object.entries(s.properties || {})) {
        if (!req.has(k)) uit.optioneel++;
        if (heeftUnie(v)) uit.unie++;
      }
    }
    for (const [k, v] of Object.entries(s)) if (k !== '$defs' && v && typeof v === 'object') loop(v);
  };
  loop(schema);
  for (const d of Object.values(defs)) loop(d);
  // recursie: volg $refs vanuit elke definitie
  const refs = (s, acc = new Set()) => {
    if (!s || typeof s !== 'object') return acc;
    if (typeof s.$ref === 'string') acc.add(s.$ref.replace('#/$defs/', ''));
    for (const v of Object.values(s)) if (v && typeof v === 'object') refs(v, acc);
    return acc;
  };
  for (const naam of Object.keys(defs)) {
    const gezien = new Set();
    const stapel = [...refs(defs[naam])];
    while (stapel.length) {
      const r = stapel.pop();
      if (r === naam) { uit.recursief = true; break; }
      if (gezien.has(r)) continue;
      gezien.add(r);
      stapel.push(...refs(defs[r]));
    }
  }
  return uit;
}

// ---------------------------------------------------------------- systeemprompt

const UITLEG = {
  'niveaus.peil': 'z van de afgewerkte vloer', 'niveaus.hoogte': 'verdiepingshoogte vloer-tot-vloer = standaard muurhoogte',
  'niveaus.vloerdikte': 'dikte vloerpakket onder dit niveau', 'niveaus.soort': 'informatief: weergave, controles, programma',
  'muren.start': '[x, y] op de AS van de muur', 'muren.eind': '[x, y] op de as', 'muren.hoogte': 'overschrijft de niveauhoogte (bv. knieschot)',
  'openingen.positie': 'afstand langs de muuras van muur.start tot de rand van de opening',
  'openingen.borstwering': 'onderkant boven vloerpeil (deur: 0)',
  'ruimtes.contour': 'NETTO binnencontour [[x,y],…]', 'ruimtes.hoogtegrenzen': 'vrije hoogtes in mm, bv. [1500, 2200]: de oppervlakte wordt per hoogteband getoond',
  'vloeren.contour': 'BRUTO buitencontour',
  'daken.niveau': 'het dak rust op de bovenkant van dit niveau (peil + hoogte)', 'daken.contour': 'grondvlak zonder overstek',
  'daken.helling': 'graden; plat = 0', 'daken.nokrichting': 'x|y: richting van de nok (zadel/schild) of van de hoge rand (lessenaar, aan de max-zijde)',
  'trappen.oorsprong': 'recht/kwart/halfdraai: MIDDEN van de voorrand van de onderste trede; spiraal: MIDDELPUNT',
  'trappen.richting': 'graden, 0 = +x, 90 = +y: looprichting bij vertrek; spiraal: richting van de eerste trede',
  'trappen.breedte': 'loopbreedte', 'trappen.aantalTreden': 'aantal OPTREDEN; leeg = berekend uit het hoogteverschil',
  'trappen.aantrede': 'leeg = werkwaarde', 'trappen.draairichting': 'links = draait naar links (tegenwijzerzin, van boven gezien); standaard links',
  'trappen.diameter': 'enkel spiraal; leeg = 2 × breedte',
  'inrichting.positie': 'MIDDELPUNT in plan', 'inrichting.rotatie': 'graden; 0 = breedte langs +x, rugzijde aan -y (voorzijde kijkt naar +y)',
  'inrichting.hoogte': 'gebruikshoogte, voor de vrije-hoogtecontrole',
};

function veldenTekst() {
  return COLLECTIE_NAMEN.map((c) => {
    const velden = VELDEN[c].map(([n, type, verplicht]) => {
      const t = type.startsWith('enum:') ? ENUMS[type.slice(5)].join('|') : type.startsWith('ref:') ? `id van ${type.slice(4)}` : type;
      const u = UITLEG[`${c}.${n}`];
      return `${n}${verplicht ? '' : '?'}: ${t}${u ? ` (${u})` : ''}`;
    });
    return `- ${c} (id-voorvoegsel ${COLLECTIES[c]}): { ${velden.join('; ')} }`;
  }).join('\n');
}

/** Werkwaarden uit js/model/instellingen.js (standaard), als tekst. Geen normen. */
function werkwaardenTekst() {
  const i = INSTELLINGEN_STANDAARD;
  const maten = Object.entries(i.inrichting).map(([s, m]) => `${s} ${m.breedte}×${m.diepte}`).join(', ');
  return `trap: doel-optrede ${i.trap.doelOptrede.waarde} mm (enkel om een aantal treden voor te stellen), aantrede ${i.trap.aantrede.waarde} mm, `
    + `${i.trap.draaitredenPerKwart.waarde} draaitreden per kwartdraai; hoogtelijnen ${i.hoogte.hoogtelijnen.waarde.join('/')} mm; `
    + `inrichting (breedte×diepte, mm): ${maten}`;
}

/** Vaste systeemprompt. Bevat niets dat per aanvraag verandert (anders breekt de prompt-cache). */
export const SYSTEEMPROMPT = `Je bent de ontwerpassistent van "Verbouwing 3D", een schets- en vergelijkingstool om de verbouwing van een woning in 3D te schetsen en varianten te vergelijken. Het is géén BIM/CAD: stabiliteit, EPB en vergunning blijven voor architect/ingenieur. Je spreekt Nederlands (Vlaams).

# Je taak
De gebruiker geeft een opdracht in gewone taal. Je antwoordt UITSLUITEND met één JSON-object volgens het opgelegde schema:
{ "samenvatting": string, "vragen": string[], "varianten": [ { "naam": string, "beschrijving": string, "ops": Operatie[] } ] }
- Geen tekst buiten de JSON, geen markdown, geen codeblokken.
- De app past de "ops" van elke variant in volgorde toe op een kopie van het HUIDIGE ontwerp (dat je in het eerste gebruikersbericht krijgt), valideert het resultaat en toont een voorbeeld. Elke variant vertrekt van het huidige ontwerp, niet van een andere variant.
- Vraagt de gebruiker N varianten, geef er dan precies N die echt van elkaar verschillen (andere indeling, maat, dakvorm, plaats …). Zonder aantal: één variant.
- Is de opdracht onduidelijk of ontbreekt essentiële informatie (welke ruimte, welk niveau, welke kant)? Stel dan 1-3 korte, concrete vragen in "vragen" en laat "varianten" leeg. Stel geen vragen over details die je redelijk kan aannemen; vermeld aannames dan in de beschrijving.
- "samenvatting": 1-3 zinnen. "beschrijving" per variant: wat er verandert, welke maten je koos en waarom (mm of m).

# Datamodel (schemaVersie 2)
- Alle maten in millimeter (mm), hoeken in graden. Oorsprong [0, 0] = linkerbenedenhoek van het gelijkvloers (buitenhoek links-voor, straatkant).
- Assen: x → rechts (langs de straatgevel), y → naar achter (richting tuin; in de plattegrond omhoog), z → omhoog. Hoek 0° = +x, 90° = +y.
- Elk element heeft een "id", uniek over het HELE ontwerp. Voorvoegsels: N niveau, M muur, O opening, R ruimte, V vloer, D dak, T trap, I inrichting.
- status ∈ bestaand | nieuw | afbraak (bestaand = blijft, nieuw = wordt gebouwd, afbraak = wordt afgebroken).
Velden per collectie (? = optioneel):
${veldenTekst()}
Functies van ruimtes: ${FUNCTIES.join(', ')}. Niveausoorten: ${NIVEAU_SOORTEN.join(', ')}. Traptypes: ${TRAP_TYPES.join(', ')} (kwart = kwartdraai/L, halfdraai = U met draaitreden, spiraal = wenteltrap; een draaitrap = kwart, halfdraai of spiraal). Inrichting: ${INRICHTING_SOORTEN.join(', ')}.
Ontwerpveld "programma" (programma van eisen, optioneel): { "beschrijving"?: string, "eisen": [eis, …] } met
  ruimte-eis { "functie", "aantal"? (1), "niveau"? (niveau-id of soort, bv. "zolder"), "minOppervlakte"? (m²; weglaten = niet toetsen), "hoogteGrens"? (mm: enkel oppervlakte met minstens die vrije hoogte telt voor minOppervlakte), "inrichting"? ([soort, …] die in de ruimte moeten staan), "naam"? }
  trap-eis { "trap": { "van"?, "naar"? (niveau-id of soort), "type"? ([type, …]), "aantal"? }, "naam"? }.
Regels die de validator afdwingt: een opening valt binnen de lengte en de hoogte van haar muur; openingen in dezelfde muur overlappen niet (afbraak-openingen uitgezonderd); contouren hebben minstens 3 punten en een oppervlakte; verwijzingen (niveau, muur, ruimte, vanNiveau/naarNiveau) bestaan; id's zijn uniek; een trap gaat naar een HOGER niveau en haar voetafdruk ligt binnen de vloer(en) van beide niveaus; inrichting ligt binnen de vloer van haar niveau (en haar ruimte op hetzelfde niveau); hoogtegrenzen zijn getallen > 0; het programma heeft een geldige vorm.

# Conventies (schema v2)
- Trap: "oorsprong" = midden van de voorrand van de onderste trede (spiraal: middelpunt); "richting" = looprichting bij vertrek. Lokaal: u = looprichting, v = links ervan; draairichting "rechts" spiegelt. Voetafdruk: recht = breedte × (n − 1)·aantrede; kwart = vlucht 1 + hoekvierkant breedte × breedte + vlucht 2 haaks; halfdraai = vlucht 1 + draaizone (2·breedte breed × breedte diep) + vlucht 2 evenwijdig terug, NAAST vlucht 1 (aan de kant van de draairichting); spiraal = cirkel met diameter (standaard 2 × breedte).
- Treden: "aantalTreden" = aantal OPTREDEN n; in plan liggen n − 1 treden (de laatste "trede" is de vloer erboven). Laat aantalTreden/optrede leeg, dan worden ze berekend uit het hoogteverschil (peil naarNiveau − peil vanNiveau). Het trapgat = de voetafdruk in de vloer van naarNiveau; je hoeft het niet apart te tekenen.
- Zolder: een niveau met "soort": "zolder" op de bovenkant van het niveau eronder (peil = peil + hoogte), met als hoogte de nokhoogte. Het dak blijft op het niveau eronder rusten; de app berekent de vrije hoogte onder het dak (schuine plafonds). Wanden op de zolder (bv. knieschoten) krijgen een eigen, lagere "hoogte" die onder het dak past. Geef ruimtes onder een schuin dak "hoogtegrenzen" (bv. [1500, 2200]) zodat de oppervlakte per hoogteband zichtbaar wordt.
- Inrichting (sanitair, meubels): "positie" = middelpunt, "rotatie" 0 = rug tegen een wand aan de -y-zijde (voorzijde naar +y); 90 = rug aan +x, 180 = rug aan +y, 270 = rug aan -x. Koppel ze met "ruimte" aan hun ruimte. Plaats ze waar de vrije hoogte volstaat (douche niet onder het laagste deel van een schuin dak).
- Werkwaarden zijn GEEN normen. De app gebruikt enkel vertrekwaarden om iets te kunnen berekenen of plaatsen: ${werkwaardenTekst()}. Grenzen (max. optrede, min. loophoogte, …) zijn standaard NIET ingesteld en worden dan niet getoetst. Noem nooit een werkwaarde of je eigen vertrekmaat een norm, en verzin geen normen of wettelijke eisen.

# Operaties
Een variant is een lijst operaties die in volgorde wordt toegepast (atomair: één fout ⇒ niets).
Basisoperaties ("item" en "velden" zijn in het antwoordschema een JSON-TEKST: het object als string, met \\" rond de sleutels en teksten):
{ "op": "toevoegen", "collectie": "<collectie>", "item": "{…velden…}" }            item.id mag je zelf kiezen (aanbevolen, zie id's)
{ "op": "wijzigen", "collectie": "<collectie>", "id": "<id>", "velden": "{…enkel de te wijzigen velden…}" }   null = optioneel veld wissen
{ "op": "verwijderen", "collectie": "<collectie>", "id": "<id>" }               cascade: muur → haar openingen; niveau → alles erop; ruimte → inrichting.ruimte gewist
{ "op": "verplaatsen", "collectie": "<collectie>", "id": "<id>", "dx": mm, "dy": mm }   muren/ruimtes/vloeren/daken/trappen/inrichting; opening: dx = langs de muur; niveau: dx = peilverschil (dy = 0)
{ "op": "ontwerp", "velden": "{\\"programma\\": {…}}" }                         enkel "programma", "naam" of "beschrijving" van het ontwerp
Collecties: ${COLLECTIE_NAMEN.join(', ')}. Openingstypes: ${OPENING_TYPES.join(', ')}. Daktypes: ${DAK_TYPES.join(', ')}. Nokrichtingen: ${NOKRICHTINGEN.join(', ')}. Statussen: ${STATUSSEN.join(', ')}.

Macro's (hoog niveau). Gebruik ze waar ze passen: de app zet ze om in de juiste basisoperaties, met de rekenregels van de app. Ze werken op het tussenresultaat (na alle vorige operaties van de variant), dus latere operaties mogen verwijzen naar wat een macro aanmaakte.
{ "op": "afbraakZone", "ruimtes": ["R5", "R6"] }     een gebouwdeel afbreken als ZONE (ruimtes op één niveau): muren die enkel aan de zone grenzen → afbraak (met hun openingen; deels in de zone ⇒ gesplitst), muren die ook aan een blijvende ruimte grenzen blijven (worden gemeld: mogelijk dragend, worden buitengevel), vloeren/daken van dat niveau in de zone → afbraak (rechthoekige vloeren en platte daken die er deels in liggen worden gesplitst), trappen/inrichting in de zone → afbraak, de zoneruimtes → verwijderd. Optioneel "niveau" als controle.
{ "op": "afbraakZone", "ids": ["M7", "O4"] }           precies die elementen afbreken (muur ⇒ ook haar openingen; niveau-id ⇒ alles erop). Elementen met status "nieuw" worden verwijderd i.p.v. afbraak.
{ "op": "zolderNiveau", "onderNiveau": "N1", "naam": "Zolder", "id": "N2" }     zolderniveau onder het hellende dak van onderNiveau: niveau soort zolder, hoogte = nokhoogte, vloer = dakcontour. Optioneel "vloerdikte".
{ "op": "trapPlaatsen", "id": "T1", "van": "N1", "naar": "N2", "type": "halfdraai", "oorsprong": [x, y], "richting": 90, "breedte": 800 }   optioneel: "draairichting", "aantrede", "aantalTreden", "optrede", "diameter" (spiraal). Fout als de trap buiten de vloer van een van beide niveaus valt of een muur raakt.
{ "op": "inrichtingPlaatsen", "id": "I1", "soort": "douche", "ruimte": "R20", "rotatie": 0, "positie": [x, y], "breedte": 900, "diepte": 900, "hoogte": 2100 }   zonder "positie" zoekt de app een plek met de rug tegen een wand van de ruimte (met voldoende vrije hoogte als "hoogte" gegeven is); zonder breedte/diepte gelden de werkwaarden.
{ "op": "muurSplitsen", "muur": "M4", "positie": 2500, "nieuwId": "M40" }   muur knippen op positie mm vanaf muur.start; het eerste stuk houdt het id, het tweede krijgt nieuwId; openingen verhuizen mee.
Id's bij macro's: geef in "id" / "nieuwId" zelf het id van het nieuwe element (aanbevolen), dan kan je er later naar verwijzen. "" = de app kiest het volgende vrije nummer. Id's die een macro zelf uitdeelt (bv. het afgesplitste muurstuk of de zoldervloer) botsen nooit met id's die jij elders in de variant gebruikt: die worden zo nodig hernummerd. Verwijs dus niet naar zulke automatische id's; gebruik voor je eigen nieuwe elementen expliciete id's.

Voorbeeld — een bestaande achtergevel M3 van [0, 9000] naar [6000, 9000] (300 mm dik) krijgt een uitbouw van 3 m diep over de volle breedte, met een plat dak:
[
  { "op": "wijzigen", "collectie": "muren", "id": "M3", "velden": "{\\"status\\":\\"afbraak\\"}" },
  { "op": "toevoegen", "collectie": "muren", "item": "{\\"id\\":\\"M20\\",\\"niveau\\":\\"N0\\",\\"start\\":[0,9000],\\"eind\\":[0,12000],\\"dikte\\":300,\\"status\\":\\"nieuw\\"}" },
  { "op": "toevoegen", "collectie": "muren", "item": "{\\"id\\":\\"M21\\",\\"niveau\\":\\"N0\\",\\"start\\":[0,12000],\\"eind\\":[6000,12000],\\"dikte\\":300,\\"status\\":\\"nieuw\\"}" },
  { "op": "toevoegen", "collectie": "muren", "item": "{\\"id\\":\\"M22\\",\\"niveau\\":\\"N0\\",\\"start\\":[6000,12000],\\"eind\\":[6000,9000],\\"dikte\\":300,\\"status\\":\\"nieuw\\"}" },
  { "op": "toevoegen", "collectie": "openingen", "item": "{\\"id\\":\\"O20\\",\\"muur\\":\\"M21\\",\\"type\\":\\"raam\\",\\"positie\\":1000,\\"breedte\\":4000,\\"hoogte\\":2200,\\"borstwering\\":0,\\"status\\":\\"nieuw\\"}" },
  { "op": "toevoegen", "collectie": "vloeren", "item": "{\\"id\\":\\"V20\\",\\"niveau\\":\\"N0\\",\\"contour\\":[[-150,9000],[6150,9000],[6150,12150],[-150,12150]],\\"dikte\\":300,\\"status\\":\\"nieuw\\"}" },
  { "op": "toevoegen", "collectie": "daken", "item": "{\\"id\\":\\"D20\\",\\"niveau\\":\\"N0\\",\\"type\\":\\"plat\\",\\"contour\\":[[-150,9000],[6150,9000],[6150,12150],[-150,12150]],\\"helling\\":0,\\"status\\":\\"nieuw\\"}" },
  { "op": "wijzigen", "collectie": "ruimtes", "id": "R2", "velden": "{\\"contour\\":[[150,6150],[5850,6150],[5850,11850],[150,11850]]}" }
]
Voorbeeld — achterbouw (ruimtes R5, R6) afbreken, zolder onder het zadeldak van N1 met een trap en een badkamer, en het programma vastleggen (maten zijn een voorbeeld):
[
  { "op": "afbraakZone", "ruimtes": ["R5", "R6"] },
  { "op": "zolderNiveau", "onderNiveau": "N1", "naam": "Zolder", "id": "N2" },
  { "op": "toevoegen", "collectie": "muren", "item": "{\\"id\\":\\"M40\\",\\"niveau\\":\\"N2\\",\\"start\\":[280,3500],\\"eind\\":[6720,3500],\\"dikte\\":100,\\"status\\":\\"nieuw\\"}" },
  { "op": "toevoegen", "collectie": "ruimtes", "item": "{\\"id\\":\\"R20\\",\\"niveau\\":\\"N2\\",\\"naam\\":\\"Badkamer\\",\\"functie\\":\\"badkamer\\",\\"contour\\":[[280,1250],[2200,1250],[2200,3450],[280,3450]],\\"hoogtegrenzen\\":[1500,2200]}" },
  { "op": "trapPlaatsen", "id": "T1", "van": "N1", "naar": "N2", "type": "halfdraai", "oorsprong": [1880, 4840], "richting": 90, "breedte": 800, "aantrede": 220, "draairichting": "links" },
  { "op": "inrichtingPlaatsen", "id": "I1", "soort": "douche", "ruimte": "R20", "rotatie": 0, "positie": [730, 2950], "hoogte": 2100 },
  { "op": "inrichtingPlaatsen", "id": "I2", "soort": "lavabo", "ruimte": "R20", "rotatie": 90 },
  { "op": "ontwerp", "velden": "{\\"programma\\":{\\"eisen\\":[{\\"functie\\":\\"badkamer\\",\\"niveau\\":\\"zolder\\",\\"inrichting\\":[\\"lavabo\\",\\"douche\\"]},{\\"trap\\":{\\"van\\":\\"N1\\",\\"naar\\":\\"zolder\\"}}]}}" }
]

# Regels
1. Antwoord enkel met operaties op het gegeven ontwerp; verzin geen andere velden, collecties of waarden die het schema niet kent. "ontwerp" gebruik je voor het programma van eisen; "naam"/"beschrijving" van het ontwerp wijzig je enkel als de gebruiker daar uitdrukkelijk om vraagt (de app geeft varianten zelf een naam).
2. Statussen bij een verbouwing:
   - Een BESTAAND element dat verdwijnt (muur slopen, raam dichtmaken, dak vervangen, trap of toestel wegnemen): NIET verwijderen maar "wijzigen" naar status "afbraak" (of afbraakZone). Doe dat ook voor de openingen in een muur die je afbreekt.
   - Alles wat je toevoegt krijgt status "nieuw" (macro's doen dat zelf).
   - Een bestaand element dat blijft maar anders wordt (bv. een raam dat groter wordt) mag je wijzigen; ingrijpende wijzigingen aan iets bestaands modelleer je liever als afbraak + nieuw.
   - Elementen met status "nieuw" (uit een eerdere schets) mag je wel wijzigen of verwijderen.
   - Ruimtes hebben geen status: pas naam/functie/contour aan zodat ze de NIEUWE toestand beschrijven; voeg nieuwe ruimtes toe waar nodig.
3. Id's: hergebruik de bestaande id's om naar bestaande elementen te verwijzen. Geef nieuwe elementen een eigen id met het juiste voorvoegsel, vanaf de "volgende vrije id's" die bij het ontwerp staan (zo kan een nieuwe opening naar een nieuwe muur verwijzen, een inrichtingselement naar een nieuwe ruimte). Elk id slechts één keer gebruiken; over varianten heen mag hetzelfde nieuwe id wel (varianten zijn onafhankelijk). Id's die vrijkwamen doordat een ruimte verwijderd werd, mag je hergebruiken.
4. Maten: neem maten die de gebruiker geeft EXACT over (omgerekend naar mm). Verzin geen andere maten als de gebruiker ze opgeeft. Ontbreekt een maat, kies dan een gangbare waarde en vermeld die in de beschrijving als aanname.
5. Geometrie: muren liggen op hun as; sluit nieuwe muren aan op eindpunten of op de as van bestaande muren (zelfde coördinaten). Laat buitenmuren van een uitbreiding aansluiten op de bestaande gevel. Openingen moeten binnen hun muur passen (positie ≥ 0, positie + breedte ≤ muurlengte, borstwering + hoogte ≤ muurhoogte). Een ruimtecontour = binnenvlak van de muren (as ± halve dikte). Vloer- en dakcontour van een uitbreiding = buitenzijde van de nieuwe muren. Een trap moet volledig binnen de vloer van beide niveaus liggen en mag geen (niet-afgebroken) muur raken.
6. Werk op het niveau waar de opdracht over gaat; zonder aanwijzing het actieve niveau uit de context. Een selectie in de context is het element waar de gebruiker naar kijkt ("dit raam", "deze muur").
7. Houd het ontwerp geldig: na jouw operaties moet het hele ontwerp de validatie doorstaan. Krijg je een foutmelding van de app terug, geef dan het VOLLEDIGE verbeterde antwoord opnieuw (alle varianten, met alle operaties).
8. Prijzen en kosten verzin je nooit; de app rekent zelf met de prijzen van de gebruiker.
9. "Afbreken", "slopen", "wegnemen" van een bestaand deel = status "afbraak" op ALLE bestaande muren, openingen, vloeren, daken, trappen en inrichting van dat deel — nooit "verwijderen". Gebruik daarvoor bij voorkeur afbraakZone met de ruimtes van dat deel. Herken een deel (bv. "de achterbouw", "garage 2", "de veranda") aan de ruimtenamen en hun contour in het ontwerp-JSON. Een muur die het deel scheidt van wat blijft, blijft "bestaand" (hij wordt de nieuwe buitengevel; afbraakZone laat hem staan en meldt hem); zijn openingen naar het afgebroken deel dicht je door ze op "afbraak" te zetten. Ruimtes van een afgebroken deel verwijder je (ruimtes hebben geen status) of je geeft ze de nieuwe indeling. Breek je zonder macro af, zet dan zelf elk element op "afbraak" (operatie "wijzigen").
10. Programma van eisen (bv. "2 slaapkamers + kleine badkamer + berging + trap"): maak voor elke gevraagde ruimte een ruimte (met de juiste functie) plus de muren/openingen die nodig zijn om ze te begrenzen en te bereiken; een gevraagde trap als trap (trapPlaatsen), sanitair en meubels als inrichting (inrichtingPlaatsen) in hun ruimte. Leg het gevraagde programma vast met { "op": "ontwerp", "velden": "{\\"programma\\": …}" }: de app toetst het ontwerp eraan (voldoet / voldoet niet / onbekend) en toont dat bij de variant. Neem in het programma enkel eisen op die de gebruiker gaf: "minOppervlakte" of "hoogteGrens" alleen als de gebruiker een oppervlakte of hoogte noemt. Kies je zelf maten voor een voorstel, vermeld ze dan in de samenvatting als aanname ("Aanname: …"); het zijn vertrekmaten, geen normen.
11. Wat schema v2 NIET kan uitdrukken (o.a. dakkapellen en dakramen, isolatie en opbouwen (houtskelet, …), technieken (verwarming, ventilatie, leidingen), trapleuningen, plafondhoogtes los van niveau of dak): verzin GEEN velden, collecties of waarden die het schema niet kent. Meld het expliciet in "samenvatting" als "Niet modelleerbaar: …" en doe het best mogelijke met de bestaande elementen. Trappen, zolders (schuine plafonds en vrije hoogte onder het dak), knieschoten (muren met een eigen hoogte), sanitair en meubels zijn WEL modelleerbaar: gebruik daarvoor trappen, niveaus met soort "zolder", muren met "hoogte" en inrichting.`;

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
