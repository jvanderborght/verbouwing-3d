// Promptveld (js/ai): prompt, antwoordverwerking, herstelpoging en de echte (gevendorde) SDK met een nagebootste fetch.
// Er gebeurt GEEN echte API-aanroep: elke fetch wordt hier beantwoord met een nagebootste SSE-stroom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Zoals de importmap in index.html: kale specifiers van de SDK naar de gevendorde bestanden.
const basis = new URL('../js/vendor/', import.meta.url).href;
const mapping = {
  '@anthropic-ai/sdk': `${basis}anthropic-sdk/index.mjs`,
  '@opentelemetry/api': `${basis}opentelemetry-api/index.mjs`,
  standardwebhooks: `${basis}anthropic-sdk-shims/standardwebhooks.mjs`,
};
const hook = `const M = ${JSON.stringify(mapping)};
export async function resolve(spec, ctx, next) { return M[spec] ? { url: M[spec], shortCircuit: true } : next(spec, ctx); }`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);

const { SYSTEEMPROMPT, ANTWOORD_SCHEMA, bouwVerzoek, eersteBericht, contextTekst, normaliseerInstellingen, assistentBericht, MAX_TOKENS, FALLBACK_BETA } = await import('../js/ai/prompt.js');
const { leesAntwoord, beoordeel, pasVariantenToe, herstelTekst, voorbeeldHulp, soortVan, leesJson } = await import('../js/ai/verwerk.js');
const { AiClient, AiOpslag, vertaalFout, verberg, schatKost, telUsage } = await import('../js/ai/client.js');
const { Gesprek } = await import('../js/ai/gesprek.js');
const V = await import('./ai-voorbeelden.js');
const { validate } = await import('../js/model/index.js');

const lees = (f) => JSON.parse(readFileSync(new URL(`../designs/${f}.json`, import.meta.url), 'utf8'));
const KEY = 'sk-ant-api03-TESTKEY-nietecht-0123456789abcdef';
const INST = { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true };

/** Nagebootste fetch: geeft de antwoorden in volgorde terug (SSE of HTTP-fout) en bewaart elk verzoek. */
function nepFetch(antwoorden) {
  const verzoeken = [];
  const f = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    verzoeken.push({ url: String(url), headers: Object.fromEntries(headers.entries()), body: init.body ? String(init.body) : '' });
    const a = antwoorden.shift();
    if (!a) throw new Error('geen nagebootst antwoord meer');
    if (a.fout) return new Response(JSON.stringify({ type: 'error', error: { type: a.type || 'error', message: a.melding || 'fout' } }), { status: a.fout, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
    if (a.netwerk) throw new TypeError('Failed to fetch');
    return new Response(V.sse(a.bericht), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
  };
  return { f, verzoeken };
}
const client = (antwoorden, extra = {}) => {
  const n = nepFetch(antwoorden);
  return { c: new AiClient({ apiKey: KEY, fetch: n.f, maxRetries: 0, ...extra }), verzoeken: n.verzoeken };
};
const antwoord = (data, o) => ({ bericht: V.bericht(data, o) });

// ---------------------------------------------------------------- prompt en verzoek

test('systeemprompt: vast, Nederlands, met datamodel, operaties en de afbraak-/statusregels', () => {
  assert.equal(typeof SYSTEEMPROMPT, 'string');
  for (const s of ['mm', 'Oorsprong', 'x → rechts', 'y → naar achter', 'toevoegen', 'wijzigen', 'verwijderen', 'verplaatsen', 'afbraak', '"nieuw"',
    'Niet modelleerbaar in schema v1', 'Programma van eisen', 'draaitrap', 'Zolder', 'vragen', 'Verzin geen andere maten']) {
    assert.ok(SYSTEEMPROMPT.includes(s), `systeemprompt mist "${s}"`);
  }
  // geen tijdstempels of willekeur (cache)
  assert.doesNotMatch(SYSTEEMPROMPT, /\d{4}-\d{2}-\d{2}T/);
});

test('antwoordschema: additionalProperties false op elk object, geen min/max, geen ontwerp-operatie', () => {
  const objecten = [];
  const loop = (s) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') objecten.push(s);
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) assert.ok(!(k in s), `niet ondersteund: ${k}`);
    for (const v of Object.values(s)) if (v && typeof v === 'object') loop(v);
  };
  loop(ANTWOORD_SCHEMA);
  assert.ok(objecten.length >= 6);
  for (const o of objecten) assert.equal(o.additionalProperties, false);
  assert.deepEqual(ANTWOORD_SCHEMA.required, ['samenvatting', 'vragen', 'varianten']);
  const ops = ANTWOORD_SCHEMA.$defs.op.anyOf.map((x) => x.properties.op.enum[0]);
  assert.deepEqual(ops, ['toevoegen', 'wijzigen', 'verwijderen', 'verplaatsen']);
});

