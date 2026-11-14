# Status

_Laatst bijgewerkt: 2026-11-14 — fase 5 (schema v2, bestaande toestand uit IFC/STEP, dakkapellen, concept asymmetrisch dak, opdrachten zonder API-key) **afgerond** — QA goedgekeurd, gemerged naar `main`._

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

## Fase 5 — programma van eisen (schema v2) — afgerond
- Datamodel v2 (`docs/FASE5.md`, `docs/DATAMODEL.md`): `trappen` (recht/kwart/halfdraai/spiraal), `inrichting` (sanitair, meubels),
  `niveaus.soort` (zolder), `ruimtes.hoogtegrenzen`, ontwerpveld `programma`; v1-ontwerpen migreren automatisch.
- Afgeleid: trapgeometrie en trapgat, vrije hoogte onder daken, hoogtelijnen en m² per hoogteband, `toetsProgramma`.
- Bewerkingen: afbraakzone (gedeelde muren blijven bestaand, gemeld als mogelijk dragend), zolderniveau, trap en inrichting plaatsen, muur splitsen.
- Weergave: trap 2D/3D, trapgat, sanitairsymbolen, hoogtelijnen (schakelaar), zoldermuren volgen het dak in 3D.
- Gereedschap: Trap, Inrichting, Afbraakzone, Zolder toevoegen, programma-editor met toetsresultaat.
- Promptveld: schema v2 + macro's (afbraakZone, zolderNiveau, trapPlaatsen, inrichtingPlaatsen, muurSplitsen); antwoordschema
  binnen de limieten van structured outputs volgens de API-documentatie (niet onafhankelijk geverifieerd; item/velden als JSON-tekst).
- Werkwaarden (doel-optrede, hoogtelijnen 1,50/2,20 m, standaardmaten sanitair) zijn **geen normen**; normgrenzen staan op `null` tot ze met bron ingevuld worden.
- Voorbeeld van de opdracht "achterbouw + garage 2 afbreken, zolder met trap, 2 slaapkamers, berging, badkamer": `tools/voorbeelden/zolder-programma.ops.json`.
- QA-opvolging (`fase5/fix`):
  - Geen vals conflict meer voor een lokaal gewijzigde v1-werkkopie tegenover het v2-bestand met `soort: 'verdieping'`
    (`alsV1` vergelijkt op v1-inhoud: `soort: 'verdieping'`, lege `trappen`/`inrichting` en `idTeller` tellen niet mee; het veld blijft in de designs).
  - Zolder: wanden onder het dak zijn binnenmuren tenzij ze op de rand van de dakvoetafdruk liggen (topgevel); muur-m² in de
    kerncijfers zijn afgeknipt onder het dak (zelfde geometrie als 3D, nu in `js/model/muurprofiel.js`).
    Zolder-voorbeeld op de fase-5-toestand: nieuwe binnenmuur 62,3 m², buitenmuur 0 m² (was 78,6 m² buiten); raming 20.745 € (was 36.484 €).
    Op de nieuwe bestaande toestand (38,5°, zolder N2): binnenmuur 38,0 m², buitenmuur 0 m², raming 6.171 € (richtprijzen).
  - Id's worden niet meer hergebruikt: optioneel ontwerpveld `idTeller` (bijgewerkt bij verwijderen), diff toont het niet.

- Dakkapellen (`concept/dakkapellen`): optionele collectie `dakkapellen` (geen nieuwe schemaVersie), geometrie, vrije hoogte/hoogtebanden,
  validatie, 3D (uitsparing in het dak) en 2D, eigenschappen (positie x/z, breedte, hoogte, raam) + knoppen "Dakkapel voor/achter" bij
  een dak, macro `dakkapelPlaatsen`, kerncijfers en vergelijkingsrijen. Variant `designs/zolder-dakkapellen.json` (generator
  `tools/voorbeelden/maak-zolder-dakkapellen.mjs`; opnieuw draaien na een wijziging aan `bestaand.json`). Zie DATAMODEL.md "Dakkapellen".

- Opdrachten **zonder eigen API-key**: handmatige modus in de app (`js/ai/handmatig.js`: kopieertekst → Claude.ai → antwoord plakken,
  zelfde verwerking en herstelvraag als de API) en via Claude Code (`js/ai/opsbestand.js`, `node tools/apply-ops.mjs` met macro's en
  het antwoordformaat, `--droog`, `--variant`, `--als`).
- **Bestaande toestand uit IFC/STEP** (`docs/BESTAAND.md`): N0/N1 elk 2775, tussenvloer 160; bestaande **zolder N2** op 5550
  (vloer 185); symmetrisch **zadeldak 38,5°**, contour y 482…7498 (onderkant raakt daar de zoldervloer), overstek 480, dikte 300;
  bestaande trap **T1** GV → verdieping (vereenvoudigd tot kwarttrap). De oude toestand (45°, peil 5800, geen zolder) blijft als vaste
  testbasis in `tests/fixtures/` (+ het oude voorbeeld-opsbestand).
