// daken.basisHoogte en daken.hogeZijde (optioneel, geen nieuwe schemaVersie). Alle verwachte waarden handmatig nagerekend:
// lessenaar 6000 × 4000 (nokrichting x), helling 45° (tan = 1), basisHoogte 1000, hogeZijde 'min' ⇒ hoge rand aan y = 0.
//   onderkant boven het rustvlak: h(y) = 1000 + (4000 − y)   → y = 0: 5000, y = 4000: 1000
//   volume = 6000·4000·1000 + 6000·4000·4000/2 = 24 + 48 = 72 m³
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOps, validate, dakHoogteIn, dakNokHoogte, dakVolume, dakVlakken, dakGevels, dakBasisHoogte, zichtbareDakGevels,
  vrijeHoogte, oppervlaktePerHoogteband, muurOppervlakteOnderDak, hoogtelijnen,
} from '../js/model/index.js';
import { kerncijfers } from '../js/metrics/index.js';

const dichtbij = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const RECHTHOEK = [[0, 0], [6000, 0], [6000, 4000], [0, 4000]];
const DAK = { id: 'D1', niveau: 'N1', type: 'lessenaar', contour: RECHTHOEK, helling: 45, nokrichting: 'x', overstek: 0, dikte: 300, status: 'nieuw', basisHoogte: 1000, hogeZijde: 'min' };
const zonder = (o, ...velden) => { const c = { ...o }; for (const v of velden) delete c[v]; return c; };

function model(dak = DAK, extra = {}) {
  return {
    schemaVersie: 2, id: 't', naam: 'test',
    niveaus: [
      { id: 'N1', naam: 'V', peil: 3000, hoogte: 2500 },
      { id: 'Z', naam: 'Zolder', peil: 5500, hoogte: 5000, vloerdikte: 300, soort: 'zolder' },
    ],
    muren: [], openingen: [], ruimtes: [],
    vloeren: [{ id: 'V1', niveau: 'Z', contour: RECHTHOEK, dikte: 300, status: 'nieuw' }],
    daken: [dak], trappen: [], inrichting: [], ...extra,
  };
}

test('dakHoogteIn / dakNokHoogte / dakVolume met basisHoogte en hogeZijde min', () => {
  dichtbij(dakHoogteIn(DAK, 100, 0), 5000);
  dichtbij(dakHoogteIn(DAK, 100, 4000), 1000);
  dichtbij(dakHoogteIn(DAK, 100, 1000), 4000);
  dichtbij(dakNokHoogte(DAK), 5000);
  dichtbij(dakVolume(DAK), 72e9, 1);
  dichtbij(dakBasisHoogte(DAK), 1000);
  // standaard = huidig gedrag: hoge rand aan de max-zijde, geen basis
  const oud = zonder(DAK, 'basisHoogte', 'hogeZijde');
  const max = { ...DAK, basisHoogte: 0, hogeZijde: 'max' };
  for (const y of [0, 1234, 4000]) dichtbij(dakHoogteIn(max, 0, y), dakHoogteIn(oud, 0, y));
  dichtbij(dakHoogteIn(oud, 0, 1234), 1234);
  dichtbij(dakVolume(oud), 48e9, 1);
  // zadel met basis: + basis overal; volume = grondvlak × basis + 6000·4000·2000/2
  const zadel = { ...zonder(DAK, 'hogeZijde'), type: 'zadel' };
  dichtbij(dakHoogteIn(zadel, 0, 2000), 1000 + 2000);
  dichtbij(dakNokHoogte(zadel), 3000);
  dichtbij(dakVolume(zadel), 24e9 + 24e9, 1);
  // plat: basisHoogte genegeerd
  dichtbij(dakBasisHoogte({ ...DAK, type: 'plat', helling: 0 }), 0);
  dichtbij(dakHoogteIn({ ...DAK, type: 'plat', helling: 0 }, 0, 0), 0);
});

test('dakVlakken volgen dakHoogteIn (ook met overstek)', () => {
  const [v] = dakVlakken({ ...DAK, overstek: 500 });
  // overstek: de helling loopt door. y = −500 ⇒ 1000 + 4500 ; y = 4500 ⇒ 1000 − 500
  for (const [, y, h] of v) dichtbij(h, y < 0 ? 5500 : 500);
  for (const [x, y, h] of dakVlakken(DAK)[0]) dichtbij(h, dakHoogteIn(DAK, x, y));
});

