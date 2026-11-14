// Bestaande toestand met hoogtes, bestaande trap en dak uit het 3D-model van de gebruiker (IFC/STEP; niet in de repo),
// en de variant "Zolder volgens programma — trap in bestaande traphal" (tools/voorbeelden/maak-zolder-trap-hal.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validate, migreer, trapGeometrie, trapMaten, trapgat, vrijeHoogte, oppervlaktePerHoogteband, toetsProgramma, begrenzing,
  polygoonOppervlakte, dakHoogteIn, niveauBovenkant,
} from '../js/model/index.js';

const lees = (id) => migreer(JSON.parse(readFileSync(new URL(`../designs/${id}.json`, import.meta.url), 'utf8')));
const dichtbij = (a, b, eps = 1, tekst = '') => assert.ok(Math.abs(a - b) <= eps, `${tekst} ${a} ≉ ${b}`);
const el = (m, c, id) => m[c].find((x) => x.id === id);
const TAN = Math.tan((38.5 * Math.PI) / 180);

test('bestaand: hoogtes uit het IFC (vloer-tot-vloer 2775, vloerdiktes 160 / 185, zolder op 5550)', () => {
  const m = lees('bestaand');
  const [n0, n1, n2] = m.niveaus;
  assert.deepEqual([n0.peil, n0.hoogte], [0, 2775]);
  assert.deepEqual([n1.peil, n1.hoogte, n1.vloerdikte, n1.soort], [2775, 2775, 160, 'verdieping']);
  assert.deepEqual([n2.naam, n2.soort, n2.peil, n2.vloerdikte], ['Zolder', 'zolder', 5550, 185]);
  assert.equal(el(m, 'vloeren', 'V2').dikte, 160);
  const zv = m.vloeren.filter((v) => v.niveau === 'N2');
  assert.equal(zv.length, 1);
  assert.equal(zv[0].dikte, 185);
  assert.equal(zv[0].status, 'bestaand');
  // alle openingen passen in de nieuwe hoogtes
  for (const o of m.openingen) assert.ok(o.borstwering + o.hoogte <= 2775, o.id);
});

test('bestaand: dak uit de STEP — symmetrisch zadeldak 38,5°, ondervlak raakt de zoldervloer op y 482 en 7498, nok ±8340', () => {
  const m = lees('bestaand');
  const d = el(m, 'daken', 'D1');
  assert.deepEqual([d.type, d.helling, d.nokrichting, d.dikte, d.overstek], ['zadel', 38.5, 'x', 300, 480]);
  const b = begrenzing(d.contour);
  assert.deepEqual([b.minY, b.maxY], [482, 7498]);
  const rust = niveauBovenkant(m, 'N1');
  assert.equal(rust, 5550);
  dichtbij(rust + dakHoogteIn(d, 3500, 3990), 8340, 3, 'ondervlak nok');
  assert.equal(el(m, 'niveaus', 'N2').hoogte, Math.round(3508 * TAN));
  // ondervlak, doorgetrokken in de overstek tot de buitenzijde van de voorgevel: 5550 − 482 · tan 38,5° ≈ 5167
  // (= bovenvlak op de zoldervloer min 383 mm verticale dakdikte, zoals in de STEP)
  dichtbij(rust - 482 * TAN, 5550 - 383, 2, 'ondervlak aan de gevel');
  // vrije hoogte op de zolder = (y − 482) · tan 38,5°
  dichtbij(vrijeHoogte(m, 'N2', [3500, 2000]), (2000 - 482) * TAN, 1);
  dichtbij(vrijeHoogte(m, 'N2', [3500, 6000]), (7498 - 6000) * TAN, 1);
});

test('bestaand: bestaande trap T1 (GV → verdieping) — 15 × 185, vereenvoudigd tot kwarttrap in de hal', () => {
  const m = lees('bestaand');
  assert.equal(m.trappen.length, 1);
  const t = m.trappen[0];
  assert.deepEqual([t.id, t.vanNiveau, t.naarNiveau, t.type, t.draairichting, t.status], ['T1', 'N0', 'N1', 'kwart', 'rechts', 'bestaand']);
  const g = trapGeometrie(m, t);
  assert.deepEqual([g.maten.aantalTreden, g.maten.optrede, g.maten.treden], [15, 185, 14]);
  // binnen de hal (GV: x 280..2720, y 1870..4680) en onder de overloop (VD: y 2770..4680)
  const b = begrenzing(g.voetafdruk);
  assert.ok(b.minX >= 280 && b.maxX <= 2720 && b.minY >= 2770 && b.maxY <= 4680, JSON.stringify(b));
  // aankomst naar +x op de overloop (laatste trede ligt rechts van de draai)
  const laatste = begrenzing(g.treden.at(-1).contour);
  assert.ok(laatste.minX >= 1080 && laatste.minY >= 3885);
  // enige waarschuwing van het ontwerp: de wand van de kast ónder de trap (M10) ligt in plan onder T1
  assert.deepEqual(validate(m).waarschuwingen.map((w) => w.melding), ['Trap T1 overlapt met muur M10 op niveau N0.']);
});