test('bouwVerzoek: model, effort, structured output, fallbacks, cache_control; geen thinking/sampling/prefill', () => {
  const m = lees('voorbeeld');
  const p = bouwVerzoek(INST, [eersteBericht(m, 'Maak de keuken groter', { aantal: 2, niveau: 'N0' })]);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, MAX_TOKENS);
  assert.deepEqual(p.output_config.effort, 'medium');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.deepEqual(p.betas, [FALLBACK_BETA]);
  assert.equal(p.fallbacks, 'default');
  assert.equal(p.system[0].cache_control.type, 'ephemeral');
  assert.equal(p.messages[0].content[0].cache_control.type, 'ephemeral', 'contextblok is cachebaar');
  assert.equal(p.messages[0].content[1].cache_control, undefined, 'opdracht zelf niet');
  for (const k of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'tools']) assert.ok(!(k in p), k);
  assert.equal(p.messages.at(-1).role, 'user', 'geen assistant-prefill');
  assert.match(p.messages[0].content[1].text, /precies 2 verschillende varianten/);
  // Haiku 5.5: geen fallbacks (400 volgens de documentatie); fallbacks uit in instellingen
  assert.ok(!('fallbacks' in bouwVerzoek({ ...INST, model: 'claude-haiku-5-5' }, p.messages)));
  assert.ok(!('betas' in bouwVerzoek({ ...INST, fallbacks: false }, p.messages)));
  assert.ok(!('format' in bouwVerzoek(INST, p.messages, { structured: false }).output_config));
  // deterministisch (cache)
  assert.equal(JSON.stringify(bouwVerzoek(INST, [eersteBericht(m, 'x')])), JSON.stringify(bouwVerzoek(INST, [eersteBericht(m, 'x')])));
});

test('context: compact ontwerp-JSON, kerncijfers, actief niveau, selectie en volgende vrije ids', () => {
  const m = lees('bestaand');
  const t = contextTekst(m, { niveau: 'N1', selectie: 'M5' });
  assert.ok(t.includes(JSON.stringify({ ...m, gewijzigd: undefined }).slice(0, 40)));
  assert.match(t, /Kerncijfers \(huidig ontwerp\): bruto [\d.]+ m²/);
  assert.match(t, /Actief niveau in de plattegrond: N1 \(Verdieping\)/);
  assert.match(t, /Geselecteerd element: muren M5/);
  assert.match(t, /muren: M30/);
  assert.doesNotMatch(t, /\n {2}/, 'geen ingesprongen JSON');
});

test('multi-turn: cache_control op contextblok en op het laatste blok, max. 4 breekpunten; assistent zonder denkblokken', () => {
  const m = lees('voorbeeld');
  const b = [eersteBericht(m, 'x'), assistentBericht(V.bericht({ samenvatting: 's', vragen: ['Welke kant?'], varianten: [] })), { role: 'user', content: [{ type: 'text', text: 'links' }] }];
  assert.deepEqual(b[1].content.map((x) => x.type), ['text']);
  const p = bouwVerzoek(INST, b);
  const n = JSON.stringify(p).split('"cache_control"').length - 1;
  assert.equal(n, 3);
  assert.equal(p.messages[2].content[0].cache_control.type, 'ephemeral');
  assert.equal(b[0].content[0].cache_control, undefined, 'origineel niet gemuteerd');
});

test('normaliseerInstellingen: onbekende waarden → standaard', () => {
  assert.deepEqual(normaliseerInstellingen(null), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true });
  assert.deepEqual(normaliseerInstellingen({ model: 'gpt', effort: 'extreem', fallbacks: 'ja' }), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true });
  assert.deepEqual(normaliseerInstellingen({ model: 'claude-sonnet-5-5', effort: 'high', fallbacks: false }), { model: 'claude-sonnet-5-5', effort: 'high', fallbacks: false });
});

// ---------------------------------------------------------------- antwoorden lezen

