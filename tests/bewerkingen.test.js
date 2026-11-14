// Tests voor de bewerkingen op hoog niveau (js/model/bewerkingen.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyOps, validate, leegModel, polygoonOppervlakte, muurLengte,
  opsMuurTekenen, opsMuurVerplaatsen, opsMuurEindpunt, opsMuurLengte, opsOpeningPlaatsen,
  ruimteContourBijPunt, opsRuimteBenoemen, opsRuimteRechthoek, opsNiveauToevoegen, opsDakInstellen,
  buitenMuren, buitenContour,
} from '../js/model/index.js';

const voorbeeld = () => JSON.parse(readFileSync(new URL('../designs/voorbeeld.json', import.meta.url), 'utf8'));
const muur = (m, id) => m.muren.find((x) => x.id === id);
const opening = (m, id) => m.openingen.find((x) => x.id === id);

/** Past r.ops toe en controleert dat dat lukt. */
function pas(model, r) {
  assert.equal(r.fout, undefined, r.fout);
  assert.ok(r.ops.length > 0, 'verwacht operaties');
  const a = applyOps(model, r.ops);
  assert.equal(a.ok, true, JSON.stringify(a.fouten));
  return a.model;
}
function isFout(r, deel) {
  assert.equal(typeof r.fout, 'string', 'verwacht een foutmelding');
  assert.deepEqual(r.ops, []);
  if (deel) assert.match(r.fout, deel);
}

// ── muur tekenen ────────────────────────────────────────────────────────────

test('opsMuurTekenen: nieuwe muur met id in info', () => {
  const m = voorbeeld();
  const r = opsMuurTekenen(m, { niveau: 'N0', start: [1000, 15000], eind: [4000, 15000], dikte: 200 });
  const n = pas(m, r);
  assert.equal(r.info.id, 'M16');
  assert.deepEqual(muur(n, 'M16'), { id: 'M16', niveau: 'N0', start: [1000, 15000], eind: [4000, 15000], dikte: 200, status: 'nieuw' });
  const h = opsMuurTekenen(m, { niveau: 'N0', start: [0, 0], eind: [0, 500], dikte: 100, hoogte: 1000, status: 'bestaand' });
  assert.equal(pas(m, h).muren.at(-1).hoogte, 1000);
});

test('opsMuurTekenen: foutgevallen', () => {
  const m = voorbeeld();
  isFout(opsMuurTekenen(m, { niveau: 'N0', start: [0, 0], eind: [5, 5], dikte: 100 }), /te kort/);
  isFout(opsMuurTekenen(m, { niveau: 'N9', start: [0, 0], eind: [500, 0], dikte: 100 }), /niveau/);
  isFout(opsMuurTekenen(m, { niveau: 'N0', start: [0, 0], eind: [500, 0], dikte: 0 }), /dikte/i);
  isFout(opsMuurTekenen(m, { niveau: 'N0', start: [0, 0], eind: [500, 0], dikte: 100, status: 'weg' }), /Status/);
});

// ── muur verplaatsen ────────────────────────────────────────────────────────

test('opsMuurVerplaatsen: aansluitende eindpunten schuiven mee', () => {
  const m = voorbeeld();
  // M8 (achtergevel aanbouw) 500 mm naar achter: M7.eind en M9.start volgen
  const r = opsMuurVerplaatsen(m, 'M8', 0, 500);
  const n = pas(m, r);
  assert.deepEqual(muur(n, 'M8').start, [150, 12350]);
  assert.deepEqual(muur(n, 'M7').eind, [150, 12350]);
  assert.deepEqual(muur(n, 'M9').start, [6850, 12350]);
  assert.deepEqual(muur(n, 'M7').start, [150, 8850]);
  assert.deepEqual(r.info.aansluitingen.sort(), ['M7', 'M9']);
  // opening O4 in M8 blijft op dezelfde positie
  assert.equal(opening(n, 'O4').positie, 800);
});

test('opsMuurVerplaatsen: zonder aansluitingen enkel de muur zelf', () => {
  const m = voorbeeld();
  const n = pas(m, opsMuurVerplaatsen(m, 'M8', 0, 500, { metAansluitingen: false }));
  assert.deepEqual(muur(n, 'M7').eind, [150, 11850]);
  assert.deepEqual(muur(n, 'M8').eind, [6850, 12350]);
});