- **Concept asymmetrisch dak** (`designs/concept-asymmetrisch-dak.json`, `tools/voorbeelden/maak-concept-asym-dak.mjs`): optionele
  dakvelden `basisHoogte`/`hogeZijde`, `js/model/dakgevels.js`. Bestaand voordak 38,5° blijft (verlengd tot de nieuwe nok), nieuw
  achterdak 28,5° op een verhoogde achtergevel. Nagerekend tegen de STEP (getest in `tests/dak-basis.test.js`): nok bovenkant
  y 4655 / z 9253 (STEP ≈ 4655 / 9250), onderkant nok 8894 (≈ 8892), knieschot 1721 op de binnenzijde van de achtergevel in de STEP
  (app-y 7675; op de plan-binnenzijde 7720: 1697), bovenkant achtergevel 7450 (buitenzijde STEP y 7975; op plan-y 8000: 7437).
- Varianten op de nieuwe bestaande toestand opnieuw gegenereerd (alle vier gebruiken de bestaande zolder N2, geen tweede zolder;
  trap verdieping → zolder = de IFC-trap als halfdraai T2, 15 × 185): `zolder-programma-trap-hal`, `zolder-dakkapellen`,
  `concept-asymmetrisch-dak` en het opsbestand `tools/voorbeelden/zolder-programma.ops.json`. Alle geldig, programma voldoet.
  Zolderwanden zijn binnenmuren (0 m² nieuwe buitenmuur), behalve de echte nieuwe gevels in het concept (31 m²).
- Integratie (`fase5/integratie`): tests die de oude toestand verwachtten wijzen nu naar de fixtures (app-logica) of rekenen met de
  nieuwe maten (ontwerp). B1: een lokaal gewijzigde v1-werkkopie van `bestaand` tegenover de nieuwe GitHub-versie is een **echt
  conflict** (GitHub is inhoudelijk gewijzigd: hoogtes, dak, zolder, trap) — melding, werkkopie blijft geladen.

## Bekende beperkingen
- **Trapvormen benaderd**: het schema kent geen U-trap met tussenstuk of trap met twee kwartdraaien en ongelijke vluchten; de
  bestaande trap T1 (kwart) en de IFC-trap naar de zolder (halfdraai) zijn vereenvoudigd (afwijkingen in `docs/BESTAAND.md`).
  T1 overlapt in plan de kastwand M10 (één waarschuwing; in werkelijkheid staat de kast onder de trap). Trapgat = volledige voetafdruk.
- **Overstek rondom**: een dak kent één overstek voor alle zijden. Bestaand: de 480 mm (die het dakvlak tot de buitenzijde van de
  gevels brengt) steekt daardoor ook aan de zijgevels uit. Concept asymmetrisch dak: overstek 0, dus het voordak stopt op y 482
  (binnen de voorgevel) — in 3D een smalle open strook boven de voorgevel; het achterdak loopt wel tot de buitenzijde van de achtergevel.
- Concept: de dakvlakken zijn gesplitst op de snijlijn van de onderkanten (y 4686); daar steekt de bovenkant van het voordak ±40 mm
  boven die van het achterdak uit (geen versneden nok). De zoldervloer V5 blijft de oude dakcontour (tot y 7498); de slaapkamers
  lopen tot de achtergevel (7720).
- Dakkapellen bij 38,5°: de dakkapel achter (vrije hoogte 2,30 m) loopt ±220 mm over wand B (STEP) door boven de overloop — met
  vrije hoogte ≥ 2,20 m kan ze niet volledig in de slaapkamer achter liggen. Labels van dakkapel en kamer overlappen in 2D.
- Vrije hoogte buiten de dakcontour = niveauhoogte (geen dak erboven): zolderruimtes worden daarom tot de dakcontour begrensd.
- Raming: geen prijsposten voor trap, sanitair, dakkapellen en vloeren in `designs/prijzen.json` ⇒ niet in de raming (geen prijzen verzonnen).
- Dakkapellen: enkel plat dakje, raam altijd gecentreerd, geen tikgereedschap in de taakbalk (wel knoppen bij een geselecteerd dak).
- Trap en inrichting niet versleepbaar (wel via eigenschappen); trap/inrichting snappen enkel op het raster.
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
5. Gebruiker: zolder en programma van eisen uitproberen (bv. `tools/voorbeelden/zolder-programma.ops.json` als variant); trapgrenzen
   (comfortregels) en hoogtegrenzen enkel invullen met een bron.
6. QA van `fase5/integratie` (renders van de vier varianten), daarna merge naar `main`. Gebruiker: prijsposten voor trap, sanitair en
   dakkapellen aanleveren (met bron) als die in de raming moeten; beslissen over overstek per zijde (voordak concept).
