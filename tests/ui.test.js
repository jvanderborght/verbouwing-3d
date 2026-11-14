// Tests voor de DOM-vrije UI-logica: id-afleiding, base64-UTF8, conflictdetectie, toestand lokaal-vs-GitHub,
// localStorage-wrapper, GitHub-client (met nep-fetch) en variantbeheer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { naarJson, leegModel, applyOps } from '../js/model/index.js';
import {
  LokaleOpslag, GitHubClient, GitHubFout, naarBase64Utf8, vanBase64Utf8, hashTekst, modelHash, githubFoutmelding, SLEUTELS,
} from '../js/ui/opslag.js';
import {
  idUitNaam, vergelijkMetGithub, bepaalToestand, kiesBijLaden, leesOntwerpTekst, werkIndexBij, VariantBeheer, PAGES_VERTRAGING_MS,
} from '../js/ui/varianten.js';
import { zoekElement, niveauVanElement, elementUitPad, veldRijen } from '../js/ui/eigenschappen.js';

const voorbeeldTekst = readFileSync(new URL('../designs/voorbeeld.json', import.meta.url), 'utf8');
const voorbeeld = () => JSON.parse(voorbeeldTekst);
const indexTekst = readFileSync(new URL('../designs/index.json', import.meta.url), 'utf8');

/** In-memory localStorage. `vol` simuleert QuotaExceededError, `kapot` een geblokkeerde opslag. */
class NepStorage {
  constructor({ vol = false, kapot = false } = {}) { this.m = new Map(); this.vol = vol; this.kapot = kapot; }
  get length() { if (this.kapot) throw new Error('SecurityError'); return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { if (this.kapot) throw new Error('SecurityError'); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.kapot) throw new Error('SecurityError'); if (this.vol) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); }
  removeItem(k) { if (this.kapot) throw new Error('SecurityError'); this.m.delete(k); }
}

const antwoord = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/**
 * Nep-GitHub (contents + git data API) en nep-Pages-site, met registratie van verzoeken.
 * bestanden: pad → tekst. Pages serveert `pages` (kan verouderd zijn t.o.v. bestanden).
 */
function nepGithub({ bestanden = {}, pages = null, status = {} } = {}) {
  const repo = { ...bestanden };
  const shaVan = (t) => 'sha-' + hashTekst(t);
  const pagesBestanden = pages ?? { ...bestanden };
  const log = [];
  let commits = 0;
  const fetch = async (url, opties = {}) => {
    const methode = opties.method || 'GET';
    log.push({ url, methode, headers: opties.headers || {}, body: opties.body });
    if (status[`${methode} ${url}`]) return antwoord(status[`${methode} ${url}`], { message: 'fout' });
    if (url.startsWith('designs/')) {
      const p = 'designs/' + url.slice('designs/'.length);
      return p in pagesBestanden ? antwoord(200, pagesBestanden[p]) : antwoord(404, 'Not Found');
    }
    const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(\/.*)$/.exec(url);
    if (!m) throw new TypeError('Failed to fetch');
    const rest = m[3];
    let c = /^\/contents\/([^?]+)/.exec(rest);
    if (c) {
      const pad = decodeURIComponent(c[1]);
      if (methode === 'GET') {
        if (!(pad in repo)) return antwoord(404, { message: 'Not Found' });
        const b64 = naarBase64Utf8(repo[pad]).replace(/(.{60})/g, '$1\n');
        return antwoord(200, { type: 'file', encoding: 'base64', content: b64, sha: shaVan(repo[pad]) });
      }
      if (methode === 'PUT') {
        const body = JSON.parse(opties.body);
        if (pad in repo && body.sha !== shaVan(repo[pad])) return antwoord(409, { message: 'sha mismatch' });
        if (!(pad in repo) && body.sha) return antwoord(422, { message: 'sha voor onbestaand bestand' });
        repo[pad] = vanBase64Utf8(body.content);
        commits++;
        return antwoord(200, { content: { sha: shaVan(repo[pad]) }, commit: { sha: `c${commits}` } });
      }
    }
    if (rest.startsWith('/git/ref/heads/')) return antwoord(200, { object: { sha: `c${commits}` } });
    if (rest.startsWith('/git/commits/') && methode === 'GET') return antwoord(200, { tree: { sha: 't' } });
    if (rest === '/git/trees') {
      const body = JSON.parse(opties.body);
      fetch.wachtend = body.tree;
      return antwoord(201, { sha: 'nieuweboom', tree: body.tree.map((e) => ({ path: e.path, sha: shaVan(e.content) })) });
    }
    if (rest === '/git/commits' && methode === 'POST') return antwoord(201, { sha: `c${commits + 1}` });
    if (rest.startsWith('/git/refs/heads/') && methode === 'PATCH') {
      for (const e of fetch.wachtend) repo[e.path] = e.content;
      commits++;
      return antwoord(200, {});
    }
    return antwoord(404, { message: 'onbekend' });
  };
  return { fetch, repo, log, get commits() { return commits; }, pages: pagesBestanden };
}

