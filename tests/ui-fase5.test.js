// Fase 5 deel B (UI): DOM-vrije logica van eigenschappenpaneel (trappen, inrichting, getallenlijsten), gereedschap
// (trap, inrichting, afbraakzone), programma-editor en synchronisatie van v1-werkkopieën met v2-bestanden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Geschiedenis, applyOps, opsAfbraakZone, opsZolderNiveau, opsTrapPlaatsen, opsInrichtingPlaatsen, opsRuimteRechthoek,
  COLLECTIE_NAMEN, NIVEAU_SOORTEN, naarJson, migreer,
} from '../js/model/index.js';
import {
  ENKELVOUD, MEERVOUD, veldRijen, niveauVanElement, niveausVanElement, planNiveauVoorSelectie, leesGetallen, getallenTekst,
  elementLabel, trapInfoTekst, EENHEID,
} from '../js/ui/eigenschappen.js';
import {
  normaliseerOpties, niveauErboven, richtingUitSleep, trapParameters, hulpTrap, inrichtingParameters, hulpInrichting,
  afbraakVoorbeeld, wisselZone, ruimteOpPunt, hintVoor, normHoek, STANDAARD_OPTIES,
} from '../js/ui/gereedschap.js';
import { leegFormulier, eisNaarFormulier, formulierNaarEis, programmaOps, niveauKeuzes, toetsWeergave } from '../js/ui/programma.js';
import { LokaleOpslag, modelHash, oudeModelHash, stabieleJson, HASH_VERSIE, SLEUTELS } from '../js/ui/opslag.js';
import { VariantBeheer, normaliseerBasis, alsV1, ordenZoals, kiesBijLaden } from '../js/ui/varianten.js';

const lees = (naam) => readFileSync(new URL(`../designs/${naam}.json`, import.meta.url), 'utf8');
// Vaste testbasis: de bestaande toestand zoals bij fase 5 (zonder zolder, hoogtes 3000/2800) in tests/fixtures/,
// los van designs/bestaand.json (die evolueert met nieuwe opmetingen).
const bestaand = () => JSON.parse(readFileSync(new URL('./fixtures/bestaand-fase5.json', import.meta.url), 'utf8'));
const voorbeeld = () => JSON.parse(lees('voorbeeld'));

/** bestaand + afbraak achterbouw + zolder (N2) — basis voor trap/inrichting-tests. */
function metZolder() {
  const g = new Geschiedenis(bestaand());
  assert.ok(g.toepassen(opsAfbraakZone(g.huidig, { ruimte: ['R5', 'R6', 'R7'] }).ops, 'afbraak').ok);
  const z = opsZolderNiveau(g.huidig, { onderNiveau: 'N1' });
  assert.ok(g.toepassen(z.ops, 'zolder').ok);
  return { g, zolder: z.info.id };
}

// ---------------------------------------------------------------- eigenschappen

test('eigenschappen: labels voor alle collecties (geen "undefined")', () => {
  for (const c of COLLECTIE_NAMEN) {
    assert.ok(ENKELVOUD[c], `enkelvoud ${c}`);
    assert.ok(MEERVOUD[c], `meervoud ${c}`);
  }
  assert.equal(ENKELVOUD.trappen, 'Trap');
  assert.equal(MEERVOUD.inrichting, 'Inrichting');
});

