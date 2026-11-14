// Fase 5 deel B (weergave): muurprofielen onder daken, trap- en inrichtingssymbolen, hoogtelijnen, hittests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyOps, migreer, dakHoogteIn, polygoonOppervlakte, muurAansluiting, muurLengte, muurSegmenten, trapGeometrie, hoogtelijnen,
} from '../js/model/index.js';
import {
  begrenzendeDaken, bovenkantFunctie, profielVan, profielWaarde, vereenvoudigProfiel, muurProfielen, knipStuk, stukVlakken, stukZijOppervlakte,
} from '../js/views/muurprofiel.js';
import {
  WEERGAVE_HOOGTE, inrichtingHoogte, inrichtingSymbool, pijlpunt, trapSymbool, trapBlokken, trapgatenOp,
  formatteerHoogte, niveauOnderDak, hoogteBanden, lijnLabel, vrijLijnLabel,
} from '../js/views/symbolen.js';
import { raakDoel, raakElement, verborgenIds } from '../js/views/bouwstenen.js';
import { INRICHTING_SOORTEN } from '../js/model/schema.js';

const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));
const dichtbij = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** bestaand.json + de demonstratie (zolder, halfdraaitrap, badkamer met douche en lavabo). */
function demo() {
  // vaste testbasis (fase 5): tests/fixtures/, los van designs/bestaand.json en het (geregenereerde) voorbeeld
  const m = migreer(lees('./fixtures/bestaand-fase5.json'));
  const r = applyOps(m, lees('./fixtures/zolder-programma-fase5.ops.json').ops);
  assert.ok(r.ok, JSON.stringify(r.fouten));
  return r.model;
}

// ── muurprofiel ──────────────────────────────────────────────────────────────

test('profielVan: knik exact gevonden, rechte stukken vereenvoudigd', () => {
  const g = (t) => Math.min(1000, 2 * Math.abs(t - 1234.5)); // V-vorm met afvlakking op 1000
  const p = profielVan(g, 0, 3000);
  for (const t of [0, 300, 1000, 1234.5, 1500, 1734.5, 2999]) dichtbij(profielWaarde(p, t), g(t), 1);
  assert.ok(p.length <= 8, `te veel punten: ${p.length}`);
  assert.ok(p.some(([t, z]) => Math.abs(t - 1234.5) < 2 && z < 3), 'knik onderaan niet gevonden');
  assert.deepEqual(vereenvoudigProfiel([[0, 0], [1, 1], [2, 2], [3, 0]]), [[0, 0], [2, 2], [3, 0]]);
  assert.equal(profielWaarde([[0, 5], [10, 15]], -3), 5);
  assert.equal(profielWaarde([[0, 5], [10, 15]], 5), 10);
});

test('begrenzendeDaken: hellend dak op het vloerpeil telt (zolder), plat dak op het peil niet', () => {
  const m = demo();
  // zolder N2 (peil 5800): D1 (zadel) rust op N1 = 5800 ⇒ telt
  assert.deepEqual(begrenzendeDaken(m, 'N2').map((x) => x.dak.id), ['D1']);
  // verdieping N1 (peil 3000): D1 rust op 5800 ⇒ telt; platte daken op N0 (rust 3000 = peil N1) niet
  assert.deepEqual(begrenzendeDaken(m, 'N1').map((x) => x.dak.id), ['D1']);
  const t = {
    niveaus: [{ id: 'A', peil: 0, hoogte: 2600 }, { id: 'B', peil: 2600, hoogte: 2600 }],
    daken: [
      { id: 'P', niveau: 'A', type: 'plat', helling: 0, contour: [[0, 0], [1, 0], [1, 1], [0, 1]], status: 'nieuw' },
      { id: 'Z', niveau: 'A', type: 'zadel', helling: 30, contour: [[0, 0], [1, 0], [1, 1], [0, 1]], status: 'afbraak' },
    ],
  };
  assert.deepEqual(begrenzendeDaken(t, 'B').map((x) => x.dak.id), []);
  assert.deepEqual(begrenzendeDaken(t, 'B', { metAfbraak: true }).map((x) => x.dak.id), ['Z']);
  assert.deepEqual(begrenzendeDaken(t, 'A').map((x) => x.dak.id), ['P']);
});

