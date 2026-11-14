// Tests voor js/ui/snap.js (puur, geen DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snap, snapDelta } from '../js/ui/snap.js';

const model = JSON.parse(readFileSync(new URL('../designs/voorbeeld.json', import.meta.url), 'utf8'));
const opt = (extra = {}) => ({ model, niveau: 'N0', raster: 50, tolerantie: 200, ...extra });

test('snap: eindpunt heeft voorrang', () => {
  const r = snap([6800, 200], opt());
  assert.equal(r.soort, 'eindpunt');
  assert.deepEqual(r.punt, [6850, 150]);
  assert.ok(['M1', 'M2'].includes(r.doel));
});

test('snap: enkel muren van het gevraagde niveau en niet in negeer', () => {
  // M15 (N1) eindpunt [4000, 8850] telt niet op N0
  assert.notEqual(snap([4000, 8900], opt()).doel, 'M15');
  const r = snap([6800, 200], opt({ negeer: ['M1', 'M2'] }));
  assert.notEqual(r.soort, 'eindpunt');
});

test('snap: midden van een muur', () => {
  const r = snap([3480, 2300], opt({ negeer: ['M6'] })); // M6 genegeerd
  assert.notEqual(r.doel, 'M6');
  const r2 = snap([3480, 11800], opt({ tolerantie: 100 })); // midden M8 = [3500, 11850]
  assert.equal(r2.soort, 'midden');
  assert.deepEqual(r2.punt, [3500, 11850]);
  assert.equal(r2.doel, 'M8');
});

test('snap: op de muuras, positie langs de muur op raster', () => {
  const r = snap([1234, 230], opt());
  assert.equal(r.soort, 'muur');
  assert.equal(r.doel, 'M1');
  assert.deepEqual(r.punt, [1250, 150]); // t = 1084 → 1100 vanaf start x=150
});

test('snap: op de muuras met ortho vanuit vanaf (loodrecht op muur)', () => {
  const r = snap([1013, 230], opt({ vanaf: [1013, 3000] }));
  assert.equal(r.soort, 'muur');
  assert.deepEqual(r.punt, [1013, 150]);
  assert.equal(r.hulplijnen.length, 1);
});

test('snap: uitlijning met x/y van bestaande eindpunten', () => {
  const r = snap([3520, 14000], opt());
  assert.equal(r.soort, 'uitlijning');
  assert.deepEqual(r.punt, [3500, 14000]); // x van M6
  assert.ok(r.hulplijnen.length >= 1);
  const beide = snap([3480, 13900], opt({ tolerantie: 100 })); // x = 3500 (M6), y: geen eindpunt binnen 100
  assert.deepEqual(beide.punt, [3500, 13900]);
});

test('snap: ortho t.o.v. vanaf met lengte op raster', () => {
  const r = snap([10000 + 2014, 15200], opt({ vanaf: [10000, 15000], tolerantie: 20 }));
  assert.equal(r.soort, 'ortho');
  assert.deepEqual(r.punt, [12000, 15000]);
  const v = snap([10200, 15000 + 2990], opt({ vanaf: [10000, 15000], tolerantie: 20 }));
  assert.deepEqual(v.punt, [10000, 18000]);
  // buiten 7° ⇒ geen ortho
  const s = snap([11000, 16000], opt({ vanaf: [10000, 15000], tolerantie: 20 }));
  assert.equal(s.soort, 'raster');
  // ortho uit ⇒ raster
  assert.equal(snap([12014, 15200], opt({ vanaf: [10000, 15000], ortho: false, tolerantie: 20 })).soort, 'raster');
});

test('snap: ortho + uitlijning op eindpunt van een andere muur', () => {
  // horizontaal tekenen vanaf [10000, 15000]; x = 6850 is een eindpunt-x
  const r = snap([6900, 15100], opt({ vanaf: [10000, 15000] }));
  assert.equal(r.soort, 'uitlijning');
  assert.deepEqual(r.punt, [6850, 15000]);
});

test('snap: raster en geen', () => {
  const r = snap([20012, 20037], opt());
  assert.equal(r.soort, 'raster');
  assert.deepEqual(r.punt, [20000, 20050]);
  const g = snap([20012, 20037], opt({ raster: 0 }));
  assert.equal(g.soort, 'geen');
  assert.deepEqual(g.punt, [20012, 20037]);
  assert.deepEqual(snap([-20, -10], { model: { muren: [] }, niveau: 'N0' }).punt, [0, 0]);
});

test('snapDelta: array én {dx, dy}', () => {
  const d = snapDelta(123, -26);
  assert.deepEqual([...d], [100, -50]);
  assert.equal(d.dx, 100);
  assert.equal(d.dy, -50);
  const [a, b] = snapDelta(-20, 20, 100);
  assert.ok(Object.is(a, 0) && Object.is(b, 0));
});
