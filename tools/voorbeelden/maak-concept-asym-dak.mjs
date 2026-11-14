// Genereert designs/concept-asymmetrisch-dak.json ("Concept: asymmetrisch dak achteraan") uit designs/bestaand.json met
// de bewerkingen (js/model/bewerkingen.js) en operaties. Robuust als bestaand.json later wijzigt: alle maten van de
// bestaande woning (rustvlak, dakbegrenzing, voordakhelling, gevels) worden uit bestaand.json gelezen; enkel de maten van
// het concept zelf (hieronder, CONCEPT) komen uit een aangeleverd 3D-model (afgeleide maten; het bronbestand zit NIET in
// de repo — CLAUDE.md regel 8). Opnieuw draaien na een wijziging van bestaand.json:
//
//   node tools/voorbeelden/maak-concept-asym-dak.mjs && node tools/validate.mjs
//   (proef op een ander basisbestand, zonder designs/ te wijzigen: --bestaand <pad.json> --uit <pad.json>)
//
// Concept (schets, geen ontwerp; stabiliteit, EPB en vergunning niet beoordeeld):
//  - afbraak achterbouw + garage 2 (zoals de zolder-varianten), zolderniveau onder het dak van de verdieping;
//  - het bestaande voordakvlak blijft (helling uit bestaand.json); het achterste dakvlak wordt afgebroken en vervangen door
//    een lessenaardak (CONCEPT.hellingAchter) met de hoge rand aan de nok (hogeZijde 'min') op een verhoogde achtergevel
//    (basisHoogte = knieschot). De nok ligt waar de onderkanten van beide dakvlakken elkaar snijden; schuift ze naar
//    achter t.o.v. de oude nok, dan wordt het voordakvlak tot daar verlengd (nieuw stuk, zelfde helling);
//  - verhoogde achtergevel en topgevels achter de oude nok als nieuwe muren op de zolder (volgen het dak);
//  - zolderindeling volgens het 3D-model (wanden CONCEPT.wanden); badkamer en verdeling van de achterste linkerkamer = voorstel;
//  - halfdraaitrap verdieping → zolder in de bestaande traphal (benadering van de trap uit het 3D-model: 15 optreden,
//    loopbreedte ~740, twee kwartdraaiingen met een tussenstuk — in het schema één halfdraai met draaitreden).
import { readFileSync, writeFileSync } from 'node:fs';
import {
  migreer, applyOps, validate, formatteerFouten, opsAfbraakZone, opsZolderNiveau, opsMuurTekenen, opsOpeningPlaatsen,
  opsTrapPlaatsen, opsInrichtingPlaatsen, begrenzing, niveauBovenkant, dakNokHoogte, trapGeometrie,
} from '../../js/model/index.js';

const ID = 'concept-asymmetrisch-dak';
const NAAM = 'Concept: asymmetrisch dak achteraan';

// Maten van het concept (mm, graden), afgeleid uit het aangeleverde 3D-model (app-assenstelsel, z boven de zoldervloer).
const CONCEPT = {
  hellingAchter: 28.5,
  knieschot: 1721, // onderkant nieuw achterdak aan de binnenzijde van de achtergevel, boven de zoldervloer …
  knieschotY: 7675, // … op app-y 7675 = binnenzijde achtergevel in het 3D-model (in het plan, en dus in de app, ligt ze op 7720;
  //                  afwijking plan ↔ 3D-model, zie docs/BESTAAND.md). Zo valt het dakvlak samen met dat van het 3D-model.
  dakdikteAchter: 300,
  // zolderwanden uit het 3D-model: [x0, y0, x1, y1] = vlakken van de wand (rechthoek in plan)
  wanden: {
    halAchter: [null, 4665, 3780, 4825], // x0 = binnenzijde linkergevel
    middenX: [3780, 3565, 3890, null], // y1 = binnenzijde achtergevel
    middenY: [3780, 3565, null, 3675], // x1 = binnenzijde rechtergevel
  },
  trap: { type: 'halfdraai', richting: 180, breedte: 740, aantalTreden: 15, aantrede: 200, draairichting: 'rechts', vertrek: [1830, 3185] },
};
// Voorstel (geen bron): badkamer in de achterste linkerkamer, naast de overloop.
const VOORSTEL = { badkamerX: 2680, badkamerDiepte: 1800, wand: 100 };
const GRENZEN = [1500, 2200]; // voorbeeldwaarden (docs/CONCEPT.md §3.1), geen norm

