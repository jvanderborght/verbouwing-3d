// Tests voor schemaVersie 2 (fase 5): migratie, schema, trappen, vrije hoogte, validator, bewerkingen, programma, kerncijfers,
// en de demonstratie tools/voorbeelden/zolder-programma.ops.json op designs/bestaand.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEMA_VERSIE, COLLECTIES, COLLECTIE_NAMEN, VELDEN, leegModel, migreer, v1naarV2, validate, applyOps, diff,
  polygoonOppervlakte, begrenzing, trapMaten, trapGeometrie, trapVoetafdruk, trapgat, trapLoophoogte,
  vrijeHoogte, hoogtelijnen, oppervlaktePerHoogteband, INSTELLINGEN_STANDAARD, metInstellingen, instelling,
  opsMuurSplitsen, opsAfbraakZone, opsTrapPlaatsen, opsInrichtingPlaatsen, opsZolderNiveau, toetsProgramma, valideerProgramma,
  inrichtingContour, polygonenOverlappen,
} from '../js/model/index.js';
import { kerncijfers, raming, vergelijkingsRijen } from '../js/metrics/index.js';
import { leesOntwerpTekst } from '../js/ui/varianten.js';

const lees = (f) => JSON.parse(readFileSync(new URL(`../designs/${f}`, import.meta.url), 'utf8'));
const bestaand = () => migreer(lees('bestaand.json'));
const demoOps = () => JSON.parse(readFileSync(new URL('../tools/voorbeelden/zolder-programma.ops.json', import.meta.url), 'utf8'));
const dichtbij = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const el = (m, c, id) => m[c].find((x) => x.id === id);

function pas(model, r) {
  assert.equal(r.fout, undefined, r.fout);
  const a = applyOps(model, r.ops);
  assert.ok(a.ok, JSON.stringify(a.fouten));
  return a.model;
}

/** v1-versie van een v2-ontwerp (zoals oude bestanden/werkkopieën). */
function naarV1(m) {
  const k = structuredClone(m);
  k.schemaVersie = 1;
  delete k.trappen;
  delete k.inrichting;
  for (const n of k.niveaus) delete n.soort;
  return k;
}

/**
 * Doos 7 × 8 m (vloer = buitenzijde), gelijkvloers 3 m + verdieping 2,8 m met zadeldak 45° (nok langs x, op y = 4000).
 * Verdieping heeft een vloer; zolder komt via opsZolderNiveau.
 */
function huis({ dak = { type: 'zadel', helling: 45, nokrichting: 'x' } } = {}) {
  const m = leegModel('huis', 'Huis');
  m.niveaus = [{ id: 'N0', naam: 'GV', peil: 0, hoogte: 3000 }, { id: 'N1', naam: 'V1', peil: 3000, hoogte: 2800, vloerdikte: 300, soort: 'verdieping' }];
  const rh = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  m.muren = [
    ['N0', [150, 150], [6850, 150]], ['N0', [6850, 150], [6850, 7850]], ['N0', [6850, 7850], [150, 7850]], ['N0', [150, 7850], [150, 150]],
    ['N1', [150, 150], [6850, 150]], ['N1', [6850, 150], [6850, 7850]], ['N1', [6850, 7850], [150, 7850]], ['N1', [150, 7850], [150, 150]],
  ].map(([niveau, start, eind], i) => ({ id: `M${i + 1}`, niveau, start, eind, dikte: 300, status: 'bestaand' }));
  m.vloeren = [
    { id: 'V1', niveau: 'N0', contour: rh(0, 0, 7000, 8000), dikte: 300, status: 'bestaand' },
    { id: 'V2', niveau: 'N1', contour: rh(0, 0, 7000, 8000), dikte: 300, status: 'bestaand' },
  ];
  m.ruimtes = [
    { id: 'R1', niveau: 'N0', naam: 'Leef', functie: 'leefruimte', contour: rh(300, 300, 6700, 7700) },
    { id: 'R2', niveau: 'N1', naam: 'Slaap', functie: 'slaapkamer', contour: rh(300, 300, 6700, 7700) },
  ];
  m.daken = [{ id: 'D1', niveau: 'N1', contour: rh(0, 0, 7000, 8000), overstek: 0, dikte: 300, status: 'bestaand', ...dak }];
  assert.ok(validate(m).geldig, JSON.stringify(validate(m).fouten));
  return m;
}
function huisMetZolder(opties) {
  const m = huis(opties);
  return pas(m, opsZolderNiveau(m, { onderNiveau: 'N1' }));
}

// ───────────────────────────── schema en migratie ─────────────────────────────

test('schema v2: versie, collecties en velden', () => {
  assert.equal(SCHEMA_VERSIE, 2);
  assert.equal(COLLECTIES.trappen, 'T');
  assert.equal(COLLECTIES.inrichting, 'I');
  assert.ok(COLLECTIE_NAMEN.includes('trappen') && COLLECTIE_NAMEN.includes('inrichting'));
  assert.ok(VELDEN.niveaus.some(([n]) => n === 'soort'));
  assert.ok(VELDEN.ruimtes.some(([n, t]) => n === 'hoogtegrenzen' && t === 'getallen'));
  const m = leegModel();
  assert.equal(m.schemaVersie, 2);
  assert.deepEqual([m.trappen, m.inrichting], [[], []]);
  assert.ok(validate(m).geldig);
});

test('migratie v1 → v2: designs blijven gelijk, origineel ongewijzigd, niets verloren', () => {
  for (const f of ['bestaand.json', 'voorbeeld.json']) {
    const v2 = lees(f);
    const v1 = naarV1(v2);
    const kopie = structuredClone(v1);
    assert.equal(validate(v1).geldig, false, 'v1 valideert niet rechtstreeks');
    const m = migreer(v1);
    assert.deepEqual(v1, kopie, 'origineel niet gemuteerd');
    assert.equal(m.schemaVersie, 2);
    assert.ok(validate(m).geldig, JSON.stringify(validate(m).fouten));
    // alles van v1 zit er nog in
    for (const c of ['niveaus', 'muren', 'openingen', 'ruimtes', 'vloeren', 'daken']) assert.deepEqual(m[c], v1[c]);
    assert.deepEqual([m.trappen, m.inrichting], [[], []]);
    // diff met het echte v2-bestand: enkel de (informatieve) niveausoort
    assert.ok(diff(v2, m).every((d) => d.collectie === 'niveaus' && d.velden.every((v) => v.veld === 'soort')));
  }
});