test('leesAntwoord: stop_reason eerst (refusal, max_tokens), dan JSON', () => {
  const r = leesAntwoord(V.bericht(null, { stop: 'refusal' }));
  assert.equal(r.status, 'weigering');
  assert.match(r.melding, /weigerde/);
  assert.equal(leesAntwoord({ ...V.bericht(null, { stop: 'refusal' }), stop_details: { category: 'cyber' } }).melding.includes('cyberveiligheid'), true);
  const mt = leesAntwoord(V.bericht('{"samenvatting": "afgebr', { stop: 'max_tokens' }));
  assert.equal(mt.status, 'max_tokens');
  assert.match(mt.melding, /maximale lengte/);
  assert.equal(leesAntwoord(V.bericht('geen json')).status, 'ongeldig');
  assert.equal(leesAntwoord(V.bericht({ samenvatting: 1 })).status, 'ongeldig');
  assert.equal(leesAntwoord(V.bericht('```json\n{"samenvatting":"ok","vragen":[],"varianten":[]}\n```')).status, 'ok');
  assert.equal(leesJson('tekst ervoor {"a":1} erna').waarde.a, 1);
});

test('leesAntwoord: na een fallback-blok telt de tekst erna als die alleen geldig is', () => {
  const b = V.bericht({ samenvatting: 'ok', vragen: [], varianten: [] }, { extra: [{ type: 'text', text: '{"samenv' }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }] });
  const r = leesAntwoord(b);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.fallback, { van: 'claude-opus-5-5', naar: 'claude-opus-4-8' });
});

test('pasVariantenToe: geldige variant → diff + telling; basis blijft ongewijzigd', () => {
  const m = lees('voorbeeld');
  const kopie = JSON.stringify(m);
  const [v] = pasVariantenToe(m, [V.geldigeVariant(m)]);
  assert.equal(v.ok, true);
  assert.equal(validate(v.model).geldig, true);
  assert.deepEqual(v.telling, { nieuw: 2, afbraak: 0, gewijzigd: 0, verwijderd: 0 });
  assert.ok(v.diffTekst.some((r) => r.includes('M900')));
  assert.equal(JSON.stringify(m), kopie);
});

test('voorbeeldHulp: nieuw blauw, afbraak rood, gewijzigd oranje, per niveau', () => {
  const m = lees('bestaand');
  const [v] = pasVariantenToe(m, V.antwoordPve().varianten);
  assert.equal(v.ok, true, JSON.stringify(v.fouten));
  const h0 = voorbeeldHulp(m, v.model, v.diff, 'N0');
  const stijlen = new Set(h0.polygonen.map((p) => p.stijl));
  assert.ok(stijlen.has('afbraak'));
  assert.ok(!stijlen.has('nieuw'));
  const h2 = voorbeeldHulp(m, v.model, v.diff, 'N2');
  assert.ok(h2.polygonen.some((p) => p.stijl === 'nieuw'));
  assert.deepEqual([...h0.niveaus].sort(), ['N0', 'N2']);
  assert.equal(soortVan({ soort: 'gewijzigd', velden: [{ veld: 'breedte', oud: 1, nieuw: 2 }] }), 'gewijzigd');
});

test('programma van eisen (afbraak achterbouw + garage 2, zolder): statussen correct, niets verwijderd behalve ruimtes', () => {
  const m = lees('bestaand');
  const r = beoordeel(m, leesAntwoord(V.bericht(V.antwoordPve())));
  assert.equal(r.actie, 'toon');
  const v = r.varianten[0];
  const na = v.model;
  for (const id of ['M3', 'M12', 'M13', 'M27', 'M28', 'M29']) assert.equal(na.muren.find((x) => x.id === id).status, 'afbraak', id);
  for (const id of ['O9', 'O10', 'O11', 'O17', 'O18', 'O30']) assert.equal(na.openingen.find((x) => x.id === id).status, 'afbraak', id);
  assert.equal(na.daken.find((x) => x.id === 'D2').status, 'afbraak');
  assert.equal(na.vloeren.find((x) => x.id === 'V4').status, 'afbraak');
  assert.deepEqual(na.niveaus.find((n) => n.id === 'N2'), { id: 'N2', naam: 'Zolder', peil: 5800, hoogte: 2400, vloerdikte: 250 });
  const zolder = na.ruimtes.filter((x) => x.niveau === 'N2');
  assert.deepEqual(zolder.map((x) => x.functie).sort(), ['badkamer', 'berging', 'hal', 'slaapkamer', 'slaapkamer', 'trap']);
  assert.ok(na.muren.filter((x) => x.niveau === 'N2').every((x) => x.status === 'nieuw'));
  // enkel ruimtes verdwijnen; bestaande muren/openingen/vloeren/daken worden nooit verwijderd
  const weg = v.diff.filter((d) => d.soort === 'verwijderd');
  assert.ok(weg.length > 0 && weg.every((d) => d.collectie === 'ruimtes'));
  assert.match(r.data.samenvatting, /Niet modelleerbaar in schema v1/);
  assert.match(r.data.samenvatting, /Aanname/);
});