const tan = (g) => Math.tan((g * Math.PI) / 180);
const lees = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const r0 = (v) => Math.round(v);

const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
const bestaand = migreer(arg('--bestaand') ? JSON.parse(readFileSync(arg('--bestaand'), 'utf8')) : lees('../../designs/bestaand.json'));
let model = bestaand;
const alleOps = [];
function stap(label, r) {
  if (r.fout) throw new Error(`${label}: ${r.fout}`);
  const a = applyOps(model, r.ops);
  if (!a.ok) throw new Error(`${label}:\n${formatteerFouten(a)}`);
  model = a.model;
  alleOps.push(...r.ops);
  return r.info;
}
const ops = (label, lijst) => stap(label, { ops: lijst });
const nieuwsteId = (c) => model[c][model[c].length - 1].id;

// ── 0. Bestaande toestand lezen ────────────────────────────────────────────────
// het hellende hoofddak (zadel) rust op de verdieping; een bestaande zolder (bestaand.json sinds de IFC/STEP-opmeting: N2)
// ligt erboven en is zelf niet "de verdieping"
const D1 = model.daken.find((d) => d.status !== 'afbraak' && d.type === 'zadel' && d.helling > 0);
if (!D1 || (D1.nokrichting || 'x') !== 'x') throw new Error('Verwacht een zadeldak met nokrichting x op de verdieping.');
const verdieping = model.niveaus.find((n) => n.id === D1.niveau);
const B = begrenzing(D1.contour);
const tanV = tan(D1.helling), tanA = tan(CONCEPT.hellingAchter);
const murenV = model.muren.filter((m) => m.niveau === verdieping.id && m.status !== 'afbraak');
const verticaal = (m) => Math.abs(m.start[0] - m.eind[0]) < 1, horizontaal = (m) => Math.abs(m.start[1] - m.eind[1]) < 1;
const gevel = (filter, sleutel) => murenV.filter(filter).sort(sleutel)[0];
const links = gevel(verticaal, (a, b) => a.start[0] - b.start[0]);
const rechts = gevel(verticaal, (a, b) => b.start[0] - a.start[0]);
const achter = gevel(horizontaal, (a, b) => b.start[1] - a.start[1]);
const voor = gevel(horizontaal, (a, b) => a.start[1] - b.start[1]);
const Li = links.start[0] + links.dikte / 2, Ri = rechts.start[0] - rechts.dikte / 2;
const Ai = achter.start[1] - achter.dikte / 2, Vi = voor.start[1] + voor.dikte / 2;
const Ab = achter.start[1] + achter.dikte / 2; // buitenzijde achtergevel
// zolderruimtes niet vóór de lijn waar de onderkant van het voordak de zoldervloer raakt (daar is geen vrije hoogte)
const Vz = Math.max(Vi, B.minY);

// ── 1. Afbraak achterbouw + garage 2 (zoals de zolder-varianten) ───────────────
const ruimteId = (id, naam) => (model.ruimtes.find((r) => r.id === id) ? id : model.ruimtes.find((r) => r.naam === naam)?.id);
stap('afbraak achterbouw', opsAfbraakZone(model, { ruimte: [ruimteId('R5', 'Kamer achterbouw'), ruimteId('R6', 'Berging'), ruimteId('R7', 'Keuken (achterbouw)')].filter(Boolean) }));
stap('afbraak garage 2', opsAfbraakZone(model, { ruimte: ruimteId('R15', 'Garage 2') }));

// ── 2. Zolderniveau (vloer = dakcontour): de bestaande zolder als die er al is (zijn onbenoemde ruimte maakt plaats
//       voor de nieuwe indeling), anders een nieuwe ───────────────────────────
const bestaandeZolder = model.niveaus.find((n) => n.soort === 'zolder' && n.peil === niveauBovenkant(model, verdieping.id));
const Z = bestaandeZolder ? bestaandeZolder.id : stap('zolder', opsZolderNiveau(model, { onderNiveau: verdieping.id, naam: 'Zolder' })).id;
if (bestaandeZolder) for (const r of model.ruimtes.filter((x) => x.niveau === Z)) ops('zolderruimte weg', [{ op: 'verwijderen', collectie: 'ruimtes', id: r.id }]);

