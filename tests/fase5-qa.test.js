// QA-opvolging fase 5: id-hergebruik (idTeller), buitenmuren op een zolder, muuroppervlakte onder het dak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  migreer, applyOps, validate, volgendId, hoogsteIdNummer, diff, beschrijfDiff, Geschiedenis,
  opsAfbraakZone, opsRuimteRechthoek, opsZolderNiveau, opsMuurTekenen, buitenMuren, muurOppervlakteOnderDak, muurLengte,
  MODEL_VELDEN, ONTWERP_VELDEN,
} from '../js/model/index.js';
import { kerncijfers, raming } from '../js/metrics/index.js';

const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));
const bestaand = () => migreer(lees('../designs/bestaand.json'));
const zolderOps = () => lees('../tools/voorbeelden/zolder-programma.ops.json');
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r.fouten)); return r.model; };
const pas = (m, r) => { assert.ok(!r.fout, r.fout); return ok(applyOps(m, r.ops)); };
const alleIds = (m) => new Set(['niveaus', 'muren', 'openingen', 'ruimtes', 'vloeren', 'daken', 'trappen', 'inrichting'].flatMap((c) => (m[c] || []).map((x) => x.id)));

// ── idTeller ────────────────────────────────────────────────────────────────

test('idTeller: afbraakZone (garage 2 = hoogste ruimte-id) + nieuwe ruimte geeft een NIEUW id', () => {
  let m = bestaand();
  const hoogste = hoogsteIdNummer(m, 'R');
  assert.ok(m.ruimtes.some((r) => r.id === `R${hoogste}`));
  const garage = m.ruimtes.find((r) => r.id === 'R15');
  assert.ok(garage, 'R15 bestaat in bestaand');
  m = pas(m, opsAfbraakZone(m, { ruimte: 'R15' }));
  assert.ok(!m.ruimtes.some((r) => r.id === 'R15'), 'de ruimte van de zone is verwijderd');
  assert.equal(m.idTeller.R, hoogste, 'verwijderd id onthouden');
  // via de bewerking (idMaker) én via toevoegen zonder id (volgendId)
  const r = opsRuimteRechthoek(m, 'N0', [500, 500], [1500, 1500], { naam: 'Nieuw', functie: 'badkamer' });
  assert.equal(r.info.id, `R${hoogste + 1}`);
  assert.equal(volgendId(m, 'ruimtes'), `R${hoogste + 1}`);
  const a = applyOps(m, [{ op: 'toevoegen', collectie: 'ruimtes', item: { niveau: 'N0', naam: 'X', functie: 'overig', contour: [[500, 500], [900, 500], [900, 900]] } }]);
  assert.deepEqual(a.nieuweIds, [`R${hoogste + 1}`]);
  assert.equal(a.model.idTeller.R, hoogste + 1, 'toevoegen werkt een bestaande teller bij');
});

test('idTeller: cascade (muur → openingen) wordt onthouden; binnen één operatielijst geen hergebruik', () => {
  const m0 = bestaand();
  const muur = m0.muren.find((w) => m0.openingen.some((o) => o.muur === w.id));
  const opening = m0.openingen.filter((o) => o.muur === muur.id).map((o) => Number(o.id.slice(1))).sort((a, b) => b - a)[0];
  const maxO = hoogsteIdNummer(m0, 'O');
  // hoogste opening verwijderen + meteen een nieuwe zonder id ⇒ niet hetzelfde nummer
  const hoogsteO = m0.openingen.find((o) => o.id === `O${maxO}`);
  const r = ok(applyOps(m0, [
    { op: 'verwijderen', collectie: 'openingen', id: hoogsteO.id },
    { op: 'toevoegen', collectie: 'openingen', item: { ...hoogsteO, id: undefined } },
  ]));
  assert.ok(r.openingen.some((o) => o.id === `O${maxO + 1}`));
  assert.ok(!r.openingen.some((o) => o.id === `O${maxO}`));
  // muur verwijderen ⇒ ook de id's van zijn openingen in de teller
  const m2 = ok(applyOps(m0, [{ op: 'verwijderen', collectie: 'muren', id: muur.id }]));
  assert.ok(m2.idTeller.O >= opening);
  assert.ok(m2.idTeller.M >= Number(muur.id.slice(1)));
});

