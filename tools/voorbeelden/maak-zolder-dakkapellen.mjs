// Genereert designs/zolder-dakkapellen.json ("Zolder met dakkapellen voor en achter") uit designs/bestaand.json met de
// bewerkingen van js/model/ (geen handwerk in de JSON). Robuust als bestaand.json wijzigt: elementen worden opgezocht
// op naam/geometrie, maten volgen uit het model. Draai opnieuw na een wijziging aan bestaand.json:
//   node tools/voorbeelden/maak-zolder-dakkapellen.mjs        (schrijft het ontwerp + designs/index.json)
//   node tools/voorbeelden/maak-zolder-dakkapellen.mjs --rapport   (ook kerncijfers en hoogtebanden met/zonder dakkapellen)
//
// Bronnen en aannames (zie ook docs/DATAMODEL.md "Dakkapellen" en het rapport bij deze variant):
//  - Zolderwanden: afgeleid uit de STEP van de gebruiker (bron NIET in de repo, CLAUDE.md regel 8), vlakken van de zolderschaal
//    op STEP x 2410 / −1070 / −1180 en y −160…0 / 990…1100, omgerekend met x = 2710 − x_step, y = 4665 − y_step (mm):
//      wand A  x 3780…3890 (dikte 110), van wand C tot de achtergevel;
//      wand B  y 4665…4825 (dikte 160), van de linker zijgevel tot wand A (boven de bestaande wand overloop/slaapkamer);
//      wand C  y 3565…3675 (dikte 110), van wand A tot de rechter zijgevel.
//    De STEP gebruikt een ASYMMETRISCH dakconcept; daarvan nemen we enkel de wanden over, niet het dak: de dakkapellen komen
//    in het bestaande symmetrische zadeldak van bestaand.json.
//  - Wanden D en E (dikte 90, in het verlengde van wand A en boven de bestaande badkamerwand) en alle deuren staan NIET in de
//    STEP: aanvulling om berging en slaapkamer voor af te sluiten en de kamers bereikbaar te maken.
//  - Kamernamen: interpretatie (de STEP bevat geen namen), zie stap 7.
//  - Trap verdieping → zolder: benadering van de trap in de STEP (15 optreden, loopbreedte 740, aantrede 200, twee
//    kwartdraaien = halfdraai naar rechts, vertrek in −x). Het trapgat is in de app de volledige voetafdruk.
//  - Dakkapellen, maten van ramen, douchehoogte: VOORSTEL (geen norm), aangepast aan de kamerbreedte en de nokhoogte.
//  - Hoogtegrenzen 1500/2200 mm: voorbeeldwaarden (docs/CONCEPT.md §3.1), geen norm.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  migreer, applyOps, validate, formatteerFouten, naarJson, opsAfbraakZone, opsZolderNiveau, opsMuurTekenen, opsOpeningPlaatsen,
  opsTrapPlaatsen, opsInrichtingPlaatsen, opsDakkapelPlaatsen, begrenzing, polygoonZwaartepunt, dakNokHoogte, niveauBovenkant,
  oppervlaktePerHoogteband, toetsProgramma, dakkapelGeometrie,
} from '../../js/model/index.js';
import { kerncijfers } from '../../js/metrics/kerncijfers.js';

const ID = 'zolder-dakkapellen';
const NAAM = 'Zolder met dakkapellen voor en achter';
const pad = (p) => new URL(`../../${p}`, import.meta.url);
const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
// --bron <bestand> (proef met een ander bestaand-ontwerp) en --uit <bestand> (schrijft enkel daarheen, designs/ blijft ongewijzigd)
const bron = migreer(JSON.parse(readFileSync(arg('--bron') || pad('designs/bestaand.json'), 'utf8')));
let model = bron;
const meldingen = [];
function stap(label, r) {
  if (r.fout) throw new Error(`${label}: ${r.fout}`);
  const a = applyOps(model, r.ops);
  if (!a.ok) throw new Error(`${label}:\n${formatteerFouten(a)}`);
  model = a.model;
  for (const m of r.info?.meldingen || []) meldingen.push(`${label}: ${m}`);
  return r.info;
}
const rond = (v) => Math.round(v);

