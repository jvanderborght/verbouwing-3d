# Status

_Laatst bijgewerkt: 2026-11-14 — fase 2 loopt; bestaande toestand (schatting) toegevoegd._

## Live
- App: https://jvanderborght.github.io/verbouwing-3d/ (GitHub Pages via Actions; deploy bij elke push naar `main`).
  Repo is publiek, Pages staat op "GitHub Actions"; eerste geslaagde deploy op 2026-11-14 (workflow-run + github-pages-deployment).

## Fase 1 — basis ✅ (QA goedgekeurd, gemerged naar `main`)
- Repo-structuur, `CLAUDE.md`, agents in `.claude/agents/`, workflow `.github/workflows/pages.yml` (tests + deploy).
- Datamodel v1 (`js/model/`, spec in `docs/DATAMODEL.md`): schema, validator, operaties (`toevoegen`, `wijzigen`, `verwijderen`, `verplaatsen`, `ontwerp`), atomair toepassen, undo/redo (`Geschiedenis`), diff, migratie-haak, optioneel `perceel`.
- CLI voor Claude Code: `node tools/validate.mjs`, `node tools/apply-ops.mjs <id> ops.json [--als nieuw-id --naam "…"]`.
- 3D-weergave (Three.js 0.170.0, gevendored): muren met openingen, vloeren, daken (plat/lessenaar/zadel/schild), perceel, kleurcode, orbit met muis/touch, niveaus aan/uit, doorsnede, selectie.
- 2D-plattegrond (SVG) per niveau: kleurcode, deurzwaai, ruimtes met m², ketting- en totaalmaten, pan/zoom (ook knijpen), selectie.
- App-schil: responsive (desktop naast elkaar, telefoon met tabs), eigenschappenpaneel (getallen/tekst/keuzes al bewerkbaar via operaties), undo/redo + sneltoetsen, validatiemeldingen.
- Variantbeheer: werkkopie in localStorage, nieuw/dupliceren/hernoemen/verwijderen (lokaal)/export/import, **opslaan naar en ophalen van GitHub** met eigen token in de browser (nooit in git).
- Tests: `npm test` (60 tests + validatie designs).
- QA-opvolging: getalinvoer begrijpt "1.200" als 1200; 422 van GitHub enkel als conflict bij sha-fout; workflow least-privilege.
- `designs/bestaand.json`: **Bestaande toestand (schatting)** — enkel breedte 7 m en perceel 14 m zijn gegeven; rest geschat uit één straatfoto (±10–20 %) of aangenomen (diepte 9 m, binnenindeling onbekend). Details, bronnen en open vragen: `docs/BESTAAND.md`.
- `designs/voorbeeld.json`: FICTIEF testhuis (7 m breed, perceel 14 m; rest aannames). `designs/prijzen.json`: leeg sjabloon.

## Bekende beperkingen
- GitHub-opslag enkel getest tegen een nagebootste API; eerste echte test door gebruiker nodig (token aanmaken: zie Instellingen in de app).
- Na opslaan loopt Pages enkele minuten achter; "Ophalen van GitHub" haalt altijd de actuele versie.
- Verwijderen van een variant gebeurt enkel lokaal (niet op GitHub).
- Doorsnede: snijvlakken niet gesloten. Hellende daken op rechthoekige begrenzing. Maatlijnen bij L-vormige plannen niet altijd ideaal.
- Geen kaart-/GRB-import: netwerk van de Claude-omgeving blokkeert geo.api.vlaanderen.be.

## Afspraken
- Repo blijft anoniem (CLAUDE.md regel 8): geen adres, foto's of plannen in git; enkel afgeleide maten.

## Volgende stappen
1. Gebruiker: live app openen op laptop + telefoon; fine-grained token aanmaken (enkel deze repo, Contents read/write) en "Opslaan naar GitHub" testen.
2. Fase 2: tekengereedschap (muur tekenen/verplaatsen/verwijderen, opening, ruimte, niveau, dak), snapping 50 mm + op muren, exacte maten.
3. Fase 3: kerncijfers, kostenraming (prijzen.json), vergelijkweergave.
4. Fase 4: promptveld (Anthropic API, eigen key) + "genereer N varianten".
5. Bestaande toestand verfijnen: open vragen in `docs/BESTAAND.md` beantwoorden, diepte/contour uit Geopunt (GRB), hoogtes en openingen nameten.