test('idTeller: optioneel, enkel na een verwijdering; validator controleert de vorm; niet via de operatie ontwerp', () => {
  const m = bestaand();
  assert.equal(m.idTeller, undefined, 'designs hebben (nog) geen teller');
  assert.ok(MODEL_VELDEN.includes('idTeller'));
  assert.ok(!ONTWERP_VELDEN.includes('idTeller'));
  const toegevoegd = ok(applyOps(m, [{ op: 'toevoegen', collectie: 'ruimtes', item: { niveau: 'N0', naam: 'X', functie: 'overig', contour: [[500, 500], [900, 500], [900, 900]] } }]));
  assert.equal(toegevoegd.idTeller, undefined, 'toevoegen zonder teller laat het veld weg (geen ruis)');
  assert.ok(validate({ ...m, idTeller: { R: 20, M: 3 } }).geldig);
  assert.equal(validate({ ...m, idTeller: { Q: 1 } }).geldig, false);
  assert.equal(validate({ ...m, idTeller: { R: -1 } }).geldig, false);
  assert.equal(validate({ ...m, idTeller: { R: 1.5 } }).geldig, false);
  assert.equal(validate({ ...m, idTeller: [] }).geldig, false);
  assert.equal(validate({ ...m, idTeller: { R: 20 } }).waarschuwingen.some((w) => w.pad === 'idTeller'), false, 'geen "onbekend veld"');
  assert.equal(applyOps(m, [{ op: 'ontwerp', velden: { idTeller: { R: 1 } } }]).ok, false);
  // teller lager dan de bestaande id's: bestaande id's winnen
  assert.equal(volgendId({ ...m, idTeller: { R: 1 } }, 'ruimtes'), `R${hoogsteIdNummer(m, 'R') + 1}`);
  assert.equal(volgendId({ ...m, idTeller: { R: 99 } }, 'ruimtes'), 'R100');
});

test('idTeller: diff negeert de teller (geen ruis "idTeller gewijzigd"); undo herstelt hem', () => {
  const m = bestaand();
  const g = new Geschiedenis(m);
  assert.ok(g.toepassen(opsAfbraakZone(m, { ruimte: 'R15' }).ops, 'afbraak').ok);
  const d = diff(m, g.huidig);
  assert.ok(!d.some((x) => x.collectie === 'ontwerp'), beschrijfDiff(d).join('\n'));
  assert.ok(!beschrijfDiff(d).some((t) => /idTeller/.test(t)));
  assert.equal(diff({ ...m, idTeller: { R: 3 } }, { ...m, idTeller: { R: 9 } }).length, 0);
  g.undo();
  assert.equal(g.huidig.idTeller, undefined);
});

test('zolder-programma.ops.json hergebruikt geen id\'s (geen toegevoegd id dat eerder bestond of verwijderd werd)', () => {
  const m0 = bestaand();
  const ooit = alleIds(m0);
  for (const op of zolderOps().ops) {
    if (op.op !== 'toevoegen') continue;
    if (!op.item.id) continue; // automatisch id bij het toepassen (volgendId) — gecontroleerd hieronder
    assert.ok(!ooit.has(op.item.id), `id ${op.item.id} hergebruikt`);
    ooit.add(op.item.id);
  }
  const m = ok(applyOps(m0, zolderOps().ops));
  // de nieuwe zolderruimtes hebben hogere nummers dan alle ruimtes van bestaand
  const maxBestaand = hoogsteIdNummer(m0, 'R');
  const zolder = m.niveaus.find((n) => n.soort === 'zolder');
  for (const r of m.ruimtes.filter((x) => x.niveau === zolder.id)) assert.ok(Number(r.id.slice(1)) > maxBestaand, r.id);
});

// ── buitenmuren op een zolder ───────────────────────────────────────────────

function zolderVariant() {
  const m = ok(applyOps(bestaand(), zolderOps().ops));
  const Z = m.niveaus.find((n) => n.soort === 'zolder').id;
  return { m, Z };
}

test('buitenMuren: zolderwanden onder het dak zijn binnenwanden (flood-fill lekt niet meer)', () => {
  const { m, Z } = zolderVariant();
  const wanden = m.muren.filter((w) => w.niveau === Z);
  assert.equal(wanden.length, 7);
  assert.deepEqual(buitenMuren(m, Z), []);
  // andere niveaus ongewijzigd: verdieping heeft nog zijn gevels
  assert.ok(buitenMuren(m, 'N1').length >= 4);
});