// ── 1. Wat is wat in bestaand.json ───────────────────────────────────────────────────────────────────────────
const hellend = (d) => d.status !== 'afbraak' && d.type === 'zadel' && d.helling > 0;
const hoofddak = model.daken.find(hellend);
if (!hoofddak) throw new Error('Geen zadeldak gevonden in bestaand.json.');
const V = model.niveaus.find((n) => n.id === hoofddak.niveau); // verdieping onder het dak
const G = [...model.niveaus].sort((a, b) => a.peil - b.peil)[0]; // gelijkvloers
const db = begrenzing(hoofddak.contour);
// binnenmaten van de verdieping (unie van haar ruimtes)
const vb = begrenzing(model.ruimtes.filter((r) => r.niveau === V.id).flatMap((r) => r.contour));
// in y begrensd door het dak (contour = waar de onderkant van het dak de zoldervloer raakt): daarbuiten is er geen vrije hoogte
const IN = { x0: vb.minX, x1: vb.maxX, y0: Math.max(vb.minY, db.minY), y1: Math.min(vb.maxY, db.maxY) };

// ── 2. Afbraak: achterbouw (ruimtes op het gelijkvloers achter het hoofdvolume) en garage 2 ─────────────────────
const zw = (r) => polygoonZwaartepunt(r.contour);
const achterbouw = model.ruimtes.filter((r) => r.niveau === G.id && zw(r)[1] > db.maxY && zw(r)[0] > db.minX && zw(r)[0] < db.maxX).map((r) => r.id);
const garage2 = model.ruimtes.filter((r) => /garage\s*2/i.test(r.naam)).map((r) => r.id);
if (achterbouw.length) stap('afbraak achterbouw', opsAfbraakZone(model, { ruimte: achterbouw }));
if (garage2.length) stap('afbraak garage 2', opsAfbraakZone(model, { ruimte: garage2 }));

// ── 3. Zolder onder het bestaande dak ───────────────────────────────────────────────────────────────────────
// Bestaat er al een zolder boven de verdieping (bestaand.json sinds de IFC/STEP-opmeting: N2), dan wordt die gebruikt en
// maakt zijn onbenoemde ruimte plaats voor de nieuwe indeling; anders wordt ze aangemaakt (oudere bestaande toestand).
const bestaandeZolder = model.niveaus.find((n) => n.soort === 'zolder' && n.peil === niveauBovenkant(model, V.id));
const Z = bestaandeZolder ? bestaandeZolder.id : stap('zolder', opsZolderNiveau(model, { onderNiveau: V.id, naam: 'Zolder' })).id;
for (const r of bestaandeZolder ? model.ruimtes.filter((x) => x.niveau === Z) : []) stap('zolderruimte weg', { ops: [{ op: 'verwijderen', collectie: 'ruimtes', id: r.id }] });

// ── 4. Zolderwanden (STEP) + aanvulling ────────────────────────────────────────────────────────────────────
const STEP = { A: { x: 3835, d: 110 }, B: { y: 4745, d: 160 }, C: { y: 3620, d: 110 } };
const muur = (label, start, eind, dikte) => stap(label, opsMuurTekenen(model, { niveau: Z, start, eind, dikte, status: 'nieuw' })).id;
const wA = muur('wand A (STEP)', [STEP.A.x, STEP.C.y], [STEP.A.x, IN.y1], STEP.A.d);
const wB = muur('wand B (STEP)', [IN.x0, STEP.B.y], [STEP.A.x, STEP.B.y], STEP.B.d);
muur('wand C (STEP)', [STEP.A.x, STEP.C.y], [IN.x1, STEP.C.y], STEP.C.d);
// aanvulling (niet in de STEP): wand D = verlengde van wand A naar voor; wand E boven de bestaande wand badkamer/overloop
const bestaandeBadWand = model.muren.find((m) => m.niveau === V.id && m.status !== 'afbraak' && m.start[1] === m.eind[1] && m.start[1] > IN.y0 + 1500 && m.start[1] < STEP.C.y - 500 && Math.min(m.start[0], m.eind[0]) <= IN.x0 + 200);
const yE = bestaandeBadWand ? bestaandeBadWand.start[1] : 2725;
const wD = muur('wand D (aanvulling)', [STEP.A.x, IN.y0], [STEP.A.x, STEP.C.y], 90);
const wE = muur('wand E (aanvulling)', [IN.x0, yE], [STEP.A.x, yE], 90);