test('migratie: v2 blijft hetzelfde object, nieuwere versie ⇒ fout, bestaande trappen/inrichting blijven', () => {
  const m = lees('voorbeeld.json');
  assert.equal(migreer(m), m);
  assert.throws(() => migreer({ ...m, schemaVersie: 3 }), /schemaVersie 3/);
  const v1 = { ...naarV1(m), trappen: [], inrichting: [] };
  assert.deepEqual(v1naarV2(v1).trappen, []);
  assert.equal(migreer(null), null);
});

test('migratie: v1-werkkopie/import laadt via leesOntwerpTekst (app) als v2', () => {
  const r = leesOntwerpTekst(JSON.stringify(naarV1(lees('bestaand.json'))));
  assert.equal(r.ok, true, r.fouten.join('\n'));
  assert.equal(r.model.schemaVersie, 2);
  assert.deepEqual(r.model.trappen, []);
});

test('operaties: cascade, verplaatsen en programma via ontwerp-operatie', () => {
  let m = huisMetZolder();
  m = pas(m, opsTrapPlaatsen(m, { van: 'N1', naar: 'N2', type: 'recht', oorsprong: [1000, 2000], richting: 0, breedte: 900 }));
  m = pas(m, opsInrichtingPlaatsen(m, { ruimte: 'R2', soort: 'bed', positie: [4000, 4000] }));
  const a = applyOps(m, [{ op: 'verplaatsen', collectie: 'trappen', id: 'T1', dx: 100, dy: 50 }, { op: 'verplaatsen', collectie: 'inrichting', id: 'I1', dx: -100, dy: 0 }]);
  assert.ok(a.ok);
  assert.deepEqual(el(a.model, 'trappen', 'T1').oorsprong, [1100, 2050]);
  assert.deepEqual(el(a.model, 'inrichting', 'I1').positie, [3900, 4000]);
  // ruimte weg ⇒ inrichting.ruimte gewist (element blijft)
  const b = applyOps(m, [{ op: 'verwijderen', collectie: 'ruimtes', id: 'R2' }]);
  assert.ok(b.ok);
  assert.equal(el(b.model, 'inrichting', 'I1').ruimte, undefined);
  // niveau weg ⇒ trappen van/naar en inrichting erop weg
  const c = applyOps(m, [{ op: 'verwijderen', collectie: 'niveaus', id: 'N2' }]);
  assert.ok(c.ok);
  assert.equal(c.model.trappen.length, 0);
  assert.equal(c.model.inrichting.length, 1);
  const d = applyOps(m, [{ op: 'verwijderen', collectie: 'niveaus', id: 'N1' }]);
  assert.ok(d.ok);
  assert.deepEqual([d.model.trappen.length, d.model.inrichting.length], [0, 0]);
  // programma
  const p = { eisen: [{ functie: 'slaapkamer', aantal: 1 }] };
  const e = applyOps(m, [{ op: 'ontwerp', velden: { programma: p } }]);
  assert.ok(e.ok);
  assert.deepEqual(e.model.programma, p);
  assert.ok(diff(m, e.model).some((x) => x.velden?.[0].veld === 'programma'));
  assert.equal(applyOps(m, [{ op: 'ontwerp', velden: { programma: { eisen: [{ functie: 'zwembad' }] } } }]).ok, false);
});

// ───────────────────────────── instellingen ─────────────────────────────

test('instellingen: grenzen standaard leeg (geen normen), werkwaarden gelabeld, overschrijfbaar', () => {
  for (const [k, v] of Object.entries(INSTELLINGEN_STANDAARD.trap)) {
    assert.equal(v.bron, null, k);
    if (v.soort === 'grens') assert.equal(v.waarde, null, `${k} is een grens en moet standaard leeg zijn`);
    else assert.match(v.uitleg, /geen norm/);
  }
  for (const v of Object.values(INSTELLINGEN_STANDAARD.inrichting)) assert.match(v.uitleg, /geen norm/);
  const i = metInstellingen({ trap: { maxOptrede: 190, doelOptrede: { waarde: 170, bron: 'test' } } });
  assert.equal(instelling(i, 'trap.maxOptrede'), 190);
  assert.equal(instelling(i, 'trap.doelOptrede'), 170);
  assert.equal(instelling(i, 'trap.aantrede'), 250);
  assert.equal(instelling(INSTELLINGEN_STANDAARD, 'trap.maxOptrede'), null);
});

// ───────────────────────────── trappen ─────────────────────────────

test('trapMaten: aantal optreden uit hoogteverschil en werkwaarde, of uit opgegeven waarden', () => {
  const m = huisMetZolder();
  const t = { vanNiveau: 'N0', naarNiveau: 'N1', type: 'recht', oorsprong: [0, 0], richting: 0, breedte: 900 };
  let x = trapMaten(m, t);
  assert.deepEqual([x.hoogteverschil, x.aantalTreden, x.treden, x.aantrede], [3000, 17, 16, 250]); // 3000 / 180 ≈ 16,7 → 17
  dichtbij(x.optrede, 3000 / 17);
  assert.ok(x.berekend.aantalTreden && x.berekend.optrede && x.berekend.aantrede);
  x = trapMaten(m, { ...t, aantalTreden: 16, aantrede: 230 });
  assert.deepEqual([x.aantalTreden, x.optrede, x.aantrede, x.berekend.aantalTreden], [16, 187.5, 230, false]);
  x = trapMaten(m, { ...t, optrede: 200 });
  assert.deepEqual([x.aantalTreden, x.optrede], [15, 200]);
  x = trapMaten(m, t, { instellingen: metInstellingen({ trap: { doelOptrede: 150 } }) });
  assert.equal(x.aantalTreden, 20);
  assert.match(trapMaten(m, { ...t, type: 'kwart', aantalTreden: 3 }).fout, /Te weinig treden/);
});

