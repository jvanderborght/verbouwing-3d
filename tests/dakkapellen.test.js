// Dakkapellen (optionele collectie `dakkapellen`): schema, geometrie, vrije hoogte, validatie, operaties, bewerking,
// kerncijfers, weergave-bouwstenen, eigenschappen en macro. Alle verwachte waarden zijn met de hand nagerekend
// op een eenvoudig testmodel (los van designs/, zodat wijzigingen aan bestaand.json de tests niet raken).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  COLLECTIES, COLLECTIE_NAMEN, VELDEN, OPTIONELE_COLLECTIES, leegModel, validate, applyOps, migreer, naarJson, diff,
  dakkapelGeometrie, dakkapelNiveau, dakkapelVerhoging, vlakMinRechthoek, vlakkenMetUitsparingen, dakkapelDelen, dakVlakken,
  opsDakkapelPlaatsen, vrijeHoogte, oppervlaktePerHoogteband, hoogtelijnen, muurProfielen, polygoonOppervlakte, INSTELLINGEN_STANDAARD,
} from '../js/model/index.js';
import { kerncijfers } from '../js/metrics/kerncijfers.js';
import { vergelijkingsRijen } from '../js/metrics/vergelijk.js';
import { raming } from '../js/metrics/kosten.js';
import { dakkapelSymbool } from '../js/views/symbolen.js';
import { raakElement, verborgenIds } from '../js/views/bouwstenen.js';
import { veldRijen, elementLabel, niveauVanElement, ENKELVOUD, MEERVOUD } from '../js/ui/eigenschappen.js';
import { dakkapelInfoTekst } from '../js/ui/dakkapelpaneel.js';
import { vouwUit } from '../js/ai/macros.js';

/**
 * Testmodel: verdieping N1 (peil 3000, hoogte 2800 ⇒ rustvlak 5800), zadeldak D1 45° op 0…7000 × 0…8000, nok langs x
 * (nok op y 4000, 4000 mm boven het rustvlak), zolder N2 op peil 5800 met vloer = dakcontour.
 * Onderkant dak boven de zoldervloer in (x, y) = min(y, 8000 − y) (tan 45° = 1).
 */
function model(extra = {}) {
  return {
    ...leegModel('test', 'Test'),
    niveaus: [
      { id: 'N0', naam: 'Gelijkvloers', peil: 0, hoogte: 3000 },
      { id: 'N1', naam: 'Verdieping', peil: 3000, hoogte: 2800 },
      { id: 'N2', naam: 'Zolder', peil: 5800, hoogte: 4000, soort: 'zolder' },
    ],
    vloeren: [{ id: 'V1', niveau: 'N2', contour: [[0, 0], [7000, 0], [7000, 8000], [0, 8000]], dikte: 200, status: 'nieuw' }],
    daken: [{ id: 'D1', niveau: 'N1', type: 'zadel', contour: [[0, 0], [7000, 0], [7000, 8000], [0, 8000]], helling: 45, nokrichting: 'x', overstek: 500, dikte: 300, status: 'bestaand' }],
    ...extra,
  };
}
/** Dakkapel voor: midden x 4860, onderkant 1000 boven de zoldervloer, 2000 breed, voorvlak 1400 hoog, raam 1400 × 1100. */
const K1 = { id: 'K1', dak: 'D1', zijde: 'voor', positieX: 4860, positieZ: 1000, breedte: 2000, hoogte: 1400, raam: { breedte: 1400, hoogte: 1100 }, status: 'nieuw' };
const met = (...k) => model({ dakkapellen: k });
const bijna = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

// ---------------------------------------------------------------- schema en migratie

