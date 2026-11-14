// Genereert designs/bestaand.json: eerste SCHATTING van de bestaande toestand van de woning.
// Bronnen (zie docs/BESTAAND.md voor de volledige maattabel):
//   gegeven door de eigenaar : woningbreedte 7000 mm, perceelbreedte 14000 mm;
//   geschat uit één straatfoto: hoogtes, dak, gevelopeningen (±10–20 %);
//   aanname                   : diepte 9000 mm, positie op het perceel, perceeldiepte, binnenindeling.
// Alle maten zijn afgerond op 50 mm. Openingposities = fractie van de buitenbreedte, omgezet naar de muuras.
import { writeFileSync } from 'node:fs';
import { validate, formatteerFouten, naarJson } from '../js/model/index.js';

const B = 7000;             // gegeven
const D = 9000;             // AANNAME — diepte niet zichtbaar op de foto
const H0 = 3000, H1 = 2800; // foto-schatting: vloer-tot-vloer gelijkvloers / verdieping (goot ≈ 5800)
const t = 300, h = t / 2;   // spouwmuur; as op 150 mm van de buitenzijde
const S = 'bestaand';
const r50 = (v) => Math.round(v / 50) * 50;
const muur = (id, niveau, start, eind) => ({ id, niveau, start, eind, dikte: t, status: S });
const rh = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// Opening in de voorgevel: x van de linkerrand aan de buitengevel (mm) → positie langs de as (as start op x = h).
const voor = (id, muurId, type, xBuiten, breedte, hoogte, borstwering) =>
  ({ id, muur: muurId, type, positie: r50(xBuiten) - h, breedte, hoogte, borstwering, status: S });
// Opening in de linker zijgevel: de muur loopt van achter (y = D - h) naar voor (y = h).
// yVoor = y van de voorste rand van de opening; positie = afstand vanaf de achterste as-hoek.
const links = (id, muurId, yVoor, breedte, hoogte, borstwering) =>
  ({ id, muur: muurId, type: 'raam', positie: (D - h) - (r50(yVoor) + breedte), breedte, hoogte, borstwering, status: S });

const m = {
  schemaVersie: 1,
  id: 'bestaand',
  naam: 'Bestaande toestand (schatting)',
  beschrijving:
    'Eerste SCHATTING van de bestaande toestand. Gegeven door de eigenaar: woningbreedte 7 m, perceelbreedte 14 m. ' +
    'Uit één straatfoto geschat (±10–20 %): 2 bouwlagen (3,0 m + 2,8 m, goot ≈ 5,8 m), zadeldak 45° met nok evenwijdig aan de straat, ' +
    'overstek ≈ 0,5 m (in het model rondom; op de foto enkel zeker aan de voorgevel), buitenmuren 300 mm, ramen en deur in voorgevel en linker zijgevel. ' +
    'Aangenomen (onbekend): diepte 9 m, positie van de woning op het perceel en perceeldiepte, achtergevel, binnenindeling, posities van de zijgevelramen in de diepte. ' +
    'Niet opgenomen: schoorsteen, zolderraam in de topgevel, rondboog van het smalle raam en de lagere zijvolumes links en rechts (open vraag aan de eigenaar). Zie docs/BESTAAND.md.',
  basis: null,
  perceel: { contour: rh(-3500, -8000, 10500, 30000) }, // AANNAME: woning gecentreerd, voortuin 8 m, perceel tot y = 30 m
  niveaus: [
    { id: 'N0', naam: 'Gelijkvloers', peil: 0, hoogte: H0 },
    { id: 'N1', naam: 'Verdieping', peil: H0, hoogte: H1, vloerdikte: 300 },
  ],
  muren: [
    muur('M1', 'N0', [h, h], [B - h, h]),         // voorgevel (straat)
    muur('M2', 'N0', [B - h, h], [B - h, D - h]), // rechter zijgevel
    muur('M3', 'N0', [B - h, D - h], [h, D - h]), // achtergevel (onbekend)
    muur('M4', 'N0', [h, D - h], [h, h]),         // linker zijgevel (topgevel)
    muur('M5', 'N1', [h, h], [B - h, h]),
    muur('M6', 'N1', [B - h, h], [B - h, D - h]),
    muur('M7', 'N1', [B - h, D - h], [h, D - h]),
    muur('M8', 'N1', [h, D - h], [h, h]),
  ],
  openingen: [
    // voorgevel gelijkvloers
    voor('O1', 'M1', 'raam', 0.10 * B, 800, 1700, 600),  // smal hoog raam met rondboog (boog niet gemodelleerd), 0.10–0.21
    voor('O2', 'M1', 'deur', 2550, 1000, 2200, 0),       // voordeur; groep deur + zijlicht (≈ 1400) gecentreerd op 0.38–0.55
    voor('O3', 'M1', 'raam', 3600, 400, 2200, 0),        // zijlicht naast de deur (aan welke kant: na te kijken)
    voor('O4', 'M1', 'raam', 0.68 * B, 2000, 1700, 600), // breed raam, 0.68–0.97
    // voorgevel verdieping
    voor('O5', 'M5', 'raam', 0.15 * B, 1800, 1400, 900), // 0.15–0.41
    voor('O6', 'M5', 'raam', 0.57 * B, 1800, 1400, 900), // 0.57–0.83
    // linker zijgevel — de posities in de diepte zijn een gok
    links('O7', 'M4', 3700, 600, 1000, 1000),            // gelijkvloers, klein raam (1–2 op de foto; 1 gemodelleerd)
    links('O8', 'M8', 2000, 600, 1200, 800),             // verdieping
    links('O9', 'M8', 5500, 600, 1200, 800),             // verdieping
  ],
  ruimtes: [
    { id: 'R1', niveau: 'N0', naam: 'Gelijkvloers (indeling onbekend)', functie: 'overig', contour: rh(t, t, B - t, D - t) },
    { id: 'R2', niveau: 'N1', naam: 'Verdieping (indeling onbekend)', functie: 'overig', contour: rh(t, t, B - t, D - t) },
  ],
  vloeren: [
    { id: 'V1', niveau: 'N0', contour: rh(0, 0, B, D), dikte: 300, status: S },
    { id: 'V2', niveau: 'N1', contour: rh(0, 0, B, D), dikte: 300, status: S },
  ],
  daken: [
    { id: 'D1', niveau: 'N1', type: 'zadel', contour: rh(0, 0, B, D), helling: 45, nokrichting: 'x', overstek: 500, dikte: 300, status: S },
  ],
};

const r = validate(m);
if (!r.geldig) { console.error(formatteerFouten(r)); process.exit(1); }
writeFileSync(new URL('../designs/bestaand.json', import.meta.url), naarJson(m));
console.log('designs/bestaand.json geschreven' + (r.waarschuwingen.length ? '\n' + formatteerFouten(r) : ''));
