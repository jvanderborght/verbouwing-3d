// Kerncijfers, kostenraming en vergelijkingstabel (js/metrics). Alle verwachte waarden zijn met de hand nagerekend
// (berekening in het commentaar bij elke assert).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, applyOps, dupliceer } from '../js/model/index.js';
import {
  kerncijfers, raming, leesPrijzen, dakOppervlak, btwTekst, POST_SLEUTELS,
  vergelijkingsRijen, naarCsv, csvGetal, fmtGetal, fmtM2, fmtM3, fmtBedrag, fmtDelta,
} from '../js/metrics/index.js';

const lees = (f) => JSON.parse(readFileSync(new URL(`../designs/${f}`, import.meta.url), 'utf8'));
const dichtbij = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/**
 * Doos van 5 × 4 m (muurassen), muren 200 mm dik, één niveau van 2800 mm.
 * Vloer = buitenzijde muren: 5,2 × 4,2 m. Ruimte = binnenzijde: 4,8 × 3,8 m.
 */
function doos() {
  return {
    schemaVersie: 1, id: 'doos', naam: 'Doos', beschrijving: '',
    niveaus: [{ id: 'N0', naam: 'Gelijkvloers', peil: 0, hoogte: 2800 }],
    muren: [
      { id: 'M1', niveau: 'N0', start: [0, 0], eind: [5000, 0], dikte: 200, status: 'bestaand' },
      { id: 'M2', niveau: 'N0', start: [5000, 0], eind: [5000, 4000], dikte: 200, status: 'bestaand' },
      { id: 'M3', niveau: 'N0', start: [5000, 4000], eind: [0, 4000], dikte: 200, status: 'bestaand' },
      { id: 'M4', niveau: 'N0', start: [0, 4000], eind: [0, 0], dikte: 200, status: 'bestaand' },
    ],
    openingen: [],
    ruimtes: [{ id: 'R1', niveau: 'N0', naam: 'Leefruimte', functie: 'leefruimte', contour: [[100, 100], [4900, 100], [4900, 3900], [100, 3900]] }],
    vloeren: [{ id: 'V1', niveau: 'N0', contour: [[-100, -100], [5100, -100], [5100, 4100], [-100, 4100]], dikte: 300, status: 'bestaand' }],
    daken: [],
  };
}

/** Doos + 1 nieuwe binnenmuur (met nieuwe deur) + 1 nieuw raam in een bestaande muur (= doorbraak) + nieuw plat dak. */
function doosVerbouwd() {
  const m = doos();
  m.muren.push({ id: 'M5', niveau: 'N0', start: [2500, 100], eind: [2500, 3900], dikte: 100, status: 'nieuw' });
  m.openingen.push(
    { id: 'O1', muur: 'M1', type: 'raam', positie: 1000, breedte: 1200, hoogte: 1500, borstwering: 900, status: 'nieuw' },
    { id: 'O2', muur: 'M5', type: 'deur', positie: 500, breedte: 900, hoogte: 2100, borstwering: 0, status: 'nieuw' },
  );
  m.daken.push({ id: 'D1', niveau: 'N0', type: 'plat', contour: [[-100, -100], [5100, -100], [5100, 4100], [-100, 4100]], helling: 0, overstek: 0, status: 'nieuw' });
  return m;
}

test('testmodellen zijn geldig', () => {
  for (const m of [doos(), doosVerbouwd()]) assert.equal(validate(m).geldig, true, JSON.stringify(validate(m).fouten));
});

test('doos 5×4 m: bruto, netto en volume', () => {
  const k = kerncijfers(doos());
  dichtbij(k.niveaus[0].bruto, 21.84);      // 5,2 × 4,2
  assert.equal(k.niveaus[0].brutoBron, 'vloeren');
  dichtbij(k.niveaus[0].netto, 18.24);      // 4,8 × 3,8
  dichtbij(k.volume.totaal, 61.152);        // 21,84 × 2,8 (geen dak)
  dichtbij(k.bruto, 21.84);
  assert.deepEqual(k.muren, { nieuwBuiten: 0, nieuwBinnen: 0, afbraak: 0, doorbraken: 0 });
  assert.equal(k.vloerNieuw, 0);
});

