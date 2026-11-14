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

// Sinds de IFC/STEP-opmeting (dak 38,5° i.p.v. 45°, contour y 482…7498) kan de dakkapel achter niet meer volledig in de
// slaapkamer achter liggen én er vrije hoogte ≥ 2200 geven: het dak bereikt 2200 mm pas op y ≈ 4732, vóór wand B (STEP,
// y 4665…4825). De dakkapel (vrije hoogte 2300) loopt daarom ±220 mm over wand B door boven de overloop. Getoetst: het voorvlak
// ligt in een slaapkamer, ≥ 85 % van de voetafdruk ligt in die slaapkamer en de rest enkel boven een hal (overloop).
const fractieIn = (voetafdruk, contour, n = 40) => {
  const xs = voetafdruk.map((p) => p[0]), ys = voetafdruk.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let in_ = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (puntInPolygoon([x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)], contour)) in_++;
  return in_ / (n * n);
};

test('variant zolder-dakkapellen: één dakkapel voor en één achter, elk (grotendeels) in een slaapkamer op de zolder', () => {
  assert.deepEqual(m.dakkapellen.map((k) => k.zijde).sort(), ['achter', 'voor']);
  const dak = m.daken.find((d) => d.id === m.dakkapellen[0].dak);
  assert.equal(dak.type, 'zadel', 'in het bestaande zadeldak');
  for (const k of m.dakkapellen) {
    const g = dakkapelGeometrie(m, k);
    assert.equal(g.fout, undefined);
    assert.equal(g.referentie.niveau, zolder.id);
    // voorvlak = de rand van de voetafdruk aan de gootzijde (voor: kleinste y, achter: grootste y)
    const ys = g.voetafdruk.map((p) => p[1]);
    const yVoorvlak = k.zijde === 'voor' ? Math.min(...ys) : Math.max(...ys);
    const voorvlak = g.voetafdruk.filter((p) => Math.abs(p[1] - yVoorvlak) < 1);
    const kamer = m.ruimtes.find((r) => r.niveau === zolder.id && r.functie === 'slaapkamer' && voorvlak.every((p) => puntInPolygoon(p, polygoonOffset(r.contour, 1))));
    assert.ok(kamer, `voorvlak van ${k.id} ligt in een slaapkamer`);
    const f = fractieIn(g.voetafdruk, polygoonOffset(kamer.contour, 1));
    assert.ok(f >= 0.85, `${k.id}: ${Math.round(f * 100)} % in ${kamer.naam}`);
    if (f < 0.999) {
      const rest = m.ruimtes.filter((r) => r.niveau === zolder.id && r.id !== kamer.id && fractieIn(g.voetafdruk, r.contour) > 0.001);
      assert.ok(rest.every((r) => r.functie === 'hal'), `${k.id} steekt enkel boven een hal uit: ${rest.map((r) => r.naam)}`);
    }
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
