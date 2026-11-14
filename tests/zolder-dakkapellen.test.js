// Variant designs/zolder-dakkapellen.json (gegenereerd door tools/voorbeelden/maak-zolder-dakkapellen.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  migreer, validate, dakkapelGeometrie, toetsProgramma, oppervlaktePerHoogteband, puntInPolygoon, polygoonOffset,
} from '../js/model/index.js';
import { kerncijfers } from '../js/metrics/kerncijfers.js';

const lees = (f) => migreer(JSON.parse(readFileSync(new URL(`../designs/${f}`, import.meta.url), 'utf8')));
const m = lees('zolder-dakkapellen.json');
const zolder = m.niveaus.find((n) => n.soort === 'zolder');

test('variant zolder-dakkapellen: geldig, in index.json, basis bestaand, programma voldoet', () => {
  assert.equal(validate(m).geldig, true);
  const index = JSON.parse(readFileSync(new URL('../designs/index.json', import.meta.url), 'utf8'));
  assert.ok(index.ontwerpen.some((o) => o.id === 'zolder-dakkapellen'));
  assert.equal(m.basis, 'bestaand');
  assert.ok(zolder);
  const t = toetsProgramma(m);
  assert.equal(t.samenvatting['voldoet niet'], 0);
  assert.equal(t.samenvatting.onbekend, 0);
  assert.equal(m.trappen.filter((x) => x.naarNiveau === zolder.id && x.status !== 'afbraak').length, 1);
});

test('variant zolder-dakkapellen: één dakkapel voor en één achter, elk volledig in een slaapkamer op de zolder', () => {
  assert.deepEqual(m.dakkapellen.map((k) => k.zijde).sort(), ['achter', 'voor']);
  const dak = m.daken.find((d) => d.id === m.dakkapellen[0].dak);
  assert.equal(dak.type, 'zadel', 'in het bestaande zadeldak');
  for (const k of m.dakkapellen) {
    const g = dakkapelGeometrie(m, k);
    assert.equal(g.fout, undefined);
    assert.equal(g.referentie.niveau, zolder.id);
    const kamer = m.ruimtes.find((r) => r.niveau === zolder.id && r.functie === 'slaapkamer' && g.voetafdruk.every((p) => puntInPolygoon(p, polygoonOffset(r.contour, 1))));
    assert.ok(kamer, `${k.id} ligt in een slaapkamer`);
    assert.ok(k.raam && g.raamM2 > 0, `${k.id} heeft een raam`);
    // de dakkapel vergroot de oppervlakte met vrije hoogte ≥ 2200 in die kamer
    const zonder = oppervlaktePerHoogteband({ ...m, dakkapellen: [] }, kamer.id, [1500, 2200]).banden[2].m2;
    const met = oppervlaktePerHoogteband(m, kamer.id, [1500, 2200]).banden[2].m2;
    assert.ok(met > zonder + 1, `${kamer.naam}: ${zonder} → ${met}`);
  }
  const k = kerncijfers(m);
  assert.equal(k.dakkapellen.aantal, 2);
  assert.ok(k.dakkapellen.volume > 3);
});