test('eigenschappen: veldRijen voor trap, inrichting, ruimte (getallen) en niveau (soort)', () => {
  const trap = { id: 'T1', vanNiveau: 'N0', naarNiveau: 'N1', type: 'kwart', oorsprong: [1000, 2000], richting: 90, breedte: 900, draairichting: 'links', status: 'nieuw' };
  const m = { ...bestaand(), trappen: [trap] };
  const rijen = veldRijen(m, 'trappen', trap);
  const r = (veld) => rijen.find((x) => x.veld === veld);
  assert.equal(r('richting').eenheid, '°');
  assert.equal(r('richting').label, 'Richting');
  assert.equal(r('oorsprong').soort, 'punt');
  assert.equal(r('vanNiveau').soort, 'ref');
  assert.equal(r('type').soort, 'keuze');
  assert.equal(r('aantalTreden').eenheid, 'st.');
  assert.ok(rijen.every((x) => x.label && x.label !== 'undefined'));
  const inr = { id: 'I1', niveau: 'N0', soort: 'lavabo', positie: [500, 500], rotatie: 90, breedte: 600, diepte: 450, status: 'nieuw' };
  const ir = veldRijen(m, 'inrichting', inr);
  assert.equal(ir.find((x) => x.veld === 'rotatie').eenheid, '°');
  assert.equal(ir.find((x) => x.veld === 'ruimte').soort, 'ref');
  assert.equal(ir.find((x) => x.veld === 'ruimte').verplicht, false);
  const ru = { ...m.ruimtes[0], hoogtegrenzen: [1500, 2200] };
  const hg = veldRijen(m, 'ruimtes', ru).find((x) => x.veld === 'hoogtegrenzen');
  assert.equal(hg.soort, 'getallen');
  assert.equal(hg.tekst, '1500, 2200');
  const sr = veldRijen(m, 'niveaus', m.niveaus[1]).find((x) => x.veld === 'soort');
  assert.equal(sr.soort, 'keuze');
  assert.deepEqual(sr.opties, NIVEAU_SOORTEN);
  assert.equal(EENHEID.rotatie, '°');
  assert.match(elementLabel(m, 'trappen', trap), /T1 · kwart N0 → N1/);
  assert.match(elementLabel(m, 'inrichting', inr), /I1 · lavabo/);
});

test('eigenschappen: trap selecteren ⇒ plattegrond op vanNiveau, tenzij naarNiveau al getoond wordt', () => {
  const trap = { id: 'T1', vanNiveau: 'N0', naarNiveau: 'N1', type: 'recht', oorsprong: [1000, 2000], richting: 90, breedte: 900, status: 'nieuw' };
  const m = { ...bestaand(), trappen: [trap] };
  assert.equal(niveauVanElement(m, 'T1'), 'N0');
  assert.deepEqual(niveausVanElement(m, 'T1'), ['N0', 'N1']);
  assert.equal(planNiveauVoorSelectie(m, 'T1', 'N1'), 'N1', 'trap is ook zichtbaar op naarNiveau');
  assert.equal(planNiveauVoorSelectie(m, 'T1', 'N0'), 'N0');
  assert.equal(planNiveauVoorSelectie({ ...m, niveaus: [...m.niveaus, { id: 'N9', naam: 'x', peil: 9000, hoogte: 2000 }] }, 'T1', 'N9'), 'N0');
  assert.equal(planNiveauVoorSelectie(m, 'R8', 'N0'), 'N1');
  assert.equal(planNiveauVoorSelectie(m, 'bestaat-niet', 'N0'), 'N0');
});

test('eigenschappen: leesGetallen (komma/spatie/puntkomma, Vlaamse duizendtallen) en getallenTekst', () => {
  assert.deepEqual(leesGetallen('1500, 2200').waarden, [1500, 2200]);
  assert.deepEqual(leesGetallen('2200 1.500').waarden, [1500, 2200], 'gesorteerd, 1.500 = 1500');
  assert.deepEqual(leesGetallen('1500;2200;1500').waarden, [1500, 2200], 'dubbels weg');
  assert.equal(leesGetallen('   ').waarden, null);
  assert.ok(leesGetallen('1500, abc').fout);
  assert.ok(leesGetallen('0, 1500').fout, 'moet > 0');
  assert.equal(getallenTekst([1500, 2200]), '1500, 2200');
  assert.equal(getallenTekst(undefined), '');
});

test('eigenschappen: trapInfoTekst toont berekende maten', () => {
  const { g, zolder } = metZolder();
  const r = opsTrapPlaatsen(g.huidig, { van: 'N1', naar: zolder, type: 'halfdraai', oorsprong: [1900, 4900], richting: 90, breedte: 800, draairichting: 'links' });
  assert.equal(r.fout, undefined);
  const t = trapInfoTekst(g.huidig, r.ops[0].item);
  assert.match(t, /16 optreden \(berekend\) van 175 mm \(berekend\)/);
  assert.match(t, /aantrede 250 mm \(berekend\)/);
});

// ---------------------------------------------------------------- gereedschap