function maakBeheer({ gh = nepGithub({ bestanden: { 'designs/index.json': indexTekst, 'designs/voorbeeld.json': voorbeeldTekst } }), storage = new NepStorage(), token = 'geheim-token-123', nu } = {}) {
  const opslag = new LokaleOpslag(storage);
  if (token) opslag.bewaarToken(token);
  const b = new VariantBeheer({ opslag, fetch: gh.fetch, nu });
  return { b, gh, opslag, storage };
}

// ---------------------------------------------------------------- id uit naam

test('idUitNaam: accenten, spaties, leestekens', () => {
  assert.equal(idUitNaam('Variant B – Zolder & Garage'), 'variant-b-zolder-garage');
  assert.equal(idUitNaam('Één verdieping erbij!'), 'een-verdieping-erbij');
  assert.equal(idUitNaam('  --Uitbouw__achter--  '), 'uitbouw__achter');
  assert.equal(idUitNaam('€€€'), 'variant');
  assert.equal(idUitNaam(''), 'variant');
  assert.equal(idUitNaam('index'), 'index-ontwerp');
  assert.match(idUitNaam('x'.repeat(100)), /^x{40}$/);
});

test('idUitNaam: uniek t.o.v. bestaande ids', () => {
  assert.equal(idUitNaam('Voorbeeld', ['voorbeeld']), 'voorbeeld-2');
  assert.equal(idUitNaam('Voorbeeld', ['voorbeeld', 'voorbeeld-2']), 'voorbeeld-3');
  for (const n of ['A b', 'ÄÖÜ', '123 Test', 'variant (kopie)']) assert.match(idUitNaam(n), /^[a-z0-9][a-z0-9-_]*$/);
});

// ---------------------------------------------------------------- base64

test('base64 UTF-8 heen en terug, ook met accenten, emoji en lange tekst', () => {
  for (const t of ['', 'abc', 'Gelijkvloers – é ë ï ç € ½', 'tuin 🌳 en 中文', 'x'.repeat(200_000) + 'ë']) {
    assert.equal(vanBase64Utf8(naarBase64Utf8(t)), t);
  }
  assert.equal(naarBase64Utf8('é'), 'w6k=');
  assert.equal(vanBase64Utf8('w6\nk='), 'é', 'regeleinden in GitHub-base64 worden genegeerd');
});

// ---------------------------------------------------------------- conflictdetectie en toestand

test('vergelijkMetGithub: alle gevallen', () => {
  assert.equal(vergelijkMetGithub({ lokaal: 'a', basis: 'a', github: null }), 'enkel-lokaal');
  assert.equal(vergelijkMetGithub({ lokaal: 'a', basis: 'x', github: 'a' }), 'gelijk');
  assert.equal(vergelijkMetGithub({ lokaal: 'a', basis: 'a', github: 'b' }), 'neem-github');
  assert.equal(vergelijkMetGithub({ lokaal: 'b', basis: 'a', github: 'a' }), 'behoud-lokaal');
  assert.equal(vergelijkMetGithub({ lokaal: 'b', basis: 'a', github: 'c' }), 'conflict');
  assert.equal(vergelijkMetGithub({ lokaal: 'b', basis: null, github: 'c' }), 'conflict');
});

test('bepaalToestand', () => {
  assert.equal(bepaalToestand({ lokaal: 'a', basis: 'a' }), 'gelijk');
  assert.equal(bepaalToestand({ lokaal: 'b', basis: 'a' }), 'gewijzigd');
  assert.equal(bepaalToestand({ lokaal: 'b', basis: null }), 'enkel-lokaal');
  assert.equal(bepaalToestand({ lokaal: 'a', basis: 'a', github: 'c' }), 'github-nieuwer');
  assert.equal(bepaalToestand({ lokaal: 'b', basis: 'a', github: 'c' }), 'conflict');
  assert.equal(bepaalToestand({ lokaal: 'b', basis: 'a', github: 'b' }), 'gewijzigd');
});

