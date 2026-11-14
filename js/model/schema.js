// Schema-constanten van het datamodel. Zie docs/DATAMODEL.md.
// Eenheden: mm. Oorsprong: linkerbenedenhoek gelijkvloers. x → rechts, y → achter, z → omhoog.

export const SCHEMA_VERSIE = 1;

export const STATUSSEN = ['bestaand', 'nieuw', 'afbraak'];
export const OPENING_TYPES = ['deur', 'raam'];
export const DAK_TYPES = ['plat', 'lessenaar', 'zadel', 'schild'];
export const NOKRICHTINGEN = ['x', 'y'];

// Collecties in vaste volgorde + id-voorvoegsel voor automatisch gegenereerde id's.
export const COLLECTIES = {
  niveaus: 'N',
  muren: 'M',
  openingen: 'O',
  ruimtes: 'R',
  vloeren: 'V',
  daken: 'D',
};
export const COLLECTIE_NAMEN = Object.keys(COLLECTIES);

export const FUNCTIES = [
  'woonkamer', 'keuken', 'eetkamer', 'leefruimte', 'slaapkamer', 'badkamer', 'toilet',
  'hal', 'trap', 'berging', 'bureau', 'wasplaats', 'garage', 'zolder', 'technisch', 'terras', 'overig',
];

// Toegelaten velden per collectie: [veldnaam, type, verplicht].
// type: 'string' | 'number' | 'punt' | 'contour' | 'enum:<LIJST>' | 'ref:<collectie>'
export const VELDEN = {
  niveaus: [
    ['id', 'string', true],
    ['naam', 'string', true],
    ['peil', 'number', true],        // z van de afgewerkte vloer (mm)
    ['hoogte', 'number', true],      // verdiepingshoogte vloer-tot-vloer = standaard muurhoogte (mm)
    ['vloerdikte', 'number', false], // dikte vloerpakket onder dit niveau (mm), standaard 0 op peil 0
  ],
  muren: [
    ['id', 'string', true],
    ['niveau', 'ref:niveaus', true],
    ['start', 'punt', true],         // [x, y] van de as (mm)
    ['eind', 'punt', true],
    ['dikte', 'number', true],
    ['hoogte', 'number', false],     // overschrijft niveau.hoogte
    ['status', 'enum:STATUSSEN', true],
  ],
  openingen: [
    ['id', 'string', true],
    ['muur', 'ref:muren', true],
    ['type', 'enum:OPENING_TYPES', true],
    ['positie', 'number', true],     // afstand langs de muuras van muur.start tot de rand van de opening (mm)
    ['breedte', 'number', true],
    ['hoogte', 'number', true],
    ['borstwering', 'number', true], // hoogte onderkant opening boven vloerpeil (deur: 0)
    ['status', 'enum:STATUSSEN', true],
  ],
  ruimtes: [
    ['id', 'string', true],
    ['niveau', 'ref:niveaus', true],
    ['naam', 'string', true],
    ['functie', 'enum:FUNCTIES', true],
    ['contour', 'contour', true],    // binnencontour (netto) [[x,y], ...]
  ],
  vloeren: [
    ['id', 'string', true],
    ['niveau', 'ref:niveaus', true],
    ['contour', 'contour', true],    // buitencontour (bruto)
    ['dikte', 'number', true],
    ['status', 'enum:STATUSSEN', true],
  ],
  daken: [
    ['id', 'string', true],
    ['niveau', 'ref:niveaus', true], // dak rust op de bovenkant van dit niveau (peil + hoogte)
    ['type', 'enum:DAK_TYPES', true],
    ['contour', 'contour', true],    // grondvlak van het dak (zonder overstek)
    ['helling', 'number', true],     // graden; plat = 0
    ['nokrichting', 'enum:NOKRICHTINGEN', false], // richting van de nok (zadel/schild) of van de hoge rand (lessenaar)
    ['overstek', 'number', false],
    ['dikte', 'number', false],
    ['status', 'enum:STATUSSEN', true],
  ],
};

export const ENUMS = { STATUSSEN, OPENING_TYPES, DAK_TYPES, NOKRICHTINGEN, FUNCTIES };

// perceel (optioneel): { contour: [[x,y],...] } — perceelgrens in hetzelfde assenstelsel (x mag negatief zijn).
export const MODEL_VELDEN = ['schemaVersie', 'id', 'naam', 'beschrijving', 'basis', 'gewijzigd', 'perceel', ...COLLECTIE_NAMEN];

export function leegModel(id = 'nieuw', naam = 'Nieuw ontwerp') {
  return {
    schemaVersie: SCHEMA_VERSIE,
    id,
    naam,
    beschrijving: '',
    niveaus: [{ id: 'N0', naam: 'Gelijkvloers', peil: 0, hoogte: 2800 }],
    muren: [],
    openingen: [],
    ruimtes: [],
    vloeren: [],
    daken: [],
  };
}