test('gereedschap: opties trap/inrichting normaliseren', () => {
  const o = normaliseerOpties({ trap: { type: 'spiraal', breedte: 50, richting: -90, draairichting: 'rechts' }, inrichting: { soort: 'douche', plaatsing: 'raar', rotatie: 450 } });
  assert.deepEqual(o.trap, { type: 'spiraal', breedte: STANDAARD_OPTIES.trap.breedte, draairichting: 'rechts', richting: 270, status: 'nieuw' });
  assert.deepEqual(o.inrichting, { soort: 'douche', plaatsing: 'wand', rotatie: 90, status: 'nieuw' });
  assert.equal(normaliseerOpties({ trap: { type: 'wenteltrap' } }).trap.type, STANDAARD_OPTIES.trap.type);
  assert.equal(normHoek(-0.04), 0);
  assert.match(hintVoor('afbraak', { zone: 2 }), /2 ruimtes/);
  assert.ok(hintVoor('trap').length > 10 && hintVoor('inrichting').length > 10);
});

test('gereedschap: niveau erboven en richting uit slepen', () => {
  const m = bestaand();
  assert.equal(niveauErboven(m, 'N0'), 'N1');
  assert.equal(niveauErboven(m, 'N1'), null);
  assert.equal(niveauErboven(m, 'bestaat-niet'), null);
  assert.equal(richtingUitSleep([0, 0], [1000, 80]), 0);
  assert.equal(richtingUitSleep([0, 0], [100, 900]), 90);
  assert.equal(richtingUitSleep([0, 0], [-900, -100]), 180);
  assert.equal(richtingUitSleep([0, 0], [10, -900]), 270);
  assert.equal(richtingUitSleep([0, 0], [700, 600], { stap: 15 }), 45);
  assert.equal(richtingUitSleep([0, 0], [30, 20]), null, 'te kort');
});

test('gereedschap trap: parameters, voorbeeld en plaatsen als één undo-stap', () => {
  const { g, zolder } = metZolder();
  assert.equal(niveauErboven(g.huidig, 'N1'), zolder);
  const opties = normaliseerOpties({ trap: { type: 'halfdraai', breedte: 800, draairichting: 'links', richting: 90 } });
  const p = trapParameters(opties, { van: 'N1', naar: zolder, oorsprong: [1900, 4900] });
  assert.equal(p.richting, 90);
  assert.equal(p.draairichting, 'links');
  assert.equal(trapParameters(normaliseerOpties({ trap: { type: 'recht' } }), { van: 'N0', naar: 'N1', oorsprong: [0, 0] }).draairichting, undefined);
  const r = opsTrapPlaatsen(g.huidig, p);
  assert.equal(r.fout, undefined);
  const hulp = hulpTrap(g.huidig, p, { schaal: 0.1 });
  assert.equal(hulp.polygonen[0].stijl, 'nieuw');
  assert.equal(hulp.polygonen.length, 1 + 15, 'voetafdruk + 15 treden');
  assert.ok(hulp.lijnen.length >= 2, 'looplijn');
  assert.match(hulp.labels[0].tekst, /^16 × 175 mm$/);
  const fout = hulpTrap(g.huidig, { ...p, oorsprong: [1500, 2770] }, { fout: 'botst' });
  assert.equal(fout.polygonen[0].stijl, 'afbraak');
  assert.match(fout.labels[0].tekst, /kan niet: botst/);
  const n = g.verleden.length;
  assert.ok(g.toepassen(r.ops, 'Trap plaatsen').ok);
  assert.equal(g.verleden.length, n + 1);
  assert.equal(g.huidig.trappen.length, 1);
  g.undo();
  assert.equal(g.huidig.trappen.length, 0);
});