test('doos zonder vloer: bruto = buitencontour van de muren', () => {
  const m = doos();
  m.vloeren = [];
  const k = kerncijfers(m);
  dichtbij(k.niveaus[0].bruto, 21.84);      // buitenzijde muren 5,2 × 4,2
  assert.equal(k.niveaus[0].brutoBron, 'buitencontour');
});

test('afbraakvloer telt niet mee (terugval op buitencontour); niveau zonder muren en vloer = 0', () => {
  const m = doos();
  m.vloeren[0].status = 'afbraak';
  m.vloeren.push({ id: 'V2', niveau: 'N0', contour: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], dikte: 100, status: 'nieuw' });
  dichtbij(kerncijfers(m).niveaus[0].bruto, 1);          // enkel de nieuwe vloer van 1 × 1 m
  m.niveaus.push({ id: 'N1', naam: 'Leeg', peil: 2800, hoogte: 2500 });
  const k = kerncijfers(m);
  assert.equal(k.niveaus[1].bruto, 0);
  assert.equal(k.niveaus[1].brutoBron, 'geen');
  dichtbij(k.vloerNieuw, 1);
});

test('doos met 1 nieuwe binnenmuur, 1 nieuw raam en 1 nieuwe deur', () => {
  const k = kerncijfers(doosVerbouwd());
  // M5: 3,8 m × 2,8 m = 10,64 m² − deur 0,9 × 2,1 = 1,89 m² ⇒ 8,75 m² binnenmuur
  dichtbij(k.muren.nieuwBinnen, 8.75);
  assert.equal(k.muren.nieuwBuiten, 0);
  // nieuw raam 1,2 × 1,5 = 1,8 m² in een bestaande muur ⇒ doorbraak
  dichtbij(k.muren.doorbraken, 1.8);
  assert.equal(k.muren.afbraak, 0);
  assert.equal(k.ramen.nieuw.aantal, 1);
  dichtbij(k.ramen.nieuw.m2, 1.8);
  assert.deepEqual(k.deuren, { bestaand: 0, nieuw: 1, afbraak: 0 });
  // plat dak zonder overstek = 5,2 × 4,2
  dichtbij(k.dak.platNieuw, 21.84);
  assert.equal(k.dak.hellendNieuw, 0);
  assert.equal(k.dak.bestaand, 0);
  // plat dak voegt geen volume toe
  dichtbij(k.volume.totaal, 61.152);
});

test('nieuwe buitenmuur met nieuw raam (geen doorbraak) en afbraakmuur (bruto, zonder aftrek)', () => {
  const m = doosVerbouwd();
  m.muren.find((x) => x.id === 'M3').status = 'nieuw';                 // achtergevel nieuw: 5 m × 2,8 m = 14 m²
  m.openingen.push({ id: 'O3', muur: 'M3', type: 'raam', positie: 1000, breedte: 2000, hoogte: 1000, borstwering: 1000, status: 'nieuw' }); // 2 m²
  m.muren.find((x) => x.id === 'M5').status = 'afbraak';               // binnenmuur wordt afbraak: 3,8 × 2,8 = 10,64 m² bruto
  const k = kerncijfers(m);
  dichtbij(k.muren.nieuwBuiten, 12);        // 14 − 2
  assert.equal(k.muren.nieuwBinnen, 0);
  dichtbij(k.muren.afbraak, 10.64);         // deur in de afbraakmuur wordt NIET afgetrokken
  dichtbij(k.muren.doorbraken, 1.8);        // enkel O1 (O3 zit in een nieuwe muur, O2 in een afbraakmuur)
  assert.equal(k.ramen.nieuw.aantal, 2);
  dichtbij(k.ramen.nieuw.m2, 3.8);          // 1,8 + 2
});