test('trapVoetafdruk per type (recht, kwart, halfdraai, spiraal) en draairichting', () => {
  const basis = { aantalTreden: 16, aantrede: 250, breedte: 800, oorsprong: [1000, 1000], richting: 0 };
  // recht: 15 treden × 250 = 3750 lang, 800 breed, gecentreerd op de oorsprong
  let v = trapVoetafdruk({ ...basis, type: 'recht' });
  assert.deepEqual(begrenzing(v), { minX: 1000, minY: 600, maxX: 4750, maxY: 1400, breedte: 3750, diepte: 800 });
  // richting 90: langs +y
  v = trapVoetafdruk({ ...basis, type: 'recht', richting: 90 });
  assert.deepEqual([begrenzing(v).breedte, begrenzing(v).diepte], [800, 3750]);
  // kwart (3 draaitreden): 12 treden ⇒ vluchten 6 + 6 = 1500; L = (1500 + 800) × 800 + 1500 × 800
  v = trapVoetafdruk({ ...basis, type: 'kwart', draairichting: 'links' });
  dichtbij(polygoonOppervlakte(v), 2300 * 800 + 1500 * 800, 1);
  assert.deepEqual(begrenzing(v), { minX: 1000, minY: 600, maxX: 3300, maxY: 2900, breedte: 2300, diepte: 2300 });
  const r = trapVoetafdruk({ ...basis, type: 'kwart', draairichting: 'rechts' });
  assert.equal(begrenzing(r).maxY, 1400);
  assert.equal(begrenzing(r).minY, -900);
  // halfdraai (6 draaitreden): 9 treden ⇒ 5 + 4; U = vlucht 1 (1250) + draaizone (800 × 1600) + vlucht 2 (1000)
  v = trapVoetafdruk({ ...basis, type: 'halfdraai' });
  assert.deepEqual([begrenzing(v).breedte, begrenzing(v).diepte], [2050, 1600]);
  dichtbij(polygoonOppervlakte(v), 1250 * 800 + 800 * 1600 + 1000 * 800, 1);
  // spiraal: cirkel met diameter (standaard 2 × breedte)
  v = trapVoetafdruk({ ...basis, type: 'spiraal', diameter: 1600 });
  dichtbij(polygoonOppervlakte(v), Math.PI * 800 * 800, Math.PI * 800 * 800 * 0.01);
  assert.equal(begrenzing(trapVoetafdruk({ ...basis, type: 'spiraal' })).breedte, 1600);
  // zonder aantalTreden en zonder model: geen voetafdruk
  assert.equal(trapVoetafdruk({ ...basis, aantalTreden: undefined, type: 'recht' }), null);
});

test('trapGeometrie: n − 1 treden, oplopende z, treden binnen de voetafdruk; trapgat op naarNiveau', () => {
  const m = huisMetZolder();
  for (const type of ['recht', 'kwart', 'halfdraai', 'spiraal']) {
    const t = { vanNiveau: 'N1', naarNiveau: 'N2', type, oorsprong: [2000, 2000], richting: 0, breedte: 800, aantrede: 220 };
    const g = trapGeometrie(m, t);
    assert.equal(g.treden.length, g.maten.aantalTreden - 1, type);
    g.treden.forEach((x, i) => dichtbij(x.z, Math.round((i + 1) * g.maten.optrede * 10) / 10, 0.11));
    const som = g.treden.reduce((s, x) => s + polygoonOppervlakte(x.contour), 0);
    if (type !== 'spiraal') dichtbij(som, polygoonOppervlakte(g.voetafdruk), 5); // treden betegelen de voetafdruk
    assert.equal(trapgat(m, t).niveau, 'N2');
  }
});

// ───────────────────────────── vrije hoogte ─────────────────────────────

test('vrijeHoogte: zolder onder zadeldak, plafond = volgend niveau, trapgat zonder plafond', () => {
  const m = huisMetZolder();
  dichtbij(vrijeHoogte(m, 'N2', [3500, 4000]), 4000, 1e-6);   // nok: 4000 × tan 45°
  dichtbij(vrijeHoogte(m, 'N2', [3500, 1000]), 1000, 1e-6);
  dichtbij(vrijeHoogte(m, 'N2', [3500, 7500]), 500, 1e-6);
  dichtbij(vrijeHoogte(m, 'N1', [3500, 4000]), 2800 - 300, 1e-6); // onderkant zoldervloer (dikte 300)
  dichtbij(vrijeHoogte(m, 'N0', [3500, 4000]), 3000 - 300, 1e-6); // onderkant vloer V2
  // trapgat in de zoldervloer ⇒ op N1 geen plafond daar, wel het dak
  const t = pas(m, opsTrapPlaatsen(m, { van: 'N1', naar: 'N2', type: 'recht', oorsprong: [1000, 3000], richting: 0, breedte: 900 }));
  dichtbij(vrijeHoogte(t, 'N1', [2000, 3000]), 2800 + 3000, 1e-6);
  // zonder zolder: verdieping tot onder het dak
  dichtbij(vrijeHoogte(huis(), 'N1', [3500, 2000]), 2800 + 2000, 1e-6);
});