// ── 3. Daken ──────────────────────────────────────────────────────────────────
// Het nieuwe achterdak loopt tot de buitenzijde van de (verhoogde) achtergevel (Ab), zodat die gevel volledig onder het dak
// ligt (de app kent enkel een overstek rondom; hier overstek 0). basisHoogte = onderkant aan die rand, zodat de onderkant aan
// de binnenzijde van de achtergevel (in het 3D-model, CONCEPT.knieschotY) = knieschot.
const basis = r0(CONCEPT.knieschot - (Ab - CONCEPT.knieschotY) * tanA);
// nok: onderkant voor (B.minY → stijgend) = onderkant achter (Ab → stijgend naar voor)
const yn = r0((basis + Ab * tanA + B.minY * tanV) / (tanV + tanA));
const ym = (B.minY + B.maxY) / 2; // oude nok
const rh = (y0, y1) => [[B.minX, y0], [B.maxX, y0], [B.maxX, y1], [B.minX, y1]];
const dak = { niveau: D1.niveau, type: 'lessenaar', helling: D1.helling, nokrichting: 'x', overstek: 0, dikte: D1.dikte ?? 300 };
const dakOps = [
  // bestaand voordakvlak: blijft (tot de oude nok, of tot de nieuwe als die vóór de oude ligt)
  { op: 'wijzigen', collectie: 'daken', id: D1.id, velden: { type: 'lessenaar', contour: rh(B.minY, Math.min(ym, yn)), overstek: 0 } },
  // oud achterdakvlak: afbraak
  { op: 'toevoegen', collectie: 'daken', item: { ...dak, contour: rh(ym, B.maxY), hogeZijde: 'min', status: 'afbraak' } },
];
if (yn > ym + 1) // voordakvlak verlengen tot de nieuwe nok
  dakOps.push({ op: 'toevoegen', collectie: 'daken', item: { ...dak, contour: rh(ym, yn), basisHoogte: r0((ym - B.minY) * tanV), status: 'nieuw' } });
else if (yn < ym - 1) // nieuwe nok ligt vóór de oude: stuk voordakvlak afbreken
  dakOps.push({ op: 'toevoegen', collectie: 'daken', item: { ...dak, contour: rh(yn, ym), basisHoogte: r0((yn - B.minY) * tanV), status: 'afbraak' } });
dakOps.push({ op: 'toevoegen', collectie: 'daken', item: {
  ...dak, contour: rh(yn, Ab), helling: CONCEPT.hellingAchter, hogeZijde: 'min', basisHoogte: basis, dikte: CONCEPT.dakdikteAchter, status: 'nieuw',
} });
ops('daken', dakOps);
const nok = Math.max(...model.daken.filter((d) => d.niveau === D1.niveau && d.status !== 'afbraak' && d.type !== 'plat').map(dakNokHoogte));
ops('zolderhoogte', [{ op: 'wijzigen', collectie: 'niveaus', id: Z, velden: { hoogte: r0(nok) } }]);

// ── 4. Gevels op de zolder (nieuw): verhoogde achtergevel + topgevels achter de oude nok ─────────────
const muur = (label, start, eind, dikte) => stap(label, opsMuurTekenen(model, { niveau: Z, start, eind, dikte, status: 'nieuw' })).id;
const yGevel = Math.min(ym, yn);
const yA = achter.start[1];
muur('verhoogde achtergevel', [links.start[0], yA], [rechts.start[0], yA], achter.dikte);
muur('topgevel links', [links.start[0], yGevel], [links.start[0], yA], links.dikte);
muur('topgevel rechts', [rechts.start[0], yGevel], [rechts.start[0], yA], rechts.dikte);

