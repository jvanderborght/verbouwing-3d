// Genereert designs/bestaand.json: de bestaande toestand van de woning.
//
// BRON van de plattegrond: het bestaande plan (DXF, kader 'origineel'), getekend in cm.
// Alle x/y-maten hieronder staan in **cm** zoals afgelezen in dat kader (lokaal assenstelsel:
// oorsprong = buitenhoek links-voor gelijkvloers, x naar rechts, y naar achter) en worden
// met `mm()` omgerekend (× 10). Hoogtes staan in mm en zijn AANNAMES of foto-schattingen —
// een grondplan bevat geen hoogtes. Volledige verantwoording: docs/BESTAAND.md.
//
// Na wijzigen: `node tools/maak-bestaand.mjs && npm test`.
import { writeFileSync } from 'node:fs';
import { validate, formatteerFouten, naarJson, ruimteContourBijPunt } from '../js/model/index.js';

const S = 'bestaand';
const mm = (cm) => Math.round(cm * 10);
const P = (x, y) => [mm(x), mm(y)];
const rh = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];

// ── Hoogtes (mm) — NIET in het plan; foto-schatting / aanname ─────────────────
const H0 = 3000;          // gelijkvloers vloer-tot-vloer (foto-schatting)
const H1 = 2800;          // verdieping vloer-tot-vloer (foto-schatting)
const VLOER = 300;        // vloerdikte (aanname)
const DEUR_H = 2100;      // binnendeuren en doorgangen (aanname)
const RAAM = { hoogte: 1400, borstwering: 900 }; // standaardraam (aanname)

// ── Plan-maten (cm) ──────────────────────────────────────────────────────────
const B = 700;            // breedte buitenwerks (plan; = gegeven 7 m)
const D = 1250;           // diepte buitenwerks incl. achterbouw (plan, maatlijn 1250)
const D_HOOFD = 800;      // diepte hoofdvolume (2 bouwlagen) tot buitenzijde oude achtergevel (plan)
// Muurassen (cm). Buitenmuren 28 cm (9 gevelsteen + 5 spouw + 14 binnenblad); rechter zijgevel 14 cm.
const XL = 14;            // as linker zijgevel (0..28)
const XR = 693;           // as rechter zijgevel (686..700)
const YV = 14;            // as voorgevel (0..28)
const YA = 1236;          // as achtergevel achterbouw (1222..1250)
const YO = 786;           // as oude achtergevel (772..800)
const XB = 279;           // as dragende binnenmuur hoofdvolume (272..286)

let nMuur = 0, nOpening = 0;
const muren = [], openingen = [];
/** Muur in cm-coördinaten; geeft id terug. */
function muur(niveau, [x0, y0], [x1, y1], dikteCm) {
  const id = `M${++nMuur}`;
  muren.push({ id, niveau, start: P(x0, y0), eind: P(x1, y1), dikte: mm(dikteCm), status: S });
  return id;
}
/**
 * Opening in muur `id`; van/tot = coördinaat (cm) langs de muur (x bij een horizontale muur, y bij een verticale),
 * zoals afgelezen in het plan (binnendagmaat = buitenkant van het kader). positie = afstand vanaf muur.start.
 */
function opening(id, type, van, tot, { hoogte, borstwering }) {
  const m = muren.find((x) => x.id === id);
  const horizontaal = m.start[1] === m.eind[1];
  const s = horizontaal ? m.start[0] : m.start[1];
  const e = horizontaal ? m.eind[0] : m.eind[1];
  const richting = Math.sign(e - s);
  const a = mm(van), b = mm(tot);
  const positie = richting > 0 ? a - s : s - b;
  openingen.push({ id: `O${++nOpening}`, muur: id, type, positie, breedte: b - a, hoogte, borstwering, status: S });
}
const DEUR = { hoogte: DEUR_H, borstwering: 0 };

