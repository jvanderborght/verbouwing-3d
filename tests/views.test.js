import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  muurAansluiting, muurSegmenten, muurDeelRechthoek, polygoonOffset, polygoonOppervlakte,
  dakVlakken, dakGevels, dakHoogteIn, dakNokHoogte,
} from '../js/model/index.js';
import {
  formatteerOppervlakte, formatteerMaat, buitenNormaal, isBuitenmuur, maatlijn, muurMaten, totaleMaten,
  leesbareHoek, passendeView, schermNaarModelV, modelNaarSchermV, zoomRond, verschuif, niveauEronder, verborgenIds,
  GEBAAR, isSleep, isTik, isDubbeltik, afstandTotMuurvak, raakDoel, raakGreep, strookPolygoon,
} from '../js/views/bouwstenen.js';

const voorbeeld = () => JSON.parse(readFileSync(new URL('../designs/voorbeeld.json', import.meta.url), 'utf8'));
const dichtbij = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('muurSegmenten: muur zonder openingen = één stuk', () => {
  assert.deepEqual(muurSegmenten(0, 5000, 2800, []), [{ t0: 0, t1: 5000, z0: 0, z1: 2800 }]);
});

test('muurSegmenten: raam en deur', () => {
  const s = muurSegmenten(-150, 6850, 2900, [
    { positie: 900, breedte: 1000, borstwering: 0, hoogte: 2200 },   // deur
    { positie: 3000, breedte: 2800, borstwering: 700, hoogte: 1600 }, // raam
  ]);
  const sleutel = (x) => `${x.t0}-${x.t1}:${x.z0}-${x.z1}`;
  assert.deepEqual(s.map(sleutel).sort(), [
    '-150-900:0-2900', '900-1900:2200-2900', '1900-3000:0-2900',
    '3000-5800:0-700', '3000-5800:2300-2900', '5800-6850:0-2900',
  ].sort());
  // volle oppervlakte = muur − openingen
  const opp = s.reduce((a, x) => a + (x.t1 - x.t0) * (x.z1 - x.z0), 0);
  assert.equal(opp, 7000 * 2900 - 1000 * 2200 - 2800 * 1600);
});

test('muurSegmenten: opening tot bovenaan en opening die buiten de muur steekt wordt afgekapt', () => {
  const s = muurSegmenten(0, 3000, 2500, [{ positie: 2500, breedte: 1000, borstwering: 0, hoogte: 9999 }]);
  assert.deepEqual(s, [{ t0: 0, t1: 2500, z0: 0, z1: 2500 }]);
});

test('muurAansluiting: L-hoeken, T-aansluiting en collineaire verlengstukken (voorbeeld)', () => {
  const m = voorbeeld();
  const a = Object.fromEntries(m.muren.map((x) => [x.id, muurAansluiting(m.muren, x)]));
  // M1 (eerste, bestaand) loopt door aan beide hoeken; M4 en M2 stoppen ertegen
  assert.deepEqual(a.M1, { start: 150, eind: 150 });
  assert.equal(a.M2.start, -150);
  assert.equal(a.M4.eind, -150);
  // T: binnenmuur M5 stopt tegen de binnenzijde van M4 en M2
  assert.deepEqual(a.M5, { start: -150, eind: -150 });
  // M6 (afbraak) tussen M1 en M5: T aan beide zijden
  assert.deepEqual(a.M6, { start: -150, eind: -70 });
  // M3 (afbraak) loopt op twee collineaire muren (M4/M7, M2/M9) → inkorten
  assert.deepEqual(a.M3, { start: -150, eind: -150 });
  // M4 en M7 zijn collineair: geen correctie op dat punt
  assert.equal(a.M4.start, 0);
  assert.equal(a.M7.start, 0);
});

test('muurAansluiting: L-hoeken sluiten zonder gat of overlap', () => {
  const m = voorbeeld();
  const N1 = m.muren.filter((x) => x.niveau === 'N1' && x.dikte === 300);
  const opp = N1.reduce((s, x) => {
    const a = muurAansluiting(m.muren, x);
    const L = Math.hypot(x.eind[0] - x.start[0], x.eind[1] - x.start[1]);
    return s + polygoonOppervlakte(muurDeelRechthoek(x, -a.start, L + a.eind));
  }, 0);
  assert.equal(opp, 7000 * 9000 - 6400 * 8400); // buitencontour − binnencontour
});

test('polygoonOffset verschuift naar buiten, ongeacht de oriëntatie', () => {
  const vk = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
  assert.deepEqual(polygoonOffset(vk, 100).map((p) => p.map(Math.round)), [[-100, -100], [1100, -100], [1100, 1100], [-100, 1100]]);
  const omgekeerd = [...vk].reverse();
  dichtbij(polygoonOppervlakte(polygoonOffset(omgekeerd, 100)), 1200 * 1200, 1e-3);
  dichtbij(polygoonOppervlakte(polygoonOffset(vk, -100)), 800 * 800, 1e-3);
});

