# CLAUDE.md — verbouwing-3d

Webapp om de verbouwing van een woning in 3D te schetsen en varianten te vergelijken.
Schets- en vergelijkingstool, géén BIM/CAD: stabiliteit, EPB en vergunning blijven voor architect/ingenieur.

## Harde regels

1. **GitHub is de enige bron van waarheid.** Niets bestaat enkel lokaal. Na elke afgeronde taak: `commit` + `push`.
2. **Geen buildstap.** Pure ES-modules, rechtstreeks door de browser geladen. Geen bundler, geen transpiler, geen `node_modules` in de app.
3. **Three.js is gevendored** in `js/vendor/three/` (versie 0.170.0), geladen via een importmap in `index.html`. Geen CDN.
4. **Hosting via GitHub Pages**: `.github/workflows/pages.yml` draait de tests en publiceert de repo-root bij elke push naar `main`.
5. **Ontwerpen zijn JSON in `designs/`**: één bestand per variant (`designs/<id>.json`), opgesomd in `designs/index.json`.
6. **Geen secrets in git.** API-keys (Anthropic, GitHub-token) leven enkel in `localStorage` van de browser van de gebruiker.
7. **`docs/STATUS.md` bijwerken aan het einde van elke sessie** (wat werkt, wat niet, volgende stap).
8. **Anoniem houden (repo is publiek).** Geen adres, straatnaam, gemeente, perceelnummer, GPS-coördinaten,
   foto's of beelden van de woning, Street View-/kaartbeelden, namen van bewoners of buren in de repo —
   ook niet in commitberichten, ontwerpnamen of beschrijvingen. Aangeleverde plannen/foto's worden enkel
   gebruikt om maten af te lezen; ze worden **niet** gecommit. Enkel de afgeleide maten komen in `designs/`.
9. Taal van UI, code-commentaar en docs: **Nederlands** (Vlaams). Identifiers in het datamodel zijn Nederlands.

## Datamodel = kern van alles

- Specificatie: `docs/DATAMODEL.md`. Code: `js/model/`.
- Eenheden **mm**. Oorsprong = linkerbenedenhoek gelijkvloers. x naar rechts, y "naar achter" (in plan omhoog), z omhoog.
- **Alle wijzigingen** (knoppen, promptveld, Claude Code) gaan via operaties (`js/model/operations.js`) op het model.
  3D en 2D worden altijd volledig uit het model opgebouwd. Undo/redo = modelgeschiedenis (`js/model/history.js`).
- Elk model moet `validate()` doorstaan vóór het wordt toegepast of opgeslagen.

## Werken via Claude Code (zonder de app)

- Varianten maken/bewerken = JSON in `designs/` aanpassen (of operaties toepassen met `node tools/apply-ops.mjs`).
- Daarna altijd: `node tools/validate.mjs` (valideert alle ontwerpen) en `npm test`.
- Nieuwe variant? Voeg ze toe aan `designs/index.json`.
- Prijzen: `designs/prijzen.json` vult de gebruiker zelf in. **Nooit prijzen verzinnen.**

## Structuur

```
index.html            app (importmap → js/vendor/three)
css/                  stijl
js/model/             schema, validator, operaties, geschiedenis, geometrie (pure functies, getest)
js/views/             viewer3d.js (Three.js), plan2d.js (SVG)
js/ui/                app-logica, taakbalk, eigenschappenpaneel, variantbeheer, opslag
js/metrics/           kerncijfers en kostenraming (fase 3)
js/ai/                promptveld / Anthropic API (fase 4)
designs/              ontwerpen (JSON) + prijzen.json
docs/                 STATUS.md, DATAMODEL.md (plannen/foto's NIET in de repo — zie regel 8)
tests/                node --test (geen afhankelijkheden)
tools/                CLI-hulpjes voor Claude Code
```

## Tests

`npm test` (= `node --test tests/*.test.js` + `node tools/validate.mjs`) — Node ≥ 22, geen npm-pakketten. Pure modellogica wordt in Node getest;
de views worden met een rooktest (Playwright, optioneel lokaal) gecontroleerd.

## Git-werkwijze

- Elke fase/agent werkt op een eigen branch `fase<N>/<onderwerp>`; `qa-reviewer` keurt goed vóór merge naar `main`.
- Commitberichten in het Nederlands, kort en beschrijvend.

## Agents (`.claude/agents/`)

model-architect · viewer-3d · ui-toolbar · variants-metrics · ai-prompt · qa-reviewer.
`model-architect` gaat eerst; de rest bouwt op het schema. viewer-3d en ui-toolbar kunnen parallel.