// ── 5. Trap verdieping → zolder (benadering van de STEP-trap) ────────────────────────────────────────────────
// Halfdraai naar rechts, vertrek in −x; de draaizone eindigt 10 mm voor de linker binnengevel; eerste vlucht 45 mm
// achter de wand van de overloop op de verdieping (zoals in de STEP).
const overloopV = model.ruimtes.find((r) => r.niveau === V.id && /overloop|trap/i.test(r.naam));
const oy0 = overloopV ? begrenzing(overloopV.contour).minY : yE + 45;
const TRAP = { breedte: 740, aantrede: 200, aantalTreden: 15, draairichting: 'rechts', richting: 180 };
let trapInfo = null;
for (const dx of [0, 20, 40, 60]) for (const dy of [45, 60, 30, 80]) {
  if (trapInfo) break;
  const oorsprong = [IN.x0 + 10 + TRAP.breedte + 4 * TRAP.aantrede + dx, oy0 + dy + TRAP.breedte / 2];
  const r = opsTrapPlaatsen(model, { van: V.id, naar: Z, type: 'halfdraai', oorsprong, ...TRAP });
  if (!r.fout) trapInfo = stap('trap naar zolder', r);
}
if (!trapInfo) throw new Error('Trap verdieping → zolder past niet in de overloop.');
const trapB = begrenzing(trapInfo.voetafdruk);

// ── 6. Deuren (aanvulling: de STEP bevat geen deuren) ───────────────────────────────────────────────────────
const deur = (label, m, punt, breedte) => stap(label, opsOpeningPlaatsen(model, m, punt, { type: 'deur', breedte, hoogte: 2000 }));
deur('deur berging', wE, [Math.min(STEP.A.x - 500, trapB.maxX + 450), yE], 700);
deur('deur slaapkamer achter', wB, [Math.min(STEP.A.x - 450, trapB.maxX + 450), STEP.B.y], 800);
deur('deur slaapkamer voor', wD, [STEP.A.x, (Math.max(yE, trapB.minY) + STEP.C.y) / 2 - 20], 700);
deur('deur badkamer', wA, [STEP.A.x, (STEP.C.y + STEP.B.y) / 2 + 40], 700);

// ── 7. Ruimtes (netto contour tussen de wandvlakken) ─────────────────────────────────────────────────────────
const GRENZEN = [1500, 2200]; // voorbeeldwaarden (CONCEPT §3.1), geen norm
const h = (d) => d / 2;
const ruimte = (naam, functie, contour) => {
  stap(naam, { ops: [{ op: 'toevoegen', collectie: 'ruimtes', item: { niveau: Z, naam, functie, contour, hoogtegrenzen: GRENZEN } }] });
  return model.ruimtes.at(-1).id;
};
const ax = STEP.A.x, ad = h(STEP.A.d), by = STEP.B.y, bd = h(STEP.B.d), cy = STEP.C.y, cd = h(STEP.C.d), ed = h(90);
// Interpretatie van de kamerverdeling (de STEP bevat geen namen): het lage voorste deel links = berging (boven de bestaande
// badkamer), voor rechts = slaapkamer voor (dakkapel voor), achter links = slaapkamer achter (dakkapel achter), achter rechts =
// badkamer (de douche kan er tegen wand C, waar het dak hoog genoeg is), midden links = overloop met de trap.
const R = {
  berging: ruimte('Berging', 'berging', [[IN.x0, IN.y0], [ax - ed, IN.y0], [ax - ed, yE - ed], [IN.x0, yE - ed]]),
  voor: ruimte('Slaapkamer voor', 'slaapkamer', [[ax + ed, IN.y0], [IN.x1, IN.y0], [IN.x1, cy - cd], [ax + ed, cy - cd]]),
  overloop: ruimte('Overloop', 'hal', [[IN.x0, yE + ed], [ax - ed, yE + ed], [ax - ed, by - bd], [IN.x0, by - bd]]),
  achter: ruimte('Slaapkamer achter', 'slaapkamer', [[IN.x0, by + bd], [ax - ad, by + bd], [ax - ad, IN.y1], [IN.x0, IN.y1]]),
  badkamer: ruimte('Badkamer', 'badkamer', [[ax + ad, cy + cd], [IN.x1, cy + cd], [IN.x1, IN.y1], [ax + ad, IN.y1]]),
};

