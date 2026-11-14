// Promptveld fase 5: schema v2 in de prompt, macro's (hoog-niveau operaties), programmatoets en schemagrootte.
// Er gebeurt GEEN echte API-aanroep: elke fetch wordt beantwoord met een nagebootste SSE-stroom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Zoals de importmap in index.html: kale specifiers van de SDK naar de gevendorde bestanden.
const basisUrl = new URL('../js/vendor/', import.meta.url).href;
const mapping = {
  '@anthropic-ai/sdk': `${basisUrl}anthropic-sdk/index.mjs`,
  '@opentelemetry/api': `${basisUrl}opentelemetry-api/index.mjs`,
  standardwebhooks: `${basisUrl}anthropic-sdk-shims/standardwebhooks.mjs`,
};
const hook = `const M = ${JSON.stringify(mapping)};
export async function resolve(spec, ctx, next) { return M[spec] ? { url: M[spec], shortCircuit: true } : next(spec, ctx); }`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const { ANTWOORD_SCHEMA, SCHEMA_LIMIETEN, schemaMaat, bouwVerzoek, eersteBericht, SYSTEEMPROMPT } = await import('../js/ai/prompt.js');
const { leesAntwoord, beoordeel, pasVariantenToe, voorbeeldHulp } = await import('../js/ai/verwerk.js');
const { vouwUit, MACROS, hernoemOps } = await import('../js/ai/macros.js');
const { AiClient } = await import('../js/ai/client.js');
const { Gesprek } = await import('../js/ai/gesprek.js');
const V = await import('./ai-voorbeelden.js');
const { validate, applyOps, migreer, toetsProgramma, muurLengte } = await import('../js/model/index.js');

const lees = (f) => migreer(JSON.parse(readFileSync(new URL(`../designs/${f}.json`, import.meta.url), 'utf8')));
const KEY = 'sk-ant-api03-TESTKEY-nietecht-0123456789abcdef';
const INST = { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true };