test('zadeldak met gekende helling: oppervlak en volume', () => {
  // grondvlak 6 × 8 m, nok evenwijdig met x, helling 30°, overstek 0,5 m
  const dak = { id: 'D1', niveau: 'N0', type: 'zadel', contour: [[0, 0], [6000, 0], [6000, 8000], [0, 8000]], helling: 30, nokrichting: 'x', overstek: 500, status: 'nieuw' };
  // (6 + 1) × (8 + 1) = 63 m² / cos 30° (0,8660254) = 72,7461 m²
  dichtbij(dakOppervlak(dak), 63 / Math.cos(Math.PI / 6));
  dichtbij(dakOppervlak(dak), 72.746134, 1e-5);
  const m = doos();
  m.daken.push(dak);
  const k = kerncijfers(m);
  dichtbij(k.dak.hellendNieuw, 72.746134, 1e-5);
  // nokhoogte = 4 m × tan 30° = 2,309401 m; volume = 6 × 8 × 2,309401 / 2 = 55,425626 m³
  dichtbij(k.volume.daken, 55.425626, 1e-5);
  dichtbij(k.volume.totaal, 61.152 + 55.425626, 1e-5);
  // een afbraakdak telt niet mee
  m.daken[0].status = 'afbraak';
  const k2 = kerncijfers(m);
  assert.equal(k2.dak.totaal, 0);
  assert.equal(k2.volume.daken, 0);
});

test('plat dak met overstek: grondvlak incl. overstek', () => {
  const dak = { id: 'D1', niveau: 'N0', type: 'plat', contour: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], helling: 0, overstek: 200, status: 'bestaand' };
  dichtbij(dakOppervlak(dak), 5.4 * 4.4); // 23,76 m²
  // L-vormig plat dak: 6×4 − 3×2 = 18 m² (geen overstek)
  dichtbij(dakOppervlak({ ...dak, overstek: 0, contour: [[0, 0], [6000, 0], [6000, 2000], [3000, 2000], [3000, 4000], [0, 4000]] }), 18);
});

// ---------------------------------------------------------------- raming

const PRIJZEN = {
  valuta: 'EUR', btw: 'excl',
  eenheidsprijzen: {
    muur_nieuw_buiten: { eenheid: 'm²', prijs: 200, bereik: [150, 250] },
    muur_nieuw_binnen: { eenheid: 'm²', prijs: 40, bereik: [30, 60], bron: ['https://voorbeeld.invalid/a', 'javascript:alert(1)'], opmerking: 'test' },
    muur_afbraak: { eenheid: 'm²', prijs: 20 },
    raam_nieuw: { eenheid: 'm²', prijs: null },
    deur_nieuw: { eenheid: 'stuk', prijs: 500 },
    vloer_nieuw: { eenheid: 'm²', prijs: 0 },
    dak_plat_nieuw: { eenheid: 'm²', prijs: 100 },
    dak_hellend_nieuw: { eenheid: 'm²', prijs: null },
    afwerking_nieuw_vloeroppervlak: { eenheid: 'm²', prijs: 50 },
    onbekend_ding: { eenheid: 'm²', prijs: 1 },
  },
};

test('raming doos: onvolledig door ontbrekende raamprijs, totaal = som gekende posten', () => {
  const r = raming(doosVerbouwd(), PRIJZEN);
  const post = Object.fromEntries(r.posten.map((p) => [p.sleutel, p]));
  dichtbij(post.muur_nieuw_binnen.bedrag, 8.75 * 40);   // 350
  dichtbij(post.muur_afbraak.bedrag, 1.8 * 20);         // 36 (doorbraak)
  assert.equal(post.raam_nieuw.bedrag, null);           // prijs null ⇒ geen bedrag
  assert.equal(post.deur_nieuw.bedrag, 500);
  dichtbij(post.dak_plat_nieuw.bedrag, 21.84 * 100);    // 2184
  assert.equal(post.dak_hellend_nieuw.bedrag, 0);       // hoeveelheid 0 ⇒ 0, ook zonder prijs
  assert.equal(post.vloer_nieuw.bedrag, 0);
  dichtbij(r.totaal, 350 + 36 + 500 + 2184);            // 3070 = "minstens"
  assert.equal(r.volledig, false);
  assert.deepEqual(r.ontbrekend, ['raam_nieuw']);
  assert.deepEqual(r.zonderPrijs, ['raam_nieuw', 'dak_hellend_nieuw']);
  assert.equal(r.btw, 'excl');
  assert.ok(r.waarschuwingen.some((w) => w.includes('onbekend_ding')));
  // bronnen: enkel http(s)-links
  assert.deepEqual(post.muur_nieuw_binnen.bron, ['https://voorbeeld.invalid/a']);
  assert.equal(post.muur_nieuw_binnen.opmerking, 'test');
  // bandbreedte: posten met bereik × min/max, andere × prijs; raam (geen prijs, geen bereik) ontbreekt
  dichtbij(r.bandbreedte.min, 8.75 * 30 + 36 + 500 + 2184);  // 2982,5
  dichtbij(r.bandbreedte.max, 8.75 * 60 + 36 + 500 + 2184);  // 3245
});

