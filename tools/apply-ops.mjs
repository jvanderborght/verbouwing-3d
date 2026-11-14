// Past operaties toe op een ontwerp in designs/ — voor gebruik vanuit Claude Code (zonder app, zonder API-key).
// Zelfde formaat en zelfde verwerking als het promptveld (js/ai/opsbestand.js → macros.js + verwerk.js).
//
// Gebruik: node tools/apply-ops.mjs <ontwerp-id> <bestand | '-' voor stdin> [opties]
//   bestand = lijst operaties, één operatie, { ops: [...], _uitleg?, basis? }, of het antwoordformaat van het promptveld
//             { samenvatting, vragen?, varianten: [{ naam, beschrijving, ops }] } (ook als tekst met een ```json-blok).
//   Operaties: toevoegen, wijzigen, verwijderen, verplaatsen, ontwerp + de macro's afbraakZone, zolderNiveau, trapPlaatsen,
//   inrichtingPlaatsen, muurSplitsen (zie js/ai/macros.js). item/velden als object of als JSON-tekst.
// Opties:
//   --als <nieuw-id>  resultaat als nieuw ontwerp (basis = bron), toegevoegd aan designs/index.json (één variant)
//   --naam "Naam"     naam van het nieuwe ontwerp
//   --variant <n>     enkel variant n (1, 2, …) uit het antwoordformaat
//   --droog           niets schrijven, enkel controleren en de wijzigingen tonen
//   --designs <map>   andere map dan designs/ (voor tests)
// Zonder --als: gewone ops werken het bronontwerp zelf bij; het antwoordformaat maakt per variant een nieuw ontwerp
// `<ontwerp-id>-<slug van de variantnaam>` (bestaat dat al: -2, -3, …).
// Het ontwerp wordt eerst gemigreerd naar de huidige schemaVersie; het resultaat wordt in die versie opgeslagen.
// Uitvoer: wijzigingen (diff), macro-info, meldingen (bv. blijvende randmuren), waarschuwingen en de toets aan het programma van eisen.
// Afsluitcode: 0 = ok, 1 = niet toegepast (fouten), 2 = verkeerd gebruik.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { naarJson, migreer } from '../js/model/index.js';
import { leesOpsBron, verwerkOpsBron } from '../js/ai/opsbestand.js';

const GEBRUIK = 'Gebruik: node tools/apply-ops.mjs <ontwerp-id> <bestand|-> [--als <nieuw-id>] [--naam "Naam"] [--variant <n>] [--droog]';
const args = process.argv.slice(2);
const VLAGGEN = new Set(['--droog']);
const MET_WAARDE = new Set(['--als', '--naam', '--variant', '--designs']);
const pos = [];
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VLAGGEN.has(a)) opt[a] = true;
  else if (MET_WAARDE.has(a)) { if (i + 1 >= args.length) { console.error(`${a} vereist een waarde.\n${GEBRUIK}`); process.exit(2); } opt[a] = args[++i]; }
  else if (a.startsWith('--')) { console.error(`Onbekende optie ${a}.\n${GEBRUIK}`); process.exit(2); }
  else pos.push(a);
}
const [id, opsBron] = pos;
if (!id || !opsBron || pos.length > 2) { console.error(GEBRUIK); process.exit(2); }

const map = opt['--designs'] ? resolve(opt['--designs']) : fileURLToPath(new URL('../designs/', import.meta.url));
const pad = (x) => join(map, x);
const toon = (x) => (opt['--designs'] ? pad(x) : `designs/${x}`);
if (!existsSync(pad(`${id}.json`))) { console.error(`${toon(`${id}.json`)} bestaat niet.`); process.exit(2); }
const model = migreer(JSON.parse(readFileSync(pad(`${id}.json`), 'utf8')));
const bron = leesOpsBron(readFileSync(opsBron === '-' ? 0 : opsBron, 'utf8'));
if (!bron.ok) { console.error(`Niet toegepast: ${bron.fout}`); process.exit(1); }
if (bron.basis && bron.basis !== id) console.warn(`Let op: dit ops-bestand is gemaakt voor "${bron.basis}", niet voor "${id}".`);
if (bron.samenvatting) console.log(`Samenvatting: ${bron.samenvatting}`);
if (bron.vragen.length) console.log(`Vragen in het antwoord:\n- ${bron.vragen.join('\n- ')}`);

const index = JSON.parse(readFileSync(pad('index.json'), 'utf8'));
const bezet = new Set([...index.ontwerpen.map((o) => o.id), ...readdirSync(map).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))]);
const r = verwerkOpsBron(model, bron, { variant: opt['--variant'] ?? null, als: opt['--als'] ?? null, naam: opt['--naam'] ?? null, bezet });
if (r.fout) { console.error(`Niet toegepast: ${r.fout}`); process.exit(r.resultaten.length ? 1 : 2); }
for (const x of r.resultaten) {
  console.log(x.regels.join('\n'));
  if (!x.ok) console.error(`  Fouten:\n${x.fouten.map((f) => `  ✗ ${f}`).join('\n')}`);
}
if (!r.ok) { console.error('Niet toegepast (atomair: er werd niets geschreven).'); process.exit(1); }
if (opt['--droog']) { console.log('--droog: niets geschreven.'); process.exit(0); }

for (const x of r.resultaten) {
  if (x.nieuw && existsSync(pad(`${x.id}.json`))) console.warn(`Let op: ${toon(`${x.id}.json`)} bestond al en wordt overschreven.`);
  writeFileSync(pad(`${x.id}.json`), naarJson(x.model));
  if (x.nieuw && !index.ontwerpen.some((o) => o.id === x.id)) index.ontwerpen.push({ id: x.id, naam: x.model.naam });
  console.log(`→ ${toon(`${x.id}.json`)}`);
}
if (r.resultaten.some((x) => x.nieuw)) writeFileSync(pad('index.json'), JSON.stringify(index, null, 2) + '\n');