test('muurprofiel zolder: muren onder het zadeldak volgen de dakhelling (niet door het dak)', () => {
  const m = demo();
  const D1 = m.daken.find((d) => d.id === 'D1');
  const N2 = m.niveaus.find((n) => n.id === 'N2');
  // M34: evenwijdig aan de nok (y = 3500, dikte 100) ⇒ schuine bovenkant over de dikte
  const M34 = m.muren.find((x) => x.id === 'M34');
  const a = muurAansluiting(m.muren, M34);
  const p = muurProfielen(m, M34, -a.start, muurLengte(M34) + a.eind);
  assert.equal(p.vrij, false);
  assert.equal(p.H, N2.hoogte);
  dichtbij(profielWaarde(p.links, 2000), dakHoogteIn(D1, 2000, 3550), 1);
  dichtbij(profielWaarde(p.rechts, 2000), dakHoogteIn(D1, 2000, 3450), 1);
  // M35: dwars op de nok (x = 2250, y 1200 → 3500): stijgt van de goot naar de nok
  const M35 = m.muren.find((x) => x.id === 'M35');
  const q = muurProfielen(m, M35, 0, muurLengte(M35));
  dichtbij(profielWaarde(q.links, 0), dakHoogteIn(D1, 2200, 1200), 1);
  dichtbij(profielWaarde(q.rechts, 2300), dakHoogteIn(D1, 2300, 3500), 1);
  // overal: bovenkant ≤ onderkant dak in dat punt (steekt niet door het dak)
  for (const mu of m.muren.filter((x) => x.niveau === 'N2')) {
    const r = muurProfielen(m, mu, 0, muurLengte(mu));
    const L = muurLengte(mu);
    const ux = (mu.eind[0] - mu.start[0]) / L, uy = (mu.eind[1] - mu.start[1]) / L;
    for (const [prof, s] of [[r.links, mu.dikte / 2], [r.rechts, -mu.dikte / 2]]) {
      for (let t = 0; t <= L; t += L / 37) {
        const x = mu.start[0] + ux * t - uy * s, y = mu.start[1] + uy * t + ux * s;
        assert.ok(profielWaarde(prof, t) <= dakHoogteIn(D1, x, y) + 1, `${mu.id} t=${t}`);
      }
    }
  }
  // knieschot M32 (eigen hoogte 1150, y = 1200): het dak ligt daar op 1200 ⇒ blijft een gewone balk
  const M32 = m.muren.find((x) => x.id === 'M32');
  const k = muurProfielen(m, M32, 0, muurLengte(M32));
  assert.equal(k.H, 1150);
  assert.equal(k.vrij, true);
});

test('muurprofiel: muren van gelijkvloers en verdieping blijven volledig (dak rust op hun bovenkant)', () => {
  const m = demo();
  for (const mu of m.muren.filter((x) => x.niveau === 'N1' || x.niveau === 'N0')) {
    const a = muurAansluiting(m.muren, mu);
    assert.equal(muurProfielen(m, mu, -a.start, muurLengte(mu) + a.eind).vrij, true, mu.id);
  }
});

test('bovenkantFunctie: min(H, dak), nooit negatief', () => {
  const m = {
    niveaus: [{ id: 'A', peil: 0, hoogte: 2600 }, { id: 'Z', peil: 2600, hoogte: 5000 }],
    daken: [{ id: 'D', niveau: 'A', type: 'zadel', helling: 45, nokrichting: 'x', contour: [[0, 0], [8000, 0], [8000, 6000], [0, 6000]], status: 'nieuw' }],
  };
  const fA = bovenkantFunctie(m, 'A', 2600);
  assert.equal(fA(4000, 3000), 2600);
  const fZ = bovenkantFunctie(m, 'Z', 5000);
  dichtbij(fZ(4000, 3000), 3000); // nok
  dichtbij(fZ(4000, 1000), 1000);
  assert.equal(fZ(20000, 3000), 5000); // buiten het dak ⇒ H
});

