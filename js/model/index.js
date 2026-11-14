// Publieke ingang van het datamodel.
export * from './schema.js';
export * from './geometry.js';
export { validate, formatteerFouten } from './validator.js';
export { applyOps, volgendId, hoogsteIdNummer, dupliceer, OPERATIES } from './operations.js';
export { muurProfielen, muurOppervlakteOnderDak, begrenzendeDaken } from './muurprofiel.js';
export { Geschiedenis } from './history.js';
export { diff, beschrijfDiff } from './diff.js';
export { migreer } from './migrate.js';
export {
  opsMuurTekenen, opsMuurVerplaatsen, opsMuurEindpunt, opsMuurLengte, opsOpeningPlaatsen,
  ruimteContourBijPunt, opsRuimteBenoemen, opsRuimteRechthoek, opsNiveauToevoegen, opsDakInstellen,
  buitenMuren, buitenContour, MIN_MUURLENGTE,
  opsMuurSplitsen, opsAfbraakZone, opsTrapPlaatsen, opsInrichtingPlaatsen, opsZolderNiveau,
} from './bewerkingen.js';
export { v1naarV2 } from './migrate.js';
export { INSTELLINGEN_STANDAARD, metInstellingen, instelling, inrichtingMaat } from './instellingen.js';
export { trapHoogteverschil, trapMaten, trapGeometrie, trapVoetafdruk, trapgat } from './trappen.js';
export {
  niveauBegrenzing, vrijeHoogte, vrijeHoogteFunctie, minVrijeHoogte, trapLoophoogte, hoogtelijnen, oppervlaktePerHoogteband,
} from './hoogte.js';
export { inrichtingContour, polygonenOverlappen } from './vormen.js';
export { valideerProgramma, toetsProgramma, inrichtingVanRuimte, TOETS_STATUSSEN } from './programma.js';

/** Stabiele JSON-serialisatie voor designs/*.json (2 spaties, punten op één regel). */
export function naarJson(model) {
  return JSON.stringify(model, null, 2)
    .replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, '[$1, $2]') + '\n';
}
