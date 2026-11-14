// Genereert tools/voorbeelden/zolder-programma.ops.json: DEMONSTRATIE van de voorbeeldopdracht (docs/FASE5.md) op
// designs/bestaand.json, opgebouwd met de hoog-niveau bewerkingen (js/model/bewerkingen.js):
//   "breek de achterbouw en garage 2 af en maak een compact plan volgens een programma van eisen: draaitrap naar zolder
//    + 2 slaapkamers + kleine berging + kleine badkamer (lavabo + douche) onder het dak".
// Alle maten hieronder zijn een PLAUSIBEL VOORSTEL om de werking te tonen — geen ontwerp, geen normen.
// De hoogtegrenzen 1500/2200 mm zijn de voorbeeldwaarden uit docs/CONCEPT.md §3.1 (geen norm).
//
// Gebruik: node tools/voorbeelden/maak-zolder-programma.mjs   (schrijft het ops-bestand; designs/ blijft ongewijzigd)
// Toepassen als variant: node tools/apply-ops.mjs bestaand tools/voorbeelden/zolder-programma.ops.json --als <id> --naam "<naam>"
import { readFileSync, writeFileSync } from 'node:fs';
import {
  migreer, applyOps, formatteerFouten, opsAfbraakZone, opsZolderNiveau, opsMuurTekenen, opsOpeningPlaatsen, opsRuimteRechthoek,
  opsTrapPlaatsen, opsInrichtingPlaatsen, vrijeHoogte,
} from '../../js/model/index.js';

let model = migreer(JSON.parse(readFileSync(new URL('../../designs/bestaand.json', import.meta.url), 'utf8')));
const alleOps = [];
function stap(label, r) {
  if (r.fout) throw new Error(`${label}: ${r.fout}`);
  const a = applyOps(model, r.ops);
  if (!a.ok) throw new Error(`${label}:\n${formatteerFouten(a)}`);
  model = a.model;
  alleOps.push(...r.ops);
  return r.info;
}

// 1. Afbraak: achterbouw (kamer, berging, keuken) en garage 2
stap('afbraak achterbouw', opsAfbraakZone(model, { ruimte: ['R5', 'R6', 'R7'] }));
stap('afbraak garage 2', opsAfbraakZone(model, { ruimte: 'R15' }));

// 2. Zolderniveau onder het zadeldak van de verdieping
const Z = stap('zolder', opsZolderNiveau(model, { onderNiveau: 'N1', naam: 'Zolder' })).id;

// 3. Wanden op de zolder (100 mm). Knieschotten op y 1200 en 6800, hoogte = vrije hoogte aan hun buitenvlak.
const W = 100;
const knie = (y, buiten) => Math.floor(vrijeHoogte(model, Z, [3500, buiten]));
const muur = (label, start, eind, hoogte) => stap(label, opsMuurTekenen(model, { niveau: Z, start, eind, dikte: W, status: 'nieuw', hoogte })).id;
muur('knieschot voor', [280, 1200], [6720, 1200], knie(1200, 1150));
muur('knieschot achter', [280, 6800], [6720, 6800], knie(6800, 6850));
const wb = muur('wand badkamer/slaapkamer 1 ↔ overloop', [280, 3500], [6720, 3500]);
muur('wand badkamer ↔ slaapkamer 1', [2250, 1200], [2250, 3500]);
const wm = muur('wand overloop ↔ berging/slaapkamer 2', [2750, 4400], [6720, 4400]);
muur('wand overloop ↔ berging', [2750, 4400], [2750, 6800]);
muur('wand berging ↔ slaapkamer 2', [3750, 4400], [3750, 6800]);

// 4. Deuren
const deur = (label, m, punt, breedte) => stap(label, opsOpeningPlaatsen(model, m, punt, { type: 'deur', breedte }));
deur('deur badkamer', wb, [1700, 3500], 700);
deur('deur slaapkamer 1', wb, [3200, 3500], 800);
deur('deur berging', wm, [3250, 4400], 700);
deur('deur slaapkamer 2', wm, [4600, 4400], 800);