test('dakGevels: trapezia op de kopse kanten, rechthoek onder de hoge en de lage rand', () => {
  const g = dakGevels(DAK, 0);
  assert.equal(g.length, 4);
  const kop = g.filter((x) => x.binnen[1] === 0);
  assert.equal(kop.length, 2);
  // trapezium (y, h): (0,0)-(4000,0)-(4000,1000)-(0,5000): oppervlakte = 4000 · (1000 + 5000) / 2 = 12 m²
  const opp = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[1] * b[2] - b[1] * a[2]; } return Math.abs(s) / 2; };
  dichtbij(opp(kop[0].punten), 12e6, 1);
  const hoog = g.find((x) => x.binnen[1] === 1);
  assert.ok(hoog.punten.every((p) => p[1] === 0));
  dichtbij(Math.max(...hoog.punten.map((p) => p[2])), 5000);
  const laag = g.find((x) => x.binnen[1] === -1);
  assert.ok(laag.punten.every((p) => p[1] === 4000));
  dichtbij(Math.max(...laag.punten.map((p) => p[2])), 1000);
  // dv = 1200 > basis: geen rechthoek aan de lage rand; kopse kant = driehoek met de voet tot y = 4000 − 200
  const g2 = dakGevels(DAK, 1200);
  assert.equal(g2.length, 3);
  const k2 = g2.find((x) => x.binnen[0] === 1);
  dichtbij(Math.max(...k2.punten.map((p) => p[1])), 3800);
  dichtbij(Math.max(...k2.punten.map((p) => p[2])), 3800);
  // zonder basis/hogeZijde: ongewijzigd (2 driehoeken + 1 rechthoek)
  assert.equal(dakGevels(zonder(DAK, 'basisHoogte', 'hogeZijde')).length, 3);
});

test('zichtbareDakGevels: geen gevel tussen aansluitende daken of waar muren de gevel vormen', () => {
  const voor = { ...zonder(DAK, 'basisHoogte', 'hogeZijde'), id: 'D1', contour: [[0, 0], [6000, 0], [6000, 2000], [0, 2000]] };
  const achter = { ...DAK, id: 'D2', contour: [[0, 2000], [6000, 2000], [6000, 4000], [0, 4000]] };
  const m = model(voor, { daken: [voor, achter] });
  assert.equal(zichtbareDakGevels(m, voor, 0).length, 2, 'voor: enkel de kopse kanten (hoge rand aan y = 2000 vervalt)');
  assert.equal(zichtbareDakGevels(m, achter, 0).length, 3, 'achter: kopse kanten + rand onder de lage zijde (y = 4000)');
  // achtergevel als muur op de zolder (peil = rustvlak): de vulling aan y = 4000 vervalt
  const muur = { id: 'M1', niveau: 'Z', start: [0, 3900], eind: [6000, 3900], dikte: 200, status: 'nieuw' };
  assert.equal(zichtbareDakGevels({ ...m, muren: [muur] }, achter, 0).length, 2);
  // afbraakmuur telt niet; een muur die maar de helft bedekt ook niet
  assert.equal(zichtbareDakGevels({ ...m, muren: [{ ...muur, status: 'afbraak' }] }, achter, 0).length, 3);
  assert.equal(zichtbareDakGevels({ ...m, muren: [{ ...muur, eind: [3000, 3900] }] }, achter, 0).length, 3);
  // een afbraakdak ernaast verbergt de gevel van een blijvend dak niet
  const m3 = model(voor, { daken: [voor, { ...achter, status: 'afbraak' }] });
  assert.equal(zichtbareDakGevels(m3, voor, 0).length, 3);
});

test('vrije hoogte, hoogtebanden, muurprofiel en kerncijfers volgen basisHoogte', () => {
  const muur = { id: 'M1', niveau: 'Z', start: [0, 3950], eind: [6000, 3950], dikte: 100, status: 'nieuw' };
  const ruimte = { id: 'R1', niveau: 'Z', naam: 'Kamer', functie: 'slaapkamer', contour: RECHTHOEK, hoogtegrenzen: [1500, 2200] };
  const m = model(DAK, { muren: [muur], ruimtes: [ruimte] });
  assert.ok(validate(m).geldig, JSON.stringify(validate(m).fouten));
  // rustvlak 5500 = zolderpeil ⇒ vrije hoogte = dakHoogteIn
  dichtbij(vrijeHoogte(m, 'Z', [3000, 3000]), 2000);
  dichtbij(vrijeHoogte(m, 'Z', [3000, 3999]), 1001);
  // banden: h(y) = 5000 − y ⇒ < 1500 voor y > 3500 (0,5 m × 6 m), 1500..2200 voor 2800 < y ≤ 3500 (0,7 × 6), rest (2,8 × 6)
  const b = oppervlaktePerHoogteband(m, 'R1');
  dichtbij(b.banden[0].m2, 3.0, 0.05);
  dichtbij(b.banden[1].m2, 4.2, 0.05);
  dichtbij(b.banden[2].m2, 16.8, 0.05);
  // hoogtelijn 1500 ligt op y = 3500
  const [l] = hoogtelijnen(m, 'Z', [1500]);
  assert.ok(l.lijnen.length > 0);
  for (const lijn of l.lijnen) for (const [, y] of lijn) dichtbij(y, 3500, 1);
  // muur onder de lage rand: zijvlakken op y 3900 (1100 hoog) en 4000 (1000 hoog) ⇒ 6000 × 1050
  dichtbij(muurOppervlakteOnderDak(m, muur), 6000 * 1050, 50);
  // kerncijfers: zolder = dakvolume (72 m³), dakoppervlak = grondvlak / cos 45°
  const k = kerncijfers(m);
  const z = k.niveaus.find((n) => n.id === 'Z');
  dichtbij(z.volume, 72, 1e-6);
  dichtbij(k.dak.hellendNieuw, 24 / Math.cos(Math.PI / 4), 1e-6);
});