test('schema: collectie dakkapellen (K), optioneel; bestaande ontwerpen blijven geldig zonder het veld', () => {
  assert.equal(COLLECTIES.dakkapellen, 'K');
  assert.ok(COLLECTIE_NAMEN.includes('dakkapellen') && OPTIONELE_COLLECTIES.includes('dakkapellen'));
  for (const v of ['dak', 'zijde', 'positieX', 'positieZ', 'breedte', 'hoogte', 'status']) assert.ok(VELDEN.dakkapellen.find(([n, , verpl]) => n === v && verpl), v);
  for (const v of ['type', 'diepte', 'dakdikte', 'zijwangDikte', 'raam']) assert.ok(VELDEN.dakkapellen.find(([n, , verpl]) => n === v && !verpl), v);
  assert.equal('dakkapellen' in leegModel(), false, 'leeg model heeft geen (lege) dakkapellen-lijst nodig');
  const m = model();
  assert.equal(validate(m).geldig, true);
  assert.equal(validate({ ...m, dakkapellen: [] }).geldig, true);
  assert.equal(validate({ ...m, dakkapellen: {} }).geldig, false, 'geen lijst ⇒ fout');
  // alle ontwerpen in designs/ blijven geldig en ongewijzigd na migratie (geen nieuwe schemaVersie)
  for (const f of readdirSync(new URL('../designs/', import.meta.url)).filter((x) => x.endsWith('.json') && !['index.json', 'prijzen.json'].includes(x))) {
    const tekst = readFileSync(new URL(`../designs/${f}`, import.meta.url), 'utf8');
    const ontwerp = JSON.parse(tekst);
    assert.equal(validate(migreer(ontwerp)).geldig, true, f);
    if (!ontwerp.dakkapellen) assert.equal('dakkapellen' in migreer(ontwerp), false, `${f}: migratie voegt niets toe`);
  }
});

// ---------------------------------------------------------------- geometrie

test('geometrie: voorvlak, diepte, plafond, voetafdruk, raam, oppervlaktes en volume (nagerekend)', () => {
  const m = met(K1);
  const g = dakkapelGeometrie(m, K1);
  assert.equal(g.fout, undefined);
  assert.equal(g.referentie.niveau, 'N2');
  // h(d) = d ⇒ voorvlak op d = positieZ = 1000 (y = 1000); dakje op 1000 + 1400 = 2400 ⇒ snijdt het dak op y = 2400
  bijna(g.dVoor, 1000); bijna(g.diepte, 1400); bijna(g.dAchter, 2400);
  assert.equal(g.achterwand, false);
  bijna(g.zOnder, 6800); bijna(g.plafond, 8200); bijna(g.zTop, 8200 + INSTELLINGEN_STANDAARD.dakkapel.dakdikte.waarde);
  bijna(g.u0, 3860); bijna(g.u1, 5860);
  const b = (p) => p.map(([x, y]) => [Math.round(x), Math.round(y)]);
  assert.deepEqual(b(g.voetafdruk), [[3860, 1000], [5860, 1000], [5860, 2400], [3860, 2400]]);
  const w = INSTELLINGEN_STANDAARD.dakkapel.zijwangDikte.waarde; // 120
  assert.deepEqual(b(g.binnen), [[3860 + w, 1000 + w], [5860 - w, 1000 + w], [5860 - w, 2400], [3860 + w, 2400]]);
  // raam gecentreerd, onderaan het voorvlak (borstwering leeg = positieZ)
  assert.deepEqual([g.raam.u0, g.raam.u1, g.raam.z0, g.raam.z1], [4160, 5560, 6800, 7900]);
  bijna(g.voorvlakM2, 2.8); bijna(g.raamM2, 1.54);
  // volume = breedte × driehoek (1400 × 1400 / 2) = 2000 × 980 000 mm² = 1,96 m³
  bijna(g.volume / 1e9, 1.96, 1e-6);
});

test('geometrie: achterzijde (goot op y 8000) en nokrichting y (zijde links/rechts)', () => {
  const k = { ...K1, id: 'K2', zijde: 'achter' };
  const g = dakkapelGeometrie(met(k), k);
  bijna(g.dVoor, 1000);
  const ys = g.voetafdruk.map((p) => p[1]);
  bijna(Math.min(...ys), 5600); bijna(Math.max(...ys), 7000);
  // dak met nok langs y: zijde rechts ⇒ goot op x = 7000, positieX is een y-coördinaat
  const m2 = model();
  m2.daken[0] = { ...m2.daken[0], nokrichting: 'y' };
  const k3 = { ...K1, id: 'K3', zijde: 'rechts', positieX: 4000 };
  const g3 = dakkapelGeometrie({ ...m2, dakkapellen: [k3] }, k3);
  assert.equal(g3.fout, undefined);
  const xs = g3.voetafdruk.map((p) => p[0]), ys3 = g3.voetafdruk.map((p) => p[1]);
  bijna(Math.min(...xs), 4600); bijna(Math.max(...xs), 6000);
  bijna(Math.min(...ys3), 3000); bijna(Math.max(...ys3), 5000);
  assert.match(dakkapelGeometrie(m2, { ...K1, zijde: 'voor' }).fout, /past niet bij nokrichting y/);
});