// ── 5. Zolderwanden uit het 3D-model + voorstel badkamer ──────────────────────
const W = CONCEPT.wanden;
const wHal = muur('wand overloop ↔ achterkamers', [links.start[0], (W.halAchter[1] + W.halAchter[3]) / 2], [(W.middenX[0] + W.middenX[2]) / 2, (W.halAchter[1] + W.halAchter[3]) / 2], W.halAchter[3] - W.halAchter[1]);
const xMid = (W.middenX[0] + W.middenX[2]) / 2;
const wMidX = muur('wand achterkamers links ↔ rechts', [xMid, W.middenX[1]], [xMid, yA], W.middenX[2] - W.middenX[0]);
muur('wand overloop/berging ↔ slaapkamer 1', [xMid, (W.middenY[1] + W.middenY[3]) / 2], [Ri, (W.middenY[1] + W.middenY[3]) / 2], W.middenY[3] - W.middenY[1]);
const v = VOORSTEL, hw = v.wand / 2;
const yBad = W.halAchter[3] + v.badkamerDiepte; // achterkant badkamer (binnenvlak)
muur('wand badkamer ↔ slaapkamer 2 (x)', [v.badkamerX - hw, (W.halAchter[1] + W.halAchter[3]) / 2], [v.badkamerX - hw, yBad + hw], v.wand);
muur('wand badkamer ↔ slaapkamer 2 (y)', [v.badkamerX - hw, yBad + hw], [xMid, yBad + hw], v.wand);

// ── 6. Trap verdieping → zolder in de bestaande traphal ───────────────────────
const t = CONCEPT.trap;
const ox = Math.max(t.vertrek[0], Li + 4 * t.aantrede + t.breedte + 10);
const trapInfo = stap('trap', opsTrapPlaatsen(model, {
  van: verdieping.id, naar: Z, type: t.type, oorsprong: [ox, t.vertrek[1]], richting: t.richting, breedte: t.breedte,
  aantalTreden: t.aantalTreden, aantrede: t.aantrede, draairichting: t.draairichting,
}));
const tb = begrenzing(trapInfo.voetafdruk);

// ── 7. Deuren ─────────────────────────────────────────────────────────────────
const deur = (label, m, punt, breedte) => stap(label, opsOpeningPlaatsen(model, m, punt, { type: 'deur', breedte }));
const yHal = (W.halAchter[1] + W.halAchter[3]) / 2;
deur('deur slaapkamer 2', wHal, [(tb.maxX + v.badkamerX - v.wand) / 2, yHal], 700);
deur('deur badkamer', wHal, [(v.badkamerX + W.middenX[0]) / 2, yHal], 700);
deur('deur slaapkamer 1', wMidX, [xMid, (W.middenY[3] + W.halAchter[1]) / 2], 800);

// ── 8. Ruimtes (netto) ────────────────────────────────────────────────────────
const ruimte = (naam, functie, contour) => {
  ops(naam, [{ op: 'toevoegen', collectie: 'ruimtes', item: { niveau: Z, naam, functie, contour: contour.map((p) => p.map(r0)), hoogtegrenzen: GRENZEN } }]);
  return nieuwsteId('ruimtes');
};
const [x0, x1, y0, y1] = [W.middenX[0], W.middenX[2], W.middenY[1], W.middenY[3]];
ruimte('Slaapkamer 1', 'slaapkamer', [[x1, y1], [Ri, y1], [Ri, Ai], [x1, Ai]]);
ruimte('Slaapkamer 2', 'slaapkamer', [[Li, W.halAchter[3]], [v.badkamerX - v.wand, W.halAchter[3]], [v.badkamerX - v.wand, yBad + v.wand], [x0, yBad + v.wand], [x0, Ai], [Li, Ai]]);
const bad = ruimte('Badkamer', 'badkamer', [[v.badkamerX, W.halAchter[3]], [x0, W.halAchter[3]], [x0, yBad], [v.badkamerX, yBad]]);
ruimte('Overloop', 'hal', [[tb.maxX, y0], [x0, y0], [x0, W.halAchter[1]], [Li, W.halAchter[1]], [Li, tb.maxY], [tb.maxX, tb.maxY]]);
ruimte('Berging onder het voordak', 'berging', [[Li, Vz], [Ri, Vz], [Ri, y0], [tb.maxX, y0], [tb.maxX, tb.minY], [Li, tb.minY]]);
const traphal = model.ruimtes.find((r) => r.niveau === verdieping.id && /trap/i.test(r.naam));

