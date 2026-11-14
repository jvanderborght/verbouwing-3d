// Migratie van oudere schemaversies naar SCHEMA_VERSIE. Pure functies: het origineel wordt nooit gemuteerd.
// Oude bestanden (designs/, werkkopieën in localStorage, imports) worden bij het laden gemigreerd;
// opslaan gebeurt altijd in de nieuwste versie. Zie docs/DATAMODEL.md "Migratie".

import { SCHEMA_VERSIE } from './schema.js';

const kloon = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

/**
 * v1 → v2: `schemaVersie: 2`, lege lijsten `trappen` en `inrichting` (als ze ontbreken).
 * Geen verplichte velden bij; bestaande ruimtes met functie "trap" blijven ruimtes. Niets gaat verloren.
 */
export function v1naarV2(model) {
  const m = kloon(model);
  m.schemaVersie = 2;
  if (!Array.isArray(m.trappen)) m.trappen = [];
  if (!Array.isArray(m.inrichting)) m.inrichting = [];
  return m;
}

const STAPPEN = { 1: v1naarV2 };

/** Migreert naar SCHEMA_VERSIE. Gooit bij een nieuwere versie dan de app kent. Ontbrekende versie ⇒ ongewijzigd (validate meldt het). */
export function migreer(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return model;
  if (typeof model.schemaVersie === 'number' && model.schemaVersie > SCHEMA_VERSIE) {
    throw new Error(`Ontwerp heeft schemaVersie ${model.schemaVersie}; deze app kent maximaal ${SCHEMA_VERSIE}. Herlaad de app.`);
  }
  let m = model;
  while (typeof m.schemaVersie === 'number' && m.schemaVersie < SCHEMA_VERSIE && STAPPEN[m.schemaVersie]) m = STAPPEN[m.schemaVersie](m);
  return m;
}