test('trapLoophoogte: loophoogte per trede onder het dak', () => {
  const m = huisMetZolder();
  const t = { id: 'T9', vanNiveau: 'N1', naarNiveau: 'N2', type: 'recht', oorsprong: [1000, 4000], richting: 0, breedte: 800, aantalTreden: 16, status: 'nieuw' };
  const lh = trapLoophoogte({ ...m, trappen: [t] }, t);
  assert.equal(lh.perTrede.length, 15);
  // langs de nok: bovengrens = 5800 + 4000; trede 15 op 3000 + 15 × 175 = 5625 ⇒ 4175
  dichtbij(lh.min, 9800 - (3000 + 15 * 175), 1e-6);
});

test('hoogtelijnen: zadel, lessenaar en schild', () => {
  let m = huisMetZolder();
  let h = hoogtelijnen(m, 'N2', [1500, 2200]);
  assert.equal(h.length, 2);
  const ys = (x) => x.lijnen.map((l) => l.map((p) => p[1])).flat().sort((a, b) => a - b);
  assert.deepEqual([...new Set(ys(h[0]))], [1500, 6500]);
  assert.deepEqual([...new Set(ys(h[1]))], [2200, 5800]);
  assert.equal(h[1].gebieden.length, 1);
  dichtbij(polygoonOppervlakte(h[1].gebieden[0]) / 1e6, 7 * 3.6, 7 * 0.05);
  // lessenaar 30°, hoge rand aan y-max: één lijn op y = h / tan 30°
  m = huisMetZolder({ dak: { type: 'lessenaar', helling: 30, nokrichting: 'x' } });
  h = hoogtelijnen(m, 'N2', [2000]);
  assert.equal(h[0].lijnen.length, 1);
  for (const p of h[0].lijnen[0]) dichtbij(p[1], 2000 / Math.tan(Math.PI / 6), 1.5);
  // schild 45°: gesloten lus (rechthoek ingekort met h aan alle zijden)
  m = huisMetZolder({ dak: { type: 'schild', helling: 45, nokrichting: 'x' } });
  h = hoogtelijnen(m, 'N2', [1000]);
  assert.equal(h[0].gebieden.length, 1);
  const b = begrenzing(h[0].lijnen.flat());
  dichtbij(b.minX, 1000, 2); dichtbij(b.maxX, 6000, 2); dichtbij(b.minY, 1000, 2); dichtbij(b.maxY, 7000, 2);
});

test('oppervlaktePerHoogteband: analytisch onder een zadeldak; som = netto', () => {
  const m = huisMetZolder();
  const r = { id: 'Rz', niveau: 'N2', naam: 'Z', functie: 'zolder', contour: [[300, 1000], [6700, 1000], [6700, 7000], [300, 7000]], hoogtegrenzen: [1500, 2200] };
  const o = oppervlaktePerHoogteband(m, r);
  // y-banden: <1500: 1000–1500 + 6500–7000 = 1000; 1500–2200: 2 × 700; ≥2200: 2200–5800 = 3600; × 6,4 m
  dichtbij(o.banden[0].m2, 6.4 * 1.0, 0.05);
  dichtbij(o.banden[1].m2, 6.4 * 1.4, 0.05);
  dichtbij(o.banden[2].m2, 6.4 * 3.6, 0.05);
  dichtbij(o.banden.reduce((s, b) => s + b.m2, 0), o.m2, 1e-9);
  assert.deepEqual(o.banden.map((b) => [b.van, b.tot]), [[0, 1500], [1500, 2200], [2200, null]]);
  assert.equal(oppervlaktePerHoogteband(m, 'bestaat-niet'), null);
});

// ───────────────────────────── validator ─────────────────────────────

test('validator: trappen', () => {
  const m = huisMetZolder();
  const t = { id: 'T1', vanNiveau: 'N1', naarNiveau: 'N2', type: 'kwart', oorsprong: [1000, 2000], richting: 0, breedte: 800, draairichting: 'links', status: 'nieuw' };
  const v = (x, opties) => validate({ ...m, trappen: [x] }, opties);
  assert.ok(v(t).geldig, JSON.stringify(v(t).fouten));
  assert.deepEqual(v(t).waarschuwingen, [], 'werkwaarden geven geen meldingen');
  assert.match(v({ ...t, vanNiveau: 'N2', naarNiveau: 'N1' }).fouten[0].melding, /boven/);
  assert.match(v({ ...t, naarNiveau: 'N1' }).fouten[0].melding, /verschillen/);
  assert.match(v({ ...t, oorsprong: [6000, 2000] }).fouten[0].melding, /buiten de vloer/);
  assert.match(v({ ...t, type: 'wenteltrap' }).fouten[0].melding, /ongeldig/);
  assert.match(v({ ...t, aantalTreden: 2.5 }).fouten[0].melding, /geheel getal/);
  assert.match(v({ ...t, aantalTreden: 3 }).fouten[0].melding, /Te weinig treden/);
  assert.match(v({ ...t, aantalTreden: 10, optrede: 100 }).waarschuwingen[0].melding, /wijkt af/);
  // grens uit gebruikersinstellingen ⇒ waarschuwing (geen fout)
  const g = v(t, { instellingen: { trap: { maxOptrede: { waarde: 170, bron: 'test' } } } });
  assert.ok(g.geldig);
  assert.match(g.waarschuwingen[0].melding, /Optrede 175 mm > ingestelde grens 170 mm \(test\)/);
  // muur op de verdieping in de weg ⇒ waarschuwing
  const w = validate({ ...m, trappen: [{ ...t, oorsprong: [200, 2000] }] });
  assert.ok(w.waarschuwingen.some((x) => /overlapt met muur M8/.test(x.melding)));
});

