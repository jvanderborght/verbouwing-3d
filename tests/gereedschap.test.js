// Tests voor de DOM-vrije logica van het tekengereedschap (js/ui/gereedschap.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GEREEDSCHAPPEN, gereedschapInfo, isTekengereedschap, STANDAARD_OPTIES, OPTIE_SLEUTEL, normaliseerOpties,
  laadOpties, bewaarOpties, tolerantieMm, richtingVan, puntInRichting, RICHTINGEN, muurHoek, MuurTekenaar,
  hintVoor, hulpMuur, murenUitOps, hulpSlepen, openingContour, mmTekst,
} from '../js/ui/gereedschap.js';
import { applyOps, opsMuurTekenen, opsMuurVerplaatsen, opsOpeningPlaatsen, Geschiedenis, leegModel } from '../js/model/index.js';
import { snap } from '../js/ui/snap.js';

const voorbeeld = () => JSON.parse(readFileSync(new URL('../designs/voorbeeld.json', import.meta.url), 'utf8'));

class NepStorage {
  constructor({ kapot = false, vol = false } = {}) { this.m = new Map(); this.kapot = kapot; this.vol = vol; }
  getItem(k) { if (this.kapot) throw new Error('SecurityError'); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.kapot) throw new Error('SecurityError'); if (this.vol) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); }
}

test('gereedschappen: volgorde, modi en acties', () => {
  assert.deepEqual(GEREEDSCHAPPEN.map((g) => g.id), ['selecteren', 'muur', 'deur', 'raam', 'ruimte', 'verwijderen', 'niveau', 'dak']);
  assert.equal(gereedschapInfo('selecteren').modus, 'navigeren');
  for (const id of ['muur', 'deur', 'raam', 'ruimte', 'verwijderen']) assert.ok(isTekengereedschap(id), id);
  assert.ok(!isTekengereedschap('selecteren'));
  assert.ok(gereedschapInfo('niveau').actie && gereedschapInfo('dak').actie);
  assert.ok(!isTekengereedschap('niveau'));
  assert.equal(gereedschapInfo('bestaat-niet'), null);
  // sneltoetsen uniek
  const toetsen = GEREEDSCHAPPEN.map((g) => g.toets).filter(Boolean);
  assert.equal(new Set(toetsen).size, toetsen.length);
});

test('opties: normaliseren vult aan en weigert ongeldige waarden', () => {
  const std = normaliseerOpties(null);
  assert.deepEqual(std, { muur: { ...STANDAARD_OPTIES.muur }, deur: { ...STANDAARD_OPTIES.deur }, raam: { ...STANDAARD_OPTIES.raam } });
  assert.deepEqual(STANDAARD_OPTIES.deur, { breedte: 900, hoogte: 2100, borstwering: 0, status: 'nieuw' });
  assert.deepEqual(STANDAARD_OPTIES.raam, { breedte: 1200, hoogte: 1400, borstwering: 900, status: 'nieuw' });
  const o = normaliseerOpties({ muur: { dikte: 175.4, status: 'afbraak' }, deur: { breedte: -5, status: 'raar' }, raam: { borstwering: 0 } });
  assert.equal(o.muur.dikte, 175);
  assert.equal(o.muur.status, 'afbraak');
  assert.equal(o.deur.breedte, 900);
  assert.equal(o.deur.status, 'nieuw');
  assert.equal(o.raam.borstwering, 0);
  assert.equal(normaliseerOpties({ muur: { dikte: 5 } }).muur.dikte, 140, 'te dun');
  assert.equal(normaliseerOpties({ muur: { dikte: '200' } }).muur.dikte, 140, 'tekst is geen getal');
});

test('opties: bewaren en laden via storage, met try/catch', () => {
  const s = new NepStorage();
  assert.deepEqual(laadOpties(s), normaliseerOpties(null), 'leeg ⇒ standaard');
  const o = normaliseerOpties({ muur: { dikte: 300, status: 'bestaand' } });
  assert.equal(bewaarOpties(s, o), true);
  assert.ok(s.m.has(OPTIE_SLEUTEL));
  assert.deepEqual(laadOpties(s), o);
  s.m.set(OPTIE_SLEUTEL, '{kapot');
  assert.deepEqual(laadOpties(s), normaliseerOpties(null), 'kapotte JSON ⇒ standaard');
  assert.deepEqual(laadOpties(new NepStorage({ kapot: true })), normaliseerOpties(null));
  assert.equal(bewaarOpties(new NepStorage({ kapot: true }), o), false);
  assert.equal(bewaarOpties(new NepStorage({ vol: true }), o), false);
  assert.equal(bewaarOpties(null, o), false);
  assert.deepEqual(laadOpties(null), normaliseerOpties(null));
});