// ── 8. Dakkapellen: één voor, één achter, gecentreerd in de slaapkamers (VOORSTEL, geen norm) ──────────────────
// positie z 900 mm (onderkant voorvlak = borstwering van het raam), vrije hoogte eronder positie z + hoogte ≈ 2300 mm
// (begrensd zodat het dakje minstens 300 mm onder de nok blijft), breedte = kamerbreedte − 2 × 300 mm (max. 2400 mm),
// raam = breedte tussen de zijwangen − 2 × 200 mm, 1100 mm hoog.
const rustZ = niveauBovenkant(model, hoofddak.niveau);
const nokBovenVloer = rustZ + dakNokHoogte(hoofddak) - model.niveaus.find((n) => n.id === Z).peil;
const POS_Z = 900;
const HOOGTE = Math.min(1400, Math.floor((nokBovenVloer - 300 - POS_Z) / 10) * 10);
const dakkapel = (label, ruimteId, zijde) => {
  const rb = begrenzing(model.ruimtes.find((r) => r.id === ruimteId).contour);
  const breedte = Math.min(2400, Math.floor((rb.breedte - 600) / 10) * 10);
  const raamB = Math.floor((breedte - 2 * 120 - 400) / 10) * 10;
  return stap(label, opsDakkapelPlaatsen(model, {
    dak: hoofddak.id, zijde, positieX: rond((rb.minX + rb.maxX) / 2), positieZ: POS_Z, breedte, hoogte: HOOGTE,
    raam: { breedte: raamB, hoogte: Math.min(1100, HOOGTE - 100) },
  })).id;
};
const kVoor = dakkapel('dakkapel voor', R.voor, 'voor');
const kAchter = dakkapel('dakkapel achter', R.achter, 'achter');

// ── 9. Badkamer: douche (gebruikshoogte 2100 = voorstel) en lavabo, plek tegen een wand ──────────────────────
stap('douche', opsInrichtingPlaatsen(model, { ruimte: R.badkamer, soort: 'douche', breedte: 900, diepte: 900, hoogte: 2100 }));
stap('lavabo', opsInrichtingPlaatsen(model, { ruimte: R.badkamer, soort: 'lavabo' }));

// ── 10. Ontwerpgegevens + programma van eisen ───────────────────────────────────────────────────────────────
const programma = {
  beschrijving: 'Zolder met dakkapellen voor en achter (variant)',
  eisen: [
    { functie: 'slaapkamer', aantal: 2, niveau: 'zolder' },
    { functie: 'badkamer', aantal: 1, niveau: 'zolder', inrichting: ['lavabo', 'douche'] },
    { functie: 'berging', aantal: 1, niveau: 'zolder' },
    { functie: 'hal', aantal: 1, niveau: 'zolder', naam: 'Overloop' },
    { trap: { van: V.id, naar: 'zolder', type: ['halfdraai', 'kwart', 'spiraal'] } },
  ],
};
const resultaat = {
  ...model,
  id: ID,
  naam: NAAM,
  basis: 'bestaand',
  beschrijving: 'Achterbouw en garage 2 afgebroken; zolder onder het bestaande zadeldak met de wandindeling van de STEP-schets '
    + '(wanden A, B, C) aangevuld met twee scheidingswanden en deuren; halfdraaitrap vanuit de overloop van de verdieping '
    + '(benadering van de STEP-trap: 15 optreden, loopbreedte 740). Dakkapel voor in de slaapkamer voor en dakkapel achter in de '
    + 'slaapkamer achter, elk met een plat dakje en een raam. Kamernamen zijn een interpretatie; dakkapel- en raammaten, '
    + `positie z ${POS_Z} mm en douchehoogte zijn een voorstel, geen norm. Hoogtegrenzen 1,50/2,20 m zijn voorbeeldwaarden. `
    + 'Stabiliteit (o.a. kepers/gordingen bij de dakkapellen), EPB en vergunning niet beoordeeld. '
    + 'Gegenereerd door tools/voorbeelden/maak-zolder-dakkapellen.mjs.',
  programma,
};
const v = validate(resultaat);
if (!v.geldig) { console.error(formatteerFouten(v)); process.exit(1); }
writeFileSync(arg('--uit') || pad(`designs/${ID}.json`), naarJson(resultaat));
const index = JSON.parse(readFileSync(pad('designs/index.json'), 'utf8'));
if (!arg('--uit') && !index.ontwerpen.some((o) => o.id === ID)) {
  index.ontwerpen.push({ id: ID, naam: NAAM });
  writeFileSync(pad('designs/index.json'), JSON.stringify(index, null, 2).replace(/\{\n\s+"id": ("[^"]+"),\n\s+"naam": ("[^"]+")\n\s+\}/g, '{ "id": $1, "naam": $2 }') + '\n');
}
console.log(`designs/${ID}.json geschreven (${resultaat.dakkapellen.length} dakkapellen, ${resultaat.ruimtes.filter((r) => r.niveau === Z).length} zolderruimtes).`);
if (v.waarschuwingen.length) console.log(formatteerFouten({ fouten: [], waarschuwingen: v.waarschuwingen }));
for (const m of meldingen) console.log(`melding: ${m}`);

