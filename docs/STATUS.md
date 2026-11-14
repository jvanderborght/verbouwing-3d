# Status

_Laatst bijgewerkt: 2026-11-14 — fase 5 (schema v2: trap, zolder, inrichting, programma van eisen) na QA op `main`._

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
- Tests: `npm test` (150+ tests + validatie designs).
- QA-opvolging: getalinvoer begrijpt "1.200" als 1200; 422 van GitHub enkel als conflict bij sha-fout; workflow least-privilege.
- `designs/bestaand.json`: **Bestaande toestand** — plattegronden (muren, diktes, ramen, deuren, 15 ruimtes, garages) uit het bestaande plan (DXF, kader 'origineel', cm): woning 7,00 × 12,50 m, hoofdvolume 8 m diep + achterbouw. Hoogtes, dak, borstweringen en perceelligging blijven schatting/aanname (het DXF bevat geen doorsnedes). Details, bronnen, twijfels en open vragen: `docs/BESTAAND.md`; sanity-tests in `tests/bestaand.test.js`.
- `designs/voorbeeld.json`: FICTIEF testhuis (7 m breed, perceel 14 m; rest aannames). `designs/prijzen.json`: richtprijzen van internet met bronnen (zie fase 3).

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

## Fase 3 — kerncijfers, kostenraming, vergelijken ✅
- Definities: `docs/FASE3.md`. Code: `js/metrics/` (puur, getest), `js/ui/kerncijferspaneel.js`, `js/ui/vergelijken.js`.
- Kerncijfers per variant: bruto/netto m² per niveau, volume, m² nieuwe muur (buiten/binnen), afbraak + doorbraken, ramen/deuren, dakoppervlak, nieuwe vloer.
- Kostenraming uit `designs/prijzen.json`: totaal + bandbreedte (bereik), prijsdetails met bronnen; ontbrekende prijs ⇒ "—" en "minstens".
- `designs/prijzen.json` bevat **richtprijzen van internet** (op vraag van de gebruiker, 2026-11-14) met bron en bereik per post — vervangen door offerteprijzen zodra beschikbaar.
- Vergelijkweergave (2–3 varianten, Δ t.o.v. referentie, CSV-export voor Excel-BE).

## Fase 4 — promptveld ✅
- Knop **Opdracht**: opdracht in gewone taal → Claude (eigen API-key, enkel in de browser) geeft modeloperaties terug →
  validatie (+ max. 1 herstelpoging) → diff-preview in plattegrond en 3D, kerncijfers/raming-Δ → toepassen (1 undo-stap) of
  als nieuwe variant(en) bewaren en vergelijken. 1–4 varianten per opdracht; Claude kan eerst vragen stellen.
- Officiële SDK `@anthropic-ai/sdk` 1.3.0 gevendored (`js/vendor/anthropic-sdk/`, zie VENDOR.md), standaardmodel `claude-opus-5-5`,
  effort instelbaar, server-side fallbacks (uit te zetten), structured output, prompt caching, tokenverbruik + geschatte kost.
- **Nog niet getest tegen de echte API** (geen key in de ontwikkelomgeving): eerste echt gebruik door de gebruiker.
  Terugval zonder schema/fallbacks is ingebouwd als de API die combinatie weigert.
- Spec en details: `docs/FASE4.md`.

## Fase 5 — programma van eisen (schema v2) ✅
- Datamodel v2 (`docs/FASE5.md`, `docs/DATAMODEL.md`): `trappen` (recht/kwart/halfdraai/spiraal), `inrichting` (sanitair, meubels),
  `niveaus.soort` (zolder), `ruimtes.hoogtegrenzen`, ontwerpveld `programma`; v1-ontwerpen migreren automatisch.
- Afgeleid: trapgeometrie en trapgat, vrije hoogte onder daken, hoogtelijnen en m² per hoogteband, `toetsProgramma`.
- Bewerkingen: afbraakzone (gedeelde muren blijven bestaand, gemeld als mogelijk dragend), zolderniveau, trap en inrichting plaatsen, muur splitsen.
- Weergave: trap 2D/3D, trapgat, sanitairsymbolen, hoogtelijnen (schakelaar), zoldermuren volgen het dak in 3D.
- Gereedschap: Trap, Inrichting, Afbraakzone, Zolder toevoegen, programma-editor met toetsresultaat.
- Promptveld: schema v2 + macro's (afbraakZone, zolderNiveau, trapPlaatsen, inrichtingPlaatsen, muurSplitsen); antwoordschema
  binnen de gepubliceerde limieten van structured outputs (item/velden als JSON-tekst).
- Werkwaarden (doel-optrede, hoogtelijnen 1,50/2,20 m, standaardmaten sanitair) zijn **geen normen**; normgrenzen staan op `null` tot ze met bron ingevuld worden.
- Voorbeeld van de opdracht "achterbouw + garage 2 afbreken, zolder met trap, 2 slaapkamers, berging, badkamer": `tools/voorbeelden/zolder-programma.ops.json`.

## Bekende beperkingen
- Trap en inrichting niet versleepbaar (wel via eigenschappen); trap/inrichting snappen enkel op het raster. Vrijgekomen id's worden hergebruikt (diff toont dan 'gewijzigd').
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
1. Gebruiker: tekengereedschap en vergelijken uitproberen op laptop + telefoon; richtprijzen in `designs/prijzen.json` vervangen door offerteprijzen zodra beschikbaar (en dan `_herkomst` weghalen, anders blijft "richtprijzen van internet" staan).
2. Gebruiker: API-key aanmaken (met uitgavelimiet), in Instellingen plakken, een kleine opdracht proberen.
3. Bestaande toestand verfijnen: hoogtes (doorsnede of opmeting), perceelligging en garages bevestigen — open vragen in `docs/BESTAAND.md`.
4. Lange termijn (houtskelet/prefab, aanvraag, uitvoering, werf) en roadmap fase 5+: zie `docs/CONCEPT.md` (nog te bespreken met de gebruiker).