test('variant zolder-programma-trap-hal: geldig, afbraak, nieuwe trap uit het IFC in de traphal, geen slaapkamer opgeofferd', () => {
  const b = lees('bestaand');
  const m = lees('zolder-programma-trap-hal');
  const r = validate(m);
  assert.ok(r.geldig, JSON.stringify(r.fouten));
  assert.equal(r.waarschuwingen.length, 1); // T1 / M10 zoals in bestaand
  assert.equal(m.basis, 'bestaand');
  const index = JSON.parse(readFileSync(new URL('../designs/index.json', import.meta.url), 'utf8'));
  assert.equal(index.ontwerpen.find((o) => o.id === m.id)?.naam, m.naam);
  // afbraak achterbouw + garage 2
  for (const id of ['M3', 'M12', 'M13', 'M27', 'M28', 'M29']) assert.equal(el(m, 'muren', id).status, 'afbraak', id);
  for (const id of ['D2', 'D4']) assert.equal(el(m, 'daken', id).status, 'afbraak', id);
  // verdieping ongemoeid: dezelfde muren en de 3 slaapkamers
  assert.deepEqual(m.muren.filter((x) => x.niveau === 'N1'), b.muren.filter((x) => x.niveau === 'N1'));
  assert.equal(m.ruimtes.filter((x) => x.niveau === 'N1' && x.functie === 'slaapkamer').length, 3);
  // nieuwe trap: halfdraai N1 → zolder, 15 × 185, aantrede 200, breedte 740, start op de voorrand van de IFC-trede 1
  const t = m.trappen.find((x) => x.status === 'nieuw');
  assert.deepEqual([t.vanNiveau, t.naarNiveau, t.type, t.richting, t.draairichting, t.breedte, t.aantrede, t.optrede, t.aantalTreden],
    ['N1', 'N2', 'halfdraai', 180, 'rechts', 740, 200, 185, 15]);
  assert.deepEqual(t.oorsprong, [1830, 3185]);
  const maten = trapMaten(m, t);
  assert.deepEqual([maten.vluchten, maten.draaitreden], [[4, 4], 6]);
  // trapgat in de zoldervloer binnen de bestaande traphal (VD-overloop x 280..2720, y 2770..4680)
  const gat = begrenzing(trapgat(m, t).contour);
  assert.deepEqual([gat.minX, gat.minY, gat.maxX, gat.maxY], [290, 2815, 1830, 4295]);
  // geen zolderwand in het trapgat: de enige waarschuwing (hierboven) gaat over T1
  assert.match(r.waarschuwingen[0].melding, /Trap T1 /);
});

test('variant zolder-programma-trap-hal: programma voldoet; douche op de nok; hoogtebanden', () => {
  const m = lees('zolder-programma-trap-hal');
  const t = toetsProgramma(m);
  assert.deepEqual(t.samenvatting, { voldoet: 6, 'voldoet niet': 0, onbekend: 0 });
  const zolder = m.ruimtes.filter((x) => x.niveau === 'N2');
  assert.deepEqual(zolder.map((x) => x.functie).sort(), ['badkamer', 'berging', 'hal', 'slaapkamer', 'slaapkamer', 'trap']);
  // ruimtes overlappen niet (som = oppervlakte van de unie, ruw via de contouren)
  const som = zolder.reduce((s, r) => s + polygoonOppervlakte(r.contour), 0) / 1e6;
  assert.ok(som < 7 * 7.016, `${som}`);
  const douche = m.inrichting.find((x) => x.soort === 'douche');
  assert.equal(douche.hoogte, 2100);
  // banden: de slaapkamers hebben elk ≥ 1,5 m² met vrije hoogte ≥ 2,20 m (voorbeeldgrenzen, geen norm)
  for (const r of zolder.filter((x) => x.functie === 'slaapkamer')) {
    const b = oppervlaktePerHoogteband(m, r, [1500, 2200]);
    assert.ok(b.banden[2].m2 >= 1.5, `${r.naam} ${b.banden[2].m2}`);
  }
});