test('dakVlakken: zadeldak volgt dakHoogteIn binnen de contour en heeft de juiste nok', () => {
  const dak = voorbeeld().daken.find((d) => d.id === 'D1');
  const vlakken = dakVlakken(dak);
  assert.equal(vlakken.length, 2);
  const H = dakNokHoogte(dak);
  const max = Math.max(...vlakken.flat().map((p) => p[2]));
  dichtbij(max, H, 1e-6);
  // dakrand in de overstek ligt lager dan het rustvlak
  const min = Math.min(...vlakken.flat().map((p) => p[2]));
  dichtbij(min, -dak.overstek * Math.tan((dak.helling * Math.PI) / 180));
  // hoekpunten die binnen de contour liggen: zelfde hoogte als dakHoogteIn
  for (const [x, y, h] of vlakken.flat()) if (x >= 0 && x <= 7000 && y >= 0 && y <= 9000) dichtbij(h, dakHoogteIn(dak, x, y));
  // overstek: dakvlak reikt tot contour + overstek
  const xs = vlakken.flat().map((p) => p[0]);
  assert.equal(Math.min(...xs), -300);
  assert.equal(Math.max(...xs), 7300);
});

test('dakVlakken: lessenaar, schild en plat', () => {
  const basis = { contour: [[0, 0], [8000, 0], [8000, 5000], [0, 5000]], helling: 30, overstek: 0 };
  const les = dakVlakken({ ...basis, type: 'lessenaar', nokrichting: 'x' });
  assert.equal(les.length, 1);
  for (const [x, y, h] of les[0]) dichtbij(h, dakHoogteIn({ ...basis, type: 'lessenaar', nokrichting: 'x' }, x, y));
  const schild = { ...basis, type: 'schild' };
  const sv = dakVlakken(schild);
  assert.equal(sv.length, 4);
  for (const [x, y, h] of sv.flat()) dichtbij(h, dakHoogteIn(schild, x, y), 1e-6);
  dichtbij(Math.max(...sv.flat().map((p) => p[2])), dakNokHoogte(schild));
  // pyramide (vierkant): geen dubbele punten
  const pyr = dakVlakken({ ...basis, contour: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]], type: 'schild' });
  for (const v of pyr) assert.equal(v.length, 3);
  const plat = dakVlakken({ ...basis, type: 'plat', helling: 0, overstek: 200 });
  assert.equal(plat.length, 1);
  dichtbij(polygoonOppervlakte(plat[0]), 8400 * 5400, 1e-3);
});

test('dakGevels: zadeldak heeft twee driehoeken op de kopse kanten', () => {
  const dak = voorbeeld().daken.find((d) => d.id === 'D1'); // nok langs x → kopse kanten x = 0 en x = 7000
  const g = dakGevels(dak, 0);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.punten[0][0]).sort((a, b) => a - b), [0, 7000]);
  assert.deepEqual(g[0].binnen, [1, 0]);
  dichtbij(Math.max(...g[0].punten.map((p) => p[2])), dakNokHoogte(dak));
  assert.equal(dakGevels({ ...dak, type: 'schild' }).length, 0);
  assert.equal(dakGevels({ ...dak, type: 'lessenaar' }).length, 3);
});

test('formattering', () => {
  assert.equal(formatteerOppervlakte(6400 * 4130), '26,4 m²');
  assert.equal(formatteerOppervlakte(0), '0,0 m²');
  assert.equal(formatteerMaat(6699.6), '6700');
});

test('maatlijnen: buitennormaal, buitenmuur, ketting met openingen', () => {
  const m = voorbeeld();
  const M1 = m.muren.find((x) => x.id === 'M1');
  const n = buitenNormaal(M1, [3500, 6000]);
  assert.deepEqual(n.map((v) => v + 0), [0, -1]);
  const b = { minX: 0, minY: 0, maxX: 7000, maxY: 12000 };
  assert.equal(isBuitenmuur(M1, n, b), true);
  const M5 = m.muren.find((x) => x.id === 'M5');
  assert.equal(isBuitenmuur(M5, buitenNormaal(M5, [3500, 6000]), b), false);

  const lijnen = muurMaten(M1, m.openingen.filter((o) => o.muur === 'M1'), n, true);
  const ketting = lijnen.filter((l) => l.soort === 'ketting').map((l) => l.tekst);
  assert.deepEqual(ketting, ['900', '1000', '1100', '2800', '900']);
  const muur = lijnen.find((l) => l.soort === 'muur');
  assert.equal(muur.tekst, '6700');
  // maatlijn ligt buiten de gevel (y < 0), op 2 × 550 mm van het buitenvlak
  dichtbij(muur.van[1], -1100);
  // binnenmuur: enkel de muurlengte
  assert.deepEqual(muurMaten(M5, [], [0, -1], false).map((l) => l.soort), ['muur']);
});

