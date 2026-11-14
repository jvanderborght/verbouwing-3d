// Fase 5c: werken zonder eigen API-key.
//  - handmatige modus in de app (js/ai/handmatig.js): kopieertekst, JSON uit geplakte tekst, verwerking, herstelvraag;
//  - Claude Code: ops-bestanden met macro's en het antwoordformaat (js/ai/opsbestand.js + tools/apply-ops.mjs).
// Geen netwerk, geen SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  bouwKopieertekst, haalJsonUit, leesGeplakt, naarAntwoord, herstelvraagTekst, antwoordTekst, HandmatigGesprek,
  tekstGrootte, KANAAL_TEKST, SLOT_TEKST,
} from '../js/ai/handmatig.js';
import { leesOpsBron, verwerkOpsBron, slug, vrijOntwerpId } from '../js/ai/opsbestand.js';
import { SYSTEEMPROMPT, ANTWOORD_SCHEMA, ontwerpJson } from '../js/ai/prompt.js';
import { validate, migreer, applyOps } from '../js/model/index.js';
import * as V from './ai-voorbeelden.js';

const DESIGNS = fileURLToPath(new URL('../designs/', import.meta.url));
// Vaste testbasis: de bestaande toestand zoals bij fase 5 (zonder zolder, hoogtes 3000/2800) in tests/fixtures/, los van
// designs/bestaand.json (die evolueert met nieuwe opmetingen; sinds de IFC/STEP-opmeting heeft ze al een zolder N2, waardoor
// het nagebootste antwoord met de macro zolderNiveau er niet meer op past). Zelfde aanpak als ai.test.js en ai-macros.test.js.
const FIXTURE_BESTAAND = fileURLToPath(new URL('./fixtures/bestaand-fase5.json', import.meta.url));
const FIXTURE_OPS = fileURLToPath(new URL('./fixtures/zolder-programma-fase5.ops.json', import.meta.url));
const lees = (f) => migreer(JSON.parse(readFileSync(f === 'bestaand' ? FIXTURE_BESTAAND : join(DESIGNS, `${f}.json`), 'utf8')));
const codeblok = (w, inleiding = '', slot = '') => `${inleiding}\`\`\`json\n${JSON.stringify(w, null, 2)}\n\`\`\`${slot}`;

// ---------------------------------------------------------------- kopieertekst

