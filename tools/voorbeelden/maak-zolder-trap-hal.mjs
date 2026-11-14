// Genereert designs/zolder-programma-trap-hal.json: "Zolder volgens programma — trap in bestaande traphal".
//
// Vertrekt van designs/bestaand.json en gebruikt de hoog-niveau bewerkingen (js/model/bewerkingen.js):
//  - afbraak achterbouw + garage 2 (zoals tools/voorbeelden/maak-zolder-programma.mjs);
//  - de NIEUWE trap verdieping → zolder zoals de gebruiker ze in het 3D-model (IFC) tekende, in de bestaande traphal
//    boven de bestaande trap: 15 × 185 mm, breedte 740, eerst 4 treden van 200 mm naar −x (x 1830 → 1030, y 2815..3555),
//    dan draaitreden naar +y en terug naar +x. Het schema kent geen U-trap met een tussenstuk: VEREENVOUDIGD tot een
//    halfdraaitrap (zie docs/BESTAAND.md, "Trap naar de zolder (IFC)"). Er wordt GEEN slaapkamer opgeofferd;
//  - op de bestaande zolder (N2): 2 slaapkamers, kleine berging, kleine badkamer (lavabo + douche), overloop.
// De indeling van de zolder is een PLAUSIBEL VOORSTEL rond het trapgat en de vrije hoogte onder het dak
// (zadeldak 38,5°, nok ±2,79 m boven de zoldervloer) — geen ontwerp, geen normen. Hoogtegrenzen 1500/2200 mm =
// voorbeeldwaarden (docs/CONCEPT.md §3.1), geen norm. Douche: gebruikshoogte 2100 mm = voorstel.
//
// Gebruik: node tools/voorbeelden/maak-zolder-trap-hal.mjs   (schrijft het ontwerp en zet het in designs/index.json)
import { readFileSync, writeFileSync } from 'node:fs';
import {
  migreer, applyOps, validate, formatteerFouten, naarJson, dupliceer, opsAfbraakZone, opsMuurTekenen, opsOpeningPlaatsen,
  opsTrapPlaatsen, opsInrichtingPlaatsen, vrijeHoogte, toetsProgramma,
} from '../../js/model/index.js';

const ID = 'zolder-programma-trap-hal';
const NAAM = 'Zolder volgens programma — trap in bestaande traphal';
const pad = (x) => new URL(`../../designs/${x}`, import.meta.url);
const basis = migreer(JSON.parse(readFileSync(pad('bestaand.json'), 'utf8')));
let model = dupliceer(basis, ID, NAAM);

function stap(label, r) {
  if (r.fout) throw new Error(`${label}: ${r.fout}`);
  const a = applyOps(model, r.ops);
  if (!a.ok) throw new Error(`${label}:\n${formatteerFouten(a)}`);
  model = a.model;
  return r.info;
}
const ruimteId = (niveau, naam) => model.ruimtes.find((r) => r.niveau === niveau && r.naam === naam)?.id;

// 1. Afbraak: achterbouw (kamer, berging, keuken) en garage 2
stap('afbraak achterbouw', opsAfbraakZone(model, { ruimte: ['Kamer achterbouw', 'Berging', 'Keuken (achterbouw)'].map((n) => ruimteId('N0', n)) }));
stap('afbraak garage 2', opsAfbraakZone(model, { ruimte: ruimteId('N0', 'Garage 2') }));

// 2. Bestaande zolder (N2): de onbenoemde zolderruimte maakt plaats voor de nieuwe indeling
const Z = model.niveaus.find((n) => n.soort === 'zolder').id;
for (const r of model.ruimtes.filter((x) => x.niveau === Z)) stap('zolderruimte weg', { ops: [{ op: 'verwijderen', collectie: 'ruimtes', id: r.id }] });

