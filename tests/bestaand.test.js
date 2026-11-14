// Sanity-checks op designs/bestaand.json (bestaande toestand uit het plan, kader 'origineel').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validate, muurLengte, muurHoogte, polygoonOppervlakte, begrenzing, buitenMuren, buitenContour, ruimteContourBijPunt,
} from '../js/model/index.js';

const model = () => JSON.parse(readFileSync(new URL('../designs/bestaand.json', import.meta.url), 'utf8'));
const woning = (m, niveau) => m.muren.filter((w) => w.niveau === niveau && w.start[0] >= 0 && w.eind[0] >= 0 && w.start[1] < 13000);

test('bestaand: geldig, id en naam', () => {
  const m = model();
  const r = validate(m);
  assert.equal(r.geldig, true, JSON.stringify(r.fouten));
  assert.equal(m.id, 'bestaand');
  assert.equal(m.naam, 'Bestaande toestand');
  const index = JSON.parse(readFileSync(new URL('../designs/index.json', import.meta.url), 'utf8'));
  assert.equal(index.ontwerpen.find((o) => o.id === 'bestaand')?.naam, m.naam);
});

test('bestaand: twee niveaus, alles bestaand', () => {
  const m = model();
  assert.deepEqual(m.niveaus.map((n) => n.id), ['N0', 'N1']);
  for (const c of ['muren', 'openingen', 'vloeren', 'daken']) for (const x of m[c]) assert.equal(x.status, 'bestaand', `${c} ${x.id}`);
});

test('bestaand: woning bruto 7000 × 12500 op N0, 7000 × 8000 op N1', () => {
  const m = model();
  const b0 = begrenzing(buitenContour({ ...m, muren: woning(m, 'N0') }, 'N0'));
  assert.deepEqual([b0.minX, b0.minY, b0.maxX, b0.maxY], [0, 0, 7000, 12500]);
  const b1 = begrenzing(buitenContour(m, 'N1'));
  assert.deepEqual([b1.minX, b1.minY, b1.maxX, b1.maxY], [0, 0, 7000, 8000]);
  const v1 = m.vloeren.find((v) => v.niveau === 'N0' && v.contour.some(([x, y]) => x === 7000 && y === 12500));
  assert.ok(v1, 'vloer N0 over de hele woning');
});

test('bestaand: openingen liggen binnen hun muur en overlappen niet', () => {
  const m = model();
  for (const o of m.openingen) {
    const w = m.muren.find((x) => x.id === o.muur);
    assert.ok(w, o.id);
    assert.ok(o.positie >= 0 && o.positie + o.breedte <= muurLengte(w), `${o.id} binnen ${w.id}`);
    assert.ok(o.borstwering + o.hoogte <= muurHoogte(m, w), `${o.id} hoogte`);
  }
});

test('bestaand: gevelopeningen uit het plan (aantallen)', () => {
  const m = model();
  const tel = (niveau, filter) => m.openingen.filter((o) => {
    const w = m.muren.find((x) => x.id === o.muur);
    return w.niveau === niveau && filter(w);
  }).length;
  const voor = (w) => w.start[1] === 140 && w.eind[1] === 140;
  const links = (w) => w.start[0] === 140 && w.eind[0] === 140;
  assert.equal(tel('N0', voor), 4);   // wc-raam, voordeur, zijlicht, breed raam
  assert.equal(tel('N0', links), 4);
  assert.equal(tel('N1', voor), 2);
  assert.equal(tel('N1', links), 2);
});

test('bestaand: buitenmuren zijn gesloten en elke ruimte is detecteerbaar', () => {
  const m = model();
  const b0 = buitenMuren({ ...m, muren: woning(m, 'N0') }, 'N0');
  // geen binnenmuren op de rand ⇒ plan is gesloten
  for (const id of b0) {
    const w = m.muren.find((x) => x.id === id);
    const opRand = [140, 6930].includes(w.start[0]) && w.start[0] === w.eind[0] || [140, 12360].includes(w.start[1]) && w.start[1] === w.eind[1];
    assert.ok(opRand, `${id} hoort geen buitenmuur te zijn`);
  }
  for (const r of m.ruimtes) {
    // een punt net binnen de eerste hoek van de contour vindt dezelfde ruimte terug
    const [x, y] = r.contour[0];
    const c = ruimteContourBijPunt(m, r.niveau, [x + 20, y + 20]);
    assert.ok(c, r.naam);
    assert.ok(Math.abs(polygoonOppervlakte(c) - polygoonOppervlakte(r.contour)) < 1, r.naam);
  }
});

test('bestaand: kerncijfers van de ruimtes', () => {
  const m = model();
  const m2 = (niveau) => m.ruimtes.filter((r) => r.niveau === niveau && r.contour.every(([x]) => x >= 0))
    .reduce((s, r) => s + polygoonOppervlakte(r.contour), 0) / 1e6;
  assert.ok(Math.abs(m2('N0') - 73.87) < 0.05, `N0 ${m2('N0')}`);
  assert.ok(Math.abs(m2('N1') - 47.0) < 0.05, `N1 ${m2('N1')}`);
  const daken = m.daken.map((d) => d.type).sort();
  assert.deepEqual(daken, ['plat', 'plat', 'plat', 'zadel']);
});