// ── rapport: kerncijfers en hoogtebanden met en zonder dakkapellen ──────────────────────────────────────────
if (process.argv.includes('--rapport')) {
  const zonder = { ...resultaat, dakkapellen: [] };
  const f2 = (x) => x.toFixed(2).replace('.', ',');
  const kz = kerncijfers(zonder), km = kerncijfers(resultaat);
  console.log(`\nDak ${hoofddak.id}: helling ${hoofddak.helling}°, rustvlak ${rustZ}, nok ${rond(nokBovenVloer)} mm boven de zoldervloer.`);
  for (const k of resultaat.dakkapellen) {
    const g = dakkapelGeometrie(resultaat, k);
    console.log(`${k.id} ${k.zijde}: positie x ${k.positieX}, positie z ${k.positieZ}, breedte ${k.breedte}, hoogte ${k.hoogte}, raam ${k.raam.breedte}×${k.raam.hoogte}; `
      + `voorvlak op ${rond(g.dVoor)} mm van de goot, diepte ${rond(g.diepte)} mm, vrije hoogte eronder ${k.positieZ + k.hoogte} mm, `
      + `voorvlak ${f2(g.voorvlakM2)} m², raam ${f2(g.raamM2)} m², volume +${f2(g.volume / 1e9)} m³`);
  }
  console.log(`Kerncijfers: zolder volume ${f2(kz.niveaus.find((n) => n.id === Z).volume)} → ${f2(km.niveaus.find((n) => n.id === Z).volume)} m³; `
    + `dakkapellen ${km.dakkapellen.aantal}, voorvlak ${f2(km.dakkapellen.voorvlakM2)} m², raam ${f2(km.dakkapellen.raamM2)} m², volume +${f2(km.dakkapellen.volume)} m³; `
    + `netto ${f2(km.netto)} m², totaal volume ${f2(kz.volume.totaal)} → ${f2(km.volume.totaal)} m³`);
  console.log('\nHoogtebanden per zolderruimte (m²: <1,50 | 1,50–2,20 | ≥2,20) — zonder → met dakkapellen');
  for (const r of resultaat.ruimtes.filter((x) => x.niveau === Z)) {
    const a = oppervlaktePerHoogteband(zonder, r.id), b = oppervlaktePerHoogteband(resultaat, r.id);
    console.log(`${r.naam.padEnd(18)} ${f2(a.m2)} m²: ${a.banden.map((x) => f2(x.m2)).join(' | ')}  →  ${b.banden.map((x) => f2(x.m2)).join(' | ')}`);
  }
  const t = toetsProgramma(resultaat);
  console.log(`\nProgramma: ${JSON.stringify(t.samenvatting)}`);
  for (const x of t.resultaten) console.log(`  ${x.status.padEnd(12)} ${x.label}: ${x.uitleg}`);
  console.log(`trap: ${JSON.stringify(resultaat.trappen.at(-1))}`);
  console.log(`dakkapellen: ${kVoor}, ${kAchter}`);
}