// 3. Nieuwe trap verdieping → zolder (IFC van de gebruiker), in de bestaande traphal boven de bestaande trap.
//    oorsprong = midden van de voorrand van de onderste trede (x 1830, y midden van 2815..3555); aantrede 200 = IFC.
const N1 = 'N1';
const trap = stap('trap', opsTrapPlaatsen(model, {
  van: N1, naar: Z, type: 'halfdraai', oorsprong: [1830, 3185], richting: 180, breedte: 740,
  aantalTreden: 15, optrede: 185, aantrede: 200, draairichting: 'rechts',
}));
// trapgat in de zoldervloer = voetafdruk: x 290..1830, y 2815..4295 (vereenvoudiging, zie DATAMODEL)

// 4. Wanden op de zolder (100 mm). Knieschoten: hoogte = vrije hoogte aan hun buitenvlak.
const W = 100;
const knie = (y, buiten) => Math.floor(vrijeHoogte(model, Z, [3500, buiten]));
const muur = (label, start, eind, hoogte) => stap(label, opsMuurTekenen(model, { niveau: Z, start, eind, dikte: W, status: 'nieuw', hoogte })).id;
const XL = 280, XR = 6860; // binnenvlakken van de zijgevels eronder
muur('knieschot voor', [XL, 1500], [XR, 1500], knie(1500, 1450));
muur('knieschot achter', [XL, 6500], [XR, 6500], knie(6500, 6550));
muur('wand slaapkamer 1 ↔ trapgat (voor)', [XL, 2765], [1880, 2765]);
muur('wand slaapkamer 1 ↔ trapgat (zij)', [1880, 2765], [1880, 3455]);
const wOverloopVoor = muur('wand slaapkamer 1 ↔ overloop', [1880, 3455], [3450, 3455]);
const wOverloopAchter = muur('wand overloop/trapgat ↔ berging/slaapkamer 2', [XL, 4395], [3450, 4395]);
const wBad = muur('wand overloop ↔ badkamer', [3450, 3050], [3450, 4800]);
muur('wand badkamer ↔ slaapkamer 1', [3450, 3050], [4900, 3050]);
muur('wand badkamer ↔ slaapkamer 2', [3450, 4800], [4900, 4800]);
muur('wand badkamer ↔ slaapkamers (rechts)', [4900, 3050], [4900, 4800]);
muur('wand slaapkamer 1 ↔ slaapkamer 2 (op de nok)', [4900, 3990], [XR, 3990]);
muur('wand berging ↔ slaapkamer 2', [2650, 4395], [2650, 6500]);

// 5. Deuren (in de strook met de meeste vrije hoogte, langs de nok)
const deur = (label, m, punt, breedte) => stap(label, opsOpeningPlaatsen(model, m, punt, { type: 'deur', breedte }));
deur('deur slaapkamer 1', wOverloopVoor, [2700, 3455], 700);
deur('deur slaapkamer 2', wOverloopAchter, [3050, 4395], 700);
deur('deur berging', wOverloopAchter, [2250, 4395], 600);
deur('deur badkamer', wBad, [3450, 3950], 700);

// 6. Ruimtes (netto contour). Hoogtegrenzen 1500/2200 mm = voorbeeldwaarden (CONCEPT §3.1), geen norm.
const GRENZEN = [1500, 2200];
const ruimte = (naam, functie, contour) => stap(naam, { ops: [{ op: 'toevoegen', collectie: 'ruimtes', item: { niveau: Z, naam, functie, contour, hoogtegrenzen: GRENZEN } }] });
// de slaapkamers lopen rechts van de badkamer door tot op de nok (daar is de meeste stahoogte)
ruimte('Slaapkamer 1 (zolder voor)', 'slaapkamer', [[XL, 1550], [XR, 1550], [XR, 3940], [4950, 3940], [4950, 3000], [3400, 3000], [3400, 3405], [1930, 3405], [1930, 2715], [XL, 2715]]);
ruimte('Slaapkamer 2 (zolder achter)', 'slaapkamer', [[2700, 4445], [3400, 4445], [3400, 4850], [4950, 4850], [4950, 4040], [XR, 4040], [XR, 6450], [2700, 6450]]);
ruimte('Badkamer', 'badkamer', [[3500, 3100], [4850, 3100], [4850, 4750], [3500, 4750]]);
ruimte('Berging', 'berging', [[XL, 4445], [2600, 4445], [2600, 6450], [XL, 6450]]);
ruimte('Overloop zolder', 'hal', [[1830, 3505], [3400, 3505], [3400, 4345], [1830, 4345]]);
ruimte('Trap (trapgat)', 'trap', [[XL, 2815], [1830, 2815], [1830, 4345], [XL, 4345]]);
const badkamer = ruimteId(Z, 'Badkamer');