// ═════════════════════════════ Gelijkvloers (N0) ═════════════════════════════
// Volgorde van de buitenmuren bepaalt welke muur aan de hoek doorloopt (zie muurAansluiting).
const gVoor = muur('N0', [XL, YV], [XR, YV], 28);       // voorgevel (straat)
const gRechts = muur('N0', [XR, YV], [XR, YA], 14);     // rechter zijgevel, 14 cm, geen openingen
const gAchter = muur('N0', [XL, YA], [XR, YA], 28);     // achtergevel achterbouw
const gLinks = muur('N0', [XL, YV], [XL, YA], 28);      // linker zijgevel
const gOudAchter = muur('N0', [XL, YO], [XR, YO], 28);  // oude achtergevel (draagt de achtergevel van de verdieping)
const gBinnen = muur('N0', [XB, YV], [XB, 475], 14);    // dragende binnenmuur 272..286, tot y 482 (daarachter balk)
const gHal = muur('N0', [XL, 475], [XB, 475], 14);      // wand hal ↔ leefruimte (468..482)
const gInkom = muur('N0', [XL, 182.5], [XB, 182.5], 9); // wand inkom ↔ hal (178..187)
const gWc = muur('N0', [105.5, YV], [105.5, 182.5], 9); // wand wc ↔ inkom (101..110)
const gKast = muur('N0', [105.5, 365.6], [105.5, 475], 9); // kast onder de trap (101..110), vrij einde bij de trap
muur('N0', [271, 760], [271, YO], 30);                  // penant onder de balk (256..286 × 760..772)
const gAchterbouw = muur('N0', [272, YO], [272, YA], 28); // muur achterbouw 258..286 (opgebouwd als spouwmuur)
const gBerging = muur('N0', [XL, 1119.5], [272, 1119.5], 9); // wand berging (1115..1124)

// voorgevel
opening(gVoor, 'raam', 40, 80, { hoogte: 1700, borstwering: 600 });  // smal raam wc (hoogte: foto-schatting)
opening(gVoor, 'deur', 110, 196, { hoogte: 2200, borstwering: 0 });  // voordeur (scharnier x 118, blad 78)
opening(gVoor, 'raam', 196, 260, { hoogte: 2200, borstwering: 0 });  // zijlicht naast de voordeur
opening(gVoor, 'raam', 345, 645, { hoogte: 1700, borstwering: 600 }); // breed raam leefruimte (hoogte: foto-schatting)
// linker zijgevel
opening(gLinks, 'raam', 192, 252, { hoogte: 1000, borstwering: 1000 }); // klein raam (hoogte: foto-schatting)
opening(gLinks, 'raam', 380, 440, { hoogte: 1000, borstwering: 1000 });
opening(gLinks, 'raam', 560, 710, RAAM);
opening(gLinks, 'raam', 883, 1028, RAAM);
// achtergevel achterbouw
opening(gAchter, 'raam', 116, 176, RAAM);                            // raam berging
opening(gAchter, 'deur', 286, 369, DEUR);                            // achterdeur (scharnier x 290)
opening(gAchter, 'raam', 369, 686, { hoogte: 2200, borstwering: 0 }); // brede schuifraam tot de vloer
// binnen
opening(gOudAchter, 'deur', 355, 473, DEUR); // doorgang zonder deur (latei gestippeld)
opening(gInkom, 'deur', 130, 252, DEUR);     // doorgang zonder deur inkom → hal
opening(gWc, 'deur', 110, 173, DEUR);        // deur wc (63 cm)
opening(gKast, 'deur', 390, 463, DEUR);      // deur kast onder de trap
opening(gHal, 'deur', 180, 253, DEUR);       // deur hal → leefruimte
opening(gAchterbouw, 'deur', 810, 893, DEUR); // deur keuken → kamer achterbouw
opening(gBerging, 'deur', 165, 248, DEUR);   // deur berging

