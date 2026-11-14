// Past operaties toe op een ontwerp in designs/ — voor gebruik vanuit Claude Code.
// Gebruik: node tools/apply-ops.mjs <ontwerp-id> <ops.json | '-' voor stdin> [--als <nieuw-id> --naam "Naam"]
//   --als: schrijf het resultaat als nieuwe variant (basis = bron) en voeg toe aan designs/index.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyOps, dupliceer, formatteerFouten, naarJson, diff, beschrijfDiff } from '../js/model/index.js';

const [id, opsBron, ...rest] = process.argv.slice(2);
if (!id || !opsBron) { console.error('Gebruik: node tools/apply-ops.mjs <ontwerp-id> <ops.json|-> [--als <nieuw-id> --naam "Naam"]'); process.exit(2); }
const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
const pad = (x) => new URL(`../designs/${x}`, import.meta.url);

let model = JSON.parse(readFileSync(pad(`${id}.json`), 'utf8'));
const ops = JSON.parse(readFileSync(opsBron === '-' ? 0 : opsBron, 'utf8'));
const nieuwId = arg('--als');
if (nieuwId) model = dupliceer(model, nieuwId, arg('--naam') || nieuwId);

const r = applyOps(model, ops);
if (!r.ok) { console.error('Niet toegepast:\n' + formatteerFouten(r)); process.exit(1); }
console.log(beschrijfDiff(diff(model, r.model)).join('\n'));
if (r.waarschuwingen.length) console.log(formatteerFouten(r));
writeFileSync(pad(`${r.model.id}.json`), naarJson(r.model));
if (nieuwId) {
  const index = JSON.parse(readFileSync(pad('index.json'), 'utf8'));
  if (!index.ontwerpen.some((o) => o.id === nieuwId)) index.ontwerpen.push({ id: nieuwId, naam: r.model.naam });
  writeFileSync(pad('index.json'), JSON.stringify(index, null, 2) + '\n');
}
console.log(`→ designs/${r.model.id}.json`);
