// Valideert alle ontwerpen in designs/ (of de opgegeven bestanden) en controleert designs/index.json.
// Gebruik: node tools/validate.mjs [bestand.json ...]
// Oudere schemaversies worden eerst gemigreerd (js/model/migrate.js) en dan gevalideerd; er wordt niets herschreven.
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { validate, formatteerFouten, migreer, SCHEMA_VERSIE } from '../js/model/index.js';

const dir = new URL('../designs/', import.meta.url).pathname;
const NIET_ONTWERP = new Set(['index.json', 'prijzen.json']);
const bestanden = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith('.json') && !NIET_ONTWERP.has(f)).map((f) => join(dir, f));

let fout = false;
const ids = new Set();
for (const f of bestanden) {
  let m, oud;
  try { const ruw = JSON.parse(readFileSync(f, 'utf8')); oud = ruw?.schemaVersie; m = migreer(ruw); }
  catch (e) { console.log(`✗ ${basename(f)}: ongeldige JSON — ${e.message}`); fout = true; continue; }
  const r = validate(m);
  if (m.id && basename(f) !== `${m.id}.json`) { r.fouten.push({ pad: 'id', melding: `id "${m.id}" komt niet overeen met bestandsnaam ${basename(f)}.` }); r.geldig = false; }
  ids.add(m.id);
  const mig = typeof oud === 'number' && oud < SCHEMA_VERSIE ? ` (schemaVersie ${oud} → ${SCHEMA_VERSIE} gemigreerd bij het laden)` : '';
  console.log(`${r.geldig ? '✓' : '✗'} ${basename(f)}${mig}${r.fouten.length + r.waarschuwingen.length ? '\n' + formatteerFouten(r).replace(/^/gm, '    ') : ''}`);
  if (!r.geldig) fout = true;
}

if (!process.argv.slice(2).length) {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const inIndex = new Set(index.ontwerpen.map((o) => o.id));
  for (const id of ids) if (!inIndex.has(id)) { console.log(`✗ index.json: ontwerp "${id}" ontbreekt in designs/index.json`); fout = true; }
  for (const id of inIndex) if (!ids.has(id)) { console.log(`✗ index.json: "${id}" staat in de index maar designs/${id}.json bestaat niet`); fout = true; }
  const p = JSON.parse(readFileSync(join(dir, 'prijzen.json'), 'utf8'));
  for (const [k, v] of Object.entries(p.eenheidsprijzen || {})) {
    const ok = v && typeof v === 'object' && typeof v.eenheid === 'string' && (v.prijs === null || (typeof v.prijs === 'number' && v.prijs >= 0));
    if (!ok) { console.log(`✗ prijzen.json: "${k}" moet { eenheid, prijs: getal ≥ 0 of null } zijn`); fout = true; }
  }
}
process.exit(fout ? 1 : 0);