test('opsMuurVerplaatsen: T-aansluiting schuift loodrecht mee', () => {
  const m = voorbeeld();
  // M5 (y = 4500) naar achter: M6 eindigt op M5 (eindpunt op eindpunt? nee: [3500,4500] ligt op de as) ⇒ volgt
  const n = pas(m, opsMuurVerplaatsen(m, 'M5', 0, 300));
  assert.deepEqual(muur(n, 'M6').eind, [3500, 4800]);
  assert.deepEqual(muur(n, 'M6').start, [3500, 150]);
  // M5 zelf sloot met T-aansluitingen aan op M4 en M2 (eindpunten op hun as): die muren veranderen niet
  assert.deepEqual(muur(n, 'M4').start, [150, 8850]);
  // M6 (x = 3500) zijwaarts: M6 is zelf een T op M1/M5 — die veranderen niet
  const n2 = pas(m, opsMuurVerplaatsen(m, 'M6', 200, 0));
  assert.deepEqual(muur(n2, 'M6').start, [3700, 150]);
  assert.deepEqual(muur(n2, 'M1').start, [150, 150]);
});

test('opsMuurVerplaatsen: T-aansluiting volgt enkel de loodrechte component', () => {
  const m = voorbeeld();
  const n = pas(m, opsMuurVerplaatsen(m, 'M5', 100, 300, { metAansluitingen: true }));
  // M5 eindpunten vallen samen met niets (T op M4/M2) → M6.eind schuift enkel in y
  assert.deepEqual(muur(n, 'M6').eind, [3500, 4800]);
  assert.deepEqual(muur(n, 'M5').start, [250, 4800]);
});

test('opsMuurVerplaatsen: openingen die niet meer passen ⇒ fout', () => {
  const m = voorbeeld();
  // M1 6000 mm naar achter: M2.start volgt; O5 houdt afstand tot M2.eind ⇒ positie 5500 - 6000 < 0
  isFout(opsMuurVerplaatsen(m, 'M1', 0, 6000), /O5/);
  isFout(opsMuurVerplaatsen(m, 'M999', 0, 10), /niet gevonden/);
  assert.deepEqual(opsMuurVerplaatsen(m, 'M1', 0, 0).ops, []);
});

test('opsMuurVerplaatsen: openingen behouden afstand tot het vaste eindpunt', () => {
  const m = voorbeeld();
  // M1 500 mm naar achter: M2.start volgt (start verplaatst ⇒ positie O5 daalt met 500)
  const n = pas(m, opsMuurVerplaatsen(m, 'M1', 0, 500));
  assert.deepEqual(muur(n, 'M2').start, [6850, 650]);
  assert.equal(opening(n, 'O5').positie, 5000);
  // M4 eindigt op [150,150] ⇒ eind verplaatst, positie blijft (geen openingen), lengte korter
  assert.equal(muurLengte(muur(n, 'M4')), 8200);
});

// ── eindpunt / lengte ──────────────────────────────────────────────────────

test('opsMuurEindpunt: hoekpunt verplaatsen sleept aansluitende muur mee', () => {
  const m = voorbeeld();
  const r = opsMuurEindpunt(m, 'M8', 'eind', [7350, 11850]);
  const n = pas(m, r);
  assert.deepEqual(muur(n, 'M8').eind, [7350, 11850]);
  assert.deepEqual(muur(n, 'M9').start, [7350, 11850]);
  const n2 = pas(m, opsMuurEindpunt(m, 'M8', 'eind', [7350, 11850], { metAansluitingen: false }));
  assert.deepEqual(muur(n2, 'M9').start, [6850, 11850]);
});

test('opsMuurEindpunt: foutgevallen', () => {
  const m = voorbeeld();
  isFout(opsMuurEindpunt(m, 'M8', 'midden', [0, 0]), /start/);
  isFout(opsMuurEindpunt(m, 'M8', 'start', [6845, 11850], { metAansluitingen: false }), /te kort/);
  // O4 (800 + 5000) in M8 past niet als M8 4000 mm lang wordt
  isFout(opsMuurEindpunt(m, 'M8', 'eind', [4150, 11850]), /O4/);
});