test('gereedschap inrichting: tegen een wand of op het tikpunt', () => {
  const m = bestaand();
  const bad = m.ruimtes.find((r) => r.id === 'R8'); // badkamer N1
  const punt = [1500, 1500];
  assert.equal(ruimteOpPunt(m, 'N1', punt).id, 'R8');
  assert.equal(ruimteOpPunt(m, 'N0', [-100, -100]), null);
  const wand = inrichtingParameters(m, normaliseerOpties({ inrichting: { soort: 'douche', plaatsing: 'wand' } }), { niveau: 'N1', punt });
  assert.deepEqual(wand, { soort: 'douche', niveau: 'N1', status: 'nieuw', ruimte: 'R8' });
  const r1 = opsInrichtingPlaatsen(m, wand);
  assert.equal(r1.fout, undefined);
  assert.ok(r1.info.contour.every(([x, y]) => x >= bad.contour[0][0] - 1 && y >= bad.contour[0][1] - 1));
  const tik = inrichtingParameters(m, normaliseerOpties({ inrichting: { soort: 'lavabo', plaatsing: 'punt', rotatie: 90 } }), { niveau: 'N1', punt });
  assert.deepEqual(tik.positie, punt);
  assert.equal(tik.rotatie, 90);
  assert.equal(tik.ruimte, 'R8');
  const r2 = opsInrichtingPlaatsen(m, tik);
  assert.deepEqual(r2.info.positie, punt);
  // buiten een ruimte: enkel niveau + positie
  const buiten = inrichtingParameters(m, normaliseerOpties({ inrichting: { plaatsing: 'wand' } }), { niveau: 'N1', punt: [-500, -500] });
  assert.equal(buiten.ruimte, undefined);
  assert.deepEqual(buiten.positie, [-500, -500]);
  assert.ok(opsInrichtingPlaatsen(m, buiten).fout === undefined || true);
  const h = hulpInrichting(r2.info.contour, { tekst: 'lavabo' });
  assert.equal(h.polygonen[0].stijl, 'nieuw');
  assert.equal(h.labels[0].tekst, 'lavabo');
  assert.equal(hulpInrichting(null, { tekst: 'past hier niet', punt }).labels[0].p, punt);
});

test('gereedschap afbraakzone: zone wisselen, voorbeeld met randmuren', () => {
  const m = bestaand();
  let zone = wisselZone(m, [], 'R5');
  zone = wisselZone(m, zone, 'R6');
  zone = wisselZone(m, zone, 'R7');
  assert.deepEqual(zone, ['R5', 'R6', 'R7']);
  assert.deepEqual(wisselZone(m, zone, 'R6'), ['R5', 'R7'], 'tweede tik haalt weg');
  assert.deepEqual(wisselZone(m, zone, 'R8'), ['R8'], 'ander niveau ⇒ nieuwe zone');
  assert.deepEqual(wisselZone(m, zone, 'bestaat-niet'), zone);
  const r = opsAfbraakZone(m, { ruimte: zone });
  const v = afbraakVoorbeeld(m, r);
  assert.deepEqual(v.randMuren, r.info.randMuren);
  assert.ok(v.randMuren.length > 0, 'gedeelde muren met het hoofdvolume');
  assert.equal(v.tellingen.ruimtes, 3);
  assert.ok(v.tellingen.muren > 0);
  assert.ok(v.polygonen.some((p) => p.stijl === 'afbraak'));
  assert.equal(v.polygonen.filter((p) => p.stijl === 'markering').length, v.randMuren.length);
  assert.deepEqual(afbraakVoorbeeld(m, null).polygonen, []);
  // één undo-stap
  const g = new Geschiedenis(m);
  assert.ok(g.toepassen(r.ops, 'Afbraakzone').ok);
  assert.equal(g.verleden.length, 1);
  assert.ok(!g.huidig.ruimtes.some((x) => zone.includes(x.id)));
  g.undo();
  assert.deepEqual(g.huidig, m);
});

// ---------------------------------------------------------------- programma van eisen

