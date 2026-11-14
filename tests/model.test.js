import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validate, applyOps, Geschiedenis, diff, beschrijfDiff, volgendId, dupliceer, leegModel, naarJson,
  polygoonOppervlakte, muurLengte, dakNokHoogte, dakVolume, dakHoogteIn, afstandTotSegment, puntInPolygoon,
} from '../js/model/index.js';

const voorbeeld = () => JSON.parse(readFileSync(new URL('../designs/voorbeeld.json', import.meta.url), 'utf8'));
const paden = (r) => r.fouten.map((f) => f.pad);

test('voorbeeldontwerp is geldig', () => {
  const r = validate(voorbeeld());
  assert.equal(r.geldig, true, JSON.stringify(r.fouten));
});

test('leeg model is geldig', () => assert.equal(validate(leegModel()).geldig, true));

test('validator vangt typische fouten', () => {
  const m = voorbeeld();
  m.muren[0].status = 'gesloopt';
  m.muren[1].niveau = 'N9';
  m.openingen[0].breedte = 99999;
  m.ruimtes[0].contour = [[0, 0], [1, 1]];
  m.niveaus[0].hoogte = -5;
  const r = validate(m);
  assert.equal(r.geldig, false);
  for (const p of ['muren[0].status', 'muren[1].niveau', 'openingen[0]', 'ruimtes[0].contour', 'niveaus[0].hoogte'])
    assert.ok(paden(r).includes(p), `verwacht fout op ${p}, kreeg ${paden(r)}`);
});

test('validator: dubbele id over collecties heen', () => {
  const m = voorbeeld();
  m.ruimtes[0].id = 'M1';
  assert.equal(validate(m).geldig, false);
});

test('validator: opening hoger dan muur en overlappende openingen', () => {
  const m = voorbeeld();
  m.openingen[1].hoogte = 2500; // borstwering 700 + 2500 > 2900
  m.openingen[0].positie = 2900; // overlapt met O2 (positie 3000)
  const r = validate(m);
  assert.equal(r.geldig, false);
  assert.equal(r.fouten.length >= 2, true);
});

test('validator: onrealistische maat (meters i.p.v. mm?) en geen object', () => {
  assert.equal(validate(null).geldig, false);
  const m = voorbeeld(); m.muren[0].dikte = 5e6;
  assert.equal(validate(m).geldig, false);
});

test('applyOps toevoegen met automatisch id, origineel ongewijzigd', () => {
  const m = voorbeeld();
  const kopie = JSON.stringify(m);
  const r = applyOps(m, [{ op: 'toevoegen', collectie: 'muren', item: { niveau: 'N0', start: [0, 15000], eind: [3000, 15000], dikte: 200, status: 'nieuw' } }]);
  assert.equal(r.ok, true, JSON.stringify(r.fouten));
  assert.equal(r.nieuweIds[0], 'M16');
  assert.equal(r.model.muren.length, m.muren.length + 1);
  assert.equal(JSON.stringify(m), kopie);
});

test('applyOps is atomair: één ongeldige operatie ⇒ niets toegepast', () => {
  const m = voorbeeld();
  const r = applyOps(m, [
    { op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: 400 } },
    { op: 'wijzigen', collectie: 'muren', id: 'BESTAATNIET', velden: { dikte: 400 } },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.model, m);
  assert.match(r.fouten[0].melding, /niet gevonden/);
});

test('applyOps weigert resultaat dat validatie faalt', () => {
  const r = applyOps(voorbeeld(), { op: 'wijzigen', collectie: 'openingen', id: 'O1', velden: { breedte: 50000 } });
  assert.equal(r.ok, false);
});

test('wijzigen: onbekend veld en verplicht veld wissen geweigerd; optioneel veld wissen mag', () => {
  const m = voorbeeld();
  assert.equal(applyOps(m, { op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { kleur: 'rood' } }).ok, false);
  assert.equal(applyOps(m, { op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: null } }).ok, false);
  const r = applyOps(m, { op: 'wijzigen', collectie: 'daken', id: 'D1', velden: { overstek: null } });
  assert.equal(r.ok, true);
  assert.equal('overstek' in r.model.daken.find((d) => d.id === 'D1'), false);
});

test('verwijderen muur cascadeert naar openingen; niveau naar alles erop', () => {
  const m = voorbeeld();
  const r = applyOps(m, { op: 'verwijderen', collectie: 'muren', id: 'M1' });
  assert.equal(r.ok, true);
  assert.equal(r.model.openingen.some((o) => o.muur === 'M1'), false);
  const r2 = applyOps(m, { op: 'verwijderen', collectie: 'niveaus', id: 'N1' });
  assert.equal(r2.ok, true, JSON.stringify(r2.fouten));
  for (const c of ['muren', 'ruimtes', 'vloeren', 'daken']) assert.equal(r2.model[c].some((x) => x.niveau === 'N1'), false);
  assert.equal(r2.model.openingen.some((o) => o.id === 'O6'), false);
});