// 7. Sanitair: douche achteraan op de nok (vrije hoogte ≥ 2100 = voorstel), lavabo tegen de voorwand van de badkamer
stap('douche', opsInrichtingPlaatsen(model, { ruimte: badkamer, soort: 'douche', positie: [4400, 4300], rotatie: 180, breedte: 900, diepte: 900, hoogte: 2100 }));
stap('lavabo', opsInrichtingPlaatsen(model, { ruimte: badkamer, soort: 'lavabo', positie: [3850, 3325], rotatie: 0 }));

// 8. Programma van eisen + beschrijving
stap('programma', { ops: [{ op: 'ontwerp', velden: {
  basis: 'bestaand',
  beschrijving: 'VARIANT (voorstel, geen ontwerp): achterbouw en garage 2 afgebroken; nieuwe trap van de verdieping naar de bestaande '
    + 'zolder in de bestaande traphal, boven de bestaande trap, zoals getekend door de gebruiker (IFC; in het model vereenvoudigd tot een '
    + 'halfdraaitrap 15 × 185 mm, breedte 740 mm). Geen slaapkamer opgeofferd. Zolder: 2 slaapkamers, kleine berging, kleine badkamer '
    + '(lavabo + douche op de nok) en overloop; de slaapkamers lopen rechts van de badkamer door tot op de nok. Dak: bestaand zadeldak 38,5° (nok ±2,79 m boven de zoldervloer) — '
    + 'weinig stahoogte: zie de hoogtebanden (1,50/2,20 m zijn voorbeeldwaarden, geen norm). Stabiliteit (zoldervloer, trapgat), '
    + 'EPB, brandveiligheid en vergunning niet beoordeeld.',
  programma: {
    beschrijving: 'Zolder volgens programma met de trap in de bestaande traphal (geen slaapkamer op de verdieping opofferen).',
    eisen: [
      { functie: 'slaapkamer', aantal: 2, niveau: 'zolder', minOppervlakte: null },
      { functie: 'berging', aantal: 1, niveau: 'zolder' },
      { functie: 'badkamer', aantal: 1, niveau: 'zolder', inrichting: ['lavabo', 'douche'] },
      { functie: 'hal', aantal: 1, niveau: 'zolder' },
      { functie: 'slaapkamer', aantal: 3, niveau: N1 },
      { trap: { van: N1, naar: 'zolder', type: ['kwart', 'halfdraai', 'spiraal'] } },
    ],
  },
} }] });

const r = validate(model);
if (!r.geldig) { console.error(formatteerFouten(r)); process.exit(1); }
writeFileSync(pad(`${ID}.json`), naarJson(model));
const index = JSON.parse(readFileSync(pad('index.json'), 'utf8'));
if (!index.ontwerpen.some((o) => o.id === ID)) index.ontwerpen.push({ id: ID, naam: NAAM });
writeFileSync(pad('index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`designs/${ID}.json geschreven (trap ${trap.id}, trapgat ${JSON.stringify(trap.trapgat.contour)})`
  + (r.waarschuwingen.length ? '\n' + formatteerFouten(r) : ''));
for (const x of toetsProgramma(model).resultaten) console.log(`  ${x.status.padEnd(12)} ${x.label} — ${x.uitleg}`);
