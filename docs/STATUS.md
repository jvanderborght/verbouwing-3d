# Status

_Laatst bijgewerkt: 2026-11-14 — bestaande toestand opnieuw opgebouwd uit het bestaande plan (DXF, kader 'origineel'); branch `bestaand/dxf`, wacht op QA._

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
- Tests: `npm test` (131 tests + validatie designs).
- QA-opvolging: getalinvoer begrijpt "1.200" als 1200; 422 van GitHub enkel als conflict bij sha-fout; workflow least-privilege.
- `designs/bestaand.json`: **Bestaande toestand** — plattegronden (muren, diktes, ramen, deuren, 15 ruimtes, garages) uit het bestaande plan (DXF, kader 'origineel', cm): woning 7,00 × 12,50 m, hoofdvolume 8 m diep + achterbouw. Hoogtes, dak, borstweringen en perceelligging blijven schatting/aanname (het DXF bevat geen doorsnedes). Details, bronnen, twijfels en open vragen: `docs/BESTAAND.md`; sanity-tests in `tests/bestaand.test.js`.
- `designs/voorbeeld.json`: FICTIEF testhuis (7 m breed, perceel 14 m; rest aannames). `designs/prijzen.json`: leeg sjabloon.

## Fase 2 — tekengereedschap ✅ (QA goedgekeurd)
- Taakbalk: Selecteren · Muur · Deur · Raam · Ruimte · Verwijderen · Niveau + · Dak (telefoon: onderaan, scrollbaar; sneltoetsen V M D R N X).
- Muur tekenen als keten (tik/klik of slepen), getypte lengte + Enter, richtingknoppen op touch; stoppen met Esc/dubbeltik/Klaar.
- Snapping (`js/ui/snap.js`): raster 50 mm, eindpunten, midden, langs muren, uitlijning, ortho; live voorbeeld met maat.
- Selecteren: muur verslepen (aansluitende muren volgen), eindpunt-grepen, Delete.
- Deur/raam op een muur tikken; ruimte benoemen met automatische contourdetectie (`ruimteContourBijPunt`) of rechthoek.
- Niveau toevoegen (muren kopiëren buiten/alle/geen), dak instellen per niveau.
- Eigenschappenpaneel: x/y van muureindpunten en muurlengte bewerkbaar.
- Hoog-niveau bewerkingen in `js/model/bewerkingen.js` (getest). Elke actie = één undo-stap.
- App-commits naar GitHub krijgen het anonieme noreply-adres als auteur (niet meer het account-e-mailadres).
- Tests: 124+.

## Bekende beperkingen
- Ruimtes volgen niet mee als muren verschuiven; openingen niet versleepbaar (wel via positie in eigenschappen).
- Muur verslepen trekt aansluitende muren scheef (geen optie om dat uit te zetten).
- Eén app-commit (`f2205d2`) van vóór deze fix bevat nog het account-e-mailadres.
- DWG/SketchUp-bestanden kunnen hier niet ingelezen worden (geen parser; bouwen van LibreDWG niet toegestaan). Graag DXF/DAE/OBJ of PDF aanleveren — buiten de repo.
- GitHub-opslag enkel getest tegen een nagebootste API; eerste echte test door gebruiker nodig (token aanmaken: zie Instellingen in de app).
- Na opslaan loopt Pages enkele minuten achter; "Ophalen van GitHub" haalt altijd de actuele versie.
- Verwijderen van een variant gebeurt enkel lokaal (niet op GitHub).
- Doorsnede: snijvlakken niet gesloten. Hellende daken op rechthoekige begrenzing. Maatlijnen bij L-vormige plannen niet altijd ideaal.
- Geen kaart-/GRB-import: netwerk van de Claude-omgeving blokkeert geo.api.vlaanderen.be.

## Afspraken
- Repo blijft anoniem (CLAUDE.md regel 8): geen adres, foto's of plannen in git; enkel afgeleide maten.

## Volgende stappen
1. Gebruiker: tekengereedschap uitproberen op laptop + telefoon; DWG als DXF en SketchUp als DAE/OBJ (of PDF) aanleveren voor de bestaande toestand.
2. Fase 3: kerncijfers, kostenraming (prijzen.json), vergelijkweergave.
3. Fase 4: promptveld (Anthropic API, eigen key) + "genereer N varianten".
4. Bestaande toestand verfijnen: hoogtes (doorsnede of opmeting), perceelligging en garages bevestigen — open vragen in `docs/BESTAAND.md`.