// ═════════════════════════════ Verdieping (N1) ═══════════════════════════════
const vVoor = muur('N1', [XL, YV], [XR, YV], 28);
const vRechts = muur('N1', [XR, YV], [XR, YO], 14);
const vAchter = muur('N1', [XL, YO], [XR, YO], 28);    // achtergevel verdieping = oude achtergevel
const vLinks = muur('N1', [XL, YV], [XL, YO], 28);
const vBinnen = muur('N1', [XB, YV], [XB, YO], 14);    // binnenmuur 272..286 over de hele diepte
const vBad = muur('N1', [XL, 272.5], [XB, 272.5], 9);  // wand badkamer (268..277)
const vOverloop = muur('N1', [XL, 475], [XB, 475], 14); // wand overloop ↔ slaapkamer (468..482)
muur('N1', [XB, 365.5], [XR, 365.5], 9);               // wand tussen de twee slaapkamers rechts (361..370)
void vRechts;

opening(vVoor, 'raam', 40, 260, { hoogte: 1400, borstwering: 900 });  // (foto-schatting)
opening(vVoor, 'raam', 345, 645, { hoogte: 1400, borstwering: 900 }); // (foto-schatting)
opening(vLinks, 'raam', 380, 440, { hoogte: 1200, borstwering: 800 }); // (foto-schatting)
opening(vLinks, 'raam', 560, 710, RAAM);
opening(vAchter, 'raam', 346, 626, RAAM);
opening(vBinnen, 'deur', 283, 356, DEUR);   // deur slaapkamer voor-rechts
opening(vBinnen, 'deur', 379.5, 452.5, DEUR); // deur slaapkamer achter-rechts
opening(vBad, 'deur', 180, 253, DEUR);
opening(vOverloop, 'deur', 180, 253, DEUR);

// ═════════════════════════════ Garages (N0) ══════════════════════════════════
// Apart gebouw links-achter, in hetzelfde kader getekend. Coördinaten (cm) t.o.v. de woning zoals getekend.
// Garage 1: buitenwerks x −801..−306, y 1360..2140, muren 26 cm. Garage 2 (tegen garage 1): x −306..44, y 1540..2140.
const GX0 = -788, GX1 = -319, GY0 = 1373, GY1 = 2127; // assen garage 1
const ga1 = muur('N0', [GX0, GY0], [GX1, GY0], 26);   // voorzijde met poort
muur('N0', [GX1, GY0], [GX1, GY1], 26);
const ga1Achter = muur('N0', [GX0, GY1], [GX1, GY1], 26);
muur('N0', [GX0, GY0], [GX0, GY1], 26);
muur('N0', [GX0, 1909.5], [GX1, 1909.5], 9);           // scheiding garage ↔ achterste berging (geen deur getekend)
opening(ga1, 'deur', -676, -431, { hoogte: 2100, borstwering: 0 });  // garagepoort 245 cm
opening(ga1Achter, 'deur', -486, -391, DEUR);           // deur achteraan
const ga2 = muur('N0', [-306, 1553], [40, 1553], 26);   // voorzijde garage 2 met poort
muur('N0', [40, 1553], [40, 2136], 8);                  // rechterwand 8 cm
muur('N0', [-306, 2136], [40, 2136], 8);                // achterwand 8 cm
opening(ga2, 'deur', -253.5, -8.5, { hoogte: 2100, borstwering: 0 }); // garagepoort 245 cm