test('rekenhulpjes: tolerantie, richting, punt in richting, hoek, mm-tekst', () => {
  assert.equal(tolerantieMm(0.1), 120);
  assert.equal(tolerantieMm(0.05, 12), 240);
  assert.equal(tolerantieMm(0), 12, 'schaal 0 ⇒ 1 px/mm');
  assert.deepEqual(richtingVan([0, 0], [0, 5]), [0, 1]);
  assert.equal(richtingVan([1, 1], [1, 1]), null);
  assert.equal(richtingVan(null, [1, 1]), null);
  assert.deepEqual(puntInRichting([100, 200], [1, 0], 3000), [3100, 200]);
  assert.deepEqual(puntInRichting([0, 0], [Math.SQRT1_2, Math.SQRT1_2], 1000), [707.1, 707.1]);
  assert.deepEqual(puntInRichting([0, 0], RICHTINGEN.omlaag, 250), [0, -250]);
  assert.equal(muurHoek({ start: [0, 0], eind: [10, 0] }), 0);
  assert.equal(muurHoek({ start: [0, 0], eind: [0, 10] }), 90);
  assert.equal(muurHoek({ start: [0, 0], eind: [-10, 0] }), 180);
  assert.equal(muurHoek({ start: [0, 0], eind: [0, -10] }), 270);
  assert.equal(muurHoek({ start: [0, 0], eind: [10, 10] }), 45);
  assert.match(mmTekst(3250), /^3.250 mm$/);
});

test('MuurTekenaar: keten van tikken', () => {
  const t = new MuurTekenaar();
  assert.equal(t.actief, false);
  assert.deepEqual(t.plaats([0, 0]), { soort: 'start' });
  assert.equal(t.actief, true);
  assert.deepEqual(t.plaats([0, 0.2]), { soort: 'niets' }, 'zelfde punt ⇒ niets');
  const a = t.plaats([3000, 0]);
  assert.deepEqual(a, { soort: 'muur', start: [0, 0], eind: [3000, 0] });
  // nog niet bevestigd ⇒ start blijft
  assert.deepEqual(t.start, [0, 0]);
  t.bevestig(a.eind);
  assert.deepEqual(t.start, [3000, 0]);
  assert.equal(t.aantal, 1);
  assert.deepEqual(t.vorigeRichting, [1, 0]);
  const b = t.plaats([3000, 2000]);
  assert.deepEqual(b, { soort: 'muur', start: [3000, 0], eind: [3000, 2000] });
  t.bevestig(b.eind);
  assert.equal(t.aantal, 2);
  t.stop();
  assert.equal(t.actief, false);
  assert.equal(t.aantal, 0);
});

test('MuurTekenaar: lengte intypen in de huidige richting', () => {
  const t = new MuurTekenaar();
  assert.equal(t.metLengte(3000).soort, 'fout', 'zonder beginpunt');
  t.plaats([1000, 1000]);
  // nog geen richting ⇒ horizontaal naar rechts
  assert.deepEqual(t.huidigeRichting(), [1, 0]);
  assert.deepEqual(t.metLengte(3000), { soort: 'muur', start: [1000, 1000], eind: [4000, 1000] });
  // aanwijzer bepaalt de richting
  t.zetAanwijzer([1000, 5000]);
  assert.deepEqual(t.metLengte(2500).eind, [1000, 3500]);
  // opgegeven richting wint
  assert.deepEqual(t.metLengte(500, RICHTINGEN.links).eind, [500, 1000]);
  assert.equal(t.metLengte(5).soort, 'fout', 'te kort');
  assert.equal(t.metLengte(NaN).soort, 'fout');
  // na bevestigen zonder aanwijzer: richting van de vorige muur
  const m = t.metLengte(2500);
  t.bevestig(m.eind);
  t.zetAanwijzer(null);
  assert.deepEqual(t.huidigeRichting(), [0, 1]);
  assert.deepEqual(t.metLengte(1000).eind, [1000, 4500]);
  // aanwijzer op het beginpunt zelf ⇒ terugval op vorige richting
  t.zetAanwijzer([1000, 3500]);
  assert.deepEqual(t.huidigeRichting(), [0, 1]);
});

test('MuurTekenaar + bewerkingen + geschiedenis: elke muur één undo-stap', () => {
  const g = new Geschiedenis(leegModel('t'));
  const t = new MuurTekenaar();
  t.plaats([0, 0]);
  for (const p of [[4000, 0], [4000, 3000]]) {
    const a = t.plaats(p);
    const r = opsMuurTekenen(g.huidig, { niveau: 'N0', start: a.start, eind: a.eind, dikte: 140, status: 'nieuw' });
    assert.ok(!r.fout);
    assert.ok(g.toepassen(r.ops, 'Muur tekenen').ok);
    t.bevestig(a.eind);
  }
  const m = t.metLengte(4000, RICHTINGEN.links);
  assert.ok(g.toepassen(opsMuurTekenen(g.huidig, { niveau: 'N0', start: m.start, eind: m.eind, dikte: 140 }).ops).ok);
  assert.equal(g.huidig.muren.length, 3);
  assert.deepEqual(g.huidig.muren[2].eind, [0, 3000]);
  g.undo();
  assert.equal(g.huidig.muren.length, 2);
  g.redo();
  assert.equal(g.huidig.muren.length, 3);
});