// 5. Ruimtes (netto contour). Hoogtegrenzen 1500/2200 mm = voorbeeldwaarden (CONCEPT §3.1), geen norm.
const GRENZEN = [1500, 2200];
const ruimte = (naam, functie, p1, p2) => {
  const r = opsRuimteRechthoek(model, Z, p1, p2, { naam, functie });
  r.ops[0].item.hoogtegrenzen = GRENZEN;
  return stap(naam, r).id;
};
const badkamer = ruimte('Badkamer', 'badkamer', [280, 1250], [2200, 3450]);
ruimte('Slaapkamer 1', 'slaapkamer', [2300, 1250], [6720, 3450]);
ruimte('Berging', 'berging', [2800, 4450], [3700, 6750]);
ruimte('Slaapkamer 2', 'slaapkamer', [3800, 4450], [6720, 6750]);
stap('overloop', { ops: [{ op: 'toevoegen', collectie: 'ruimtes', item: {
  niveau: Z, naam: 'Overloop zolder', functie: 'hal', hoogtegrenzen: GRENZEN,
  contour: [[280, 3550], [6720, 3550], [6720, 4350], [2700, 4350], [2700, 6750], [280, 6750]],
} }] });

// 6. Draaitrap (halfdraai, draaitreden) van de verdieping naar de zolder, in de slaapkamer links-achter (R10) die traphal wordt.
//    Aantrede 220 mm = voorstel; optrede volgt uit het hoogteverschil en de werkwaarde doel-optrede.
stap('trap', opsTrapPlaatsen(model, { van: 'N1', naar: Z, type: 'halfdraai', oorsprong: [1880, 4840], richting: 90, breedte: 800, aantrede: 220, draairichting: 'links' }));
stap('traphal', { ops: [{ op: 'wijzigen', collectie: 'ruimtes', id: 'R10', velden: { naam: 'Traphal (trap naar zolder)', functie: 'trap' } }] });

// 7. Sanitair in de badkamer, waar de vrije hoogte volstaat (douche: gebruikshoogte 2100 mm = voorstel, geen norm)
stap('douche', opsInrichtingPlaatsen(model, { ruimte: badkamer, soort: 'douche', positie: [730, 2950], rotatie: 0, breedte: 900, diepte: 900, hoogte: 2100 }));
stap('lavabo', opsInrichtingPlaatsen(model, { ruimte: badkamer, soort: 'lavabo', positie: [1975, 2600], rotatie: 90 }));

// 8. Programma van eisen + beschrijving
alleOps.push({ op: 'ontwerp', velden: {
  beschrijving: 'VOORBEELD (demonstratie fase 5, geen ontwerp): achterbouw en garage 2 afgebroken; zolder onder het zadeldak met '
    + 'halfdraaitrap vanuit de verdieping, 2 slaapkamers, berging en badkamer (lavabo + douche). Maten zijn een plausibel voorstel; '
    + 'hoogtegrenzen 1,50/2,20 m zijn voorbeeldwaarden, geen norm. Stabiliteit, EPB en vergunning niet beoordeeld.',
  programma: {
    beschrijving: 'Voorbeeldopdracht fase 5',
    eisen: [
      { functie: 'slaapkamer', aantal: 2, niveau: 'zolder', minOppervlakte: null },
      { functie: 'berging', aantal: 1, niveau: 'zolder' },
      { functie: 'badkamer', aantal: 1, niveau: 'zolder', inrichting: ['lavabo', 'douche'] },
      { trap: { van: 'N1', naar: 'zolder', type: ['kwart', 'halfdraai', 'spiraal'] } },
    ],
  },
} });

const r = applyOps(migreer(JSON.parse(readFileSync(new URL('../../designs/bestaand.json', import.meta.url), 'utf8'))), alleOps);
if (!r.ok) { console.error(formatteerFouten(r)); process.exit(1); }
const bestand = {
  _uitleg: 'VOORBEELD — demonstratie van de voorbeeldopdracht van fase 5 op designs/bestaand.json. Gegenereerd door '
    + 'tools/voorbeelden/maak-zolder-programma.mjs met de bewerkingen uit js/model/bewerkingen.js. Maten zijn een plausibel voorstel, '
    + 'geen ontwerp en geen normen. Toepassen: node tools/apply-ops.mjs bestaand tools/voorbeelden/zolder-programma.ops.json --als <id> --naam "<naam>".',
  basis: 'bestaand',
  ops: alleOps,
};
writeFileSync(new URL('./zolder-programma.ops.json', import.meta.url), JSON.stringify(bestand, null, 2).replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, '[$1, $2]') + '\n');
console.log(`tools/voorbeelden/zolder-programma.ops.json geschreven (${alleOps.length} operaties)`
  + (r.waarschuwingen.length ? '\n' + formatteerFouten(r) : ''));