test('validator: basisHoogte ≥ 0, hogeZijde enkel bij lessenaar', () => {
  assert.ok(validate(model({ ...DAK, basisHoogte: -10 })).fouten.some((f) => f.pad.endsWith('basisHoogte')));
  assert.ok(validate(model({ ...DAK, hogeZijde: 'links' })).fouten.some((f) => f.pad.endsWith('hogeZijde')));
  const zadel = validate(model({ ...DAK, type: 'zadel' }));
  assert.ok(zadel.geldig);
  assert.ok(zadel.waarschuwingen.some((w) => w.pad.endsWith('hogeZijde')));
  const plat = validate(model({ ...zonder(DAK, 'hogeZijde'), type: 'plat', helling: 0 }));
  assert.ok(plat.geldig);
  assert.ok(plat.waarschuwingen.some((w) => w.pad.endsWith('basisHoogte')));
  // via applyOps
  const basis = model(zonder(DAK, 'basisHoogte'));
  assert.equal(applyOps(basis, [{ op: 'wijzigen', collectie: 'daken', id: 'D1', velden: { basisHoogte: -1 } }]).ok, false);
  const r2 = applyOps(basis, [{ op: 'wijzigen', collectie: 'daken', id: 'D1', velden: { basisHoogte: 800 } }]);
  assert.ok(r2.ok);
  dichtbij(dakNokHoogte(r2.model.daken[0]), 4800);
});

test('concept asymmetrisch dak: geldig, programma voldoet, dakvlakken sluiten aan op de nok', async () => {
  const { readFileSync } = await import('node:fs');
  const { migreer, toetsProgramma, begrenzing } = await import('../js/model/index.js');
  const m = migreer(JSON.parse(readFileSync(new URL('../designs/concept-asymmetrisch-dak.json', import.meta.url), 'utf8')));
  const v = validate(m);
  assert.ok(v.geldig, JSON.stringify(v.fouten));
  assert.ok(toetsProgramma(m).resultaten.every((r) => r.status === 'voldoet'));
  const actief = m.daken.filter((d) => d.status !== 'afbraak' && d.type === 'lessenaar');
  const achter = actief.find((d) => d.hogeZijde === 'min');
  assert.ok(achter && achter.basisHoogte > 0 && achter.helling === 28.5);
  // nok: onderkant van het voordak (stuk dat aan de nok grenst) = onderkant van het achterdak, ± 2 mm (afronding)
  const yn = begrenzing(achter.contour).minY;
  const voor = actief.find((d) => d !== achter && Math.abs(begrenzing(d.contour).maxY - yn) < 1);
  assert.ok(voor, 'voordakvlak sluit aan op de nok');
  dichtbij(dakHoogteIn(voor, 3500, yn), dakHoogteIn(achter, 3500, yn), 2);
  // geen gevelvulling midden in de zolder (enkel buitenranden)
  const b = begrenzing(m.daken.find((d) => d.id === 'D1').contour);
  for (const d of m.daken) for (const g of zichtbareDakGevels(m, d, 5)) {
    const ys = g.punten.map((p) => p[1]), xs = g.punten.map((p) => p[0]);
    const opRand = xs.every((x) => Math.abs(x - b.minX) < 1) || xs.every((x) => Math.abs(x - b.maxX) < 1)
      || ys.every((y) => Math.abs(y - b.minY) < 1) || ys.every((y) => Math.abs(y - b.maxY) < 1);
    assert.ok(opRand, `${d.id}: gevelvulling niet op de buitenrand`);
  }
});