test('knipStuk + stukVlakken: zijvlak = integraal van het profiel; ontaard ⇒ null; gesloten oppervlak', () => {
  const links = [[0, 0], [1000, 1000], [2000, 1000]];
  const rechts = [[0, 0], [1000, 900], [2000, 900]];
  const k = knipStuk({ t0: 0, t1: 2000, z0: 0, z1: 950 }, links, rechts);
  assert.ok(k.ts.some((t) => Math.abs(t - 950) < 1e-9)); // kruising met z1 links
  assert.ok(k.ts.some((t) => Math.abs(t - 1000) < 1e-9));
  // links: driehoek tot 950 (950²/2) + rechthoek 1050 × 950
  dichtbij(stukZijOppervlakte(k, 'links'), (950 * 950) / 2 + 1050 * 950, 1e-6);
  dichtbij(stukZijOppervlakte(k, 'rechts'), (1000 * 900) / 2 + 1000 * 900, 1e-6);
  // stuk boven een opening (z0 = 2000) waar het dak lager ligt ⇒ niets
  assert.equal(knipStuk({ t0: 0, t1: 2000, z0: 2000, z1: 2600 }, links, rechts), null);
  // gesloten oppervlak: som van de vectoroppervlaktes = 0
  const som = [0, 0, 0];
  for (const v of stukVlakken(k, 100)) for (let i = 1; i < v.length - 1; i++) {
    const a = v[0], b = v[i], c = v[i + 1];
    const u = b.map((x, j) => x - a[j]), w = c.map((x, j) => x - a[j]);
    som[0] += u[1] * w[2] - u[2] * w[1]; som[1] += u[2] * w[0] - u[0] * w[2]; som[2] += u[0] * w[1] - u[1] * w[0];
  }
  for (const x of som) dichtbij(x, 0, 1e-3);
});

test('3D-muren zolder: stukken (ook rond openingen) blijven onder het profiel', () => {
  const m = demo();
  for (const mu of m.muren.filter((x) => x.niveau === 'N2')) {
    const p = muurProfielen(m, mu, 0, muurLengte(mu));
    const gaten = m.openingen.filter((o) => o.muur === mu.id && o.status !== 'afbraak');
    for (const s of muurSegmenten(0, muurLengte(mu), p.H, gaten)) {
      const k = knipStuk(s, p.links, p.rechts);
      if (!k) continue;
      k.ts.forEach((t, i) => {
        assert.ok(k.links[i] >= s.z0 && k.links[i] <= s.z1);
        assert.ok(k.links[i] <= Math.max(s.z0, profielWaarde(p.links, t)) + 1e-6);
      });
    }
  }
});

// ── symbolen ─────────────────────────────────────────────────────────────────

test('inrichtingSymbool: elke soort binnen de contour; douche = kruis + afvoer; onbekend = label', () => {
  for (const soort of [...INRICHTING_SOORTEN, 'iets-onbekends']) {
    const s = inrichtingSymbool({ soort, positie: [1000, 1000], rotatie: 0, breedte: 900, diepte: 600 });
    assert.equal(s.contour.length, 4, soort);
    dichtbij(polygoonOppervlakte(s.contour), 900 * 600, 1);
    for (const p of [...s.vormen.flat(), ...s.lijnen.flat()]) {
      assert.ok(p[0] >= 550 - 1e-6 && p[0] <= 1450 + 1e-6 && p[1] >= 700 - 1e-6 && p[1] <= 1300 + 1e-6, `${soort} ${p}`);
    }
    assert.ok(s.vormen.length + s.lijnen.length > 0 || s.label, soort);
  }
  const d = inrichtingSymbool({ soort: 'douche', positie: [0, 0], rotatie: 0, breedte: 900, diepte: 900 });
  assert.equal(d.lijnen.length, 2);
  assert.equal(d.vormen.length, 1);
  assert.equal(d.label, null);
  assert.deepEqual(inrichtingSymbool({ soort: 'overig', positie: [0, 0], breedte: 600, diepte: 600 }).label, { p: [0, 0], tekst: 'overig' });
  assert.equal(inrichtingSymbool({ soort: 'raar', positie: [0, 0], breedte: 600, diepte: 600 }).label.tekst, 'raar');
  // wc: stortbak tegen de rugzijde (−v). Rotatie 90° ⇒ rugzijde aan +x
  const w0 = inrichtingSymbool({ soort: 'wc', positie: [0, 0], rotatie: 0, breedte: 400, diepte: 650 });
  assert.ok(Math.min(...w0.vormen[0].map((p) => p[1])) < -300);
  const w90 = inrichtingSymbool({ soort: 'wc', positie: [0, 0], rotatie: 90, breedte: 400, diepte: 650 });
  assert.ok(Math.max(...w90.vormen[0].map((p) => p[0])) > 300);
});