test('opsMuurLengte: vast start of eind', () => {
  const m = voorbeeld();
  const n = pas(m, opsMuurLengte(m, 'M7', 3500));
  assert.deepEqual(muur(n, 'M7').eind, [150, 12350]);
  assert.deepEqual(muur(n, 'M8').start, [150, 12350]); // aansluiting volgt
  const n2 = pas(m, opsMuurLengte(m, 'M6', 4000, { vast: 'eind' }));
  assert.deepEqual(muur(n2, 'M6').start, [3500, 500]);
  assert.deepEqual(muur(n2, 'M6').eind, [3500, 4500]);
  isFout(opsMuurLengte(m, 'M6', 5), /minstens/);
  isFout(opsMuurLengte(m, 'M6', 1000, { vast: 'x' }), /vast/);
});

// ── openingen ──────────────────────────────────────────────────────────────

test('opsOpeningPlaatsen: gecentreerd op projectie, afgerond op 10 mm', () => {
  const m = voorbeeld();
  // M4 loopt van [150,8850] naar [150,150]; punt op y=6000 ⇒ t = 2850 ⇒ positie 2850 - 450 = 2400
  const r = opsOpeningPlaatsen(m, 'M4', [400, 6003], { type: 'deur', breedte: 900, hoogte: 2100, borstwering: 0 });
  const n = pas(m, r);
  const o = opening(n, r.info.id);
  assert.equal(o.positie, 2400);
  assert.equal(o.status, 'nieuw');
  assert.equal(o.muur, 'M4');
});

test('opsOpeningPlaatsen: geklemd binnen de muur', () => {
  const m = voorbeeld();
  const r = opsOpeningPlaatsen(m, 'M4', [150, 8900], { type: 'raam', breedte: 1000, hoogte: 1200, borstwering: 900 });
  assert.equal(pas(m, r).openingen.at(-1).positie, 0);
  const r2 = opsOpeningPlaatsen(m, 'M6', [3500, 5000], { type: 'raam', breedte: 1000, hoogte: 1200, borstwering: 900 });
  assert.equal(pas(m, r2).openingen.at(-1).positie, 3350); // muurlengte 4350
});

test('opsOpeningPlaatsen: foutgevallen', () => {
  const m = voorbeeld();
  isFout(opsOpeningPlaatsen(m, 'M1', [1400, 150], { type: 'deur', breedte: 900, hoogte: 2100, borstwering: 0 }), /overlapt met O1/);
  isFout(opsOpeningPlaatsen(m, 'M6', [3500, 2000], { type: 'raam', breedte: 5000, hoogte: 1000, borstwering: 900 }), /breder/);
  isFout(opsOpeningPlaatsen(m, 'M6', [3500, 2000], { type: 'raam', breedte: 1000, hoogte: 2500, borstwering: 900 }), /te hoog/);
  isFout(opsOpeningPlaatsen(m, 'M6', [3500, 2000], { type: 'poort' }), /Type/);
  isFout(opsOpeningPlaatsen(m, 'Mx', [3500, 2000], { type: 'deur' }), /niet gevonden/);
});

// ── ruimtedetectie ─────────────────────────────────────────────────────────

test('ruimteContourBijPunt: woonkamer ≈ R1 als M6 afgebroken wordt', () => {
  const m = voorbeeld();
  muur(m, 'M6').status = 'afbraak';
  const c = ruimteContourBijPunt(m, 'N0', [1500, 2000]);
  const r1 = m.ruimtes.find((r) => r.id === 'R1').contour;
  assert.ok(c);
  const verschil = Math.abs(polygoonOppervlakte(c) - polygoonOppervlakte(r1)) / polygoonOppervlakte(r1);
  assert.ok(verschil < 0.02, `oppervlakteverschil ${verschil}`);
  assert.deepEqual(c, r1); // orthogonaal plan ⇒ exact
});

test('ruimteContourBijPunt: met M6 als wand wordt de woonkamer gesplitst', () => {
  const m = voorbeeld();
  assert.deepEqual(ruimteContourBijPunt(m, 'N0', [1500, 2000]), [[300, 300], [3430, 300], [3430, 4430], [300, 4430]]);
  assert.deepEqual(ruimteContourBijPunt(m, 'N0', [5000, 2000]), [[3570, 300], [6700, 300], [6700, 4430], [3570, 4430]]);
});