test('maatlijn en totale maten', () => {
  const l = maatlijn([0, 0], [7000, 0], [0, -1], 1000);
  assert.deepEqual(l.van, [0, -1000]);
  assert.deepEqual(l.tot, [7000, -1000]);
  assert.equal(l.tekst, '7000');
  assert.deepEqual(l.hulplijnen[0][0], [0, -80]);
  const t = totaleMaten({ minX: 0, minY: 0, maxX: 7000, maxY: 12000 }, 1650);
  assert.deepEqual(t.map((x) => x.tekst), ['7000', '12000']);
  assert.deepEqual(t[1].van, [-1650, 0]);
});

test('leesbareHoek houdt tekst rechtop', () => {
  assert.equal(leesbareHoek(1, 0), 0);
  assert.equal(leesbareHoek(-1, 0), 0);
  assert.equal(leesbareHoek(0, -1), -90 + 0);
  assert.equal(leesbareHoek(0, 1), -90);
});

test('view: scherm ↔ model is elkaars inverse, y naar boven, zoom rond punt houdt punt vast', () => {
  const W = 800, H = 600;
  const v = passendeView({ minX: 0, minY: 0, maxX: 7000, maxY: 12000 }, W, H, 0);
  dichtbij(v.schaal, 600 / 12000);
  // midden van het venster = midden van het huis
  assert.deepEqual(schermNaarModelV(v, W, H, 400, 300), [3500, 6000]);
  // onderaan in beeld = kleine y (straat onderaan)
  const [, yOnder] = schermNaarModelV(v, W, H, 400, 600);
  const [, yBoven] = schermNaarModelV(v, W, H, 400, 0);
  assert.ok(yOnder < yBoven);
  const p = modelNaarSchermV(v, W, H, 1234, 5678);
  const q = schermNaarModelV(v, W, H, ...p);
  dichtbij(q[0], 1234, 1e-6); dichtbij(q[1], 5678, 1e-6);
  const voor = schermNaarModelV(v, W, H, 100, 50);
  const z = zoomRond(v, W, H, 100, 50, 2.5);
  const na = schermNaarModelV(z, W, H, 100, 50);
  dichtbij(na[0], voor[0], 1e-6); dichtbij(na[1], voor[1], 1e-6);
  const s = verschuif(v, 10, 0);
  dichtbij(schermNaarModelV(s, W, H, 410, 300)[0], 3500, 1e-6);
});

test('niveauEronder en verborgenIds', () => {
  const m = voorbeeld();
  assert.equal(niveauEronder(m.niveaus, 'N1').id, 'N0');
  assert.equal(niveauEronder(m.niveaus, 'N0'), null);
  const v = verborgenIds(m, ['N1']);
  for (const id of ['M10', 'M15', 'O6', 'O10', 'R3', 'V3', 'D1']) assert.ok(v.has(id), id);
  for (const id of ['M1', 'O1', 'D2', 'V1']) assert.ok(!v.has(id), id);
});

// ── interactie: gebaren en hittests ──────────────────────────────────────────

test('isSleep / isTik: drempel 6 px en 350 ms', () => {
  assert.equal(GEBAAR.sleepDrempel, 6);
  assert.equal(isSleep(3, 4), false); // 5 px
  assert.equal(isSleep(6, 0), false); // precies op de drempel = nog geen sleep
  assert.equal(isSleep(5, 5), true);
  assert.equal(isTik({ dx: 2, dy: 1, duur: 120 }), true);
  assert.equal(isTik({ dx: 2, dy: 1, duur: 350 }), false); // te lang ingedrukt
  assert.equal(isTik({ dx: 10, dy: 0, duur: 80 }), false); // gesleept
});

test('isDubbeltik: binnen 350 ms en 20 px', () => {
  const v = { t: 1000, x: 100, y: 100 };
  assert.equal(isDubbeltik(null, { t: 1100, x: 100, y: 100 }), false);
  assert.equal(isDubbeltik(v, { t: 1200, x: 110, y: 105 }), true);
  assert.equal(isDubbeltik(v, { t: 1400, x: 100, y: 100 }), false); // te traag
  assert.equal(isDubbeltik(v, { t: 1100, x: 125, y: 100 }), false); // te ver
  assert.equal(isDubbeltik(v, { t: 900, x: 100, y: 100 }), false); // tijd terug = geen dubbeltik
});

