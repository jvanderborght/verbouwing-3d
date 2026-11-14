// Instellingen voor afgeleide berekeningen (trappen, vrije hoogte, inrichting). Pure data + hulpfuncties.
//
// GEEN NORMEN IN DE CODE. Twee soorten waarden:
//  - `grens`: een regel waartegen getoetst wordt (bv. maximale optrede, minimale loophoogte). Standaard
//    `waarde: null` en `bron: null` ⇒ er wordt NIET getoetst. Vult de gebruiker een grens in, dan hoort er een
//    `bron` bij (zoals bij de prijsregel: herkomst zichtbaar maken).
//  - `werkwaarde`: een vertrekwaarde die technisch nodig is om iets te kunnen berekenen of voorstellen
//    (bv. een doel-optrede om een aantal treden voor te stellen, standaardmaten van een douche).
//    Dit is uitdrukkelijk GEEN norm; de validator geeft er nooit een fout op.
//
// Gebruik: functies aanvaarden een optie `instellingen` (gedeeltelijk object, wordt over de standaard gelegd
// met `metInstellingen`). Zonder optie gelden INSTELLINGEN_STANDAARD.

const werk = (waarde, uitleg, eenheid = 'mm') => ({ soort: 'werkwaarde', waarde, eenheid, bron: null, uitleg: `Werkwaarde, geen norm: ${uitleg}` });
const grens = (uitleg, eenheid = 'mm') => ({ soort: 'grens', waarde: null, eenheid, bron: null, uitleg });

/** Maten (breedte × diepte, mm) om een inrichtingselement zonder opgegeven maten te kunnen plaatsen. */
const MAAT = (breedte, diepte) => ({
  soort: 'werkwaarde', breedte, diepte, hoogte: null, bron: null,
  uitleg: 'Werkwaarde, geen norm: vertrekmaat om het symbool te kunnen plaatsen; pas aan aan het gekozen toestel/meubel.',
});

export const INSTELLINGEN_STANDAARD = Object.freeze({
  trap: {
    doelOptrede: werk(180, 'enkel gebruikt om een aantal treden voor te stellen als aantalTreden en optrede leeg zijn.'),
    aantrede: werk(250, 'enkel gebruikt om de voetafdruk te berekenen als de trap geen aantrede heeft.'),
    draaitredenPerKwart: werk(3, 'aantal treden in elke kwartdraai (draaitreden in het hoekvierkant breedte × breedte). 1 = bordes.', 'st.'),
    minOptrede: grens('Minimale optrede.'),
    maxOptrede: grens('Maximale optrede.'),
    minAantrede: grens('Minimale aantrede (op de looplijn).'),
    maxAantrede: grens('Maximale aantrede (op de looplijn).'),
    minBreedte: grens('Minimale loopbreedte.'),
    minLoophoogte: grens('Minimale vrije hoogte boven de looplijn (loophoogte).'),
  },
  hoogte: {
    // Voorbeeldwaarden voor hoogtelijnen (CONCEPT §3.1): GEEN norm. Welke grenzen officieel meetellen is na te gaan.
    hoogtelijnen: { soort: 'werkwaarde', waarde: [1500, 2200], eenheid: 'mm', bron: null, uitleg: 'Werkwaarde, geen norm: standaard hoogtelijnen voor weergave.' },
    rasterStap: werk(25, 'rasterstap voor hoogtelijnen en oppervlakte per hoogteband (nauwkeurigheid ± een halve stap langs de rand).'),
  },
  dakkapel: {
    // Enkel om een dakkapel te kunnen tekenen en de vrije hoogte eronder te berekenen als de dakkapel zelf geen maat heeft.
    zijwangDikte: werk(120, 'dikte van voorvlak en zijwangen van een dakkapel zonder eigen zijwangDikte (weergave, binnenmaat).'),
    dakdikte: werk(200, 'dikte van het dakje van een dakkapel zonder eigen dakdikte (weergave).'),
    voorstelBreedte: werk(2000, 'vertrekbreedte (buitenmaat) als je een dakkapel plaatst zonder breedte; pas aan.'),
    voorstelHoogte: werk(1400, 'vertrekhoogte van het voorvlak als je een dakkapel plaatst zonder hoogte; pas aan.'),
    voorstelPositieZ: werk(800, 'vertrekhoogte van de onderkant boven de zoldervloer als je een dakkapel plaatst zonder positie z of tikpunt; pas aan.'),
  },
  inrichting: {
    douche: MAAT(900, 900), lavabo: MAAT(600, 450), wc: MAAT(400, 650), bad: MAAT(1700, 750),
    keuken: MAAT(2400, 600), bed: MAAT(1600, 2000), kast: MAAT(1000, 600), wasmachine: MAAT(600, 600),
    droogkast: MAAT(600, 600), bureau: MAAT(1200, 600), tafel: MAAT(1600, 900), zetel: MAAT(2000, 900), overig: MAAT(600, 600),
  },
});

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function samenvoegen(basis, extra) {
  if (!isObj(extra)) return basis;
  const uit = { ...basis };
  for (const [k, v] of Object.entries(extra)) uit[k] = isObj(v) && isObj(basis[k]) ? samenvoegen(basis[k], v) : v;
  return uit;
}

/**
 * Standaardinstellingen met de (gedeeltelijke) gebruikersinstellingen erover.
 * Een getal i.p.v. een object wordt als `waarde` geïnterpreteerd: { trap: { maxOptrede: 190 } }.
 */
export function metInstellingen(extra) {
  if (!isObj(extra)) return INSTELLINGEN_STANDAARD;
  const genormaliseerd = {};
  for (const [groep, waarden] of Object.entries(extra)) {
    if (!isObj(waarden)) continue;
    genormaliseerd[groep] = {};
    for (const [k, v] of Object.entries(waarden)) {
      genormaliseerd[groep][k] = (typeof v === 'number' || v === null || Array.isArray(v)) && isObj(INSTELLINGEN_STANDAARD[groep]?.[k]) && 'waarde' in INSTELLINGEN_STANDAARD[groep][k]
        ? { waarde: v } : v;
    }
  }
  return samenvoegen(INSTELLINGEN_STANDAARD, genormaliseerd);
}

/** Waarde van een instelling (`groep.naam`) of null. */
export function instelling(inst, pad) {
  const [g, k] = pad.split('.');
  const v = (inst || INSTELLINGEN_STANDAARD)[g]?.[k];
  return v && typeof v === 'object' && 'waarde' in v ? v.waarde : (v ?? null);
}

/** Standaardmaten (werkwaarde) van een inrichtingssoort. */
export function inrichtingMaat(inst, soort) {
  const i = (inst || INSTELLINGEN_STANDAARD).inrichting || {};
  return i[soort] || i.overig || { breedte: 600, diepte: 600, hoogte: null };
}
