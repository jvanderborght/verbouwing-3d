// Publieke ingang van het datamodel.
export * from './schema.js';
export * from './geometry.js';
export { validate, formatteerFouten } from './validator.js';
export { applyOps, volgendId, dupliceer, OPERATIES } from './operations.js';
export { Geschiedenis } from './history.js';
export { diff, beschrijfDiff } from './diff.js';
export { migreer } from './migrate.js';

/** Stabiele JSON-serialisatie voor designs/*.json (2 spaties, punten op één regel). */
export function naarJson(model) {
  return JSON.stringify(model, null, 2)
    .replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, '[$1, $2]') + '\n';
}