test('ruimteContourBijPunt: afbraakmuur M3 telt niet ⇒ leefkeuken = R2', () => {
  const m = voorbeeld();
  const r2 = m.ruimtes.find((r) => r.id === 'R2').contour;
  assert.deepEqual(ruimteContourBijPunt(m, 'N0', [3000, 7000]), r2);
  assert.deepEqual(ruimteContourBijPunt(m, 'N0', [3000, 10000]), r2);
});

test('ruimteContourBijPunt: verdieping met dunne scheidingsmuur', () => {
  const m = voorbeeld();
  assert.deepEqual(ruimteContourBijPunt(m, 'N1', [2000, 6000]), m.ruimtes.find((r) => r.id === 'R4').contour);
  assert.deepEqual(ruimteContourBijPunt(m, 'N1', [5000, 6000]), m.ruimtes.find((r) => r.id === 'R5').contour);
});

test('ruimteContourBijPunt: buiten, in een muur, open gebied of leeg niveau ⇒ null', () => {
  const m = voorbeeld();
  assert.equal(ruimteContourBijPunt(m, 'N0', [3000, -2000]), null);
  assert.equal(ruimteContourBijPunt(m, 'N0', [3500, 2000]), null); // in M6
  assert.equal(ruimteContourBijPunt(m, 'N0', [50000, 50000]), null);
  assert.equal(ruimteContourBijPunt(leegModel(), 'N0', [0, 0]), null);
  // achtergevel aanbouw weg ⇒ open
  const open = applyOps(m, [{ op: 'verwijderen', collectie: 'muren', id: 'M8' }]).model;
  assert.equal(ruimteContourBijPunt(open, 'N0', [3000, 7000]), null);
});

test('ruimteContourBijPunt: niet-rechthoekige (L-vormige) ruimte', () => {
  const m = voorbeeld();
  // scheidingsmuur die halverwege stopt + dwarsmuur ⇒ L-vorm in de leefkeuken
  const r = applyOps(m, [
    { op: 'toevoegen', collectie: 'muren', item: { niveau: 'N0', start: [4000, 4500], eind: [4000, 8000], dikte: 100, status: 'nieuw' } },
    { op: 'toevoegen', collectie: 'muren', item: { niveau: 'N0', start: [4000, 8000], eind: [6850, 8000], dikte: 100, status: 'nieuw' } },
  ]);
  assert.equal(r.ok, true);
  const c = ruimteContourBijPunt(r.model, 'N0', [2000, 6000]);
  assert.equal(c.length, 6);
  assert.deepEqual(c, [[300, 4570], [3950, 4570], [3950, 8050], [6700, 8050], [6700, 11700], [300, 11700]]);
  const klein = ruimteContourBijPunt(r.model, 'N0', [5000, 6000]);
  assert.deepEqual(klein, [[4050, 4570], [6700, 4570], [6700, 7950], [4050, 7950]]);
});

test('ruimteContourBijPunt: schuine muur wordt benaderd', () => {
  const m = voorbeeld();
  const r = applyOps(m, [{ op: 'toevoegen', collectie: 'muren', item: { niveau: 'N0', start: [150, 3000], eind: [3500, 150], dikte: 100, status: 'nieuw' } }]);
  const c = ruimteContourBijPunt(r.model, 'N0', [400, 400]);
  assert.ok(c && c.length <= 6, JSON.stringify(c));
  // driehoek tussen M4, M1 en de schuine muur: ruwe controle op de oppervlakte
  // binnenvlak van de schuine muur: 2850·x + 3350·y = 10477500 − 50·|(3350, −2850)|
  const c0 = 10477500 - 50 * Math.hypot(3350, 2850);
  const exact = 0.5 * ((c0 - 3350 * 300) / 2850 - 300) * ((c0 - 2850 * 300) / 3350 - 300);
  const opp = polygoonOppervlakte(c);
  assert.ok(Math.abs(opp - exact) / exact < 0.03, `opp ${opp} vs ${exact}`);
});

test('ruimteContourBijPunt: snel genoeg (< 50 ms) voor het voorbeeldhuis', () => {
  const m = voorbeeld();
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) ruimteContourBijPunt(m, 'N0', [1500, 2000]);
  const ms = (performance.now() - t0) / 10;
  assert.ok(ms < 50, `${ms} ms`);
});

// ── ruimtes benoemen ───────────────────────────────────────────────────────

