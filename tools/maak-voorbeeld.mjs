// Genereert designs/voorbeeld.json: een eenvoudig, FICTIEF voorbeeldhuis om de app te testen.
// Breedte 7 m en perceelbreedte 14 m komen van de gebruiker; alle andere maten zijn aannames.
import { writeFileSync } from 'node:fs';
import { validate, formatteerFouten, naarJson } from '../js/model/index.js';

const B = 7000, D = 9000, UIT = 3000, t = 300, h = t / 2, ti = 140;
const muur = (id, niveau, start, eind, status = 'bestaand', dikte = t) => ({ id, niveau, start, eind, dikte, status });
const rh = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const m = {
  schemaVersie: 2,
  id: 'voorbeeld',
  naam: 'Voorbeeldhuis',
  beschrijving: 'Fictief testhuis (7 m breed, perceel 14 m). Diepte, hoogtes en indeling zijn aannames — NIET de bestaande toestand.',
  basis: null,
  perceel: { contour: rh(-3500, -8000, 10500, 30000) },
  niveaus: [
    { id: 'N0', naam: 'Gelijkvloers', peil: 0, hoogte: 2900 },
    { id: 'N1', naam: 'Verdieping', peil: 2900, hoogte: 2700, vloerdikte: 300, soort: 'verdieping' },
  ],
  muren: [
    // gelijkvloers: buitenmuren (as op h van de buitengevel)
    muur('M1', 'N0', [h, h], [B - h, h]),                 // voorgevel
    muur('M2', 'N0', [B - h, h], [B - h, D - h]),         // rechts
    muur('M3', 'N0', [B - h, D - h], [h, D - h], 'afbraak'), // achtergevel → open naar uitbouw
    muur('M4', 'N0', [h, D - h], [h, h]),                 // links
    muur('M5', 'N0', [h, 4500], [B - h, 4500], 'bestaand', ti),       // binnenmuur
    muur('M6', 'N0', [3500, h], [3500, 4500], 'bestaand', ti),        // scheidingsmuur (in de app van afbraak naar bestaand gezet)
    // uitbouw achteraan (nieuw)
    muur('M7', 'N0', [h, D - h], [h, D + UIT - h], 'nieuw'),
    muur('M8', 'N0', [h, D + UIT - h], [B - h, D + UIT - h], 'nieuw'),
    muur('M9', 'N0', [B - h, D + UIT - h], [B - h, D - h], 'nieuw'),
    // verdieping
    muur('M10', 'N1', [h, h], [B - h, h]),
    muur('M11', 'N1', [B - h, h], [B - h, D - h]),
    muur('M12', 'N1', [B - h, D - h], [h, D - h]),
    muur('M13', 'N1', [h, D - h], [h, h]),
    muur('M14', 'N1', [h, 4500], [B - h, 4500], 'bestaand', ti),
    muur('M15', 'N1', [4000, 4500], [4000, D - h], 'nieuw', 100),
  ],
  openingen: [
    { id: 'O1', muur: 'M1', type: 'deur', positie: 900, breedte: 1000, hoogte: 2200, borstwering: 0, status: 'bestaand' },
    { id: 'O2', muur: 'M1', type: 'raam', positie: 3000, breedte: 2800, hoogte: 1600, borstwering: 700, status: 'bestaand' },
    { id: 'O3', muur: 'M5', type: 'deur', positie: 600, breedte: 900, hoogte: 2100, borstwering: 0, status: 'bestaand' },
    { id: 'O4', muur: 'M8', type: 'raam', positie: 800, breedte: 5000, hoogte: 2400, borstwering: 0, status: 'nieuw' },
    { id: 'O5', muur: 'M2', type: 'raam', positie: 5500, breedte: 1200, hoogte: 1200, borstwering: 1000, status: 'bestaand' },
    { id: 'O6', muur: 'M10', type: 'raam', positie: 800, breedte: 1800, hoogte: 1400, borstwering: 900, status: 'bestaand' },
    { id: 'O7', muur: 'M10', type: 'raam', positie: 4000, breedte: 1800, hoogte: 1400, borstwering: 900, status: 'bestaand' },
    { id: 'O8', muur: 'M12', type: 'raam', positie: 800, breedte: 1500, hoogte: 1400, borstwering: 900, status: 'bestaand' },
    { id: 'O9', muur: 'M14', type: 'deur', positie: 500, breedte: 900, hoogte: 2100, borstwering: 0, status: 'bestaand' },
    { id: 'O10', muur: 'M15', type: 'deur', positie: 300, breedte: 800, hoogte: 2100, borstwering: 0, status: 'nieuw' },
  ],
  ruimtes: [
    { id: 'R1', niveau: 'N0', naam: 'Woonkamer', functie: 'woonkamer', contour: rh(t, t, B - t, 4500 - ti / 2) },
    { id: 'R2', niveau: 'N0', naam: 'Leefkeuken', functie: 'keuken', contour: rh(t, 4500 + ti / 2, B - t, D + UIT - t) },
    { id: 'R3', niveau: 'N1', naam: 'Slaapkamer 1', functie: 'slaapkamer', contour: rh(t, t, B - t, 4500 - ti / 2) },
    { id: 'R4', niveau: 'N1', naam: 'Slaapkamer 2', functie: 'slaapkamer', contour: rh(t, 4500 + ti / 2, 4000 - 50, D - t) },
    { id: 'R5', niveau: 'N1', naam: 'Badkamer', functie: 'badkamer', contour: rh(4000 + 50, 4500 + ti / 2, B - t, D - t) },
  ],
  vloeren: [
    { id: 'V1', niveau: 'N0', contour: rh(0, 0, B, D), dikte: 300, status: 'bestaand' },
    { id: 'V2', niveau: 'N0', contour: rh(0, D, B, D + UIT), dikte: 300, status: 'nieuw' },
    { id: 'V3', niveau: 'N1', contour: rh(0, 0, B, D), dikte: 300, status: 'bestaand' },
  ],
  daken: [
    { id: 'D1', niveau: 'N1', type: 'zadel', contour: rh(0, 0, B, D), helling: 40, nokrichting: 'x', overstek: 300, dikte: 300, status: 'bestaand' },
    { id: 'D2', niveau: 'N0', type: 'plat', contour: rh(0, D, B, D + UIT), helling: 0, overstek: 0, dikte: 350, status: 'nieuw' },
  ],
  trappen: [],
  inrichting: [],
};

const r = validate(m);
if (!r.geldig) { console.error(formatteerFouten(r)); process.exit(1); }
writeFileSync(new URL('../designs/voorbeeld.json', import.meta.url), naarJson(m));
console.log('designs/voorbeeld.json geschreven' + (r.waarschuwingen.length ? '\n' + formatteerFouten(r) : ''));