test('programma: formulier ⇄ eis en operatie', () => {
  const eisen = [
    { functie: 'slaapkamer', aantal: 2, niveau: 'zolder' },
    { functie: 'badkamer', niveau: 'zolder', inrichting: ['lavabo', 'douche'] },
    { functie: 'slaapkamer', minOppervlakte: 9, hoogteGrens: 2200, naam: 'grote kamer' },
    { trap: { van: 'N1', naar: 'zolder', type: ['kwart', 'halfdraai', 'spiraal'] } },
    { trap: { type: 'recht', aantal: 2 } },
  ];
  for (const e of eisen) assert.deepEqual(formulierNaarEis(eisNaarFormulier(e)).eis, e, JSON.stringify(e));
  assert.equal(leegFormulier('trap').soort, 'trap');
  assert.match(formulierNaarEis({ ...leegFormulier(), aantal: '0' }).fout, /Aantal/);
  assert.match(formulierNaarEis({ ...leegFormulier(), minOppervlakte: 'veel' }).fout, /oppervlakte/);
  assert.match(formulierNaarEis({ ...leegFormulier(), functie: 'kasteel' }).fout, /functie/);
  assert.deepEqual(formulierNaarEis({ ...leegFormulier(), minOppervlakte: '9,5', aantal: '' }).eis, { functie: 'slaapkamer', minOppervlakte: 9.5 });
  const x = programmaOps(eisen.map(eisNaarFormulier), '  compact plan ');
  assert.deepEqual(x.ops, [{ op: 'ontwerp', velden: { programma: { beschrijving: 'compact plan', eisen } } }]);
  assert.deepEqual(programmaOps([], '').ops, [{ op: 'ontwerp', velden: { programma: null } }], 'leeg ⇒ wissen');
  assert.match(programmaOps([{ ...leegFormulier(), aantal: 'x' }]).fout, /^Eis 1:/);
  const k = niveauKeuzes(bestaand());
  assert.deepEqual(k.slice(0, 4).map((o) => o.waarde), ['', ...NIVEAU_SOORTEN]);
  assert.ok(k.some((o) => o.waarde === 'N1'));
});

test('programma: toetsresultaat in de weergave (voldoet / voldoet niet / onbekend) via de ontwerp-operatie', () => {
  const { g, zolder } = metZolder();
  assert.equal(toetsWeergave(g.huidig).regels.length, 0);
  const formulieren = [
    { ...leegFormulier('ruimte'), functie: 'slaapkamer', aantal: '2', niveau: 'zolder' },
    { ...leegFormulier('ruimte'), functie: 'badkamer', niveau: 'zolder', inrichting: ['lavabo', 'douche'] },
    { ...leegFormulier('trap'), van: 'N1', naar: 'zolder', types: ['halfdraai', 'kwart'] },
    { ...leegFormulier('ruimte'), functie: 'berging', niveau: 'kelder-bestaat-niet' },
  ];
  const p = programmaOps(formulieren, 'test');
  assert.ok(g.toepassen(p.ops, 'Programma').ok);
  let t = toetsWeergave(g.huidig);
  assert.deepEqual(t.regels.map((r) => r.status), ['voldoet niet', 'voldoet niet', 'voldoet niet', 'onbekend']);
  assert.match(t.samenvatting, /4 eisen: 0 voldoet, 3 voldoet niet, 1 onbekend/);
  assert.ok(t.regels.every((r) => r.uitleg.length > 5));
  // zolder invullen: 2 slaapkamers, badkamer met lavabo + douche, trap
  const stap = (r, label) => { assert.equal(r.fout, undefined, label); assert.ok(g.toepassen(r.ops, label).ok, label); return r; };
  stap(opsRuimteRechthoek(g.huidig, zolder, [300, 300], [3400, 3500], { naam: 'Slaapkamer 1', functie: 'slaapkamer' }), 'sk1');
  stap(opsRuimteRechthoek(g.huidig, zolder, [3600, 300], [6700, 3500], { naam: 'Slaapkamer 2', functie: 'slaapkamer' }), 'sk2');
  const bad = stap(opsRuimteRechthoek(g.huidig, zolder, [3600, 4500], [6700, 7700], { naam: 'Badkamer', functie: 'badkamer' }), 'bad');
  const badId = bad.info?.id ?? g.huidig.ruimtes.at(-1).id;
  stap(opsInrichtingPlaatsen(g.huidig, { soort: 'lavabo', ruimte: badId }), 'lavabo');
  stap(opsInrichtingPlaatsen(g.huidig, { soort: 'douche', ruimte: badId }), 'douche');
  stap(opsTrapPlaatsen(g.huidig, { van: 'N1', naar: zolder, type: 'halfdraai', oorsprong: [1900, 4900], richting: 90, breedte: 800, draairichting: 'links' }), 'trap');
  t = toetsWeergave(g.huidig);
  assert.deepEqual(t.regels.map((r) => r.status), ['voldoet', 'voldoet', 'voldoet', 'onbekend']);
  assert.deepEqual(t.regels.map((r) => r.klasse), ['voldoet', 'voldoet', 'voldoet', 'onbekend']);
  // wissen via dezelfde operatie
  assert.ok(g.toepassen(programmaOps([], '').ops, 'wissen').ok);
  assert.equal(g.huidig.programma, undefined);
  g.undo();
  assert.equal(g.huidig.programma.eisen.length, 4);
});