// ---------------------------------------------------------------- herstelpoging

test('beoordeel: ongeldige ops → herstel (max. 1) → daarna fout', () => {
  const m = lees('voorbeeld');
  const g = leesAntwoord(V.bericht({ samenvatting: 's', vragen: [], varianten: [V.ongeldigeVariant()] }));
  const r1 = beoordeel(m, g);
  assert.equal(r1.actie, 'herstel');
  const t = r1.herstel.content[0].text;
  assert.match(t, /Variant 1 "Fout"/);
  assert.match(t, /M999/);
  assert.match(t, /VOLLEDIGE verbeterde antwoord/);
  const r2 = beoordeel(m, g, { herstelPogingen: 1 });
  assert.equal(r2.actie, 'fout');
  assert.match(r2.melding, /Er werd niets gewijzigd/);
  assert.match(herstelTekst({ vormFouten: ['x'] }), /- x/);
});

// ---------------------------------------------------------------- echte SDK met nagebootste fetch

test('SDK: geldig antwoord → varianten; request-vorm en headers; key enkel in de authenticatieheader', async () => {
  const m = lees('voorbeeld');
  const { c, verzoeken } = client([antwoord({ samenvatting: 'Een extra binnenmuur.', vragen: [], varianten: [V.geldigeVariant(m)] })]);
  const g = new Gesprek({ client: c, instellingen: INST, basis: m, niveau: 'N0', aantal: 1 });
  const voortgang = [];
  const r = await g.start('Zet een binnenmuur in het midden', { opVoortgang: (v) => voortgang.push(v) });
  assert.equal(r.actie, 'toon');
  assert.equal(r.varianten.length, 1);
  assert.ok(voortgang.some((v) => v.tekens > 0), 'voortgang tijdens streaming');
  assert.equal(verzoeken.length, 1);
  const v = verzoeken[0];
  assert.equal(v.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(v.headers['anthropic-beta'], FALLBACK_BETA);
  assert.ok(v.headers['anthropic-version']);
  const body = JSON.parse(v.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.effort, 'medium');
  assert.ok(!('betas' in body));
  // de key: enkel in de authenticatieheader, nergens anders
  const authHeaders = Object.entries(v.headers).filter(([, w]) => w.includes(KEY)).map(([k]) => k);
  assert.ok(authHeaders.length === 1 && ['authorization', 'x-api-key'].includes(authHeaders[0]), authHeaders.join());
  assert.ok(!v.body.includes(KEY));
  assert.ok(!v.url.includes(KEY));
  // usage incl. cache_read_input_tokens
  assert.equal(g.usage.cache_read_input_tokens, 6000);
  assert.ok(g.usage.kost > 0);
});

test('SDK: ongeldige ops → één herstelpoging met de fouten → succes', async () => {
  const m = lees('voorbeeld');
  const { c, verzoeken } = client([
    antwoord({ samenvatting: 's', vragen: [], varianten: [V.ongeldigeVariant()] }),
    antwoord({ samenvatting: 'Verbeterd.', vragen: [], varianten: [V.geldigeVariant(m)] }),
  ]);
  const g = new Gesprek({ client: c, instellingen: INST, basis: m });
  const r = await g.start('x');
  assert.equal(r.actie, 'toon');
  assert.equal(r.herstelPogingen, 1);
  assert.equal(verzoeken.length, 2);
  const b2 = JSON.parse(verzoeken[1].body);
  assert.deepEqual(b2.messages.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.match(b2.messages[2].content[0].text, /M999/);
  // append-only: eerste bericht byte-identiek (op de cache-markering na, die enkel verschuift)
  assert.equal(JSON.stringify(b2.messages[0]), JSON.stringify(JSON.parse(verzoeken[0].body).messages[0]));
  assert.deepEqual(b2.messages[1].content.map((x) => x.type), ['text']);
});

test('SDK: twee keer ongeldig → fout, niets toegepast', async () => {
  const m = lees('voorbeeld');
  const fout = { samenvatting: 's', vragen: [], varianten: [V.ongeldigeVariant()] };
  const { c, verzoeken } = client([antwoord(fout), antwoord(fout)]);
  const r = await new Gesprek({ client: c, instellingen: INST, basis: m }).start('x');
  assert.equal(r.actie, 'fout');
  assert.equal(verzoeken.length, 2);
});

test('SDK: refusal en max_tokens → duidelijke melding, geen herstelpoging', async () => {
  const m = lees('voorbeeld');
  for (const [stop, re] of [['refusal', /weigerde/], ['max_tokens', /maximale lengte/]]) {
    const { c, verzoeken } = client([{ bericht: V.bericht(stop === 'refusal' ? null : '{"samenvatting":"…', { stop }) }]);
    const r = await new Gesprek({ client: c, instellingen: INST, basis: m }).start('x');
    assert.equal(r.actie, 'fout');
    assert.match(r.melding, re);
    assert.equal(verzoeken.length, 1);
  }
});

test('SDK: vragen in plaats van ops → beantwoorden in hetzelfde gesprek → varianten', async () => {
  const m = lees('voorbeeld');
  const { c, verzoeken } = client([
    antwoord({ samenvatting: 'Nog onduidelijk.', vragen: ['Op welk niveau?', 'Hoe breed?'], varianten: [] }),
    antwoord({ samenvatting: 'Klaar.', vragen: [], varianten: [V.geldigeVariant(m)] }),
  ]);
  const g = new Gesprek({ client: c, instellingen: INST, basis: m });
  const r1 = await g.start('maak iets');
  assert.equal(r1.actie, 'vragen');
  assert.deepEqual(r1.data.vragen, ['Op welk niveau?', 'Hoe breed?']);
  const r2 = await g.beantwoord('Gelijkvloers, 1 m');
  assert.equal(r2.actie, 'toon');
  const b2 = JSON.parse(verzoeken[1].body);
  assert.deepEqual(b2.messages.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.match(b2.messages[2].content[0].text, /Gelijkvloers, 1 m/);
});

test('SDK: N varianten (3) → drie geldige varianten', async () => {
  const m = lees('voorbeeld');
  const vs = [0, 500, -500].map((dx, i) => V.geldigeVariant(m, { naam: `Variant ${i + 1}`, dx }));
  const { c, verzoeken } = client([antwoord({ samenvatting: 'Drie opties.', vragen: [], varianten: vs })]);
  const r = await new Gesprek({ client: c, instellingen: INST, basis: m, aantal: 3 }).start('3 varianten');
  assert.equal(r.actie, 'toon');
  assert.deepEqual(r.varianten.map((v) => v.naam), ['Variant 1', 'Variant 2', 'Variant 3']);
  assert.match(JSON.parse(verzoeken[0].body).messages[0].content[1].text, /precies 3/);
});

test('SDK: programma van eisen op het bestaande ontwerp', async () => {
  const m = lees('bestaand');
  const { c } = client([antwoord(V.antwoordPve())]);
  const r = await new Gesprek({ client: c, instellingen: INST, basis: m, niveau: 'N0' }).start(V.OPDRACHT_PVE);
  assert.equal(r.actie, 'toon');
  assert.ok(r.varianten[0].telling.afbraak >= 15);
  assert.ok(r.varianten[0].telling.nieuw >= 10);
});

test('SDK: HTTP-fouten → Nederlandse meldingen zonder key', async () => {
  const m = lees('voorbeeld');
  const gevallen = [
    [{ fout: 401, type: 'authentication_error', melding: `invalid x-api-key ${KEY}` }, 'auth', /API-key werd geweigerd/],
    [{ fout: 429, type: 'rate_limit_error' }, 'limiet', /Limiet bereikt/],
    [{ fout: 529, type: 'overloaded_error' }, 'overbelast', /overbelast/],
    [{ fout: 500, type: 'api_error' }, 'storing', /Storing/],
    [{ fout: 400, type: 'invalid_request_error', melding: `iets mis met ${KEY}` }, 'ongeldig', /Ongeldige aanvraag/],
    [{ netwerk: true }, 'netwerk', /Geen verbinding/],
  ];
  for (const [a, soort, re] of gevallen) {
    const { c } = client([a]);
    await assert.rejects(new Gesprek({ client: c, instellingen: INST, basis: m }).start('x'), (e) => {
      assert.equal(e.soort, soort, e.message);
      assert.match(e.message, re);
      assert.ok(!e.message.includes(KEY), 'key in melding');
      assert.ok(!String(e.stack).includes(KEY), 'key in stack');
      return true;
    });
  }
});

test('SDK: 400 over fallbacks → automatisch opnieuw zonder fallbacks', async () => {
  const m = lees('voorbeeld');
  const { c, verzoeken } = client([
    { fout: 400, type: 'invalid_request_error', melding: 'fallbacks: not supported for this model' },
    antwoord({ samenvatting: 'ok', vragen: [], varianten: [V.geldigeVariant(m)] }),
  ]);
  const g = new Gesprek({ client: c, instellingen: { ...INST, model: 'claude-sonnet-5-5' }, basis: m });
  const r = await g.start('x');
  assert.equal(r.actie, 'toon');
  assert.ok(!('fallbacks' in JSON.parse(verzoeken[1].body)));
  assert.equal(verzoeken[1].headers['anthropic-beta'], undefined);
  assert.equal(g.aanpassingen.length, 1);
});

test('SDK: annuleren → soort geannuleerd', async () => {
  const m = lees('voorbeeld');
  const ac = new AbortController();
  const f = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const c = new AiClient({ apiKey: KEY, fetch: f, maxRetries: 0 });
  const p = new Gesprek({ client: c, instellingen: INST, basis: m }).start('x', { signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (e) => e.soort === 'geannuleerd');
});

// ---------------------------------------------------------------- key, opslag, kost

test('key: verberg() en vertaalFout() lekken de key nooit; zonder key een duidelijke fout', () => {
  assert.equal(verberg(`a ${KEY} b`, KEY), 'a [key] b');
  assert.equal(verberg('x sk-ant-abcdefghij y'), 'x [key] y');
  const e = vertaalFout({ status: 400, error: { error: { type: 'invalid_request_error', message: `bad ${KEY}` } } }, { key: KEY });
  assert.ok(!e.message.includes(KEY));
  assert.throws(() => new AiClient({ apiKey: '' }), (x) => x.soort === 'geen-key');
});

test('AiOpslag: key en instellingen in (nagebootste) localStorage; wissen', () => {
  const m = new Map();
  const o = new AiOpslag({ lees: (k) => m.get(k) ?? null, schrijf: (k, v) => (m.set(k, v), true), wis: (k) => (m.delete(k), true) });
  assert.equal(o.key(), null);
  o.bewaarKey(`  ${KEY}  `);
  assert.equal(o.key(), KEY);
  o.bewaarInstellingen({ model: 'claude-haiku-5-5' });
  assert.deepEqual(o.instellingen(), { model: 'claude-haiku-5-5' });
  o.wisKey();
  assert.equal(o.key(), null);
});

test('schatKost: Opus 5.5 $4/$20, cache-lezen $0,20 per MTok; onbekend model → null', () => {
  const k = schatKost({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }, 'claude-opus-5-5');
  assert.ok(Math.abs(k - 24.2) < 1e-9);
  assert.equal(schatKost({ input_tokens: 1 }, 'claude-opus-4-8'), null);
  const t = telUsage([{ usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-opus-4-8' }]);
  assert.equal(t.kostOnbekend, true);
});

test('geen console-uitvoer met de key tijdens een volledige ronde', async () => {
  const m = lees('voorbeeld');
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const uit = [];
  for (const k of Object.keys(orig)) console[k] = (...a) => uit.push(a.map(String).join(' '));
  try {
    const { c } = client([{ fout: 401, type: 'authentication_error', melding: KEY }]);
    await new Gesprek({ client: c, instellingen: INST, basis: m }).start('x').catch(() => {});
    const { c: c2 } = client([antwoord({ samenvatting: 's', vragen: [], varianten: [V.geldigeVariant(m)] })]);
    await new Gesprek({ client: c2, instellingen: INST, basis: m }).start('x');
  } finally { Object.assign(console, orig); }
  assert.ok(!uit.join('\n').includes(KEY));
});