test('validator: inrichting, hoogtegrenzen en programma', () => {
  const m = huisMetZolder();
  const r = { id: 'R9', niveau: 'N2', naam: 'Bad', functie: 'badkamer', contour: [[300, 1000], [3000, 1000], [3000, 4000], [300, 4000]] };
  const d = { id: 'I1', niveau: 'N2', ruimte: 'R9', soort: 'douche', positie: [1000, 3500], rotatie: 0, breedte: 900, diepte: 900, status: 'nieuw' };
  const v = (x, extra = {}) => validate({ ...m, ruimtes: [...m.ruimtes, r], inrichting: [x], ...extra });
  assert.ok(v(d).geldig);
  assert.deepEqual(v(d).waarschuwingen, []);
  assert.match(v({ ...d, soort: 'jacuzzi' }).fouten[0].melding, /ongeldig/);
  assert.match(v({ ...d, positie: [7200, 3500] }).fouten[0].melding, /buiten de vloer/);
  assert.match(v({ ...d, positie: [3000, 3500] }).waarschuwingen[0].melding, /buiten ruimte R9/);
  assert.match(v({ ...d, ruimte: 'R1' }).fouten[0].melding, /ligt op niveau N0/);
  // douche van 2100 mm hoog op y ≈ 1500 (vrije hoogte 1050..1950) ⇒ waarschuwing
  assert.match(v({ ...d, positie: [1000, 1500], hoogte: 2100 }).waarschuwingen[0].melding, /vrije hoogte .* lager/);
  assert.ok(!v({ ...d, hoogte: 2100 }).waarschuwingen.length);
  // hoogtegrenzen
  assert.ok(validate({ ...m, ruimtes: [{ ...r, hoogtegrenzen: [1500, 2200] }] }).geldig);
  assert.match(validate({ ...m, ruimtes: [{ ...r, hoogtegrenzen: '1500' }] }).fouten[0].melding, /lijst getallen/);
  assert.match(validate({ ...m, ruimtes: [{ ...r, hoogtegrenzen: [0] }] }).fouten[0].melding, /> 0/);
  // programma
  assert.ok(validate({ ...m, programma: { eisen: [] } }).geldig);
  assert.equal(validate({ ...m, programma: { eisen: [{ functie: 'zwembad' }] } }).geldig, false);
  assert.equal(validate({ ...m, programma: [] }).geldig, false);
  const p = valideerProgramma({ eisen: [{ functie: 'badkamer', inrichting: ['sauna'] }, { trap: { type: ['ladder'] } }, { functie: 'berging', kleur: 'rood' }] });
  assert.equal(p.filter((x) => x.ernst === 'fout').length, 2);
  assert.equal(p.filter((x) => x.ernst === 'waarschuwing').length, 1);
});

test('vormen: inrichtingContour en polygonenOverlappen', () => {
  assert.deepEqual(inrichtingContour({ positie: [0, 0], rotatie: 0, breedte: 200, diepte: 100 }), [[-100, -50], [100, -50], [100, 50], [-100, 50]]);
  assert.deepEqual(begrenzing(inrichtingContour({ positie: [0, 0], rotatie: 90, breedte: 200, diepte: 100 })), { minX: -50, minY: -100, maxX: 50, maxY: 100, breedte: 100, diepte: 200 });
  const a = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.equal(polygonenOverlappen(a, a), true);
  assert.equal(polygonenOverlappen(a, [[100, 0], [200, 0], [200, 100], [100, 100]]), false); // raken
  assert.equal(polygonenOverlappen(a, [[50, -50], [60, -50], [60, 150], [50, 150]]), true);   // kruis
});

// ───────────────────────────── bewerkingen ─────────────────────────────

test('opsMuurSplitsen: openingen verhuizen; opening over de knip ⇒ fout', () => {
  const m = bestaand();
  // M4 (linker zijgevel, start y 140): O8 op 8690..10140 langs de muur
  const r = opsMuurSplitsen(m, 'M4', 7720);
  const n = pas(m, r);
  const [a, b] = r.info.ids;
  assert.equal(a, 'M4');
  assert.deepEqual(el(n, 'muren', a).eind, [140, 7860]);
  assert.deepEqual(el(n, 'muren', b).start, [140, 7860]);
  assert.deepEqual([el(n, 'openingen', 'O8').muur, el(n, 'openingen', 'O8').positie], [b, 970]);
  assert.equal(el(n, 'openingen', 'O7').muur, 'M4');
  assert.match(opsMuurSplitsen(m, 'M4', 6000).fout, /O7 ligt over de knip/);
  assert.match(opsMuurSplitsen(m, 'M4', 5).fout, /korter/);
  assert.ok(pas(m, opsMuurSplitsen(m, 'M4', [500, 300])));
});

test('opsAfbraakZone: achterbouw (via ruimtes) — gedeelde oude achtergevel blijft, zijgevels gesplitst', () => {
  const m = bestaand();
  const r = opsAfbraakZone(m, { ruimte: ['R5', 'R6', 'R7'] });
  const n = pas(m, r);
  for (const id of ['M3', 'M12', 'M13', 'O9', 'O10', 'O11', 'O17', 'O18', 'D2']) assert.equal(el(n, id.startsWith('O') ? 'openingen' : id.startsWith('D') ? 'daken' : 'muren', id).status, 'afbraak', id);
  for (const id of ['M5', 'M11', 'M2', 'M4']) assert.equal(el(n, 'muren', id).status, 'bestaand', id);
  assert.equal(el(n, 'openingen', 'O12').status, 'bestaand'); // doorgang in de oude achtergevel
  // zijgevels geknipt op de as van de oude achtergevel (y 7860)
  assert.deepEqual(el(n, 'muren', 'M2').eind, [6930, 7860]);
  assert.deepEqual(el(n, 'muren', 'M4').eind, [140, 7860]);
  const g = Object.fromEntries(r.info.gesplitst.map((x) => [x.id, x.nieuw]));
  for (const id of [g.M2[0], g.M4[0]]) { assert.equal(el(n, 'muren', id).status, 'afbraak'); assert.equal(el(n, 'muren', id).start[1], 7860); }
  assert.equal(el(n, 'openingen', 'O8').muur, g.M4[0]);
  assert.equal(el(n, 'openingen', 'O8').status, 'afbraak');
  // vloer gesplitst op dezelfde lijn
  assert.deepEqual(begrenzing(el(n, 'vloeren', 'V1').contour).maxY, 7860);
  assert.deepEqual(el(n, 'vloeren', g.V1[0]).status, 'afbraak');
  assert.deepEqual(begrenzing(el(n, 'vloeren', g.V1[0]).contour), { minX: 0, minY: 7860, maxX: 7000, maxY: 12500, breedte: 7000, diepte: 4640 });
  for (const id of ['R5', 'R6', 'R7']) assert.equal(el(n, 'ruimtes', id), undefined);
  assert.ok(r.info.randMuren.includes('M5'));
  // verdieping en hoofdvolume ongemoeid
  for (const x of n.muren.filter((y) => y.niveau === 'N1')) assert.equal(x.status, 'bestaand');
  assert.equal(el(n, 'daken', 'D1').status, 'bestaand');
});