test('buitenMuren: een topgevel op de rand van de dakvoetafdruk is een buitenmuur; ook zonder soort als niets omsloten is', () => {
  let m = bestaand();
  const z = opsZolderNiveau(m, { onderNiveau: 'N1', naam: 'Zolder' });
  m = pas(m, z);
  const Z = z.info.id;
  // dak D1: contour x 0..7000, y 0..8000, nok langs x ⇒ topgevels op x = 0 en x = 7000
  const topgevel = opsMuurTekenen(m, { niveau: Z, start: [140, 0], eind: [140, 8000], dikte: 280, status: 'nieuw' });
  m = pas(m, topgevel);
  const wand = opsMuurTekenen(m, { niveau: Z, start: [3500, 1500], eind: [3500, 6500], dikte: 100, status: 'nieuw' });
  m = pas(m, wand);
  assert.deepEqual(buitenMuren(m, Z), [topgevel.info.id]);
  // zonder soort: niets omsloten + hellend dak op het peil ⇒ zelfde regel
  const zonder = JSON.parse(JSON.stringify(m));
  delete zonder.niveaus.find((n) => n.id === Z).soort;
  assert.deepEqual(buitenMuren(zonder, Z), [topgevel.info.id]);
  // dak op afbraak ⇒ geen dakregel meer (gewone flood-fill: alles buiten)
  const zonderDak = JSON.parse(JSON.stringify(zonder));
  for (const d of zonderDak.daken) if (d.id === 'D1') d.status = 'afbraak';
  assert.equal(buitenMuren(zonderDak, Z).length, 2);
});

// ── muuroppervlakte onder het dak + kerncijfers ─────────────────────────────

test('muurOppervlakteOnderDak: analytisch voor de zolderwanden (zadeldak 45°, nok y = 4000)', () => {
  const { m, Z } = zolderVariant();
  const wanden = m.muren.filter((w) => w.niveau === Z);
  // onder een 45°-dak met rust op het zolderpeil is de dakhoogte boven punt (x, y) = min(y, 8000 − y)
  const dak = (y) => Math.min(y, 8000 - y);
  for (const w of wanden) {
    const L = muurLengte(w);
    const H = w.hoogte ?? m.niveaus.find((n) => n.id === Z).hoogte;
    // numerieke integratie langs de as van min(H, dak) — het gemiddelde van beide zijvlakken voor deze lineaire profielen
    let verwacht = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const t = ((i + 0.5) / N) * L;
      const y = w.start[1] + ((w.eind[1] - w.start[1]) * t) / L;
      verwacht += (Math.min(H, dak(y)) * L) / N;
    }
    const A = muurOppervlakteOnderDak(m, w);
    assert.ok(Math.abs(A - verwacht) / verwacht < 0.002, `${w.id}: ${A} vs ${verwacht}`);
    assert.ok(A < L * (m.niveaus.find((n) => n.id === Z).hoogte) - 1, `${w.id} is afgeknipt`);
  }
  // muren zonder dak erboven: lengte × hoogte
  const gv = m.muren.find((w) => w.niveau === 'N0' && w.status === 'bestaand');
  assert.equal(muurOppervlakteOnderDak(m, gv), muurLengte(gv) * 3000);
});

test('kerncijfers zolder-variant: zolderwanden = binnenmuren met afgeknipte m²; raming realistisch', () => {
  const { m, Z } = zolderVariant();
  const k = kerncijfers(m);
  // analytisch: 2 knieschoten 6,44 × 1,15 + M34 6,44 × 3,5 + M35 ∫y 1200..3500 + M36 3,97 × 3,6 + 2 × 2,4 × 2,4 − 4 deuren
  const bruto = 2 * 6.44 * 1.15 + 6.44 * 3.5 + (3.5 ** 2 - 1.2 ** 2) / 2 + 3.97 * 3.6 + 2 * 2.4 * 2.4;
  const deuren = m.openingen.filter((o) => m.muren.find((w) => w.id === o.muur)?.niveau === Z).reduce((s, o) => s + (o.breedte * o.hoogte) / 1e6, 0);
  assert.equal(k.muren.nieuwBuiten, 0);
  assert.ok(Math.abs(k.muren.nieuwBinnen - (bruto - deuren)) < 0.1, `${k.muren.nieuwBinnen} vs ${bruto - deuren}`);
  // volle niveauhoogte (4 m) zou veel meer geven
  const vol = m.muren.filter((w) => w.niveau === Z).reduce((s, w) => s + (muurLengte(w) * (w.hoogte ?? 4000)) / 1e6, 0) - deuren;
  assert.ok(k.muren.nieuwBinnen < vol - 10);
  const prijzen = lees('../designs/prijzen.json');
  const r = raming(m, prijzen, { kerncijfers: k });
  const post = (s) => r.posten.find((p) => p.sleutel === s);
  assert.equal(post('muur_nieuw_buiten').hoeveelheid, 0);
  assert.ok(Math.abs(post('muur_nieuw_binnen').hoeveelheid - k.muren.nieuwBinnen) < 1e-9);
});