test('opsRuimteBenoemen: bestaande ruimte ⇒ wijzigen', () => {
  const m = voorbeeld();
  const r = opsRuimteBenoemen(m, 'N1', [2000, 6000], { naam: 'Kinderkamer', functie: 'slaapkamer' });
  assert.equal(r.info.nieuw, false);
  assert.equal(r.ops[0].op, 'wijzigen');
  const n = pas(m, r);
  assert.equal(n.ruimtes.find((x) => x.id === 'R4').naam, 'Kinderkamer');
});

test('opsRuimteBenoemen: nieuwe ruimte via contourdetectie', () => {
  const m = voorbeeld();
  const zonder = applyOps(m, [{ op: 'verwijderen', collectie: 'ruimtes', id: 'R1' }]).model;
  const r = opsRuimteBenoemen(zonder, 'N0', [5000, 2000], { naam: 'Bureau', functie: 'bureau' });
  assert.equal(r.info.nieuw, true);
  const n = pas(zonder, r);
  const nieuw = n.ruimtes.find((x) => x.id === r.info.id);
  assert.deepEqual(nieuw.contour, [[3570, 300], [6700, 300], [6700, 4430], [3570, 4430]]);
  assert.equal(nieuw.functie, 'bureau');
});

test('opsRuimteBenoemen: foutgevallen', () => {
  const m = voorbeeld();
  isFout(opsRuimteBenoemen(m, 'N0', [3000, -2000], { naam: 'Tuin', functie: 'terras' }), /geen gesloten ruimte/);
  isFout(opsRuimteBenoemen(m, 'N0', [1500, 2000], { naam: 'X', functie: 'kasteel' }), /Functie/);
  isFout(opsRuimteBenoemen(m, 'N0', [1500, 2000], { naam: '  ' }), /naam/);
  isFout(opsRuimteBenoemen(m, 'N7', [1500, 2000], { naam: 'X' }), /niveau/);
});

test('opsRuimteRechthoek', () => {
  const m = voorbeeld();
  const r = opsRuimteRechthoek(m, 'N0', [3000, 15000], [0, 13000], { naam: 'Terras', functie: 'terras' });
  const n = pas(m, r);
  assert.deepEqual(n.ruimtes.at(-1).contour, [[0, 13000], [3000, 13000], [3000, 15000], [0, 15000]]);
  isFout(opsRuimteRechthoek(m, 'N0', [0, 0], [50, 5000], { naam: 'X' }), /te klein/);
  isFout(opsRuimteRechthoek(m, 'N0', [0, 0], [5000, 5000], {}), /naam/);
});

// ── buitenmuren / niveaus / daken ──────────────────────────────────────────

test('buitenMuren: gevels zonder binnen- en afbraakmuren', () => {
  const m = voorbeeld();
  assert.deepEqual(buitenMuren(m, 'N0'), ['M1', 'M2', 'M4', 'M7', 'M8', 'M9']);
  assert.deepEqual(buitenMuren(m, 'N1'), ['M10', 'M11', 'M12', 'M13']);
  assert.deepEqual(buitenMuren(leegModel(), 'N0'), []);
});

test('buitenContour: buitenzijde van de muren', () => {
  const m = voorbeeld();
  assert.deepEqual(buitenContour(m, 'N0'), [[0, 0], [7000, 0], [7000, 12000], [0, 12000]]);
  assert.deepEqual(buitenContour(m, 'N1'), [[0, 0], [7000, 0], [7000, 9000], [0, 9000]]);
});

test('opsNiveauToevoegen: buitenmuren kopiëren, vloer, daken verhuizen', () => {
  const m = voorbeeld();
  const r = opsNiveauToevoegen(m, { naam: 'Zolder', hoogte: 2400 });
  const n = pas(m, r);
  const niv = n.niveaus.find((x) => x.id === r.info.id);
  assert.deepEqual(niv, { id: 'N2', naam: 'Zolder', peil: 5600, hoogte: 2400, vloerdikte: 300 });
  assert.equal(r.info.muren.length, 4);
  const kopie = n.muren.filter((x) => x.niveau === 'N2');
  assert.deepEqual(kopie.map((x) => [x.start, x.eind]), m.muren.filter((x) => x.niveau === 'N1' && x.id !== 'M14' && x.id !== 'M15').map((x) => [x.start, x.eind]));
  assert.ok(kopie.every((x) => x.status === 'nieuw' && x.hoogte === undefined));
  assert.equal(n.openingen.filter((o) => r.info.muren.includes(o.muur)).length, 0);
  assert.deepEqual(n.vloeren.find((x) => x.id === r.info.vloer).contour, [[0, 0], [7000, 0], [7000, 9000], [0, 9000]]);
  assert.equal(n.daken.find((d) => d.id === 'D1').niveau, 'N2');
  assert.equal(n.daken.find((d) => d.id === 'D2').niveau, 'N0'); // dak van de aanbouw blijft
  assert.equal(validate(n).geldig, true);
});