test('opsAfbraakZone: garage 2 (via punt) — gedeelde muur met garage 1 blijft', () => {
  const m = bestaand();
  const r = opsAfbraakZone(m, { niveau: 'N0', punt: [-1500, 18000] });
  assert.deepEqual(r.info.ruimtes, ['R15']);
  const n = pas(m, r);
  for (const id of ['M27', 'M28', 'M29']) assert.equal(el(n, 'muren', id).status, 'afbraak', id);
  assert.equal(el(n, 'openingen', 'O30').status, 'afbraak');
  assert.deepEqual([el(n, 'vloeren', 'V4').status, el(n, 'daken', 'D4').status], ['afbraak', 'afbraak']);
  assert.deepEqual(el(n, 'muren', 'M23'), el(m, 'muren', 'M23')); // scheidingsmuur garage 1 ↔ 2
  assert.deepEqual([el(n, 'vloeren', 'V3').status, el(n, 'daken', 'D3').status], ['bestaand', 'bestaand']);
  assert.equal(r.info.gesplitst.length, 0);
  assert.deepEqual(r.info.randMuren, ['M23']);
  assert.equal(el(n, 'ruimtes', 'R15'), undefined);
  assert.ok(el(n, 'ruimtes', 'R13') && el(n, 'ruimtes', 'R14'));
});

test('opsAfbraakZone: ids, nieuwe elementen worden verwijderd, fouten', () => {
  const m = bestaand();
  const n = pas(m, opsAfbraakZone(m, { ids: ['M27', 'R15', 'V4'] }));
  assert.equal(el(n, 'muren', 'M27').status, 'afbraak');
  assert.equal(el(n, 'openingen', 'O30').status, 'afbraak');
  assert.equal(el(n, 'ruimtes', 'R15'), undefined);
  // nieuw element in de zone ⇒ verwijderd
  const v = lees('voorbeeld.json');
  const w = pas(v, opsAfbraakZone(v, { ids: ['M8', 'D2'] }));
  assert.equal(el(w, 'muren', 'M8'), undefined);
  assert.equal(el(w, 'openingen', 'O4'), undefined);
  assert.equal(el(w, 'daken', 'D2'), undefined);
  assert.match(opsAfbraakZone(m, { ids: ['X1'] }).fout, /niet gevonden/);
  assert.match(opsAfbraakZone(m, {}).fout, /ids, ruimte of punt/);
  assert.match(opsAfbraakZone(m, { niveau: 'N0', punt: [50000, 50000] }).fout, /geen ruimte/);
  assert.match(opsAfbraakZone(m, { ruimte: ['R5', 'R8'] }).fout, /hetzelfde niveau/);
});

test('opsZolderNiveau: niveau op de bovenkant, hoogte = nok, vloer = dakcontour', () => {
  const m = huis();
  const r = opsZolderNiveau(m, { onderNiveau: 'N1', naam: 'Zolder' });
  const n = pas(m, r);
  const z = el(n, 'niveaus', r.info.id);
  assert.deepEqual([z.peil, z.hoogte, z.soort, z.naam], [5800, 4000, 'zolder', 'Zolder']);
  assert.deepEqual(el(n, 'vloeren', r.info.vloeren[0]).contour, m.daken[0].contour);
  assert.equal(el(n, 'daken', 'D1').niveau, 'N1');
  assert.match(opsZolderNiveau(n, { onderNiveau: 'N1' }).fout, /al niveau/);
  assert.match(opsZolderNiveau(m, { onderNiveau: 'N0' }).fout, /al niveau/);
  const plat = huis({ dak: { type: 'plat', helling: 0 } });
  assert.match(opsZolderNiveau(plat, { onderNiveau: 'N1' }).fout, /geen hellend dak/);
});

test('opsTrapPlaatsen: plaatsen, en fouten (buiten vloer, muur, niveaus, loophoogte uit instellingen)', () => {
  const m = huisMetZolder();
  const p = { van: 'N1', naar: 'N2', type: 'halfdraai', oorsprong: [1500, 2000], richting: 0, breedte: 800 };
  const r = opsTrapPlaatsen(m, p);
  const n = pas(m, r);
  const t = el(n, 'trappen', r.info.id);
  assert.equal(t.draairichting, 'links');
  assert.equal(t.aantalTreden, undefined, 'aantalTreden blijft leeg (berekend)');
  assert.equal(r.info.maten.aantalTreden, 16);
  assert.equal(r.info.trapgat.niveau, 'N2');
  assert.ok(r.info.loophoogte > 0);
  assert.match(opsTrapPlaatsen(m, { ...p, oorsprong: [6000, 2000] }).fout, /past niet binnen de vloer/);
  assert.match(opsTrapPlaatsen(m, { ...p, oorsprong: [200, 2000] }).fout, /botst met muur/);
  assert.match(opsTrapPlaatsen(m, { ...p, van: 'N2', naar: 'N1' }).fout, /niet boven/);
  assert.match(opsTrapPlaatsen(m, { ...p, type: 'ladder' }).fout, /ongeldig/);
  // loophoogte enkel getoetst als de gebruiker een grens instelt; trap dwars op de nok, aan de lage kant
  const laag = { ...p, type: 'recht', oorsprong: [3000, 3500], richting: 90 };
  assert.equal(opsTrapPlaatsen(m, laag).fout, undefined);
  assert.match(opsTrapPlaatsen(m, { ...laag, instellingen: { trap: { minLoophoogte: 2500 } } }).fout, /Loophoogte .* lager dan de ingestelde 2500/);
});