test('kopieertekst: systeemprompt + schema + context + opdracht + slotinstructie, compact', () => {
  const m = lees('bestaand');
  const t = bouwKopieertekst(m, '  Breek de garage af.  ', { aantal: 2, niveau: 'N1', selectie: 'M3' });
  assert.ok(t.startsWith(SYSTEEMPROMPT), 'begint met de vaste systeemprompt');
  assert.ok(t.includes(KANAAL_TEKST));
  assert.ok(t.includes(JSON.stringify(ANTWOORD_SCHEMA)), 'schema compact (zonder opmaak)');
  assert.ok(t.includes(ontwerpJson(m)), 'ontwerp-JSON compact');
  assert.ok(/Kerncijfers \(huidig ontwerp\)/.test(t));
  assert.ok(t.includes('Actief niveau in de plattegrond: N1'));
  assert.ok(t.includes('Geselecteerd element: muren M3'));
  assert.ok(t.includes("Volgende vrije id's"));
  assert.ok(t.includes('Opdracht van de gebruiker:\nBreek de garage af.'));
  assert.ok(t.includes('precies 2 verschillende varianten'));
  assert.ok(t.trimEnd().endsWith(SLOT_TEKST), 'eindigt met de instructie enkel JSON te antwoorden');
  assert.ok(/uitsluitend met JSON volgens dit schema/.test(SLOT_TEKST));
  // compact: geen opgemaakte JSON en geen lege regels op rij
  assert.ok(!t.includes('\n\n\n'));
  assert.ok(!/\{\n\s+"/.test(t.slice(SYSTEEMPROMPT.length)), 'geen pretty-printed JSON na de systeemprompt');
  // geen "gewijzigd"-tijdstempel in de context
  assert.ok(!t.includes('"gewijzigd"'));
  const g = tekstGrootte(t);
  assert.equal(g.tekens, t.length);
  assert.ok(g.kB > 20 && g.kB < 80, `grootte ${g.kB} kB`);
});

test('kopieertekst is deterministisch voor hetzelfde ontwerp en dezelfde opdracht', () => {
  const m = lees('voorbeeld');
  assert.equal(bouwKopieertekst(m, 'x'), bouwKopieertekst(m, 'x'));
});

// ---------------------------------------------------------------- JSON uit geplakte tekst

test('haalJsonUit: kale JSON, ```json-blok, blok zonder taal, inleidende en afsluitende tekst', () => {
  const a = V.antwoordPveMacro();
  for (const tekst of [
    JSON.stringify(a),
    codeblok(a),
    codeblok(a, 'Hier is mijn voorstel:\n\n', '\n\nLaat maar weten als je iets wil aanpassen.'),
    `Voorstel:\n\`\`\`\n${JSON.stringify(a)}\n\`\`\``,
    `Zie hieronder (punt [1] uit je vraag).\n${JSON.stringify(a, null, 1)}\nGroeten`,
    `﻿${JSON.stringify(a)}`,
    `\`\`\`json\n${JSON.stringify(a)}`, // onafgesloten codeblok (afgeknipt bij het kopiëren)
  ]) {
    const j = haalJsonUit(tekst);
    assert.ok(j.ok, tekst.slice(0, 40));
    assert.deepEqual(j.waarde, a);
  }
});

test('haalJsonUit: kiest het antwoord als er meerdere JSON-blokken zijn', () => {
  const a = V.antwoordPveMacro();
  const tekst = `Een voorbeeld van een operatie:\n\`\`\`json\n{"op":"verwijderen","collectie":"muren","id":"M1"}\n\`\`\`\nHet antwoord:\n${codeblok(a)}`;
  assert.deepEqual(haalJsonUit(tekst).waarde, a);
});

test('haalJsonUit: foutpaden', () => {
  assert.match(haalJsonUit('').fout, /niets geplakt/);
  assert.match(haalJsonUit('   \n ').fout, /niets geplakt/);
  assert.match(haalJsonUit('Ik begrijp de opdracht niet goed.').fout, /Geen JSON gevonden/);
  assert.match(haalJsonUit('```json\n{"samenvatting": "x", "varianten": [],}\n```').fout, /ongeldig/);
  assert.match(haalJsonUit('Hier: {"samenvatting": "x", "varianten": [{"naam": "a", "ops": [{"op":"x"}').fout, /onvolledig/);
  // een afgebroken antwoord geeft NIET een los binnenobject als "antwoord"
  const afgebroken = JSON.stringify(V.antwoordPveMacro()).slice(0, 3000);
  assert.equal(haalJsonUit(afgebroken).ok, false);
  // per ongeluk de opdracht zelf teruggeplakt
  assert.match(haalJsonUit(bouwKopieertekst(lees('voorbeeld'), 'x')).fout, /opdracht zelf/);
  // gewoon getal / tekst is geen antwoord
  assert.equal(haalJsonUit('42').ok, false);
});

test('naarAntwoord: losse operatielijst of { ops } wordt één variant; ontbrekende samenvatting aangevuld', () => {
  const op = { op: 'verwijderen', collectie: 'muren', id: 'M1' };
  assert.deepEqual(naarAntwoord([op]).varianten[0].ops, [op]);
  assert.deepEqual(naarAntwoord({ ops: [op], naam: 'X' }).varianten[0], { naam: 'X', beschrijving: '', ops: [op] });
  assert.equal(naarAntwoord({ varianten: [] }).samenvatting, '');
});

test('leesGeplakt: ok, leeg, ongeldig', () => {
  assert.equal(leesGeplakt('').status, 'leeg');
  const ok = leesGeplakt(codeblok(V.antwoordPveMacro(), 'Voorstel:\n'));
  assert.equal(ok.status, 'ok');
  assert.equal(ok.data.varianten.length, 1);
  const fout = leesGeplakt('{"samenvatting": "x"}');
  assert.equal(fout.status, 'ongeldig');
  assert.match(fout.fouten.join(' '), /varianten/);
});

// ---------------------------------------------------------------- verwerking (zelfde pijplijn als de API)

test('HandmatigGesprek: programma-opdracht met macro\'s ⇒ geldige variant, toets 4 × voldoet, zelfde model als de API-pijplijn', () => {
  const basis = lees('bestaand');
  const g = new HandmatigGesprek({ basis, niveau: 'N0', aantal: 1 });
  const t = g.kopieertekst(V.OPDRACHT_PVE);
  assert.ok(t.includes(V.OPDRACHT_PVE));
  const r = g.verwerk(codeblok(V.antwoordPveMacro(), 'Hier is het voorstel.\n'));
  assert.equal(r.actie, 'toon');
  assert.equal(r.herstelPogingen, 0);
  const v = r.varianten[0];
  assert.ok(v.ok);
  assert.ok(validate(v.model).geldig);
  assert.deepEqual(v.programmaToets.samenvatting, { voldoet: 4, 'voldoet niet': 0, onbekend: 0 });
  // "Toepassen" = de uitgevouwen basisoperaties op het basisontwerp ⇒ exact hetzelfde model
  const a = applyOps(basis, v.ops);
  assert.ok(a.ok);
  assert.deepEqual(a.model, v.model);
  assert.ok(v.meldingen.some((m) => /randmuren|rand van de zone/i.test(m)));
  assert.ok(!v.ops.some((o) => typeof o.item === 'string' || typeof o.velden === 'string'), 'item/velden geparst');
});

test('HandmatigGesprek: item/velden als object (handmatige vorm) worden ook aanvaard', () => {
  const basis = lees('bestaand');
  const a = V.antwoordPveMacro();
  a.varianten[0].ops = a.varianten[0].ops.map((o) => ({ ...o, ...(typeof o.item === 'string' ? { item: JSON.parse(o.item) } : {}), ...(typeof o.velden === 'string' ? { velden: JSON.parse(o.velden) } : {}) }));
  const r = new HandmatigGesprek({ basis }).verwerk(JSON.stringify(a));
  assert.equal(r.actie, 'toon');
  assert.ok(r.varianten[0].ok);
});

test('HandmatigGesprek: fout ⇒ herstelvraag ⇒ verbeterd antwoord ⇒ ok', () => {
  const basis = lees('bestaand');
  const g = new HandmatigGesprek({ basis });
  g.kopieertekst(V.OPDRACHT_PVE);
  const r1 = g.verwerk(codeblok(V.antwoordOngeldigeMacro()));
  assert.equal(r1.actie, 'herstel');
  assert.match(r1.herstelvraag, /De app kon je antwoord niet toepassen/);
  assert.match(r1.herstelvraag, /trapPlaatsen/);
  assert.match(r1.herstelvraag, /N9/);
  assert.match(r1.herstelvraag, /uitsluitend met het volledige JSON-object/);
  assert.match(r1.herstelvraag, /Macro's die vóór de fout wel uitgevoerd werden/);
  const r2 = g.verwerk(codeblok(V.antwoordPveMacro()));
  assert.equal(r2.actie, 'toon');
  assert.equal(r2.herstelPogingen, 1, 'na één herstelpoging');
});

test('HandmatigGesprek: twee keer fout ⇒ fout (één herstelpoging, zoals bij de API)', () => {
  const g = new HandmatigGesprek({ basis: lees('bestaand') });
  assert.equal(g.verwerk(codeblok(V.antwoordOngeldigeMacro())).actie, 'herstel');
  const r = g.verwerk(codeblok(V.antwoordOngeldigeMacro()));
  assert.equal(r.actie, 'fout');
  assert.match(r.melding, /herstelpoging/);
});

test('HandmatigGesprek: geen JSON ⇒ herstelvraag met de vormfout; leeg ⇒ geen herstelpoging', () => {
  const g = new HandmatigGesprek({ basis: lees('voorbeeld') });
  assert.equal(g.verwerk('   ').actie, 'leeg');
  assert.equal(g.herstelPogingen, 0);
  const r = g.verwerk('Sorry, ik heb meer info nodig.');
  assert.equal(r.actie, 'herstel');
  assert.match(r.herstelvraag, /Geen JSON gevonden/);
});

test('HandmatigGesprek: vragen van Claude ⇒ antwoordtekst voor hetzelfde gesprek', () => {
  const g = new HandmatigGesprek({ basis: lees('voorbeeld'), aantal: 2 });
  const r = g.verwerk(JSON.stringify({ samenvatting: 'Onduidelijk', vragen: ['Welk niveau?'], varianten: [] }));
  assert.equal(r.actie, 'vragen');
  assert.deepEqual(r.data.vragen, ['Welk niveau?']);
  const t = g.antwoord('Het gelijkvloers');
  assert.match(t, /Antwoord op je vragen:\nHet gelijkvloers/);
  assert.match(t, /precies 2 varianten/);
  assert.ok(t.endsWith(SLOT_TEKST));
  assert.equal(antwoordTekst('x', 1).includes('één variant'), true);
});

test('herstelvraagTekst zonder bericht geeft toch een bruikbare tekst', () => {
  assert.match(herstelvraagTekst(null), /JSON-object/);
});

// ---------------------------------------------------------------- Claude Code: ops-bestanden

test('leesOpsBron: lijst, één operatie, { ops }, antwoordformaat, tekst met codeblok, foutpaden', () => {
  const op = { op: 'verwijderen', collectie: 'muren', id: 'M1' };
  assert.deepEqual(leesOpsBron([op]).varianten[0].ops, [op]);
  assert.deepEqual(leesOpsBron(op).varianten[0].ops, [op]);
  const b = leesOpsBron(JSON.stringify({ ops: [op], basis: 'bestaand' }));
  assert.equal(b.soort, 'ops');
  assert.equal(b.basis, 'bestaand');
  const a = leesOpsBron(codeblok(V.antwoordPveMacro(), 'Voorstel:\n'));
  assert.equal(a.soort, 'antwoord');
  assert.equal(a.varianten[0].naam, "Compacte zolder (macro's)");
  assert.equal(leesOpsBron('{"x": 1}').ok, false);
  assert.equal(leesOpsBron('geen json').ok, false);
  assert.equal(leesOpsBron({ varianten: [{ naam: 'a' }] }).ok, false);
});

test('slug en vrijOntwerpId', () => {
  assert.equal(slug("Compacte zolder (macro's)"), 'compacte-zolder-macro-s');
  assert.equal(slug('Één badkamer — zolder'), 'een-badkamer-zolder');
  assert.equal(slug('!!!'), 'variant');
  assert.ok(/^[a-z0-9][a-z0-9-_]*$/.test(slug('A'.repeat(100))));
  assert.equal(vrijOntwerpId('x', new Set(['x', 'x-2'])), 'x-3');
});

test('verwerkOpsBron: antwoordformaat met 2 varianten ⇒ 2 nieuwe ontwerpen, --variant, --als', () => {
  const m = lees('bestaand');
  const a = V.antwoordPveMacro();
  const b = V.antwoordPveMacro({ lavaboAutomatisch: false });
  a.varianten.push({ ...b.varianten[0], naam: 'Lavabo vast' });
  const bron = leesOpsBron(a);
  const r = verwerkOpsBron(m, bron, { bezet: new Set(['bestaand', 'bestaand-lavabo-vast']) });
  assert.ok(r.ok);
  assert.deepEqual(r.resultaten.map((x) => x.id), ['bestaand-compacte-zolder-macro-s', 'bestaand-lavabo-vast-2']);
  for (const x of r.resultaten) {
    assert.ok(x.nieuw);
    assert.equal(x.model.basis, 'bestaand');
    assert.ok(validate(x.model).geldig);
    assert.match(x.regels.join('\n'), /Programma van eisen: 4 voldoet/);
    assert.match(x.regels.join('\n'), /Meldingen:/);
  }
  assert.equal(r.resultaten[1].model.beschrijving, b.varianten[0].beschrijving);
  const enkel = verwerkOpsBron(m, bron, { variant: 2, als: 'zolder-b', naam: 'Zolder B' });
  assert.ok(enkel.ok);
  assert.equal(enkel.resultaten.length, 1);
  assert.equal(enkel.resultaten[0].id, 'zolder-b');
  assert.equal(enkel.resultaten[0].model.naam, 'Zolder B');
  assert.match(verwerkOpsBron(m, bron, { als: 'x' }).fout, /--als kan enkel met één variant/);
  assert.match(verwerkOpsBron(m, bron, { variant: 3 }).fout, /kies 1 tot 2/);
  assert.match(verwerkOpsBron(m, leesOpsBron([]), { als: 'Fout Id' }).fout, /kleine letters/);
});

test('verwerkOpsBron: gewone ops (zonder --als) werken het bronontwerp bij; ontwerpvelden niet beperkt tot programma', () => {
  const m = lees('voorbeeld');
  const r = verwerkOpsBron(m, leesOpsBron([{ op: 'ontwerp', velden: '{"perceel": null}' }]));
  assert.ok(r.ok, JSON.stringify(r.resultaten[0]?.fouten));
  assert.equal(r.resultaten[0].id, 'voorbeeld');
  assert.equal(r.resultaten[0].nieuw, false);
});

test('verwerkOpsBron: atomair — één foute variant ⇒ ok false met foutregels', () => {
  const m = lees('bestaand');
  const a = V.antwoordPveMacro();
  a.varianten.push(V.antwoordOngeldigeMacro().varianten[0]);
  const r = verwerkOpsBron(m, leesOpsBron(a));
  assert.equal(r.ok, false);
  assert.ok(r.resultaten[0].ok);
  assert.match(r.resultaten[1].fouten.join('\n'), /trapPlaatsen/);
});

// ---------------------------------------------------------------- tools/apply-ops.mjs (CLI, op een kopie van designs/)

test('apply-ops.mjs: antwoordformaat, macro\'s, --droog, --variant/--als, fouten', () => {
  const map = mkdtempSync(join(tmpdir(), 'v3d-ops-'));
  try {
    for (const f of readdirSync(DESIGNS)) if (f.endsWith('.json')) copyFileSync(join(DESIGNS, f), join(map, f));
    // "bestaand" in de kopie = de vaste fase-5-toestand (zie boven); de actuele bestaande toestand als "bestaand-actueel"
    copyFileSync(join(DESIGNS, 'bestaand.json'), join(map, 'bestaand-actueel.json'));
    copyFileSync(FIXTURE_BESTAAND, join(map, 'bestaand.json'));
    const cli = fileURLToPath(new URL('../tools/apply-ops.mjs', import.meta.url));
    const run = (...a) => spawnSync(process.execPath, [cli, ...a, '--designs', map], { encoding: 'utf8' });
    const antw = join(map, 'antwoord.txt');
    writeFileSync(antw, codeblok(V.antwoordPveMacro(), 'Hier is het voorstel:\n', '\nSucces.'));

    const droog = run('bestaand', antw, '--droog');
    assert.equal(droog.status, 0, droog.stderr);
    assert.match(droog.stdout, /Programma van eisen: 4 voldoet, 0 voldoet niet, 0 onbekend/);
    assert.match(droog.stdout, /Blijvende muren op de rand van de zone/);
    assert.match(droog.stdout, /\+ trappen T1/);
    assert.match(droog.stdout, /niets geschreven/);
    assert.ok(!readdirSync(map).includes('bestaand-compacte-zolder-macro-s.json'));

    const echt = run('bestaand', antw, '--variant', '1', '--als', 'zolder-test', '--naam', 'Zolder test');
    assert.equal(echt.status, 0, echt.stderr);
    const nieuw = migreer(JSON.parse(readFileSync(join(map, 'zolder-test.json'), 'utf8')));
    assert.ok(validate(nieuw).geldig);
    assert.equal(nieuw.naam, 'Zolder test');
    assert.ok(JSON.parse(readFileSync(join(map, 'index.json'), 'utf8')).ontwerpen.some((o) => o.id === 'zolder-test'));
    // validate.mjs aanvaardt de nieuwe variant
    execFileSync(process.execPath, [fileURLToPath(new URL('../tools/validate.mjs', import.meta.url)), join(map, 'zolder-test.json')]);

    // standaard: elke variant als <id>-<slug>
    const std = run('bestaand', antw);
    assert.equal(std.status, 0, std.stderr);
    assert.ok(readdirSync(map).includes('bestaand-compacte-zolder-macro-s.json'));

    // het voorbeeld-opsbestand werkt op de actuele bestaande toestand (gegenereerd uit designs/bestaand.json) …
    const vb = run('bestaand-actueel', fileURLToPath(new URL('../tools/voorbeelden/zolder-programma.ops.json', import.meta.url)), '--droog');
    assert.equal(vb.status, 0, vb.stderr);
    assert.match(vb.stdout, /niets geschreven/);
    // … en de vaste kopie van het fase-5-opsbestand op de fase-5-toestand
    const vb5 = run('bestaand', FIXTURE_OPS, '--droog');
    assert.equal(vb5.status, 0, vb5.stderr);

    // fout ⇒ afsluitcode 1, niets geschreven
    const voor = readFileSync(join(map, 'bestaand.json'), 'utf8');
    const fout = join(map, 'fout.json');
    writeFileSync(fout, JSON.stringify([{ op: 'afbraakZone', ruimtes: ['R99'] }]));
    const f = run('bestaand', fout);
    assert.equal(f.status, 1);
    assert.match(f.stderr, /R99/);
    assert.equal(readFileSync(join(map, 'bestaand.json'), 'utf8'), voor);

    // verkeerd gebruik ⇒ 2
    assert.equal(run('bestaand').status, 2);
    assert.equal(run('bestaand', antw, '--onbekend').status, 2);
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});