test('hintVoor: tekst per gereedschap en toestand', () => {
  assert.match(hintVoor('muur'), /beginpunt/);
  assert.match(hintVoor('muur', { keten: true }), /Klaar/);
  assert.match(hintVoor('ruimte', { rechthoek: 2 }), /tegenoverliggende/);
  assert.equal(hintVoor('onbekend'), '');
});

test('hulpMuur: voorbeeldlijn met dikte, maat, snap-punten en hulplijnen', () => {
  const sn = { punt: [3000, 0], soort: 'ortho', hulplijnen: [{ van: [0, 0], naar: [3000, 0] }] };
  const h = hulpMuur({ start: [0, 0], punt: [3000, 0], dikte: 140, snap: sn, schaal: 0.1 });
  const vb = h.lijnen.find((l) => l.stijl === 'voorbeeld');
  assert.deepEqual([vb.van, vb.naar, vb.dikte], [[0, 0], [3000, 0], 140]);
  const maat = h.lijnen.find((l) => l.stijl === 'maat');
  assert.match(maat.tekst, /^3.000 mm$/);
  assert.ok(maat.van[1] > 70, 'maat naast de muur (links van de looprichting)');
  assert.equal(h.lijnen.filter((l) => l.stijl === 'hulplijn').length, 1);
  assert.equal(h.punten.length, 2);
  // zonder beginpunt: enkel het snap-punt
  const h2 = hulpMuur({ punt: [50, 50], dikte: 140, snap: { punt: [50, 50], soort: 'eindpunt' }, schaal: 1 });
  assert.equal(h2.lijnen.length, 0);
  assert.equal(h2.punten.length, 1);
  assert.equal(h2.labels[0].tekst, 'eindpunt');
});

test('murenUitOps / hulpSlepen: voorbeeld van een verplaatsing met aansluitingen', () => {
  const m = voorbeeld();
  const id = 'M2';
  const r = opsMuurVerplaatsen(m, id, 500, 0);
  assert.ok(!r.fout);
  const muren = murenUitOps(m, r.ops);
  assert.ok(muren.length >= 2, 'aansluitende muren schuiven mee');
  const hoofd = muren.find((x) => x.id === id);
  const orig = m.muren.find((x) => x.id === id);
  assert.deepEqual(hoofd.van, [orig.start[0] + 500, orig.start[1]]);
  const h = hulpSlepen(m, r.ops, { id, schaal: 0.1, label: { p: [0, 0], tekst: 'x' } });
  assert.equal(h.lijnen.filter((l) => l.stijl === 'voorbeeld').length, muren.length);
  assert.equal(h.lijnen.filter((l) => l.stijl === 'maat').length, 1);
  assert.equal(h.labels.length, 1);
  // toegepast model = voorbeeld
  const na = applyOps(m, r.ops);
  assert.ok(na.ok);
  assert.deepEqual(na.model.muren.find((x) => x.id === id).start, hoofd.van);
});

test('openingContour: voorbeeld van een nieuwe opening in de muur', () => {
  const m = voorbeeld();
  const mu = m.muren.find((x) => x.niveau === 'N0' && Math.abs(x.start[1] - x.eind[1]) < 1 && Math.abs(x.eind[0] - x.start[0]) > 3000);
  const mid = [(mu.start[0] + mu.eind[0]) / 2, mu.start[1]];
  const r = opsOpeningPlaatsen({ ...m, openingen: [] }, mu.id, mid, { type: 'raam' });
  assert.ok(!r.fout, r.fout);
  const c = openingContour(m, r.ops[0].item);
  assert.equal(c.length, 4);
  const xs = c.map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 1200) < 1e-6, 'breedte 1200');
  assert.equal(openingContour(m, { muur: 'bestaat-niet', positie: 0, breedte: 1 }), null);
});

test('snap met tolerantie in px: eindpunt binnen 12 px wint, verder weg raster', () => {
  const m = voorbeeld();
  const mu = m.muren.find((x) => x.niveau === 'N0');
  const schaal = 0.05; // 12 px = 240 mm
  const dicht = snap([mu.start[0] + 150, mu.start[1] + 150], { model: m, niveau: 'N0', tolerantie: tolerantieMm(schaal) });
  assert.equal(dicht.soort, 'eindpunt');
  const ver = snap([-5000 + 13, -5000 + 7], { model: m, niveau: 'N0', tolerantie: tolerantieMm(schaal) });
  assert.equal(ver.soort, 'raster');
  assert.deepEqual(ver.punt, [-5000, -5000]);
});