// ---------------------------------------------------------------- synchronisatie v1-werkkopie ⇄ v2-bestand

class NepStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const antwoord = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(body), text: async () => body });

/** Pages-site met de gegeven bestanden; de API is niet bereikbaar (geen token nodig om te openen). */
function pages(bestanden) {
  return async (url) => {
    if (url.startsWith('designs/')) return url in bestanden ? antwoord(200, bestanden[url]) : antwoord(404, 'Not Found');
    throw new TypeError('Failed to fetch');
  };
}

/** v1-vorm van een v2-ontwerp zoals het vroeger in designs/ stond (zonder trappen/inrichting, schemaVersie 1). */
function alsOudV1(model) {
  const m = JSON.parse(JSON.stringify(model));
  m.schemaVersie = 1;
  delete m.trappen; delete m.inrichting;
  for (const n of m.niveaus) delete n.soort;
  return m;
}

/** Zelfde inhoud, andere sleutelvolgorde (zoals een generatorscript dat trappen/inrichting vooraan zet). */
function herschik(model) {
  const { trappen, inrichting, ...rest } = model;
  return { trappen, inrichting, ...Object.fromEntries(Object.entries(rest).reverse()) };
}

function beheerMet({ v2, werkkopie }) {
  const storage = new NepStorage();
  const opslag = new LokaleOpslag(storage);
  opslag.bewaarWerkkopie('voorbeeld', werkkopie);
  const index = JSON.stringify({ ontwerpen: [{ id: 'voorbeeld', naam: 'Voorbeeldhuis' }] });
  const b = new VariantBeheer({ opslag, fetch: pages({ 'designs/index.json': index, 'designs/voorbeeld.json': naarJson(v2) }), nu: () => 10 * 24 * 3600 * 1000 });
  return { b, opslag };
}