test('raming volledig als alle nodige prijzen gekend zijn', () => {
  const p = structuredClone(PRIJZEN);
  p.eenheidsprijzen.raam_nieuw.prijs = 400;
  const r = raming(doosVerbouwd(), p);
  assert.equal(r.volledig, true);
  dichtbij(r.totaal, 3070 + 1.8 * 400);                 // 3790
});

test('raming zonder prijzen.json of met alle prijzen null: nooit verzonnen bedragen', () => {
  for (const pj of [null, { eenheidsprijzen: {} }, lees('prijzen.json')]) {
    if (pj?.eenheidsprijzen && Object.keys(pj.eenheidsprijzen).length) for (const v of Object.values(pj.eenheidsprijzen)) { v.prijs = null; delete v.bereik; }
    const r = raming(doosVerbouwd(), pj);
    assert.equal(r.volledig, false);
    assert.equal(r.totaal, 0);
    assert.equal(r.bandbreedte, null);
    for (const p of r.posten) assert.ok(p.bedrag === 0 || p.bedrag === null);
  }
  assert.ok(leesPrijzen(null).waarschuwingen.length > 0);
  assert.ok(leesPrijzen({ eenheidsprijzen: {} }).waarschuwingen.some((w) => w.includes('ontbreekt')));
});

test('ongeldige prijs en bereik worden genegeerd met waarschuwing', () => {
  const l = leesPrijzen({ eenheidsprijzen: { raam_nieuw: { eenheid: 'm²', prijs: -5, bereik: [10, 5] }, deur_nieuw: { eenheid: 'stuk', prijs: '100' } } });
  assert.equal(l.prijzen.get('raam_nieuw').prijs, null);
  assert.equal(l.prijzen.get('raam_nieuw').bereik, null);
  assert.equal(l.prijzen.get('deur_nieuw').prijs, null);
  assert.ok(l.waarschuwingen.length >= 3);
});

test('btw-tekst: incl/excl of vrije tekst zoals in prijzen.json', () => {
  assert.equal(btwTekst('incl'), 'incl. btw');
  assert.equal(btwTekst('excl'), 'excl. btw');
  assert.equal(btwTekst(null), 'btw niet opgegeven in prijzen.json');
  assert.equal(btwTekst('gemengd'), 'btw: gemengd');
});

// ---------------------------------------------------------------- ontwerpen in designs/

test('bestaand.json: bruto, netto, volume en geen nieuwe muren', () => {
  const k = kerncijfers(lees('bestaand.json'));
  const [n0, n1] = k.niveaus;
  // N0: woning 7 × 12,5 = 87,5 m² + garages 4,95 × 7,8 = 38,61 en 3,5 × 6 = 21 ⇒ 147,11 m²
  dichtbij(n0.bruto, 87.5 + 38.61 + 21);
  // N1: 7 × 8 = 56 m²
  dichtbij(n1.bruto, 56);
  // volume: 147,11 × 3,0 + 56 × 2,8 + zadeldak 7 × 8 × (4 × tan 45°) / 2 = 441,33 + 156,8 + 112 = 710,13 m³
  dichtbij(k.volume.totaal, 710.13, 1e-6);
  assert.deepEqual(k.muren, { nieuwBuiten: 0, nieuwBinnen: 0, afbraak: 0, doorbraken: 0 });
  assert.equal(k.vloerNieuw, 0);
  assert.equal(k.ramen.nieuw.aantal, 0);
  assert.equal(k.deuren.nieuw, 0);
  // zadeldak 45°, overstek 0,5 m: (7 + 1) × (8 + 1) / cos 45° = 101,82 m²; platte daken 31,5 + 38,61 + 21 = 91,11 m²
  dichtbij(k.dak.hellendBestaand, 72 * Math.SQRT2);
  dichtbij(k.dak.platBestaand, 91.11);
  assert.ok(n0.netto > 0 && n0.netto < n0.bruto);
  assert.ok(n1.netto > 0 && n1.netto < n1.bruto);
  // niets te doen ⇒ raming = 0 en volledig
  const r = raming(lees('bestaand.json'), lees('prijzen.json'), { kerncijfers: k });
  assert.equal(r.totaal, 0);
  assert.equal(r.volledig, true);
});