test('kiesBijLaden: verouderde Pages-versie na opslaan wint niet van de werkkopie', () => {
  const nu = 1_000_000_000;
  // net opgeslagen: lokaal = basis = nieuw, Pages serveert nog oud
  let k = kiesBijLaden({ lokaal: 'nieuw', basis: 'nieuw', github: 'oud', basisTijd: nu - 60_000, nu });
  assert.equal(k.bron, 'werkkopie'); assert.equal(k.toestand, 'gelijk');
  // lang geleden opgeslagen en geen lokale wijzigingen: GitHub is echt nieuwer (ander toestel)
  k = kiesBijLaden({ lokaal: 'a', basis: 'a', github: 'b', basisTijd: nu - PAGES_VERTRAGING_MS - 1, nu });
  assert.equal(k.bron, 'github');
  // lokale wijzigingen én GitHub gewijzigd: werkkopie houden, conflict melden
  k = kiesBijLaden({ lokaal: 'x', basis: 'a', github: 'b', basisTijd: 0, nu });
  assert.deepEqual([k.bron, k.toestand], ['werkkopie', 'conflict']);
  // API-versie is gezaghebbend, ook binnen het venster
  k = kiesBijLaden({ lokaal: 'a', basis: 'a', github: 'b', basisTijd: nu, nu, gezaghebbend: true });
  assert.equal(k.bron, 'github');
  // geen werkkopie
  assert.equal(kiesBijLaden({ lokaal: null, basis: null, github: 'b' }).bron, 'github');
  // GitHub onbereikbaar
  k = kiesBijLaden({ lokaal: 'x', basis: 'a', github: null, nu });
  assert.deepEqual([k.bron, k.toestand], ['werkkopie', 'gewijzigd']);
});

test('leesOntwerpTekst: JSON-fout, schemafout, geldig', () => {
  assert.match(leesOntwerpTekst('{kapot').fouten[0], /Geen geldige JSON/);
  const m = voorbeeld(); m.muren[0].status = 'gesloopt';
  const r = leesOntwerpTekst(JSON.stringify(m));
  assert.equal(r.ok, false); assert.ok(r.fouten.some((f) => f.includes('muren[0].status')));
  assert.match(leesOntwerpTekst(JSON.stringify({ ...voorbeeld(), schemaVersie: 99 })).fouten[0], /schemaVersie 99/);
  assert.equal(leesOntwerpTekst(voorbeeldTekst).ok, true);
});

test('werkIndexBij', () => {
  const idx = { ontwerpen: [{ id: 'voorbeeld', naam: 'Voorbeeldhuis' }] };
  assert.equal(werkIndexBij(idx, 'voorbeeld', 'Voorbeeldhuis').gewijzigd, false);
  assert.deepEqual(werkIndexBij(idx, 'voorbeeld', 'Andere').index.ontwerpen, [{ id: 'voorbeeld', naam: 'Andere' }]);
  assert.equal(werkIndexBij(idx, 'b', 'B').index.ontwerpen.length, 2);
  assert.equal(idx.ontwerpen.length, 1, 'origineel ongewijzigd');
});

// ---------------------------------------------------------------- localStorage

test('LokaleOpslag: werkt met kapotte of volle opslag zonder te gooien', () => {
  for (const s of [new NepStorage({ kapot: true }), new NepStorage({ vol: true }), null]) {
    const o = new LokaleOpslag(s);
    assert.equal(o.beschikbaar, false);
    assert.equal(o.bewaarWerkkopie('x', { model: {} }), false);
    assert.equal(o.werkkopie('x'), null);
    assert.deepEqual(o.werkkopieIds(), []);
    assert.equal(o.token(), null);
    assert.deepEqual(o.instellingen(), { owner: 'jvanderborght', repo: 'verbouwing-3d', branch: 'main' });
  }
});

