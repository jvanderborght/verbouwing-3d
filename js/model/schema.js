// Schema-constanten van het datamodel. Zie docs/DATAMODEL.md.
// Eenheden: mm. Oorsprong: linkerbenedenhoek gelijkvloers. x → rechts, y → achter, z → omhoog.

export const SCHEMA_VERSIE = 2;

export const STATUSSEN = ['bestaand', 'nieuw', 'afbraak'];
export const OPENING_TYPES = ['deur', 'raam'];
export const DAK_TYPES = ['plat', 'lessenaar', 'zadel', 'schild'];
export const NOKRICHTINGEN = ['x', 'y'];
// schemaVersie 2 (fase 5)
export const NIVEAU_SOORTEN = ['verdieping', 'zolder', 'kelder'];
export const TRAP_TYPES = ['recht', 'kwart', 'halfdraai', 'spiraal']; // kwart = kwartdraai (L), halfdraai = U (180°)
export const DRAAIRICHTINGEN = ['links', 'rechts'];
// dakkapellen (optionele collectie, geen nieuwe schemaVersie — zie docs/DATAMODEL.md "Dakkapellen")
export const DAKKAPEL_TYPES = ['plat']; // voorlopig enkel een plat dakje; uitbreidbaar (bv. zadel, lessenaar)
export const DAKKAPEL_ZIJDEN = ['voor', 'achter', 'links', 'rechts']; // nokrichting x: voor (goot op min y) | achter; y: links | rechts
export const INRICHTING_SOORTEN = [
  'douche', 'lavabo', 'wc', 'bad', 'keuken', 'bed', 'kast', 'wasmachine', 'droogkast', 'bureau', 'tafel', 'zetel', 'overig',
];

// Collecties in vaste volgorde + id-voorvoegsel voor automatisch gegenereerde id's.
export const COLLECTIES = {
  niveaus: 'N',
  muren: 'M',
  openingen: 'O',
  ruimtes: 'R',
  vloeren: 'V',
  daken: 'D',
  trappen: 'T',
  inrichting: 'I',
  dakkapellen: 'K', // optioneel: ontbreekt = leeg (geen migratie nodig)
};
export const COLLECTIE_NAMEN = Object.keys(COLLECTIES);
/** Collecties die in een ontwerp mogen ontbreken (= leeg). */
export const OPTIONELE_COLLECTIES = ['dakkapellen'];

export const FUNCTIES = [
  'woonkamer', 'keuken', 'eetkamer', 'leefruimte', 'slaapkamer', 'badkamer', 'toilet',
  'hal', 'trap', 'berging', 'bureau', 'wasplaats', 'garage', 'zolder', 'technisch', 'terras', 'overig',
];