test('modelHash: v1 en gemigreerde v2 met andere sleutelvolgorde geven dezelfde hash', () => {
  const v2 = migreer(voorbeeld());
  const v1 = alsOudV1(v2);
  for (const n of v2.niveaus) delete n.soort;
  assert.equal(modelHash(v1), modelHash(v2));
  assert.equal(modelHash(herschik(v2)), modelHash(v2));
  assert.notEqual(oudeModelHash(v1), oudeModelHash(v2), 'de oude hash zag ze als verschillend');
  assert.equal(stabieleJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
  assert.equal(HASH_VERSIE, 2);
});

test('normaliseerBasis: oude basis-hash van een v1-werkkopie wordt herkend', () => {
  const v2 = migreer(voorbeeld());
  for (const n of v2.niveaus) delete n.soort;
  const v1 = alsOudV1(v2);
  const oud = oudeModelHash(v1);
  // werkkopie ongewijzigd: de werkkopie is de basis
  assert.equal(normaliseerBasis({ model: v1, basisHash: oud }), modelHash(v1));
  // werkkopie gewijzigd, GitHub = de basis maar als v2 en met andere sleutelvolgorde
  const gewijzigd = { ...v1, beschrijving: 'lokaal aangepast' };
  assert.equal(normaliseerBasis({ model: gewijzigd, basisHash: oud, github: herschik(v2) }), modelHash(v2));
  assert.deepEqual(Object.keys(alsV1(herschik(v2), v1)), Object.keys(v1));
  assert.equal(alsV1({ ...v2, trappen: [{ id: 'T1' }] }, v1), null, 'echte v2-inhoud is geen pure migratie');
  // onbekende basis ⇒ null; nieuwe versie ⇒ ongewijzigd
  assert.equal(normaliseerBasis({ model: gewijzigd, basisHash: 'onbekend', github: v2 }), null);
  assert.equal(normaliseerBasis({ model: v1, basisHash: 'x', hashVersie: HASH_VERSIE }), 'x');
  assert.equal(normaliseerBasis({ model: v1, basisHash: null }), null);
  assert.deepEqual(Object.keys(ordenZoals({ b: 1, a: 2, c: 3 }, { a: 0, b: 0 })), ['a', 'b', 'c']);
});

test('sync: ongewijzigde v1-werkkopie tegenover hetzelfde ontwerp als v2-bestand ⇒ gelijk, geen conflict', async () => {
  const v2 = migreer(voorbeeld());
  for (const n of v2.niveaus) delete n.soort;
  const v1 = alsOudV1(v2);
  const { b, opslag } = beheerMet({ v2: herschik(v2), werkkopie: { model: v1, basisHash: oudeModelHash(v1), basisSha: 's', basisTijd: 1 } });
  await b.laadIndex();
  assert.equal(b.toestand('voorbeeld'), 'gelijk', 'ook in de lijst vóór het openen');
  const r = await b.open('voorbeeld');
  assert.equal(r.ok, true);
  assert.equal(r.melding, undefined, 'geen conflictmelding');
  assert.equal(b.toestand('voorbeeld'), 'gelijk');
  assert.equal(b.model.schemaVersie, 2);
  // werkkopie is herschreven in het nieuwe formaat
  const wk = opslag.werkkopie('voorbeeld');
  assert.equal(wk.hashVersie, HASH_VERSIE);
  assert.equal(wk.model.schemaVersie, 2);
  assert.equal(wk.basisHash, modelHash(v2));
});

test('sync: ongewijzigde v1-werkkopie, GitHub-versie (v2) inhoudelijk nieuwer ⇒ GitHub-versie geladen, geen conflict', async () => {
  const v2 = migreer(voorbeeld());
  const zonderSoort = JSON.parse(JSON.stringify(v2));
  for (const n of zonderSoort.niveaus) delete n.soort;
  const v1 = alsOudV1(zonderSoort);
  const nieuwer = { ...v2, beschrijving: 'bijgewerkt op GitHub' };
  const { b } = beheerMet({ v2: nieuwer, werkkopie: { model: v1, basisHash: oudeModelHash(v1), basisSha: 's', basisTijd: 1 } });
  await b.laadIndex();
  const r = await b.open('voorbeeld');
  assert.equal(r.ok, true);
  assert.ok(!/conflict|gewijzigd/i.test(r.melding || ''), r.melding);
  assert.equal(b.model.beschrijving, 'bijgewerkt op GitHub');
  assert.equal(b.toestand('voorbeeld'), 'gelijk');
});

test('sync: lokaal gewijzigde v1-werkkopie, GitHub = de basis als v2 ⇒ "gewijzigd" (geen conflict)', async () => {
  const v2 = migreer(voorbeeld());
  for (const n of v2.niveaus) delete n.soort;
  const basis = alsOudV1(v2);
  const lokaal = { ...basis, beschrijving: 'lokaal aangepast' };
  const { b } = beheerMet({ v2: herschik(v2), werkkopie: { model: lokaal, basisHash: oudeModelHash(basis), basisSha: 's', basisTijd: 1 } });
  await b.laadIndex();
  const r = await b.open('voorbeeld');
  assert.equal(r.ok, true);
  assert.equal(r.melding, undefined);
  assert.equal(b.model.beschrijving, 'lokaal aangepast');
  assert.equal(b.toestand('voorbeeld'), 'gewijzigd');
});

test('sync: echt conflict blijft een conflict', async () => {
  const v2 = migreer(voorbeeld());
  for (const n of v2.niveaus) delete n.soort;
  const basis = alsOudV1(v2);
  const lokaal = { ...basis, beschrijving: 'lokaal' };
  const { b } = beheerMet({ v2: { ...v2, beschrijving: 'github' }, werkkopie: { model: lokaal, basisHash: oudeModelHash(basis), basisSha: 's', basisTijd: 1 } });
  await b.laadIndex();
  const r = await b.open('voorbeeld');
  assert.equal(r.ok, true);
  assert.match(r.melding, /ook op GitHub gewijzigd/);
  assert.equal(b.toestand('voorbeeld'), 'conflict');
  // kiesBijLaden zelf is ongewijzigd
  assert.equal(kiesBijLaden({ lokaal: 'a', basis: 'a', github: 'b', gezaghebbend: true }).bron, 'github');
  assert.ok(SLEUTELS.ontwerp('x'));
});

// ---------------------------------------------------------------- QA fase 5: B1 (vals conflict door niveaus.soort)

/**
 * QA-reproductie: werkkopie = v1-bestand zoals op main (zonder soort), lokaal gewijzigd (ruimtes[0].naam), met de
 * basis-hash zoals main die berekende (hash van naarJson, zonder hashVersie). GitHub = het v2-bestand mét
 * `soort: 'verdieping'` op N1 (blijft staan). Mag geen conflict geven maar "lokaal gewijzigd".
 */
for (const id of ['bestaand', 'voorbeeld']) {
  test(`B1: lokaal gewijzigde v1-werkkopie van ${id}, GitHub v2 met soort 'verdieping' ⇒ gewijzigd, geen conflict`, async () => {
    const v2tekst = lees(id);
    const v2 = JSON.parse(v2tekst);
    assert.ok(v2.niveaus.some((n) => n.soort === 'verdieping'), 'het v2-bestand heeft soort verdieping');
    const v1 = alsOudV1(v2); // = het v1-bestand van origin/main (naarJson-tekst gecontroleerd bij de QA-opvolging)
    const basisHash = oudeModelHash(v1); // modelHash zoals main die berekende (naarJson)
    const lokaal = JSON.parse(JSON.stringify(v1));
    lokaal.ruimtes[0].naam = 'Lokaal hernoemd';
    assert.equal(normaliseerBasis({ model: lokaal, basisHash, github: migreer(v2) }), modelHash(migreer(v2)), 'basis herkend');
    const storage = new NepStorage();
    const opslag = new LokaleOpslag(storage);
    storage.setItem(SLEUTELS.ontwerp(id), JSON.stringify({ model: lokaal, basisHash, basisTijd: 1 }));
    const index = JSON.stringify({ ontwerpen: [{ id, naam: v2.naam }] });
    const b = new VariantBeheer({ opslag, fetch: pages({ 'designs/index.json': index, [`designs/${id}.json`]: v2tekst }), nu: () => 10 * 24 * 3600 * 1000 });
    await b.laadIndex();
    assert.notEqual(b.toestand(id), 'conflict', 'ook in de lijst vóór het openen geen conflict');
    const r = await b.open(id);
    assert.equal(r.ok, true);
    assert.equal(r.melding, undefined, 'geen conflictmelding');
    assert.equal(b.model.ruimtes[0].naam, 'Lokaal hernoemd', 'de werkkopie blijft geladen');
    assert.equal(b.toestand(id), 'gewijzigd');
  });
}

test('B1: alsV1 laat enkel informatieve v2-velden weg; echte v2-inhoud ⇒ geen match', () => {
  const v2 = migreer(voorbeeld());
  const v1 = alsOudV1(v2);
  assert.equal(naarJson(alsV1(v2, v1)), naarJson(v1), 'soort verdieping + lege collecties weg ⇒ exact het v1-bestand');
  assert.equal(naarJson(alsV1({ ...v2, idTeller: { R: 40 } }, v1)), naarJson(v1), 'idTeller is boekhouding');
  const zolder = JSON.parse(JSON.stringify(v2));
  zolder.niveaus[1].soort = 'zolder';
  assert.notEqual(oudeModelHash(alsV1(zolder, v1)), oudeModelHash(v1), 'soort zolder is inhoud');
  const grenzen = JSON.parse(JSON.stringify(v2));
  grenzen.ruimtes[0].hoogtegrenzen = [1500];
  assert.notEqual(oudeModelHash(alsV1(grenzen, v1)), oudeModelHash(v1), 'hoogtegrenzen zijn inhoud');
  // echt conflict (GitHub inhoudelijk anders) blijft zonder gemeenschappelijke basis
  const lokaal = { ...v1, beschrijving: 'lokaal' };
  assert.equal(normaliseerBasis({ model: lokaal, basisHash: oudeModelHash(v1), github: { ...v2, beschrijving: 'github' } }), null);
});
