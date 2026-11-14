// Migratie van oudere schemaversies naar SCHEMA_VERSIE. Nu enkel v1.

import { SCHEMA_VERSIE } from './schema.js';

export function migreer(model) {
  if (!model || typeof model !== 'object') return model;
  // Hier komen stappen als: if (model.schemaVersie === 1) model = v1naarV2(model);
  if (model.schemaVersie > SCHEMA_VERSIE) {
    throw new Error(`Ontwerp heeft schemaVersie ${model.schemaVersie}; deze app kent maximaal ${SCHEMA_VERSIE}. Herlaad de app.`);
  }
  return model;
}