// ── 9. Sanitair (douche: gebruikshoogte 2100 mm = voorstel, geen norm) ────────
stap('douche', opsInrichtingPlaatsen(model, { ruimte: bad, soort: 'douche', positie: [x0 - 450, W.halAchter[3] + 450], rotatie: 0, breedte: 900, diepte: 900, hoogte: 2100 }));
stap('lavabo', opsInrichtingPlaatsen(model, { ruimte: bad, soort: 'lavabo', positie: [x0 - 225, yBad - 450], rotatie: 90 }));

// ── 10. Programma van eisen + beschrijving ────────────────────────────────────
ops('programma', [{ op: 'ontwerp', velden: {
  beschrijving: `CONCEPT (schets, geen ontwerp): achterbouw en garage 2 afgebroken; zolder met 2 slaapkamers, berging en badkamer `
    + `(lavabo + douche). Bestaand voordakvlak (${D1.helling}°) blijft${yn > ym + 1 ? ' en wordt tot de nieuwe nok verlengd' : ''}; `
    + `achterste dakvlak vervangen door een lessenaardak van ${CONCEPT.hellingAchter}° op een verhoogde achtergevel `
    + `(knieschot ±${CONCEPT.knieschot} mm aan de binnenzijde). Halfdraaitrap vanuit de traphal van de verdieping. `
    + 'Dak- en zoldermaten afgeleid uit een aangeleverd 3D-model; badkamerindeling is een voorstel. Hoogtegrenzen 1,50/2,20 m zijn '
    + 'voorbeeldwaarden, geen norm. Stabiliteit, EPB en vergunning niet beoordeeld.',
  programma: {
    beschrijving: 'Concept asymmetrisch dak: zolder volgens programma van eisen',
    eisen: [
      { functie: 'slaapkamer', aantal: 2, niveau: 'zolder', minOppervlakte: null },
      { functie: 'berging', aantal: 1, niveau: 'zolder' },
      { functie: 'badkamer', aantal: 1, niveau: 'zolder', inrichting: ['lavabo', 'douche'] },
      { trap: { van: verdieping.id, naar: 'zolder', type: ['kwart', 'halfdraai', 'spiraal'] } },
    ],
  },
} }]);

// ── Wegschrijven ──────────────────────────────────────────────────────────────
const controle = applyOps(bestaand, alleOps);
if (!controle.ok) { console.error(formatteerFouten(controle)); process.exit(1); }
const uit = { ...controle.model, id: ID, naam: NAAM, basis: 'bestaand' };
delete uit.gewijzigd;
const v2 = validate(uit);
if (!v2.geldig) { console.error(formatteerFouten(v2)); process.exit(1); }
const json = JSON.stringify(uit, null, 2).replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, '[$1, $2]');
if (arg('--uit')) { writeFileSync(arg('--uit'), json + '\n'); console.log(`${arg('--uit')} geschreven.`); process.exit(0); }
writeFileSync(new URL(`../../designs/${ID}.json`, import.meta.url), json + '\n');
const indexUrl = new URL('../../designs/index.json', import.meta.url);
const index = JSON.parse(readFileSync(indexUrl, 'utf8'));
if (!index.ontwerpen.some((o) => o.id === ID)) {
  index.ontwerpen.push({ id: ID, naam: NAAM });
  writeFileSync(indexUrl, JSON.stringify({ ontwerpen: index.ontwerpen }, null, 2).replace(/\{\s+"id": ("[^"]+"),\s+"naam": ("[^"]+")\s+\}/g, '{ "id": $1, "naam": $2 }') + '\n');
}
const g = trapGeometrie(uit, uit.trappen[uit.trappen.length - 1]);
console.log(`designs/${ID}.json geschreven (${alleOps.length} operaties). Nok y = ${yn} (oude nok ${ym}), basisHoogte achterdak ${basis} mm, `
  + `zolderhoogte ${r0(nok)} mm, trap ${g.maten.aantalTreden} × ${Math.round(g.maten.optrede)} mm. Traphal verdieping: ${traphal?.id ?? '?'}`
  + (v2.waarschuwingen.length ? '\n' + formatteerFouten(v2) : ''));