test('opsInrichtingPlaatsen: met positie, automatisch tegen een wand, rekening houdend met vrije hoogte', () => {
  let m = huisMetZolder();
  m = pas(m, { ops: [{ op: 'toevoegen', collectie: 'ruimtes', item: { id: 'R9', niveau: 'N2', naam: 'Bad', functie: 'badkamer', contour: [[300, 1000], [3000, 1000], [3000, 4000], [300, 4000]] } }] });
  // automatisch zonder hoogte: eerste rand (y = 1000), rugzijde tegen de rand
  let r = opsInrichtingPlaatsen(m, { ruimte: 'R9', soort: 'lavabo' });
  assert.deepEqual([r.info.positie, r.info.rotatie], [[600, 1225], 0]);
  // met hoogte 2100: pas waar de vrije hoogte volstaat (y ≥ 2100)
  r = opsInrichtingPlaatsen(m, { ruimte: 'R9', soort: 'douche', hoogte: 2100 });
  const n = pas(m, r);
  assert.ok(begrenzing(r.info.contour).minY >= 2100 - 1, JSON.stringify(r.info));
  assert.ok(validate(n).waarschuwingen.length === 0);
  // tweede douche overlapt niet met de eerste
  const r2 = opsInrichtingPlaatsen(n, { ruimte: 'R9', soort: 'douche', hoogte: 2100 });
  assert.equal(polygonenOverlappen(r.info.contour, r2.info.contour), false);
  assert.match(opsInrichtingPlaatsen(m, { ruimte: 'R9', soort: 'douche', hoogte: 5000 }).fout, /Geen plek/);
  assert.match(opsInrichtingPlaatsen(m, { soort: 'douche' }).fout, /Onbekend niveau|positie of een ruimte/);
  assert.match(opsInrichtingPlaatsen(m, { ruimte: 'R9', soort: 'sauna' }).fout, /ongeldig/);
  const x = pas(m, opsInrichtingPlaatsen(m, { niveau: 'N2', soort: 'kast', positie: [5000, 4000], rotatie: -90 }));
  assert.equal(x.inrichting[0].rotatie, 270);
  assert.equal(x.inrichting[0].ruimte, undefined);
});

// ───────────────────────────── programma ─────────────────────────────

test('toetsProgramma: voldoet / voldoet niet / onbekend met uitleg', () => {
  let m = huisMetZolder();
  m = pas(m, { ops: [
    { op: 'toevoegen', collectie: 'ruimtes', item: { id: 'R9', niveau: 'N2', naam: 'Bad', functie: 'badkamer', contour: [[300, 2000], [3000, 2000], [3000, 6000], [300, 6000]] } },
    { op: 'toevoegen', collectie: 'inrichting', item: { id: 'I1', niveau: 'N2', ruimte: 'R9', soort: 'lavabo', positie: [1000, 4000], rotatie: 0, breedte: 600, diepte: 450, status: 'nieuw' } },
  ] });
  const p = { eisen: [
    { functie: 'badkamer', niveau: 'zolder', inrichting: ['lavabo'] },
    { functie: 'badkamer', inrichting: ['lavabo', 'douche'] },
    { functie: 'badkamer', minOppervlakte: 10 },
    { functie: 'badkamer', minOppervlakte: 10, hoogteGrens: 2200 }, // y 2200..5800 ⇒ 3,6 × 2,7 = 9,72 m²
    { functie: 'slaapkamer', niveau: 'kelder' },
    { functie: 'slaapkamer', niveau: 'N9' },
    { trap: { van: 'N1', naar: 'zolder' } },
    { functie: 'zwembad' },
  ] };
  const t = toetsProgramma(m, p);
  assert.deepEqual(t.resultaten.map((r) => r.status), ['voldoet', 'voldoet niet', 'voldoet', 'voldoet niet', 'voldoet niet', 'onbekend', 'voldoet niet', 'onbekend']);
  assert.match(t.resultaten[1].uitleg, /geen douche/);
  assert.match(t.resultaten[3].uitleg, /9,72 m² < 10,00 m²/);
  assert.match(t.resultaten[5].uitleg, /bestaat niet/);
  assert.deepEqual(t.samenvatting, { voldoet: 2, 'voldoet niet': 4, onbekend: 2 });
  assert.equal(toetsProgramma(m, null).fout, 'Geen programma van eisen.');
  // trap toevoegen ⇒ trap-eis voldoet; ander type gevraagd ⇒ voldoet niet
  const n = pas(m, opsTrapPlaatsen(m, { van: 'N1', naar: 'N2', type: 'spiraal', oorsprong: [5000, 4000], breedte: 700 }));
  assert.equal(toetsProgramma(n, { eisen: [{ trap: { van: 'N1', naar: 'zolder', type: ['spiraal'] } }] }).resultaten[0].status, 'voldoet');
  assert.equal(toetsProgramma(n, { eisen: [{ trap: { van: 'N1', naar: 'zolder', type: 'recht' } }] }).resultaten[0].status, 'voldoet niet');
  // grenzen uit de instellingen tellen mee
  assert.equal(toetsProgramma(n, { eisen: [{ trap: { naar: 'zolder' } }] }, { instellingen: { trap: { maxOptrede: 150 } } }).resultaten[0].status, 'voldoet niet');
});

// ───────────────────────────── kerncijfers ─────────────────────────────