test('geometrie: kortere diepte ⇒ achterwand; langere diepte, nok, goot, rand, plat dak, raam ⇒ fout', () => {
  const kort = { ...K1, diepte: 1000 };
  const g = dakkapelGeometrie(met(kort), kort);
  assert.equal(g.achterwand, true); bijna(g.diepte, 1000);
  // volume = 2000 × ∫₀¹⁰⁰⁰ (1400 − d) dd = 2000 × (1 400 000 − 500 000) = 1,8 m³
  bijna(g.volume / 1e9, 1.8, 1e-6);
  const f = (k) => dakkapelGeometrie(met(k), k).fout || '';
  assert.match(f({ ...K1, diepte: 1500 }), /groter dan tot waar het dakje het hoofddak snijdt/);
  assert.match(f({ ...K1, hoogte: 3100 }), /boven de nok/); // 1000 + 3100 > 4000
  assert.match(f({ ...K1, hoogte: 3100 }), /max\. hoogte bij deze positie z: 3000 mm/);
  assert.equal(f({ ...K1, hoogte: 3000 }), ''); // precies tot de nok mag
  assert.match(f({ ...K1, positieZ: -100 }), /onder de goot/);
  assert.match(f({ ...K1, positieX: 500 }), /buiten het dakvlak langs de nok/); // u0 = −500
  assert.match(f({ ...K1, breedte: 200 }), /te smal/);
  assert.match(f({ ...K1, raam: { breedte: 1900, hoogte: 1000 } }), /breder dan het voorvlak/); // 2000 − 2 × 120 = 1760
  assert.match(f({ ...K1, raam: { breedte: 1000, hoogte: 1000, borstwering: 1500 } }), /boven het voorvlak/); // 2500 > 2400
  assert.match(f({ ...K1, raam: { breedte: 1000, hoogte: 1000, borstwering: 900 } }), /onder de onderkant/);
  const m = met(K1);
  m.daken[0] = { ...m.daken[0], type: 'plat', helling: 0 };
  assert.match(dakkapelGeometrie(m, K1).fout, /plat/);
  // lessenaar (hoge rand aan max y): enkel zijde voor stijgt vanaf de goot
  const l = met(K1);
  l.daken[0] = { ...l.daken[0], type: 'lessenaar', helling: 20 };
  assert.match(dakkapelGeometrie(l, { ...K1, zijde: 'achter' }).fout, /stijgt niet vanaf de goot/);
  // schilddak: dicht bij de kopse kant raakt de dakkapel de hoekkeper
  const s = met(K1);
  s.daken[0] = { ...s.daken[0], type: 'schild' };
  assert.equal(dakkapelGeometrie(s, { ...K1, positieX: 3500 }).fout, undefined);
  assert.match(dakkapelGeometrie(s, { ...K1, positieX: 1600, positieZ: 500, hoogte: 500, raam: undefined }).fout, /hoekkeper/); // u0 = 600: h(600, d) = min(d, 600)
});

test('geometrie: zonder zolderniveau geldt positie z t.o.v. het rustvlak (waarschuwing)', () => {
  const m = met(K1);
  m.niveaus = m.niveaus.filter((n) => n.id !== 'N2');
  m.vloeren = [];
  const g = dakkapelGeometrie(m, K1);
  assert.equal(g.referentie.niveau, null);
  bijna(g.zOnder, 6800);
  assert.equal(dakkapelNiveau(m, K1), 'N1');
  const r = validate(m);
  assert.equal(r.geldig, true);
  assert.ok(r.waarschuwingen.some((w) => /geen niveau \(zolder\)/.test(w.melding)));
});

// ---------------------------------------------------------------- vrije hoogte, hoogtebanden, muren