function client(antwoorden) {
  const verzoeken = [];
  const f = async (url, init = {}) => {
    verzoeken.push({ url: String(url), body: init.body ? String(init.body) : '' });
    const a = antwoorden.shift();
    if (!a) throw new Error('geen nagebootst antwoord meer');
    return new Response(V.sse(V.bericht(a)), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
  };
  return { c: new AiClient({ apiKey: KEY, fetch: f, maxRetries: 0 }), verzoeken };
}

// ---------------------------------------------------------------- schema

test('schemagrootte: binnen de limieten van structured outputs (optioneel ≤ 24, unie ≤ 16), geen recursie, alles gesloten', () => {
  const m = schemaMaat(ANTWOORD_SCHEMA);
  assert.equal(m.recursief, false);
  assert.equal(m.nietGesloten, 0);
  assert.ok(m.optioneel <= SCHEMA_LIMIETEN.optioneel, `optioneel ${m.optioneel}`);
  assert.ok(m.unie <= SCHEMA_LIMIETEN.unie, `unie ${m.unie}`);
  // marge voor latere uitbreidingen (de API heeft ook interne limieten op de grootte van de grammatica)
  assert.ok(m.optioneel <= 18, `optioneel ${m.optioneel} > budget 18`);
  assert.ok(m.unie <= 2, `unie ${m.unie} > budget 2`);
  assert.ok(m.bytes < 8000, `schema ${m.bytes} bytes`);
  // de meetfunctie zelf: een vrij element met alle v2-velden zou de limiet overschrijden (reden voor de JSON-tekst)
  const recursief = { $defs: { a: { type: 'object', additionalProperties: false, properties: { b: { $ref: '#/$defs/a' } } } }, $ref: '#/$defs/a' };
  assert.equal(schemaMaat(recursief).recursief, true);
  const unie = { type: 'object', additionalProperties: false, properties: { x: { anyOf: [{ type: 'string' }, { type: 'number' }] }, y: { type: ['string', 'null'] } }, required: ['x'] };
  assert.deepEqual([schemaMaat(unie).optioneel, schemaMaat(unie).unie], [1, 2]);
  // elke macro staat in het schema, en het verzoek stuurt dit schema mee
  const ops = ANTWOORD_SCHEMA.$defs.op.anyOf.map((x) => x.properties.op.enum[0]);
  for (const mac of MACROS) assert.ok(ops.includes(mac), mac);
  const p = bouwVerzoek(INST, [eersteBericht(lees('bestaand'), V.OPDRACHT_PVE)]);
  assert.equal(p.output_config.format.schema, ANTWOORD_SCHEMA);
  assert.equal(p.system[0].text, SYSTEEMPROMPT);
});

// ---------------------------------------------------------------- voorbeeldopdracht met macro's

test('voorbeeldopdracht end-to-end met macro\'s (SDK, nagebootst): geldig, afbraak correct, zolder met trap en sanitair, programma voldoet', async () => {
  const basis = lees('bestaand');
  const kopie = JSON.stringify(basis);
  const { c, verzoeken } = client([V.antwoordPveMacro()]);
  const r = await new Gesprek({ client: c, instellingen: INST, basis, niveau: 'N0' }).start(V.OPDRACHT_PVE);
  assert.equal(r.actie, 'toon', JSON.stringify(r.melding || r.varianten?.[0]?.fouten));
  assert.equal(verzoeken.length, 1);
  const v = r.varianten[0];
  const na = v.model;
  assert.equal(validate(na).geldig, true);
  assert.equal(JSON.stringify(basis), kopie, 'basis ongewijzigd');

  // afbraak (achterbouw + garage 2): zelfde uitkomst als de bewerkingen
  for (const id of ['M3', 'M12', 'M13', 'M27', 'M28', 'M29']) assert.equal(na.muren.find((x) => x.id === id).status, 'afbraak', id);
  for (const id of ['O9', 'O10', 'O11', 'O17', 'O18', 'O30']) assert.equal(na.openingen.find((x) => x.id === id).status, 'afbraak', id);
  assert.equal(na.daken.find((x) => x.id === 'D2').status, 'afbraak');
  for (const id of ['R5', 'R6', 'R7', 'R15']) assert.ok(!na.ruimtes.some((x) => x.id === id), id);
  const weg = v.diff.filter((d) => d.soort === 'verwijderd');
  assert.ok(weg.every((d) => d.collectie === 'ruimtes'), 'enkel ruimtes verwijderd');

  // zolder + trap + sanitair
  const n2 = na.niveaus.find((n) => n.id === 'N2');
  assert.equal(n2.soort, 'zolder');
  assert.equal(n2.peil, 5800);
  const t1 = na.trappen.find((t) => t.id === 'T1');
  assert.deepEqual([t1.vanNiveau, t1.naarNiveau, t1.type, t1.status], ['N1', 'N2', 'halfdraai', 'nieuw']);
  const inr = na.inrichting.filter((x) => x.ruimte === 'R16').map((x) => x.soort).sort();
  assert.deepEqual(inr, ['douche', 'lavabo']);
  assert.ok(na.ruimtes.filter((x) => x.niveau === 'N2').every((x) => Array.isArray(x.hoogtegrenzen)));

  // id's: de zolderwanden houden M30…M36; de door afbraakZone gesplitste muurstukken kregen andere id's
  for (const id of ['M30', 'M31', 'M32', 'M33', 'M34', 'M35', 'M36']) assert.equal(na.muren.find((x) => x.id === id).niveau, 'N2', id);
  const gesplitst = v.macroInfo[0].info.gesplitst.flatMap((g) => g.nieuw);
  assert.ok(gesplitst.length >= 2 && gesplitst.every((id) => !/^M3[0-6]$/.test(id)), gesplitst.join());
  assert.equal(v.macroInfo.find((x) => x.op === 'zolderNiveau').info.id, 'N2');
  assert.ok(v.meldingen.some((x) => /randMuren|rand van de zone/.test(x)), 'randmuren gemeld');

  // uitgevouwen: geen macro's meer, item/velden zijn objecten; toepassen geeft exact hetzelfde model
  assert.ok(v.ops.every((o) => !MACROS.includes(o.op)));
  assert.ok(v.ops.every((o) => typeof (o.item ?? {}) === 'object' && typeof (o.velden ?? {}) === 'object'));
  assert.ok(v.antwoordOps.some((o) => o.op === 'afbraakZone'));
  const t = applyOps(basis, v.ops);
  assert.equal(t.ok, true);
  assert.deepEqual(t.model, na);

  // programma van eisen + toets
  assert.equal(na.programma.eisen.length, 4);
  const toets = v.programmaToets;
  assert.ok(toets, 'programmaToets aanwezig');
  assert.equal(toets.samenvatting['voldoet niet'], 0);
  assert.ok(toets.resultaten.every((x) => ['voldoet', 'onbekend'].includes(x.status)), JSON.stringify(toets.resultaten));
  assert.equal(toets.samenvatting.voldoet, 4);
  assert.deepEqual(toets, toetsProgramma(na));

  // voorbeeld in de plattegrond: trap op N1 en N2, inrichting op N2
  const h2 = voorbeeldHulp(basis, na, v.diff, 'N2');
  const h1 = voorbeeldHulp(basis, na, v.diff, 'N1');
  assert.ok(h2.niveaus.includes('N0') && h2.niveaus.includes('N1') && h2.niveaus.includes('N2'));
  assert.ok(h2.polygonen.length >= 20);
  assert.ok(h1.polygonen.some((p) => p.stijl === 'nieuw'), 'trap zichtbaar op N1');
});

test('zonder programma: geen programmaToets; basisops als object blijven werken (fase-4-antwoorden)', () => {
  const basis = lees('bestaand');
  const [v] = pasVariantenToe(basis, V.antwoordPve().varianten);
  assert.equal(v.ok, true);
  assert.equal(v.programmaToets, undefined);
  assert.deepEqual(v.macroInfo, []);
});

// ---------------------------------------------------------------- herstelpoging

test('ongeldige macro → fout met pad en macro → herstelpoging met de fout en de info van eerdere macro\'s → succes', async () => {
  const basis = lees('bestaand');
  const g = leesAntwoord(V.bericht(V.antwoordOngeldigeMacro()));
  const r1 = beoordeel(basis, g);
  assert.equal(r1.actie, 'herstel');
  const v = r1.varianten[0];
  const i = V.antwoordOngeldigeMacro().varianten[0].ops.findIndex((o) => o.op === 'trapPlaatsen');
  assert.equal(v.fouten[0].pad, `ops[${i}]`);
  assert.match(v.fouten[0].melding, /trapPlaatsen: Onbekend naarNiveau "N9"/);
  const tekst = r1.herstel.content[0].text;
  assert.match(tekst, /trapPlaatsen/);
  assert.match(tekst, /"naar":"N9"/);
  assert.match(tekst, /Macro's die vóór de fout wel uitgevoerd werden/);
  assert.match(tekst, /ops\[2\] zolderNiveau: nieuwe id's N2/);

  const { c, verzoeken } = client([V.antwoordOngeldigeMacro(), V.antwoordPveMacro()]);
  const r = await new Gesprek({ client: c, instellingen: INST, basis }).start(V.OPDRACHT_PVE);
  assert.equal(r.actie, 'toon');
  assert.equal(r.herstelPogingen, 1);
  assert.equal(verzoeken.length, 2);
  const b2 = JSON.parse(verzoeken[1].body);
  assert.deepEqual(b2.messages.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.match(b2.messages[2].content[0].text, /N9/);
});

test('twee keer een ongeldige macro → fout, niets toegepast', async () => {
  const basis = lees('bestaand');
  const { c } = client([V.antwoordOngeldigeMacro(), V.antwoordOngeldigeMacro()]);
  const r = await new Gesprek({ client: c, instellingen: INST, basis }).start(V.OPDRACHT_PVE);
  assert.equal(r.actie, 'fout');
  assert.match(r.melding, /N9/);
});

// ---------------------------------------------------------------- macro's afzonderlijk

test('macro\'s: foutgevallen (beide zones, bestaand id, JSON-tekst, ontwerpveld, onbekende ruimte)', () => {
  const m = lees('bestaand');
  const fout = (ops) => { const r = vouwUit(m, ops); assert.equal(r.ok, false); return r.fouten[0]; };
  assert.match(fout([{ op: 'afbraakZone', ruimtes: ['R5'], ids: ['M3'] }]).melding, /niet beide/);
  assert.match(fout([{ op: 'afbraakZone' }]).melding, /vereist/);
  assert.match(fout([{ op: 'afbraakZone', ruimtes: ['R99'] }]).melding, /R99/);
  assert.match(fout([{ op: 'zolderNiveau', onderNiveau: 'N1', naam: 'Zolder', id: 'N0' }]).melding, /"N0" bestaat al/);
  const f = fout([{ op: 'verwijderen', collectie: 'ruimtes', id: 'R1' }, { op: 'toevoegen', collectie: 'muren', item: '{"id": "M90", niveau' }]);
  assert.equal(f.pad, 'ops[1]');
  assert.match(f.melding, /geen geldige JSON-tekst/);
  assert.match(fout([{ op: 'ontwerp', velden: '{"basis":"x"}' }]).melding, /enkel programma, naam, beschrijving/);
  assert.match(fout([{ op: 'inrichtingPlaatsen', id: 'I1', soort: 'douche', ruimte: 'R1', rotatie: 0, breedte: 5000, diepte: 5000 }]).melding, /Geen plek gevonden/);
});

test('macro\'s: muurSplitsen met nieuwId, latere ops verwijzen ernaar; afbraakZone met ids; lege id = automatisch', () => {
  const m = lees('voorbeeld');
  const muur = m.muren.find((x) => muurLengte(x) > 3000 && !m.openingen.some((o) => o.muur === x.id));
  assert.ok(muur, 'testmuur');
  // designs/voorbeeld.json: N1 heeft een zadeldak ⇒ zolder mogelijk
  assert.ok(m.daken.some((d) => d.niveau === 'N1' && d.type === 'zadel'));
  const ops = [
    { op: 'muurSplitsen', muur: muur.id, positie: 1500, nieuwId: 'M500' },
    { op: 'afbraakZone', ids: ['M500'] },
    { op: 'zolderNiveau', onderNiveau: 'N1', naam: 'Zolder', id: '' },
  ];
  const [v] = pasVariantenToe(m, [{ naam: 't', beschrijving: '', ops }]);
  assert.equal(v.ok, true, JSON.stringify(v.fouten));
  assert.equal(v.model.muren.find((x) => x.id === 'M500').status, 'afbraak');
  assert.equal(muurLengte(v.model.muren.find((x) => x.id === muur.id)), 1500);
  // lege id ⇒ volgend vrij nummer
  const zolder = v.model.niveaus.find((n) => n.soort === 'zolder');
  assert.equal(zolder.id, 'N2');
  assert.deepEqual(v.macroInfo.map((x) => x.op), ['muurSplitsen', 'afbraakZone', 'zolderNiveau']);
  assert.deepEqual(v.macroInfo[0].ids, ['M500']);
});

test('hernoemOps: id\'s en verwijzingen (niveau, muur, ruimte, van/naar) in item en velden', () => {
  const map = new Map([['N9', 'N2'], ['M1', 'M7']]);
  const uit = hernoemOps([
    { op: 'toevoegen', collectie: 'muren', item: { id: 'M1', niveau: 'N9' } },
    { op: 'toevoegen', collectie: 'trappen', item: { id: 'T1', vanNiveau: 'N0', naarNiveau: 'N9' } },
    { op: 'wijzigen', collectie: 'openingen', id: 'O1', velden: { muur: 'M1' } },
  ], map);
  assert.deepEqual(uit[0].item, { id: 'M7', niveau: 'N2' });
  assert.equal(uit[1].item.naarNiveau, 'N2');
  assert.equal(uit[2].velden.muur, 'M7');
});

test('instellingen gaan mee naar macro\'s en de programmatoets (grenzen zijn standaard leeg)', () => {
  const basis = lees('bestaand');
  // een ingestelde (fictieve, enkel voor de test) maximale optrede van 150 mm ⇒ de trap van 175 mm voldoet niet
  const inst = { trap: { maxOptrede: 150 } };
  const [v] = pasVariantenToe(basis, V.antwoordPveMacro().varianten, { instellingen: inst });
  assert.equal(v.ok, true);
  const trapEis = v.programmaToets.resultaten.find((x) => /Trap/.test(x.label));
  assert.equal(trapEis.status, 'voldoet niet');
  assert.match(trapEis.uitleg, /maxOptrede 150/);
});