test('opsNiveauToevoegen: alle / geen / daken laten staan', () => {
  const m = voorbeeld();
  const alle = opsNiveauToevoegen(m, { kopieerMuren: 'alle' });
  assert.equal(alle.info.muren.length, 6);
  pas(m, alle);
  const geen = opsNiveauToevoegen(m, { kopieerMuren: 'geen', verplaatsDaken: false });
  const n = pas(m, geen);
  assert.equal(geen.info.muren.length, 0);
  assert.equal(n.daken.find((d) => d.id === 'D1').niveau, 'N1');
  assert.equal(n.niveaus.at(-1).naam, 'Verdieping 2');
  isFout(opsNiveauToevoegen(m, { kopieerMuren: 'sommige' }), /kopieerMuren/);
  isFout(opsNiveauToevoegen(m, { hoogte: -1 }), /hoogte/);
});

test('opsNiveauToevoegen: op een leeg model (geen muren ⇒ geen vloer)', () => {
  const m = leegModel();
  const r = opsNiveauToevoegen(m, { naam: 'Verdieping' });
  const n = pas(m, r);
  assert.equal(r.info.vloer, null);
  assert.equal(n.niveaus[1].peil, 2800);
});

test('opsDakInstellen: bestaand dak wijzigen', () => {
  const m = voorbeeld();
  const r = opsDakInstellen(m, 'N1', { type: 'schild', helling: 30, nokrichting: 'y', overstek: 400 });
  assert.equal(r.info.nieuw, false);
  const d = pas(m, r).daken.find((x) => x.id === 'D1');
  assert.equal(d.type, 'schild');
  assert.equal(d.helling, 30);
  assert.equal(d.nokrichting, 'y');
  assert.equal(d.overstek, 400);
  assert.equal(d.status, 'bestaand');
  const plat = pas(m, opsDakInstellen(m, 'N1', { type: 'plat' })).daken.find((x) => x.id === 'D1');
  assert.equal(plat.helling, 0);
});

test('opsDakInstellen: nieuw dak op begrenzing van de buitenzijde', () => {
  const m = voorbeeld();
  const r0 = opsNiveauToevoegen(m, { verplaatsDaken: false });
  const m2 = pas(m, r0);
  const r = opsDakInstellen(m2, r0.info.id, { type: 'zadel', helling: 45 });
  assert.equal(r.info.nieuw, true);
  const d = pas(m2, r).daken.find((x) => x.id === r.info.id);
  assert.deepEqual(d.contour, [[0, 0], [7000, 0], [7000, 9000], [0, 9000]]);
  assert.equal(d.status, 'nieuw');
  assert.equal(d.overstek, 300);
  isFout(opsDakInstellen(leegModel(), 'N0', { type: 'plat' }), /geen muren/);
  isFout(opsDakInstellen(m, 'N1', { type: 'koepel' }), /Daktype/);
  isFout(opsDakInstellen(m, 'N1', { type: 'zadel', helling: 80 }), /Helling/);
  isFout(opsDakInstellen(m2, r0.info.id, {}), /daktype/);
});

test('bewerkingen muteren het model niet', () => {
  const m = voorbeeld();
  const voor = JSON.stringify(m);
  opsMuurVerplaatsen(m, 'M8', 0, 500);
  opsMuurEindpunt(m, 'M8', 'eind', [7350, 11850]);
  opsNiveauToevoegen(m, {});
  opsRuimteBenoemen(m, 'N0', [1500, 2000], { naam: 'X' });
  ruimteContourBijPunt(m, 'N0', [1500, 2000]);
  assert.equal(JSON.stringify(m), voor);
});