test('voorbeeld.json: kerncijfers en raming', () => {
  const m = lees('voorbeeld.json');
  const k = kerncijfers(m);
  dichtbij(k.niveaus[0].bruto, 84);           // 7 × 9 + 7 × 3 (nieuwe aanbouw)
  dichtbij(k.niveaus[1].bruto, 63);           // 7 × 9
  dichtbij(k.vloerNieuw, 21);
  // nieuwe buitenmuren M7 + M8 + M9 = 3 + 6,7 + 3 = 12,7 m × 2,9 m = 36,83 − schuifraam 5 × 2,4 = 12 ⇒ 24,83 m²
  dichtbij(k.muren.nieuwBuiten, 24.83);
  // nieuwe binnenmuur M15: 4,35 × 2,7 = 11,745 − deur 0,8 × 2,1 = 1,68 ⇒ 10,065 m²
  dichtbij(k.muren.nieuwBinnen, 10.065);
  // afbraak M3: 6,7 × 2,9 = 19,43 m²
  dichtbij(k.muren.afbraak, 19.43);
  assert.equal(k.muren.doorbraken, 0);
  // zadeldak 40°, overstek 0,3: 7,6 × 9,6 / cos 40° = 95,2425 m²; nieuw plat dak 7 × 3 = 21 m²
  dichtbij(k.dak.hellendBestaand, 72.96 / Math.cos((40 * Math.PI) / 180));
  dichtbij(k.dak.platNieuw, 21);
  // volume: 84 × 2,9 + 63 × 2,7 + 7 × 9 × (4,5 × tan 40°) / 2
  dichtbij(k.volume.totaal, 243.6 + 170.1 + (63 * 4.5 * Math.tan((40 * Math.PI) / 180)) / 2);
  // raming = Σ hoeveelheid × prijs uit prijzen.json (niets hardgecodeerd)
  const pj = lees('prijzen.json');
  const r = raming(m, pj, { kerncijfers: k });
  let verwacht = 0, volledig = true;
  for (const p of r.posten) {
    const prijs = pj.eenheidsprijzen[p.sleutel]?.prijs ?? null;
    if (p.hoeveelheid === 0) continue;
    if (prijs == null) volledig = false; else verwacht += p.hoeveelheid * prijs;
  }
  dichtbij(r.totaal, verwacht);
  assert.equal(r.volledig, volledig);
});

test('alle sleutels uit prijzen.json zijn gekend', () => {
  const pj = lees('prijzen.json');
  assert.deepEqual(Object.keys(pj.eenheidsprijzen).sort(), [...POST_SLEUTELS].sort());
});

// ---------------------------------------------------------------- vergelijking en CSV

test('vergelijking: Δ t.o.v. referentie na een extra muur in een kopie van bestaand', () => {
  const ref = lees('bestaand.json');
  const kopie = dupliceer(ref, 'kopie', 'Kopie');
  // nieuwe binnenmuur van 2 m op N0 (3 m hoog, geen openingen) ⇒ +6 m² binnenmuur
  const r = applyOps(kopie, [{ op: 'toevoegen', collectie: 'muren', item: { niveau: 'N0', start: [1000, 2000], eind: [3000, 2000], dikte: 100, status: 'nieuw' } }]);
  assert.equal(r.ok, true);
  const pj = lees('prijzen.json');
  const vars = [ref, r.model].map((m) => { const k = kerncijfers(m); return { naam: m.naam, kerncijfers: k, raming: raming(m, pj, { kerncijfers: k }) }; });
  const rijen = vergelijkingsRijen(vars);
  const rij = (s) => rijen.find((x) => x.sleutel === s);
  assert.equal(rij('muur-nieuw-binnen').deltas[0], null);
  dichtbij(rij('muur-nieuw-binnen').deltas[1], 6);
  assert.equal(rij('bruto').deltas[1], 0);
  const prijsBinnen = pj.eenheidsprijzen.muur_nieuw_binnen.prijs;
  if (prijsBinnen != null) dichtbij(rij('raming-totaal').deltas[1], 6 * prijsBinnen);
  // rijen per niveau
  assert.ok(rij('bruto-N0') && rij('bruto-N1') && rij('netto-N1'));
});