test('vrije hoogte: binnen de dakkapel = positieZ + hoogte, erbuiten en onder de wangen ongewijzigd', () => {
  const zonder = model(), m = met(K1);
  assert.equal(vrijeHoogte(zonder, 'N2', [4860, 1500]), 1500);
  assert.equal(vrijeHoogte(m, 'N2', [4860, 1500]), 2400);
  assert.equal(vrijeHoogte(m, 'N2', [4860, 3000]), 3000, 'achter de dakkapel: het dak is hoger dan haar plafond');
  assert.equal(vrijeHoogte(m, 'N2', [4860, 900]), 900, 'vóór het voorvlak');
  assert.equal(vrijeHoogte(m, 'N2', [3900, 1500]), 1500, 'onder de zijwang (3860…3980)');
  assert.equal(vrijeHoogte(m, 'N2', [6000, 1500]), 1500, 'naast de dakkapel');
  // afbraak telt niet
  assert.equal(vrijeHoogte(met({ ...K1, status: 'afbraak' }), 'N2', [4860, 1500]), 1500);
  const kap = dakkapelVerhoging(m);
  assert.equal(kap(m.daken[0], [4860, 1500], 1500), 2400);
  assert.equal(kap(m.daken[0], [100, 1500], 1500), 1500);
});

test('hoogtebanden en hoogtelijnen: de dakkapel vergroot de oppervlakte met vrije hoogte ≥ 2200', () => {
  const ruimte = { id: 'R1', niveau: 'N2', naam: 'Slaapkamer', functie: 'slaapkamer', contour: [[3000, 500], [7000, 500], [7000, 3500], [3000, 3500]], hoogtegrenzen: [1500, 2200] };
  const zonder = oppervlaktePerHoogteband(model({ ruimtes: [ruimte] }), 'R1');
  const metK = oppervlaktePerHoogteband(met(K1), ruimte);
  // zonder: ≥ 2200 waar y ≥ 2200 ⇒ 4000 × 1300 = 5,2 m²; [1500, 2200): 4000 × 700 = 2,8 m²
  bijna(zonder.banden[2].m2, 5.2, 0.02); bijna(zonder.banden[1].m2, 2.8, 0.02);
  // met: + binnenzone x 3980…5740 (1760) × y 1120…2200 (1080) = 1,9008 m² naar ≥ 2200 (± halve rastercel langs de randen)
  bijna(metK.banden[2].m2, 5.2 + 1.9008, 0.06);
  bijna(metK.m2, zonder.m2, 1e-9);
  // hoogtelijn 2200: een extra lus rond de dakkapel ⇒ gebied ≥ 2200 groter
  const opp = (m) => hoogtelijnen(m, 'N2', [2200])[0].gebieden.reduce((s, c) => s + polygoonOppervlakte(c), 0) / 1e6;
  assert.ok(opp(met(K1)) > opp(model()) + 1.8);
});

test('muurprofiel: een zolderwand onder de dakkapel loopt tot haar plafond', () => {
  const wand = { id: 'M1', niveau: 'N2', start: [3000, 1800], eind: [6500, 1800], dikte: 100, status: 'nieuw' };
  const top = (m, t) => { const p = muurProfielen(m, wand, 0, 3500); const z = p.links.find(([tt]) => Math.abs(tt - t) < 1)?.[1]; return z ?? p.links.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))[1]; };
  bijna(top(model({ muren: [wand] }), 1860), 1850, 1); // zijvlak op y 1850: h = 1850
  bijna(top(met(K1), 1860), 2400, 1); // x = 4860 ligt in de dakkapel
  bijna(top(met(K1), 500), 1850, 1); // x = 3500 ernaast
});

// ---------------------------------------------------------------- validatie

test('validatie: overlap in hetzelfde dakvlak = fout; voor en achter mag; raamvorm; afbraakdak = waarschuwing', () => {
  const K2 = { ...K1, id: 'K2', positieX: 3000 }; // 2000…4000 overlapt met 3860…5860
  const r = validate(met(K1, K2));
  assert.equal(r.geldig, false);
  assert.ok(r.fouten.some((f) => /overlapt met K1/.test(f.melding)));
  assert.equal(validate(met(K1, { ...K2, positieX: 2800 })).geldig, true, '1800…3800 raakt 3860 niet');
  assert.equal(validate(met(K1, { ...K2, zijde: 'achter' })).geldig, true);
  assert.equal(validate(met(K1, { ...K2, status: 'afbraak' })).geldig, true, 'afbraak telt niet voor overlap');
  const ruw = validate(met({ ...K1, raam: { breedte: -5, hoogte: 1000, kleur: 'wit' } }));
  assert.ok(ruw.fouten.some((f) => f.pad === 'dakkapellen[0].raam.breedte'));
  assert.ok(ruw.waarschuwingen.some((f) => f.pad === 'dakkapellen[0].raam.kleur'));
  assert.ok(validate(met({ ...K1, dak: 'D9' })).fouten.some((f) => /onbekend dak/.test(f.melding)));
  assert.ok(validate(met({ ...K1, zijde: 'boven' })).fouten.some((f) => f.pad === 'dakkapellen[0].zijde'));
  assert.ok(validate(met({ ...K1, hoogte: 0 })).fouten.some((f) => f.pad === 'dakkapellen[0].hoogte'));
  const m = met(K1);
  m.daken[0].status = 'afbraak';
  assert.ok(validate(m).waarschuwingen.some((w) => /afgebroken/.test(w.melding)));
});