// ═════════════════════════════ Model ═════════════════════════════════════════
const m = {
  schemaVersie: 2,
  id: 'bestaand',
  naam: 'Bestaande toestand',
  beschrijving:
    'Bestaande toestand. Plattegronden (muren, diktes, ramen, deuren, indeling) uit het bestaande plan (kader "origineel", cm): ' +
    'woning 7,00 × 12,50 m buitenwerks; hoofdvolume 8,00 m diep met 2 bouwlagen, enkelvoudige achterbouw 4,50 m met plat dak; ' +
    'buitenmuren 28 cm (rechter zijgevel 14 cm); twee garages links-achter zoals getekend. ' +
    'AANGENOMEN (niet in het plan): verdiepingshoogtes 3,0 m + 2,8 m en zadeldak 45° met nok evenwijdig aan de straat (foto-schatting), ' +
    'vloerdiktes, borstweringen en raamhoogtes (voorgevel: foto-schatting; elders standaard 900/1400), deuren 2,1 m, ' +
    'hoogte garages, positie en diepte van het perceel. Balken (leefruimte) en de trap zijn niet als element gemodelleerd. Zie docs/BESTAAND.md.',
  basis: null,
  // AANNAME: perceel 14 m breed (gegeven); woning tegen de rechter perceelgrens, voortuin 8 m, tot achter de garages.
  perceel: { contour: [[-7000, -8000], [7000, -8000], [7000, 22000], [-7000, 22000]] },
  niveaus: [
    { id: 'N0', naam: 'Gelijkvloers', peil: 0, hoogte: H0 },
    { id: 'N1', naam: 'Verdieping', peil: H0, hoogte: H1, vloerdikte: VLOER, soort: 'verdieping' },
  ],
  muren,
  openingen,
  ruimtes: [],
  vloeren: [
    { id: 'V1', niveau: 'N0', contour: rh(0, 0, B, D), dikte: VLOER, status: S },
    { id: 'V2', niveau: 'N1', contour: rh(0, 0, B, D_HOOFD), dikte: VLOER, status: S },
    { id: 'V3', niveau: 'N0', contour: rh(-801, 1360, -306, 2140), dikte: 150, status: S },
    { id: 'V4', niveau: 'N0', contour: rh(-306, 1540, 44, 2140), dikte: 150, status: S },
  ],
  daken: [
    { id: 'D1', niveau: 'N1', type: 'zadel', contour: rh(0, 0, B, D_HOOFD), helling: 45, nokrichting: 'x', overstek: 500, dikte: 300, status: S },
    { id: 'D2', niveau: 'N0', type: 'plat', contour: rh(0, D_HOOFD, B, D), helling: 0, overstek: 0, dikte: 300, status: S },
    { id: 'D3', niveau: 'N0', type: 'plat', contour: rh(-801, 1360, -306, 2140), helling: 0, overstek: 0, dikte: 250, status: S },
    { id: 'D4', niveau: 'N0', type: 'plat', contour: rh(-306, 1540, 44, 2140), helling: 0, overstek: 0, dikte: 250, status: S },
  ],
  trappen: [], // de bestaande trap GV → verdieping is niet uit het plan af te leiden (zie docs/BESTAAND.md)
  inrichting: [],
};

// ── Ruimtes: netto contour via ruimtedetectie op een punt in de kamer (cm) ───
const RUIMTES = [
  ['N0', 60, 100, 'WC', 'toilet'],
  ['N0', 190, 100, 'Inkom', 'hal'],
  ['N0', 200, 300, 'Hal met trap', 'hal'],
  ['N0', 450, 300, 'Leefruimte', 'woonkamer'],
  ['N0', 150, 950, 'Kamer achterbouw', 'overig'],
  ['N0', 150, 1170, 'Berging', 'berging'],
  ['N0', 450, 1000, 'Keuken (achterbouw)', 'keuken'],
  ['N1', 150, 150, 'Badkamer', 'badkamer'],
  ['N1', 200, 380, 'Overloop met trap', 'hal'],
  ['N1', 150, 600, 'Slaapkamer links-achter', 'slaapkamer'],
  ['N1', 450, 200, 'Slaapkamer voor', 'slaapkamer'],
  ['N1', 450, 550, 'Slaapkamer achter', 'slaapkamer'],
  ['N0', -550, 1600, 'Garage 1', 'garage'],
  ['N0', -550, 2000, 'Berging achter garage 1', 'berging'],
  ['N0', -150, 1800, 'Garage 2', 'garage'],
];
RUIMTES.forEach(([niveau, x, y, naam, functie], i) => {
  const contour = ruimteContourBijPunt(m, niveau, P(x, y));
  if (!contour) { console.error(`Geen gesloten ruimte voor "${naam}" bij (${x}, ${y}) cm.`); process.exit(1); }
  m.ruimtes.push({ id: `R${i + 1}`, niveau, naam, functie, contour });
});

const r = validate(m);
if (!r.geldig) { console.error(formatteerFouten(r)); process.exit(1); }
writeFileSync(new URL('../designs/bestaand.json', import.meta.url), naarJson(m));
console.log('designs/bestaand.json geschreven' + (r.waarschuwingen.length ? '\n' + formatteerFouten(r) : ''));