test('LokaleOpslag: werkkopieën, instellingen, token', () => {
  const s = new NepStorage();
  const o = new LokaleOpslag(s);
  assert.equal(o.beschikbaar, true);
  o.bewaarWerkkopie('a', { model: { id: 'a' }, basisHash: 'h' });
  o.bewaarWerkkopie('b', { model: { id: 'b' } });
  s.setItem(SLEUTELS.ontwerp('kapot'), '{niet json');
  assert.deepEqual(o.werkkopieIds().sort(), ['a', 'b', 'kapot']);
  assert.equal(o.werkkopie('kapot'), null);
  assert.equal(o.werkkopie('a').basisHash, 'h');
  o.bewaarInstellingen({ owner: ' iemand ', repo: '', branch: 'dev', extra: 'x' });
  assert.deepEqual(o.instellingen(), { owner: 'iemand', repo: 'verbouwing-3d', branch: 'dev' });
  o.bewaarToken('  tok  ');
  assert.equal(o.token(), 'tok');
  o.wisToken();
  assert.equal(o.token(), null);
});

// ---------------------------------------------------------------- GitHub-client

test('GitHubClient: leest base64 UTF-8 en stuurt token enkel als Authorization-header', async () => {
  const gh = nepGithub({ bestanden: { 'designs/a.json': '{"naam":"Één"}' } });
  const c = new GitHubClient({ owner: 'o', repo: 'r', token: 'TOK', fetch: gh.fetch });
  const r = await c.lees('designs/a.json');
  assert.equal(r.tekst, '{"naam":"Één"}');
  assert.ok(r.sha);
  assert.equal(gh.log[0].headers.Authorization, 'Bearer TOK');
  assert.ok(!gh.log[0].url.includes('TOK'));
  assert.equal(await c.lees('designs/bestaat-niet.json'), null);
});