test('afstandTotMuurvak: binnen = 0, buiten = euclidisch', () => {
  const mu = { start: [0, 0], eind: [4000, 0], dikte: 200 };
  assert.equal(afstandTotMuurvak(mu, [2000, 50], 0, 4000), 0);
  dichtbij(afstandTotMuurvak(mu, [2000, 300], 0, 4000), 200);
  dichtbij(afstandTotMuurvak(mu, [4300, 500], 0, 4000), Math.hypot(300, 400));
  dichtbij(afstandTotMuurvak(mu, [500, 0], 1000, 2000), 500);
});

test('raakDoel: opening > muur > ruimte, tolerantie in px', () => {
  const m = voorbeeld();
  const s = 0.1; // 0,1 px/mm ⇒ 10 px = 100 mm
  // midden van deur O1 in muur M1 (positie 900, breedte 1000, as y=150)
  assert.equal(raakDoel(m, 'N0', [1400, 150], s), 'O1');
  // net buiten de muurdikte maar binnen 10 px tolerantie → nog altijd de opening
  assert.equal(raakDoel(m, 'N0', [1400, 150 + 150 + 80], s), 'O1');
  // op de muur naast de opening
  assert.equal(raakDoel(m, 'N0', [2500, 150], s), 'M1');
  // binnen in de woonkamer, ver van muren
  assert.equal(raakDoel(m, 'N0', [2000, 2500], s), 'R1');
  // bij grotere schaal (ingezoomd) is de tolerantie in mm kleiner: 380 mm naast de as valt erbuiten
  assert.equal(raakDoel(m, 'N0', [1400, 150 + 150 + 80], 1), 'R1');
  // buiten alles
  assert.equal(raakDoel(m, 'N0', [-5000, -5000], s), null);
  // ander niveau: muren van N0 tellen niet
  assert.equal(raakDoel(m, 'N1', [1400, 150], s) === 'O1', false);
  assert.equal(raakDoel(null, 'N0', [0, 0], s), null);
  // ver uitgezoomd (telefoon): 10 px = 650 mm; precies op de muur wint de muur, niet de opening 600 mm verder
  assert.equal(raakDoel(m, 'N0', [2500, 150], 0.0154), 'M1');
  // naast de muur, dichter bij de opening dan bij de rest van de muur → opening
  assert.equal(raakDoel(m, 'N0', [1400, 600], 0.0154), 'O1');
});

test('raakDoel: dichtste muur wint, ruimte = kleinste', () => {
  const m = {
    muren: [
      { id: 'A', niveau: 'N', start: [0, 0], eind: [1000, 0], dikte: 100 },
      { id: 'B', niveau: 'N', start: [0, 300], eind: [1000, 300], dikte: 100 },
    ],
    openingen: [],
    ruimtes: [
      { id: 'groot', niveau: 'N', contour: [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]] },
      { id: 'klein', niveau: 'N', contour: [[2000, 2000], [3000, 2000], [3000, 3000], [2000, 3000]] },
    ],
  };
  assert.equal(raakDoel(m, 'N', [500, 120], 0.05), 'A'); // 70 mm van A, 130 mm van B (tol 200 mm)
  assert.equal(raakDoel(m, 'N', [500, 190], 0.05), 'B');
  assert.equal(raakDoel(m, 'N', [2500, 2500], 0.05), 'klein');
  assert.equal(raakDoel(m, 'N', [4000, 4000], 0.05), 'groot');
});

test('raakGreep: enkel grepen, dichtste binnen de hitzone', () => {
  const punten = [
    { p: [0, 0], soort: 'snap' },
    { p: [1000, 0], soort: 'greep' },
    { p: [1100, 0], soort: 'greep' },
  ];
  assert.equal(raakGreep(punten, [1080, 0], 0.1, 22), 2);
  assert.equal(raakGreep(punten, [1000, 150], 0.1, 22), 1); // 150 mm = 15 px < 22 px
  assert.equal(raakGreep(punten, [1000, 150], 0.1, 10), -1); // muis: 10 px
  assert.equal(raakGreep(punten, [0, 0], 0.1, 22), -1); // snap-punt is geen greep
  assert.equal(raakGreep(null, [0, 0], 0.1), -1);
});

test('strookPolygoon: rechthoek rond de as', () => {
  const r = strookPolygoon([0, 0], [1000, 0], 200);
  assert.deepEqual(r.map(([x, y]) => [Math.round(x), Math.round(y)]), [[0, 100], [1000, 100], [1000, -100], [0, -100]]);
  dichtbij(polygoonOppervlakte(r), 200000);
  assert.deepEqual(strookPolygoon([5, 5], [5, 5], 100), []);
});