test('kerncijfers v2: zoldervolume niet dubbel, hoogtebanden, trappen en inrichting; vergelijkingsrijen', () => {
  const zonder = huis();
  let m = huisMetZolder();
  m = pas(m, { ops: [
    { op: 'toevoegen', collectie: 'ruimtes', item: { id: 'R9', niveau: 'N2', naam: 'Zolderkamer', functie: 'slaapkamer', contour: [[300, 1000], [6700, 1000], [6700, 7000], [300, 7000]], hoogtegrenzen: [1500, 2200] } },
    { op: 'toevoegen', collectie: 'inrichting', item: { id: 'I1', niveau: 'N2', soort: 'bed', positie: [3500, 4000], rotatie: 0, breedte: 1600, diepte: 2000, status: 'nieuw' } },
    { op: 'toevoegen', collectie: 'inrichting', item: { id: 'I2', niveau: 'N2', soort: 'kast', positie: [5000, 4000], rotatie: 0, breedte: 1000, diepte: 600, status: 'afbraak' } },
  ] });
  m = pas(m, opsTrapPlaatsen(m, { van: 'N1', naar: 'N2', type: 'spiraal', oorsprong: [1500, 4000], breedte: 700 }));
  const k0 = kerncijfers(zonder), k = kerncijfers(m);
  dichtbij(k.volume.totaal, k0.volume.totaal, 1e-6);          // zolder zit in het dakvolume
  dichtbij(k.niveaus.find((n) => n.id === 'N2').volume, 7 * 8 * 4 / 2, 1e-6);
  assert.equal(k.volume.daken, 0);
  assert.equal(k.ruimtes.length, 1);
  dichtbij(k.hoogtebanden.find((b) => b.tot == null).m2, 6.4 * 3.6, 0.05);
  assert.deepEqual(k.trappen, { aantal: 1, bestaand: 0, nieuw: 1, afbraak: 0 });
  assert.deepEqual(k.inrichting, { bed: 1 });
  assert.deepEqual(k0.inrichting, {});
  const rijen = vergelijkingsRijen([{ naam: 'a', kerncijfers: k0, raming: raming(zonder, null, { kerncijfers: k0 }) }, { naam: 'b', kerncijfers: k, raming: raming(m, null, { kerncijfers: k }) }]);
  const rij = (s) => rijen.find((x) => x.sleutel === s);
  assert.deepEqual(rij('trappen').waarden, [0, 1]);
  assert.deepEqual(rij('inrichting-bed').waarden, [0, 1]);
  assert.equal(rij('hoogteband-2200-').waarden[0], 0);
  assert.match(rij('hoogteband-2200-').label, /≥ 2,20 m/);
  // v1-model (zonder trappen/inrichting) breekt de kerncijfers niet
  const v1 = naarV1(zonder);
  assert.deepEqual(kerncijfers(v1).trappen.aantal, 0);
});

// ───────────────────────────── demonstratie ─────────────────────────────

test('demonstratie zolder-programma.ops.json op bestaand: geldig, afbraak correct, programma voldoet', () => {
  const b = bestaand();
  const bestand = demoOps();
  assert.equal(bestand.basis, 'bestaand');
  assert.match(bestand._uitleg, /VOORBEELD/);
  const r = applyOps(b, bestand.ops);
  assert.ok(r.ok, JSON.stringify(r.fouten));
  assert.deepEqual(r.waarschuwingen, []);
  const m = r.model;
  // afbraak: achterbouw + garage 2; gedeelde muren blijven
  for (const id of ['M3', 'M12', 'M13', 'M27', 'M28', 'M29']) assert.equal(el(m, 'muren', id).status, 'afbraak', id);
  for (const id of ['M5', 'M23', 'M2', 'M4']) assert.equal(el(m, 'muren', id).status, 'bestaand', id);
  for (const id of ['D2', 'D4']) assert.equal(el(m, 'daken', id).status, 'afbraak');
  for (const naam of ['Kamer achterbouw', 'Berging', 'Keuken (achterbouw)', 'Garage 2']) assert.ok(!m.ruimtes.some((x) => x.niveau === 'N0' && x.naam === naam), naam);
  // zolder, trap, ruimtes, sanitair
  const z = m.niveaus.find((n) => n.soort === 'zolder');
  assert.deepEqual([z.peil, z.hoogte], [5800, 4000]);
  assert.equal(m.trappen.length, 1);
  assert.deepEqual([m.trappen[0].vanNiveau, m.trappen[0].naarNiveau, m.trappen[0].type], ['N1', z.id, 'halfdraai']);
  assert.deepEqual(m.inrichting.map((x) => x.soort).sort(), ['douche', 'lavabo']);
  // toets
  const t = toetsProgramma(m);
  assert.deepEqual(t.resultaten.map((x) => x.status), ['voldoet', 'voldoet', 'voldoet', 'voldoet']);
  assert.deepEqual(t.samenvatting, { voldoet: 4, 'voldoet niet': 0, onbekend: 0 });
  // kerncijfers per hoogteband (zadeldak 45°, nok op y 4000 ⇒ vrije hoogte = afstand tot de dakvoet)
  const k = kerncijfers(m);
  const s1 = k.ruimtes.find((x) => x.naam === 'Slaapkamer 1');
  dichtbij(s1.banden[2].m2, 4.42 * 1.25, 0.05); // y 2200..3450
  dichtbij(s1.banden[1].m2, 4.42 * 0.70, 0.05); // y 1500..2200
  dichtbij(s1.banden[0].m2, 4.42 * 0.25, 0.05); // y 1250..1500
  assert.equal(k.trappen.aantal, 1);
  assert.deepEqual(k.inrichting, { douche: 1, lavabo: 1 });
  // de demonstratie is geen ontwerp in designs/ (designs/zolder-dakkapellen.json is een aparte variant)
  assert.ok(!lees('index.json').ontwerpen.some((o) => /zolder-programma/.test(o.id)));
});

test('bestaand en voorbeeld zijn v2 en geldig', () => {
  for (const f of ['bestaand.json', 'voorbeeld.json']) {
    const m = lees(f);
    assert.equal(m.schemaVersie, 2);
    assert.ok(validate(m).geldig);
  }
});