// Toegelaten velden per collectie: [veldnaam, type, verplicht].
// type: 'string' | 'number' | 'getallen' (lijst getallen) | 'punt' | 'contour' | 'enum:<LIJST>' | 'ref:<collectie>'
//       | 'raam' ({ breedte, hoogte, borstwering? } — raam in het voorvlak van een dakkapel)
export const VELDEN = {
  niveaus: [
    ['id', 'string', true],
    ['naam', 'string', true],
    ['peil', 'number', true],        // z van de afgewerkte vloer (mm)
    ['hoogte', 'number', true],      // verdiepingshoogte vloer-tot-vloer = standaard muurhoogte (mm)
    ['vloerdikte', 'number', false], // dikte vloerpakket onder dit niveau (mm), standaard 0 op peil 0
    ['soort', 'enum:NIVEAU_SOORTEN', false], // v2: informatief (weergave, controles, programma)
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
    ['hoogtegrenzen', 'getallen', false], // v2: vrije hoogtes (mm) waarop de oppervlakte in banden verdeeld wordt
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
  // v2 — zie docs/DATAMODEL.md "trap" en js/model/trappen.js
  trappen: [
    ['id', 'string', true],
    ['vanNiveau', 'ref:niveaus', true],
    ['naarNiveau', 'ref:niveaus', true],
    ['type', 'enum:TRAP_TYPES', true],
    ['oorsprong', 'punt', true],     // recht/kwart/halfdraai: midden van de voorrand van de onderste trede; spiraal: middelpunt
    ['richting', 'number', true],    // graden (0 = +x, 90 = +y): looprichting bij vertrek; spiraal: richting van de eerste trede
    ['breedte', 'number', true],     // loopbreedte (mm)
    ['aantalTreden', 'number', false], // aantal optreden; leeg = berekend uit hoogteverschil en (doel-)optrede
    ['optrede', 'number', false],
    ['aantrede', 'number', false],   // leeg = werkwaarde uit de instellingen
    ['draairichting', 'enum:DRAAIRICHTINGEN', false], // kwart/halfdraai/spiraal; standaard links
    ['diameter', 'number', false],   // enkel spiraal; leeg = 2 × breedte
    ['status', 'enum:STATUSSEN', true],
  ],
  inrichting: [
    ['id', 'string', true],
    ['niveau', 'ref:niveaus', true],
    ['ruimte', 'ref:ruimtes', false],
    ['soort', 'enum:INRICHTING_SOORTEN', true],
    ['positie', 'punt', true],       // MIDDELPUNT van het element in plan
    ['rotatie', 'number', true],     // graden; 0 = breedte langs +x, rugzijde aan -y (voorzijde kijkt naar +y)
    ['breedte', 'number', true],
    ['diepte', 'number', true],
    ['hoogte', 'number', false],     // voor de vrije-hoogtecontrole
    ['status', 'enum:STATUSSEN', true],
  ],
  // optioneel — zie docs/DATAMODEL.md "Dakkapellen" en js/model/dakkapellen.js
  dakkapellen: [
    ['id', 'string', true],
    ['dak', 'ref:daken', true],      // hellend dak waarin de dakkapel staat
    ['zijde', 'enum:DAKKAPEL_ZIJDEN', true], // welk dakvlak: nokrichting x ⇒ voor|achter, y ⇒ links|rechts
    ['positieX', 'number', true],    // coördinaat van het MIDDEN langs de nok (x bij nokrichting x, y bij nokrichting y)
    ['positieZ', 'number', true],    // onderkant van het voorvlak boven de zoldervloer (= vloerpeil van het niveau in het dak)
    ['breedte', 'number', true],     // buitenmaat langs de nok (incl. zijwangen)
    ['hoogte', 'number', true],      // voorvlak: van de onderkant (op het dakvlak) tot de onderkant van het dakje
    ['type', 'enum:DAKKAPEL_TYPES', false], // leeg = plat
    ['diepte', 'number', false],     // horizontaal vanaf het voorvlak; leeg = tot waar het dakje het hoofddak snijdt
    ['dakdikte', 'number', false],   // dikte van het dakje; leeg = werkwaarde
    ['zijwangDikte', 'number', false], // dikte van voorvlak, zijwangen (en achterwand); leeg = werkwaarde
    ['raam', 'raam', false],         // { breedte, hoogte, borstwering? } gecentreerd in het voorvlak
    ['status', 'enum:STATUSSEN', true],
  ],
};

export const ENUMS = {
  STATUSSEN, OPENING_TYPES, DAK_TYPES, NOKRICHTINGEN, FUNCTIES, NIVEAU_SOORTEN, TRAP_TYPES, DRAAIRICHTINGEN, INRICHTING_SOORTEN,
  DAKKAPEL_TYPES, DAKKAPEL_ZIJDEN,
};

// perceel (optioneel): { contour: [[x,y],...] } — perceelgrens in hetzelfde assenstelsel (x mag negatief zijn).
// programma (optioneel, v2): { eisen: [...] } — programma van eisen, zie js/model/programma.js.
// idTeller (optioneel, v2): { [voorvoegsel]: hoogste ooit uitgedeelde nummer } — boekhouding van applyOps, zodat
//   vrijgekomen id's niet hergebruikt worden. Niet via de operatie `ontwerp` te wijzigen; diff negeert het.
export const MODEL_VELDEN = ['schemaVersie', 'id', 'naam', 'beschrijving', 'basis', 'gewijzigd', 'perceel', 'programma', 'idTeller', ...COLLECTIE_NAMEN];
/** Ontwerpvelden die met de operatie `ontwerp` gewijzigd mogen worden. */
export const ONTWERP_VELDEN = ['naam', 'beschrijving', 'basis', 'perceel', 'programma'];

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
    trappen: [],
    inrichting: [],
  };
}