// ---------------------------------------------------------------- operaties en bewerking

test('operaties: toevoegen (id K…), wijzigen met validatie, verplaatsen langs de nok, cascade bij dak/niveau verwijderen', () => {
  let r = applyOps(model(), [{ op: 'toevoegen', collectie: 'dakkapellen', item: { ...K1, id: undefined } }]);
  assert.ok(r.ok);
  assert.equal(r.model.dakkapellen[0].id, 'K1');
  const m = r.model;
  assert.equal(applyOps(m, [{ op: 'wijzigen', collectie: 'dakkapellen', id: 'K1', velden: { hoogte: 3100 } }]).ok, false, 'boven de nok ⇒ geweigerd');
  r = applyOps(m, [{ op: 'wijzigen', collectie: 'dakkapellen', id: 'K1', velden: { hoogte: 1600, raam: null } }]);
  assert.ok(r.ok);
  assert.equal(r.model.dakkapellen[0].raam, undefined);
  r = applyOps(m, [{ op: 'verplaatsen', collectie: 'dakkapellen', id: 'K1', dx: -500, dy: 300 }]);
  assert.equal(r.model.dakkapellen[0].positieX, 4360, 'enkel de component langs de nok (x)');
  r = applyOps(m, [{ op: 'verwijderen', collectie: 'daken', id: 'D1' }]);
  assert.ok(r.ok);
  assert.deepEqual(r.model.dakkapellen, []);
  assert.equal(r.model.idTeller.K, 1, 'id K1 wordt niet hergebruikt');
  r = applyOps(m, [{ op: 'verwijderen', collectie: 'niveaus', id: 'N1' }]);
  assert.ok(r.ok && r.model.dakkapellen.length === 0);
  // diff kent de collectie
  assert.deepEqual(diff(model(), m).map((d) => `${d.soort} ${d.collectie} ${d.id}`), ['toegevoegd dakkapellen K1']);
  assert.match(naarJson(m), /"dakkapellen": \[/);
});

test('opsDakkapelPlaatsen: maten, tikpunt (zijde + positie), werkwaarden, fouten, geen overlap', () => {
  const m = model();
  let r = opsDakkapelPlaatsen(m, { dak: 'D1', zijde: 'voor', positieX: 4860, positieZ: 1000, breedte: 2000, hoogte: 1400, raam: { breedte: 1400, hoogte: 1100 } });
  assert.equal(r.fout, undefined);
  assert.deepEqual(r.ops[0].item, { ...K1 });
  bijna(r.info.diepte, 1400); assert.equal(r.info.vrijeHoogte, 2400); assert.equal(r.info.niveau, 'N2');
  // tikpunt in de achterste helft ⇒ zijde achter; positie z = hoogte van het dak in het tikpunt (8000 − 7000 = 1000)
  r = opsDakkapelPlaatsen(m, { dak: 'D1', punt: [3000, 7000], breedte: 1800, hoogte: 1200 });
  assert.equal(r.ops[0].item.zijde, 'achter');
  assert.equal(r.ops[0].item.positieX, 3000);
  assert.equal(r.ops[0].item.positieZ, 1000);
  // zonder maten: werkwaarden (gemeld in info.standaard)
  r = opsDakkapelPlaatsen(m, { dak: 'D1' });
  assert.equal(r.fout, undefined);
  assert.deepEqual(r.info.standaard.sort(), ['breedte', 'hoogte', 'positieZ']);
  assert.equal(r.ops[0].item.positieX, 3500);
  assert.match(opsDakkapelPlaatsen(m, { dak: 'D9' }).fout, /niet gevonden/);
  assert.match(opsDakkapelPlaatsen(m, { dak: 'D1', zijde: 'voor', positieX: 4860, positieZ: 1000, breedte: 2000, hoogte: 3500 }).fout, /boven de nok/);
  const m2 = met(K1);
  assert.match(opsDakkapelPlaatsen(m2, { dak: 'D1', zijde: 'voor', positieX: 4000, positieZ: 1000, breedte: 1000, hoogte: 1000 }).fout, /overlapt met K1/);
  r = opsDakkapelPlaatsen(m2, { dak: 'D1', zijde: 'voor', positieX: 2000, positieZ: 1000, breedte: 1500, hoogte: 1000 });
  assert.equal(r.ops[0].item.id, 'K2');
  assert.ok(applyOps(m2, r.ops).ok);
});

// ---------------------------------------------------------------- kerncijfers

test('kerncijfers: aantal, voorvlak, raam, volumetoename (bij het zolderniveau) en vergelijkingsrijen', () => {
  const mz = model(), mk = met(K1, { ...K1, id: 'K2', zijde: 'achter', raam: undefined });
  const zonder = kerncijfers(mz), metK = kerncijfers(mk);
  assert.deepEqual([zonder.dakkapellen.aantal, zonder.dakkapellen.volume], [0, 0]);
  const d = metK.dakkapellen;
  assert.equal(d.aantal, 2); assert.equal(d.nieuw, 2);
  bijna(d.voorvlakM2, 5.6); bijna(d.raamM2, 1.54); bijna(d.volume, 3.92, 1e-6);
  const zolder = (k) => k.niveaus.find((n) => n.id === 'N2').volume;
  bijna(zolder(metK) - zolder(zonder), 3.92, 1e-6);
  bijna(metK.volume.daken, zonder.volume.daken, 1e-9);
  const tabel = { rijen: vergelijkingsRijen([
    { naam: 'zonder', kerncijfers: zonder, raming: raming(mz, null, { kerncijfers: zonder }) },
    { naam: 'met', kerncijfers: metK, raming: raming(mk, null, { kerncijfers: metK }) }]) };
  const rij = (s) => tabel.rijen.find((x) => x.sleutel === s);
  assert.deepEqual(rij('dakkapellen').waarden, [0, 2]);
  bijna(rij('dakkapellen-volume').waarden[1], 3.92, 1e-6);
});

// ---------------------------------------------------------------- weergave-bouwstenen

test('3D: dakvlak min uitsparing (stukken, hoogtes geïnterpoleerd) en delen van de dakkapel', () => {
  const vlak = [[0, 0, 0], [10, 0, 0], [10, 10, 10], [0, 10, 10]]; // h = y
  const stukken = vlakMinRechthoek(vlak, { minX: 2, maxX: 4, minY: 3, maxY: 6 });
  assert.equal(stukken.length, 4);
  bijna(stukken.reduce((s, p) => s + polygoonOppervlakte(p), 0), 100 - 6);
  for (const p of stukken) for (const [, y, h] of p) bijna(h, y);
  assert.deepEqual(vlakMinRechthoek(vlak, { minX: 20, maxX: 30, minY: 0, maxY: 5 }), [vlak]);
  const m = met(K1);
  const voor = dakVlakken(m.daken[0]);
  const na = vlakkenMetUitsparingen(m, m.daken[0], voor);
  const som = (l) => l.reduce((s, p) => s + polygoonOppervlakte(p), 0);
  bijna(som(voor) - som(na), 2000 * 1400, 1);
  // voorvlak: 3 stukken rond het raam (links, rechts, erboven) + 2 wangen + dakje + kader (4) + glas
  const delen = dakkapelDelen(m, K1);
  const tel = (s) => delen.filter((x) => x.soort === s).length;
  assert.deepEqual([tel('wand'), tel('dak'), tel('kader'), tel('glas')], [5, 1, 4, 1]);
  const dakje = delen.find((x) => x.soort === 'dak');
  assert.ok(dakje.punten.every((p) => Math.abs(p[2] - (8200 + 200)) < 1e-6));
  // zijwang = driehoek: (voorvlak, onderkant) → (dakje snijdt het dak) → (voorvlak, plafond)
  const wang = delen.filter((x) => x.soort === 'wand').find((x) => x.punten.length === 3);
  assert.deepEqual(wang.punten.map((p) => p.map(Math.round)), [[3860, 1000, 6800], [3860, 2400, 8200], [3860, 1000, 8200]]);
  assert.deepEqual(dakkapelDelen(m, { ...K1, hoogte: 9000 }), []);
});

test('2D: symbool op het zolderniveau (contour, voorvlak, maat = breedte), raakbaar; verborgen met haar dak', () => {
  const m = met(K1);
  const s = dakkapelSymbool(m, K1, 'N2');
  assert.ok(s);
  assert.equal(dakkapelSymbool(m, K1, 'N1'), null);
  assert.equal(s.maat.tekst, '2000');
  assert.ok(s.maat.van[1] < 1000, 'maatlijn aan de gootzijde');
  assert.equal(s.label.tekst, 'Dakkapel K1');
  assert.equal(raakElement(m, 'N2', [4860, 1800]), 'K1');
  assert.equal(raakElement(m, 'N2', [1000, 1800]), null);
  assert.ok(verborgenIds(m, ['N1']).has('K1'));
  assert.ok(!verborgenIds(m, ['N0']).has('K1'));
});

// ---------------------------------------------------------------- eigenschappen en macro

test('eigenschappen: labels, raamrij, element op het zolderniveau, afgeleide info', () => {
  const m = met(K1);
  assert.equal(ENKELVOUD.dakkapellen, 'Dakkapel');
  assert.equal(MEERVOUD.dakkapellen, 'Dakkapellen');
  const rijen = veldRijen(m, 'dakkapellen', K1);
  const r = (v) => rijen.find((x) => x.veld === v);
  assert.equal(r('hoogte').label, 'Hoogte');
  assert.equal(r('breedte').label, 'Breedte');
  assert.equal(r('positieX').label, 'Positie x');
  assert.equal(r('positieZ').label, 'Positie z (onderkant boven zoldervloer)');
  assert.equal(r('positieZ').soort, 'getal');
  assert.equal(r('raam').soort, 'raam');
  assert.equal(r('zijde').soort, 'keuze');
  assert.equal(r('dak').soort, 'ref');
  assert.equal(elementLabel(m, 'dakkapellen', K1), 'K1 · voor 2000×1400 · nieuw');
  assert.equal(niveauVanElement(m, 'K1'), 'N2');
  const t = dakkapelInfoTekst(m, K1);
  assert.match(t, /vrije hoogte eronder 2\.?400 mm/);
  assert.match(t, /volume \+1,96 m³/);
});

test('macro dakkapelPlaatsen: gevraagd id, raam uit raamBreedte/raamHoogte (0 = geen raam), fout als het niet past', () => {
  const m = model();
  const u = vouwUit(m, [{ op: 'dakkapelPlaatsen', id: 'K7', dak: 'D1', zijde: 'voor', positieX: 4860, positieZ: 1000, breedte: 2000, hoogte: 1400, raamBreedte: 1400, raamHoogte: 1100 }]);
  assert.ok(u.ok, JSON.stringify(u.fouten));
  assert.equal(u.ops[0].item.id, 'K7');
  assert.deepEqual(u.ops[0].item.raam, { breedte: 1400, hoogte: 1100 });
  const zonder = vouwUit(m, [{ op: 'dakkapelPlaatsen', id: '', dak: 'D1', zijde: 'achter', positieX: 3000, positieZ: 0, breedte: 1500, hoogte: 1500, raamBreedte: 0, raamHoogte: 0 }]);
  assert.ok(zonder.ok);
  assert.equal(zonder.ops[0].item.raam, undefined);
  assert.equal(zonder.ops[0].item.positieZ, 0, 'positie z 0 = voorvlak in het gevelvlak (goot)');
  const fout = vouwUit(m, [{ op: 'dakkapelPlaatsen', id: 'K1', dak: 'D1', zijde: 'voor', positieX: 4860, positieZ: 1000, breedte: 2000, hoogte: 3500, raamBreedte: 0, raamHoogte: 0 }]);
  assert.equal(fout.ok, false);
  assert.match(fout.fouten[0].melding, /boven de nok/);
});