test('inrichtingHoogte: eigen hoogte, anders weergavewaarde', () => {
  assert.equal(inrichtingHoogte({ soort: 'douche', hoogte: 2100 }), 2100);
  assert.equal(inrichtingHoogte({ soort: 'kast' }), WEERGAVE_HOOGTE.kast);
  assert.equal(inrichtingHoogte({ soort: 'onbekend' }), WEERGAVE_HOOGTE.overig);
});

test('pijlpunt: punt op het einde, vleugels terug langs de lijn', () => {
  const p = pijlpunt([[0, 0], [1000, 0]], 200);
  assert.deepEqual(p[1], [1000, 0]);
  dichtbij(p[0][0], 800); dichtbij(p[2][0], 800);
  dichtbij(Math.abs(p[0][1]), 100);
  assert.ok(p[0][1] * p[2][1] < 0);
  assert.equal(pijlpunt([[0, 0]], 100), null);
});

test('trapSymbool: halfdraaitrap uit de demonstratie — treden, looplijn met pijl naar boven', () => {
  const m = demo();
  const t = m.trappen.find((x) => x.id === 'T1');
  const g = trapGeometrie(m, t);
  const s = trapSymbool(m, t);
  assert.equal(s.treden.length, g.maten.aantalTreden - 1);
  assert.deepEqual(s.begin, g.looplijn[0]);
  assert.deepEqual(s.pijl[1], g.looplijn[g.looplijn.length - 1]);
  assert.equal(s.kolom, null);
  assert.equal(trapSymbool(m, { ...t, breedte: undefined }), null);
});

test('trapSymbool spiraal: kolom in het midden, looplijn als boog op halve straal', () => {
  const m = { niveaus: [{ id: 'A', peil: 0, hoogte: 2700 }, { id: 'B', peil: 2700, hoogte: 2600 }] };
  const t = { id: 'T9', vanNiveau: 'A', naarNiveau: 'B', type: 'spiraal', oorsprong: [1000, 1000], richting: 0, breedte: 700, status: 'nieuw' };
  const s = trapSymbool(m, t);
  assert.ok(s.kolom.length >= 8);
  for (const p of s.looplijn) dichtbij(Math.hypot(p[0] - 1000, p[1] - 1000), 350, 0.5);
  assert.ok(s.looplijn.length > s.treden.length * 3);
  const b = trapBlokken(m, t);
  assert.equal(b.treden.length, s.treden.length);
  assert.ok(b.kolom && b.kolom.z0 === 0 && b.kolom.z1 > 2700);
  for (const tr of b.treden) assert.ok(tr.z1 - tr.z0 <= 50 + 1e-9);
});

test('trapBlokken: zaagtand van één optrede, bovenste trede één optrede onder naarNiveau', () => {
  const m = demo();
  const t = m.trappen.find((x) => x.id === 'T1');
  const { treden, kolom } = trapBlokken(m, t);
  const o = trapGeometrie(m, t).maten.optrede;
  assert.equal(kolom, null);
  dichtbij(treden[0].z0, 3000, 0.2);
  dichtbij(treden[0].z1, 3000 + o, 0.2);
  dichtbij(treden[treden.length - 1].z1, 5800 - o, 0.5);
  assert.deepEqual(trapBlokken(m, { ...t, vanNiveau: 'X' }), { treden: [], kolom: null });
});

test('trapgatenOp: trapgat op naarNiveau, niet op vanNiveau, niet voor afbraaktrappen', () => {
  const m = demo();
  assert.deepEqual(trapgatenOp(m, 'N2').map((x) => x.id), ['T1']);
  assert.deepEqual(trapgatenOp(m, 'N1'), []);
  const a = { ...m, trappen: m.trappen.map((t) => ({ ...t, status: 'afbraak' })) };
  assert.deepEqual(trapgatenOp(a, 'N2'), []);
});