test('GitHubClient: foutmeldingen in het Nederlands, zonder token', async () => {
  const url = 'https://api.github.com/repos/o/r/contents/designs/a.json';
  for (const [st, soort] of [[401, 'auth'], [403, 'rechten'], [409, 'conflict'], [422, 'conflict'], [500, 'onbekend']]) {
    const gh = nepGithub({ status: { [`PUT ${url}`]: st } });
    const c = new GitHubClient({ owner: 'o', repo: 'r', token: 'GEHEIM', fetch: gh.fetch });
    await assert.rejects(c.schrijf('designs/a.json', '{}', { bericht: 'x' }), (e) => {
      assert.ok(e instanceof GitHubFout); assert.equal(e.soort, soort); assert.equal(e.status, st);
      assert.ok(!e.message.includes('GEHEIM'));
      return true;
    });
  }
  const netwerk = new GitHubClient({ owner: 'o', repo: 'r', token: 't', fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(netwerk.lees('x'), (e) => e.soort === 'netwerk' && /verbinding/.test(e.message));
  const zonder = new GitHubClient({ owner: 'o', repo: 'r', fetch: nepGithub().fetch });
  await assert.rejects(zonder.schrijf('x', 'y', { bericht: 'b' }), (e) => e.soort === 'geen-token');
  assert.equal(githubFoutmelding(403, { limietOp: true }).soort, 'limiet');
  assert.match(githubFoutmelding(404).melding, /Niet gevonden/);
});

test('GitHubClient: PUT stuurt sha mee en UTF-8-correcte base64', async () => {
  const gh = nepGithub({ bestanden: { 'designs/a.json': 'oud' } });
  const c = new GitHubClient({ owner: 'o', repo: 'r', token: 't', fetch: gh.fetch });
  const { sha } = await c.lees('designs/a.json');
  await c.schrijf('designs/a.json', 'nieuw – é', { sha, bericht: 'Ontwerp a bijgewerkt vanuit de app' });
  assert.equal(gh.repo['designs/a.json'], 'nieuw – é');
  const put = JSON.parse(gh.log.at(-1).body);
  assert.equal(put.sha, sha); assert.equal(put.branch, 'main'); assert.match(put.message, /bijgewerkt vanuit de app/);
  await assert.rejects(c.schrijf('designs/a.json', 'x', { sha, bericht: 'b' }), (e) => e.soort === 'conflict', 'oude sha → conflict');
});

// ---------------------------------------------------------------- variantbeheer

test('VariantBeheer: laadt voorbeeld via Pages, geen werkkopie zolang niets wijzigt', async () => {
  const { b, opslag } = maakBeheer();
  assert.equal((await b.laadIndex()).ok, true);
  const r = await b.open('voorbeeld');
  assert.equal(r.ok, true);
  assert.equal(b.model.id, 'voorbeeld');
  assert.equal(b.toestand('voorbeeld'), 'gelijk');
  assert.equal(opslag.werkkopie('voorbeeld'), null);
});

test('VariantBeheer: hernoemen (undo-baar), dupliceren, werkkopie overleeft herladen', async () => {
  const storage = new NepStorage();
  const { b } = maakBeheer({ storage });
  await b.laadIndex(); await b.open('voorbeeld');
  assert.equal(b.hernoem('Mijn huis').ok, true);
  assert.equal(b.model.naam, 'Mijn huis'); assert.equal(b.model.id, 'voorbeeld');
  assert.equal(b.toestand('voorbeeld'), 'gewijzigd');
  b.geschiedenis.undo();
  assert.equal(b.model.naam, 'Voorbeeldhuis');
  assert.equal(b.toestand('voorbeeld'), 'gelijk');
  b.geschiedenis.redo();
  const d = b.dupliceer('Variant B – zolder');
  assert.equal(d.id, 'variant-b-zolder');
  assert.equal(b.model.basis, 'voorbeeld');
  assert.equal(b.toestand('variant-b-zolder'), 'enkel-lokaal');

  // "herladen": nieuw beheer op dezelfde storage
  const { b: b2 } = maakBeheer({ storage });
  await b2.laadIndex();
  assert.deepEqual(b2.lijst().map((o) => o.id), ['voorbeeld', 'variant-b-zolder']);
  await b2.open('voorbeeld');
  assert.equal(b2.model.naam, 'Mijn huis');
  assert.equal(b2.toestand('voorbeeld'), 'gewijzigd');
  assert.equal(b2.laatsteId(), 'voorbeeld');
});

test('VariantBeheer: nieuw, verwijderen, export, import met id-conflict', async () => {
  const { b, opslag } = maakBeheer();
  await b.laadIndex(); await b.open('voorbeeld');
  const n = b.nieuw('Leeg');
  assert.equal(n.id, 'leeg'); assert.equal(b.model.muren.length, 0); assert.equal(b.model.basis, null);
  b.verwijder('leeg');
  assert.equal(opslag.werkkopie('leeg'), null);
  await b.open('voorbeeld');
  const e = b.exporteer();
  assert.equal(e.bestandsnaam, 'voorbeeld.json');
  assert.equal(e.tekst, naarJson(voorbeeld()));

  assert.equal(b.controleerImport('{kapot').ok, false);
  const c = b.controleerImport(e.tekst);
  assert.equal(c.ok, true); assert.equal(c.conflict, true); assert.equal(c.voorstelId, 'voorbeeldhuis');
  const r = await b.importeer(c.model, { wijze: 'nieuw', nieuwId: c.voorstelId });
  assert.equal(r.ok, true); assert.equal(b.model.id, 'voorbeeldhuis');
  // vervangen is undo-baar
  await b.open('voorbeeld');
  const ander = applyOps(voorbeeld(), [{ op: 'ontwerp', velden: { naam: 'Geïmporteerd' } }]).model;
  await b.importeer(ander, { wijze: 'vervang' });
  assert.equal(b.model.naam, 'Geïmporteerd');
  b.geschiedenis.undo();
  assert.equal(b.model.naam, 'Voorbeeldhuis');
});

test('VariantBeheer: opslaan naar GitHub (bestaand → contents PUT, nieuw → één commit met index)', async () => {
  const { b, gh } = maakBeheer();
  await b.laadIndex(); await b.open('voorbeeld');
  b.geschiedenis.toepassen([{ op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: 320 } }]);
  let r = await b.opslaanNaarGithub();
  assert.equal(r.ok, true, r.melding);
  assert.equal(JSON.parse(gh.repo['designs/voorbeeld.json']).muren[0].dikte, 320);
  assert.equal(gh.repo['designs/voorbeeld.json'], naarJson(b.model));
  assert.equal(b.toestand('voorbeeld'), 'gelijk');
  assert.equal(gh.log.filter((l) => l.methode === 'PUT').length, 1);

  b.dupliceer('Variant C');
  r = await b.opslaanNaarGithub();
  assert.equal(r.ok, true, r.melding);
  assert.ok(gh.repo['designs/variant-c.json']);
  assert.deepEqual(JSON.parse(gh.repo['designs/index.json']).ontwerpen.map((o) => o.id), ['voorbeeld', 'variant-c']);
  assert.equal(gh.log.filter((l) => l.methode === 'PATCH').length, 1, 'index + ontwerp in één commit');
  assert.equal(b.toestand('variant-c'), 'gelijk');

  // nogmaals opslaan zonder wijziging: niets te doen
  const voor = gh.commits;
  r = await b.opslaanNaarGithub();
  assert.match(r.melding, /Al gelijk/); assert.equal(gh.commits, voor);
});

test('VariantBeheer: opslaan weigert ongeldig model, zonder token, en vraagt bij conflict', async () => {
  const { b, gh } = maakBeheer();
  await b.laadIndex(); await b.open('voorbeeld');
  b.geschiedenis.vastleggen({ ...b.model, naam: '' });
  let r = await b.opslaanNaarGithub();
  assert.equal(r.ok, false); assert.match(r.melding, /ongeldig/);
  b.geschiedenis.undo();

  // ander toestel wijzigde GitHub intussen
  const ander = applyOps(voorbeeld(), [{ op: 'ontwerp', velden: { naam: 'Van ander toestel' } }]).model;
  gh.repo['designs/voorbeeld.json'] = naarJson(ander);
  b.hernoem('Van dit toestel');
  let gevraagd = 0;
  r = await b.opslaanNaarGithub({ bevestigOverschrijven: async () => { gevraagd++; return false; } });
  assert.equal(gevraagd, 1); assert.equal(r.ok, false); assert.equal(r.soort, 'geannuleerd');
  assert.equal(JSON.parse(gh.repo['designs/voorbeeld.json']).naam, 'Van ander toestel');
  r = await b.opslaanNaarGithub({ bevestigOverschrijven: async () => true });
  assert.equal(r.ok, true, r.melding);
  assert.equal(JSON.parse(gh.repo['designs/voorbeeld.json']).naam, 'Van dit toestel');

  const { b: zonder } = maakBeheer({ token: null });
  await zonder.laadIndex(); await zonder.open('voorbeeld');
  r = await zonder.opslaanNaarGithub();
  assert.equal(r.soort, 'geen-token');
});

test('VariantBeheer: ophalen van GitHub — neem GitHub, behoud lokaal, conflictkeuze', async () => {
  const { b, gh } = maakBeheer();
  await b.laadIndex(); await b.open('voorbeeld');
  const zet = (naam) => { gh.repo['designs/voorbeeld.json'] = naarJson(applyOps(voorbeeld(), [{ op: 'ontwerp', velden: { naam } }]).model); };

  // enkel GitHub gewijzigd → zonder vragen overnemen (undo-baar)
  zet('GitHub 1');
  let r = await b.ophalenVanGithub({ kiesBijConflict: async () => assert.fail('geen conflict verwacht') });
  assert.equal(r.ok, true); assert.equal(b.model.naam, 'GitHub 1'); assert.equal(b.toestand('voorbeeld'), 'gelijk');
  assert.ok(b.geschiedenis.kanUndo);

  // enkel lokaal gewijzigd → lokaal blijft
  b.hernoem('Lokaal 1');
  r = await b.ophalenVanGithub({ kiesBijConflict: async () => assert.fail('geen conflict verwacht') });
  assert.equal(b.model.naam, 'Lokaal 1'); assert.equal(b.toestand('voorbeeld'), 'gewijzigd');

  // beide gewijzigd → vragen
  zet('GitHub 2');
  r = await b.ophalenVanGithub({ kiesBijConflict: async () => 'lokaal' });
  assert.equal(b.model.naam, 'Lokaal 1'); assert.equal(b.toestand('voorbeeld'), 'gewijzigd');
  zet('GitHub 3');
  r = await b.ophalenVanGithub({ kiesBijConflict: async () => 'github' });
  assert.equal(b.model.naam, 'GitHub 3'); assert.equal(b.toestand('voorbeeld'), 'gelijk');
  b.geschiedenis.undo();
  assert.equal(b.model.naam, 'Lokaal 1', 'lokale versie terug te halen met undo');
  assert.ok(gh.log.every((l) => !l.url.startsWith('designs/') || l.methode === 'GET'));
});

test('VariantBeheer: na opslaan serveert Pages nog de oude versie → werkkopie blijft', async () => {
  const storage = new NepStorage();
  let tijd = 5_000_000;
  const gh = nepGithub({ bestanden: { 'designs/index.json': indexTekst, 'designs/voorbeeld.json': voorbeeldTekst } });
  const { b } = maakBeheer({ gh, storage, nu: () => tijd });
  await b.laadIndex(); await b.open('voorbeeld');
  b.hernoem('Opgeslagen');
  assert.equal((await b.opslaanNaarGithub()).ok, true);
  // gh.pages is nog de oude inhoud (Pages niet herbouwd)
  tijd += 60_000;
  const { b: b2 } = maakBeheer({ gh, storage, nu: () => tijd });
  await b2.laadIndex(); await b2.open('voorbeeld');
  assert.equal(b2.model.naam, 'Opgeslagen');
  assert.equal(b2.toestand('voorbeeld'), 'gelijk');
});

test('VariantBeheer: ontwerp in index maar nog niet op Pages → via API', async () => {
  const nieuw = { ...leegModel('nieuw-ding', 'Nieuw ding') };
  const gh = nepGithub({
    bestanden: { 'designs/index.json': '{"ontwerpen":[{"id":"nieuw-ding","naam":"Nieuw ding"}]}', 'designs/nieuw-ding.json': naarJson(nieuw) },
    pages: { 'designs/index.json': '{"ontwerpen":[{"id":"nieuw-ding","naam":"Nieuw ding"}]}' },
  });
  const { b } = maakBeheer({ gh });
  await b.laadIndex();
  const r = await b.open('nieuw-ding');
  assert.equal(r.ok, true, r.melding);
  assert.equal(b.model.naam, 'Nieuw ding');
});

test('VariantBeheer: ongeldig ontwerp op de site wordt niet geladen', async () => {
  const kapot = voorbeeld(); kapot.niveaus = [];
  const gh = nepGithub({ bestanden: { 'designs/index.json': indexTekst, 'designs/voorbeeld.json': JSON.stringify(kapot) } });
  const { b } = maakBeheer({ gh });
  await b.laadIndex();
  const r = await b.open('voorbeeld');
  assert.equal(r.ok, false);
  assert.match(r.melding, /ongeldig/);
});

test('VariantBeheer: volle localStorage meldt opslag-fout maar werkt verder', async () => {
  const storage = new NepStorage();
  const { b } = maakBeheer({ storage });
  await b.laadIndex(); await b.open('voorbeeld');
  const meldingen = [];
  b.opWijziging((s) => meldingen.push(s));
  storage.vol = true;
  assert.equal(b.hernoem('X').ok, true);
  assert.equal(b.model.naam, 'X');
  assert.ok(meldingen.includes('opslag-fout'));
});

// ---------------------------------------------------------------- eigenschappen (DOM-vrije delen)

test('eigenschappen: zoekElement, niveauVanElement, elementUitPad, veldRijen', () => {
  const m = voorbeeld();
  const o = m.openingen[0];
  assert.equal(zoekElement(m, o.id).collectie, 'openingen');
  assert.equal(zoekElement(m, 'bestaat-niet'), null);
  assert.equal(niveauVanElement(m, o.id), m.muren.find((x) => x.id === o.muur).niveau);
  assert.equal(niveauVanElement(m, 'N1'), 'N1');
  assert.equal(elementUitPad(m, 'muren[2].dikte'), m.muren[2].id);
  assert.equal(elementUitPad(m, 'niveaus'), null);
  const rijen = veldRijen(m, 'muren', m.muren[0]);
  assert.deepEqual(rijen.map((r) => r.veld), ['id', 'niveau', 'start', 'eind', 'dikte', 'hoogte', 'status']);
  assert.equal(rijen.find((r) => r.veld === 'dikte').soort, 'getal');
  assert.equal(rijen.find((r) => r.veld === 'status').soort, 'keuze');
  assert.equal(rijen.find((r) => r.veld === 'niveau').soort, 'ref');
  const vloer = veldRijen(m, 'vloeren', m.vloeren[0]).find((r) => r.veld === 'contour');
  assert.match(vloer.tekst, /punten · .* m²/);
});

test('modelHash is stabiel en onafhankelijk van witruimte in het bronbestand', () => {
  const a = voorbeeld();
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(modelHash(a), modelHash(b));
  assert.notEqual(modelHash(a), modelHash({ ...a, naam: 'x' }));
});