test('verplaatsen muur en ruimte', () => {
  const r = applyOps(voorbeeld(), [
    { op: 'verplaatsen', collectie: 'muren', id: 'M6', dx: 500, dy: 0 },
    { op: 'verplaatsen', collectie: 'ruimtes', id: 'R1', dx: 0, dy: 100 },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.model.muren.find((x) => x.id === 'M6').start, [4000, 150]);
  assert.equal(r.model.ruimtes.find((x) => x.id === 'R1').contour[0][1], 400);
});

test('ontwerp-operatie wijzigt naam, weigert onbekend veld', () => {
  const m = voorbeeld();
  assert.equal(applyOps(m, { op: 'ontwerp', velden: { naam: 'X' } }).model.naam, 'X');
  assert.equal(applyOps(m, { op: 'ontwerp', velden: { id: 'y' } }).ok, false);
  assert.equal(applyOps(m, { op: 'iets' }).ok, false);
});

test('geschiedenis: undo/redo en redo wordt gewist na nieuwe stap', () => {
  const g = new Geschiedenis(voorbeeld());
  let meldingen = 0;
  g.opWijziging(() => meldingen++);
  g.toepassen({ op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: 350 } });
  g.toepassen({ op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: 400 } });
  assert.equal(g.huidig.muren[0].dikte, 400);
  g.undo(); assert.equal(g.huidig.muren[0].dikte, 350);
  g.undo(); assert.equal(g.huidig.muren[0].dikte, 300);
  assert.equal(g.kanUndo, false);
  g.redo(); assert.equal(g.huidig.muren[0].dikte, 350);
  g.toepassen({ op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: 500 } });
  assert.equal(g.kanRedo, false);
  assert.equal(meldingen, 6);
  // mislukte operatie = geen stap
  const voor = g.verleden.length;
  g.toepassen({ op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: -1 } });
  assert.equal(g.verleden.length, voor);
});

test('diff en beschrijving', () => {
  const a = voorbeeld();
  const b = applyOps(a, [
    { op: 'wijzigen', collectie: 'muren', id: 'M1', velden: { dikte: 350 } },
    { op: 'verwijderen', collectie: 'openingen', id: 'O5' },
    { op: 'toevoegen', collectie: 'ruimtes', item: { niveau: 'N0', naam: 'Berging', functie: 'berging', contour: [[0, 20000], [1000, 20000], [1000, 21000]] } },
  ]).model;
  const d = diff(a, b);
  assert.deepEqual(d.map((x) => x.soort).sort(), ['gewijzigd', 'toegevoegd', 'verwijderd']);
  const tekst = beschrijfDiff(d).join('\n');
  assert.match(tekst, /M1: dikte 300 → 350/);
});

test('volgendId en dupliceer', () => {
  const m = voorbeeld();
  assert.equal(volgendId(m, 'openingen'), 'O11');
  const d = dupliceer(m, 'variant-a', 'Variant A');
  assert.equal(d.basis, 'voorbeeld');
  assert.equal(validate(d).geldig, true);
});

test('naarJson is stabiel en terug inleesbaar', () => {
  const m = voorbeeld();
  const s = naarJson(m);
  assert.deepEqual(JSON.parse(s), m);
  assert.match(s, /\[150, 150\]/);
});

test('geometrie', () => {
  assert.equal(polygoonOppervlakte([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]), 12e6);
  assert.equal(muurLengte({ start: [0, 0], eind: [3000, 4000] }), 5000);
  const zadel = { type: 'zadel', helling: 45, nokrichting: 'x', contour: [[0, 0], [7000, 0], [7000, 9000], [0, 9000]] };
  assert.ok(Math.abs(dakNokHoogte(zadel) - 4500) < 1e-6);
  assert.ok(Math.abs(dakHoogteIn(zadel, 1000, 4500) - 4500) < 1e-6);
  assert.ok(Math.abs(dakHoogteIn(zadel, 1000, 0)) < 1e-6);
  assert.ok(Math.abs(dakVolume(zadel) - 7000 * 9000 * 4500 / 2) < 1);
  const piramide = { type: 'schild', helling: 45, nokrichting: 'x', contour: [[0, 0], [6000, 0], [6000, 6000], [0, 6000]] };
  assert.ok(Math.abs(dakVolume(piramide) - (6000 * 6000 * 3000) / 3) < 1);
  assert.equal(dakVolume({ type: 'plat', helling: 0, contour: zadel.contour }), 0);
  assert.equal(afstandTotSegment([5, 5], [0, 0], [10, 0]).afstand, 5);
  assert.equal(puntInPolygoon([1, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]), true);
  assert.equal(puntInPolygoon([3, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]), false);
});