// ── hoogtelijnen ─────────────────────────────────────────────────────────────

test('formatteerHoogte en niveauOnderDak', () => {
  assert.equal(formatteerHoogte(1500), '1,50 m');
  assert.equal(formatteerHoogte(2200), '2,20 m');
  const m = demo();
  assert.equal(niveauOnderDak(m, 'N2'), true);
  assert.equal(niveauOnderDak(m, 'N1'), false);
  assert.equal(niveauOnderDak(m, 'N0'), false);
  assert.equal(niveauOnderDak(m, 'X'), false);
  // zonder soort maar met een hellend dak dat in het niveau zit
  const z = { ...m, niveaus: m.niveaus.map((n) => (n.id === 'N2' ? { ...n, soort: undefined } : n)) };
  assert.equal(niveauOnderDak(z, 'N2'), true);
});

test('hoogteBanden: drie banden voor twee grenzen (evenodd-lussen)', () => {
  const m = demo();
  const lagen = hoogtelijnen(m, 'N2', [1500, 2200], { stap: 100 });
  const domein = m.vloeren.filter((v) => v.niveau === 'N2' && v.status !== 'afbraak').map((v) => v.contour);
  const b = hoogteBanden(domein, lagen);
  assert.deepEqual(b.map((x) => [x.van, x.tot]), [[0, 1500], [1500, 2200], [2200, null]]);
  assert.equal(b[0].lussen.length, domein.length + lagen[0].gebieden.length);
  const opp = (l) => l.reduce((s, c) => s + polygoonOppervlakte(c), 0);
  // 45°-dak op 7000 × 8000, nok langs x: gebied ≥ 1500 ≈ strook y ∈ [1500, 6500] (min. het trapgat, telt niet als plafond)
  dichtbij(opp(lagen[0].gebieden), 7000 * 5000, 7000 * 250);
  assert.deepEqual(hoogteBanden(domein, []), []);
});

test('lijnLabel: midden van de lengte, leesbare hoek', () => {
  const l = lijnLabel([[0, 1500], [7000, 1500]]);
  assert.deepEqual(l.p, [3500, 1500]);
  assert.equal(l.hoek + 0, 0);
  const v = lijnLabel([[0, 0], [0, 1000], [0, 3000]]);
  assert.deepEqual(v.p, [0, 1500]);
  assert.equal(v.hoek, -90);
  assert.equal(lijnLabel([[0, 0]]), null);
  assert.deepEqual(lijnLabel([[0, 0], [1000, 0]], 0.3).p, [300, 0]);
  // vrijLijnLabel: weg van een ruimtelabel in het midden
  assert.deepEqual(vrijLijnLabel([[0, 0], [1000, 0]], [[500, 50]]).p, [150, 0]);
  assert.deepEqual(vrijLijnLabel([[0, 0], [1000, 0]], []).p, [500, 0]);
});

// ── hittests en zichtbaarheid ────────────────────────────────────────────────

test('raakDoel: inrichting en trap (vanNiveau en trapgat op naarNiveau); in de muur wint de muur', () => {
  const m = demo();
  const s = 0.05; // 10 px = 200 mm
  for (const i of m.inrichting) assert.equal(raakDoel(m, 'N2', i.positie, s), i.id, i.soort);
  const t = m.trappen[0];
  const c = trapGeometrie(m, t).treden[1].contour;
  const midden = c.reduce((a, p) => [a[0] + p[0] / c.length, a[1] + p[1] / c.length], [0, 0]);
  assert.equal(raakElement(m, 'N1', midden), t.id);
  assert.equal(raakElement(m, 'N2', midden), t.id); // trapgat
  assert.equal(raakElement(m, 'N0', midden), null);
  assert.equal(raakDoel(m, 'N2', [5000, 3500], s), 'M34');
});

test('verborgenIds: trappen bij hun vanNiveau, inrichting bij hun niveau', () => {
  const m = demo();
  const v = verborgenIds(m, ['N2']);
  for (const i of m.inrichting) assert.ok(v.has(i.id));
  assert.ok(!v.has('T1'));
  assert.ok(verborgenIds(m, ['N1']).has('T1'));
});