test('vergelijking: Δ van een onvolledig totaal is onbekend', () => {
  const p = structuredClone(PRIJZEN);
  const a = doos(), b = doosVerbouwd();
  const vars = [a, b].map((m) => ({ naam: m.naam, kerncijfers: kerncijfers(m), raming: raming(m, p) }));
  const rijen = vergelijkingsRijen(vars);
  const tot = rijen.find((x) => x.sleutel === 'raming-totaal');
  assert.deepEqual(tot.minstens, [false, true]);
  assert.equal(tot.deltas[1], null);
  assert.equal(rijen.find((x) => x.sleutel === 'post-raam_nieuw').waarden[1], null);
  assert.ok(rijen.find((x) => x.sleutel === 'raming-min'));
});

test('CSV: puntkomma, decimale komma, BOM, minstens en "—"', () => {
  const vars = [doos(), doosVerbouwd()].map((m) => ({ naam: m.naam, kerncijfers: kerncijfers(m), raming: raming(m, PRIJZEN) }));
  const csv = naarCsv(['Doos', 'Doos; verbouwd'], vergelijkingsRijen(vars), { btw: 'excl', bijgewerkt: '2026-01-01' });
  assert.ok(csv.startsWith('﻿'));
  const regels = csv.slice(1).split('\r\n');
  assert.equal(regels[0], 'Groep;Kerncijfer;Eenheid;Doos (referentie);"Doos; verbouwd";"Δ Doos; verbouwd"');
  assert.ok(regels.includes('Oppervlakte;Bruto totaal;m²;21,84;21,84;0,00'), regels.slice(0, 6).join('\n'));
  assert.ok(regels.includes('Muren;Nieuwe binnenmuur;m²;0,00;8,75;8,75'));
  assert.ok(regels.some((r) => r.startsWith('Raming;Totaal raming;EUR;0;minstens 3070;')));
  assert.ok(regels.some((r) => r.startsWith('Raming;Nieuwe ramen (prijs ontbreekt);EUR;0;—;')));
  assert.ok(regels.some((r) => r.includes('Indicatief — geen offerte')));
  assert.ok(regels.includes('Btw: excl. btw'));
  assert.equal(csvGetal(-1234.567, 2), '-1234,57');
});

test('notatie nl-BE', () => {
  assert.equal(fmtGetal(1234.5, 2), '1.234,50');
  assert.equal(fmtM2(87.5), '87,50 m²');
  assert.equal(fmtM3(710.13), '710,1 m³');
  assert.equal(fmtGetal(-0.001, 2), '0,00');
  assert.match(fmtBedrag(22263.2, 'EUR'), /^€\s22\.263$/);
  assert.equal(fmtDelta(-3, { decimalen: 2, eenheid: 'm²' }), '−3,00 m²');
  assert.equal(fmtDelta(0.001, { decimalen: 2, eenheid: 'm²' }), '=');
});

test('prijsregel (CLAUDE.md): elke ingevulde prijs heeft bron, bereik en opmerking, en ligt binnen het bereik', async () => {
  const { readFileSync } = await import('node:fs');
  const p = JSON.parse(readFileSync(new URL('../designs/prijzen.json', import.meta.url), 'utf8'));
  // Strikt enkel zolang het opgezochte richtprijzen zijn (_herkomst aanwezig). Eigen offerteprijzen van de gebruiker
  // mogen zonder bron; dan enkel: prijs binnen bereik als er een bereik is.
  const opgezocht = typeof p._herkomst === 'string' && p._herkomst.length > 0;
  for (const [k, v] of Object.entries(p.eenheidsprijzen)) {
    if (v.prijs == null) continue;
    if (!opgezocht) {
      if (Array.isArray(v.bereik)) assert.ok(v.bereik[0] <= v.prijs && v.prijs <= v.bereik[1], `${k}: prijs buiten bereik`);
      continue;
    }
    assert.ok(Array.isArray(v.bron) && v.bron.length && v.bron.every((u) => /^https?:\/\//.test(u)), `${k}: bron ontbreekt`);
    assert.ok(Array.isArray(v.bereik) && v.bereik.length === 2 && v.bereik[0] <= v.prijs && v.prijs <= v.bereik[1], `${k}: prijs buiten bereik`);
    assert.ok(typeof v.opmerking === 'string' && v.opmerking.length > 0, `${k}: opmerking ontbreekt`);
  }
});
