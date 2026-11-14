# Concept en roadmap — verbouwing-3d op lange termijn

_Opgesteld 2026-11-14, na fase 3 (fase 4 — promptveld — in aanbouw). Dit is een richtingsdocument, geen specificatie:
elke fase krijgt nog een eigen `docs/FASE<N>.md` vóór er gebouwd wordt._

**Over bronnen.** Vanuit de Claude-omgeving waren externe websites bij het schrijven niet bereikbaar (netwerkinstellingen).
Er is dus **geen enkele regelgevende of bouwtechnische bewering in dit document geverifieerd**. Alles wat over
Vlaamse regelgeving, normen of bouwfysica gaat, staat gemarkeerd als **(na te gaan)**. Er staan bewust geen
getallen voor U-waarden, λ-waarden, gewichten, prijzen of wettelijke drempels in: die komen van de gebruiker,
de architect, de EPB-verslaggever of de leverancier, met bron.

---

## 1. Visie en afbakening

### Wat de app wél is

- **Eén doorlopend digitaal model** van de woning, dat meegroeit: bestaande toestand → schetsvarianten →
  aanvraagversie → uitvoeringsontwerp in houtskeletbouw → opvolging op de werf. Geen nieuwe tekening per fase,
  maar hetzelfde model met meer detail en meer status-informatie.
- **Varianten vergelijken**: naast elkaar in 2D/3D, met kerncijfers en (zelf ingevulde) prijzen. Dat bestaat al (fase 3).
- **Ontwerpen via opdrachten in gewone taal** (promptveld, fase 4) en via Claude Code op `designs/*.json`.
  Claude stelt altijd **operaties** voor; het model valideert ze; de gebruiker ziet een diff en beslist.
- **Een gedeelde werkbasis** om met architect, ingenieur en prefableverancier te praten: maten, oppervlaktes,
  opbouwen, elementlijsten — als vertrekpunt, niet als eindproduct.
- **Werkt op elk toestel** zonder installatie (statische site, geen buildstap), en blijft **anoniem** (CLAUDE.md regel 8).

### Wat de app níet is

- **Geen vervanging van de architect.** **(Na te gaan:)** in Vlaanderen is voor vergunningsplichtige verbouwingen vermoedelijk meestal een
  architect verplicht; er bestaan uitzonderingen (bv. bepaalde kleine of niet-structurele werken) **(na te gaan:
  welke precies, en of ze voor dit project gelden)**. De app maakt **geen officiële vergunningsplannen**;
  hij levert schetsen, maten en lijsten die de architect kan overnemen of laten controleren.
- **Geen stabiliteitsstudie.** Dragende structuur, overspanningen, windverband, verankering, funderingen van een
  houtskeletuitbreiding: ingenieur stabiliteit.
- **Geen EPB-software.** De app kan opbouwen met lagen en indicatieve U-waarden tonen, maar het EPB-verslag
  (en of een verbouwing EPB-plichtig is, en welke eisen gelden) is voor de EPB-verslaggever **(na te gaan)**.
- **Geen veiligheidscoördinatie** (werfveiligheid) — wel kan de werfplanning in de app input zijn voor wie dat doet.
- **Geen BIM/CAD-pakket.** Geen volwaardige maatvoering volgens tekennormen, geen detailtekenaar op 1:5,
  geen clash detection. De app blijft een schets-, vergelijk- en opvolgtool met een zuiver datamodel; voor de
  stap naar CAD/BIM komen exports (§5).

---

## 2. Fasering van het bouwproject ↔ app-mogelijkheden

LOD (Level of Development) wordt hieronder alleen als **losse leidraad** gebruikt voor "hoeveel detail":
100 = massa/volume, 200 = generieke elementen met benaderde maten, 300 = exacte maten en posities,
350 = met aansluitingen tussen elementen, 400 = productie-/plaatsingsinformatie. Dit is de gangbare
lezing van de LOD-reeks, maar de precieze definities verschillen per bron **(na te gaan, niet bindend voor de app)**.

### (a) Bestaande toestand & inventaris

| | |
|---|---|
| **Doel** | Betrouwbare uitgangssituatie: wat staat er, met welke maten, wat is zeker en wat geschat. |
| **Model** | LOD 200–300 voor het plan (nu: muren, openingen, ruimtes uit het bestaande plan), LOD 100–200 voor hoogtes en dak (nu: schattingen). Erbij nodig: **herkomst/zekerheid per maat** (opgemeten / uit plan / geschat), trap als element, zolder, balken, bestaande opbouwen (voor zover gekend). |
| **Output** | Plattegronden, 3D, lijst van open vragen en aannames (`docs/BESTAAND.md`), opmeetlijst ("deze maten nog opmeten"). |
| **Controles** | `validate()`; consistentie (muren sluiten aan, openingen passen); markering van alles wat "geschat" is. |
| **Status nu** | Grotendeels aanwezig; hoogtes, dak, perceel en trap ontbreken of zijn geschat. |

### (b) Programma van eisen + voorontwerp/schetsvarianten

| | |
|---|---|
| **Doel** | Wensen vastleggen en snel varianten maken en vergelijken. |
| **Model** | LOD 100–200. Programma van eisen als **data** (ruimtes met gewenste functie/oppervlakte/voorwaarden, bv. "2 slaapkamers ≥ X m²", "badkamer met lavabo + douche"). Afbraakzones, nieuwe volumes, trap, zolderruimte met vrije hoogte, sanitair als symbolen. |
| **Output** | Varianten in 2D/3D, vergelijkingstabel (fase 3), kerncijfers, ruwe raming, toetsing aan het programma ("voldoet / voldoet niet / onbekend"). |
| **Controles** | Programma-toets (aantal en oppervlakte ruimtes, aanwezigheid sanitair), vrije hoogte onder het dak, trap past (ruimte voor trapgat en loophoogte — de exacte eisen **na te gaan**), afbraak vs. behoud dragende muren als *signaal* voor de ingenieur. |

### (c) Bouwaanvraag (omgevingsvergunning)

| | |
|---|---|
| **Doel** | De architect de informatie geven om het aanvraagdossier op te maken (indiening via het **omgevingsloket** — na te gaan); zelf overzicht houden over wat vergund wordt. |
| **Model** | LOD 200–300. Perceel en inplanting met afstanden tot perceelgrenzen, terreinpeil/terreinprofiel, nok- en goothoogtes, kroonlijsthoogte, bestaand/nieuw/afbraak per element, materialen van de gevels (als tekst/kleur). |
| **Output** (als **ontwerp-input**, niet als officieel plan) | Inplantingsplan; plattegronden, doorsneden en gevels **bestaand + nieuw** met kleurcode (bestaand / nieuw / afbraak); maatvoering; oppervlaktes en volumes (bestaand vs. nieuw); terreinprofiel. Welke stukken, schalen en kleurconventies officieel vereist zijn **(na te gaan bij architect/omgevingsloket)**. |
| **Controles** | Checklists (aanwezigheid van stukken, consistentie tussen plan/doorsnede/gevel), afstanden tot perceelgrenzen en bouwdiepte **ten opzichte van door de gebruiker ingevoerde voorschriften** (de app kent zelf geen stedenbouwkundige voorschriften). |
| **Vastzetten** | De ingediende en de vergunde versie worden als **snapshot** bewaard (zie §3.7). Later kan elke uitvoeringsversie ertegen vergeleken worden: "wijkt dit af van wat vergund is?". |

### (d) Uitvoeringsontwerp houtskeletbouw

| | |
|---|---|
| **Doel** | Van vergund ontwerp naar uitvoerbaar ontwerp in houtskeletbouw, bij voorkeur in prefab-elementen. |
| **Model** | LOD 300–400. **Opbouwen** (wand, vloer, dak) als lagen met materiaal, dikte, λ en functie; per muur/vloer/dak een verwijzing naar een opbouw. **Elementverdeling**: muren en daken opgedeeld in prefab-panelen met id, maten, openingen, indicatief gewicht. **Aansluitdetails** als benoemde 2D-details (voet, verdiepingsvloer, dakrand, raamaansluiting, aansluiting op bestaand metselwerk). |
| **Output** | Opbouwen als tekening + tabel; elementplannen (aanzicht per paneel); 3D met elementen apart zichtbaar; stuklijst / houtlijst per element (indicatief); lijst van U-waarden **als indicatie**; detail-overzicht. |
| **Controles** | Elementen passen binnen door de gebruiker/leverancier opgegeven maximummaten (transport, kraan); opbouw heeft een luchtdichte laag en die is "doorlopend" aangeduid bij aansluitingen; elke muur heeft een opbouw; som van elementen = muur. |
| **Bouwfysica (aandachtspunten, geen rekenkern)** | Luchtdichtheid (doorlopende luchtdichte laag, tapes/aansluitingen bij ramen, vloeren en bestaand metselwerk; leidingdoorvoeren via een installatiezone aan de binnenkant), dampopen opbouw naar buiten toe, condensatierisico, koudebruggen bij aansluiting op bestaande muren en funderingen, vochtwering onderaan het houtskelet, brandveiligheid, akoestiek tussen ruimtes. De app markeert deze punten per detail als checklist; berekeningen (bv. condensatie, EPB) doet een specialist **(na te gaan welke studies nodig zijn)**. **(Na te gaan met architect/leverancier.)** |

### (e) Werf

| | |
|---|---|
| **Doel** | Uitvoering opvolgen met hetzelfde model. |
| **Model** | Per element: status (zie §3.6), geplande en werkelijke datum, fase/volgorde van plaatsing, opmerkingen; **afwijkingen/meerwerk** als lijst gekoppeld aan elementen, met de operaties die het model aanpassen. |
| **Output** | Planning per element/fase (lijst of eenvoudige balk), 3D gekleurd per status ("wat staat er al"), meerwerklijst, opleveringslijst (punten per ruimte/element), as-built = laatste modelversie. |
| **Controles** | Afwijking t.o.v. de vergunde snapshot (signaal: mogelijk melding/regularisatie nodig — **na te gaan met de architect**); elementen zonder status; geplaatste elementen waarvan het onderliggende element nog niet geplaatst is. |

---

## 3. Evolutie van het datamodel

Principes (zoals nu):
- Elke uitbreiding is **optioneel** of krijgt een standaardwaarde, zodat bestaande ontwerpen geldig blijven.
- Elke schemaversie krijgt een **migratie** in `js/model/migrate.js` (`v1naarV2`, `v2naarV3`, …), met tests.
  Oude bestanden worden bij het laden gemigreerd; opslaan gebeurt altijd in de nieuwste versie.
- Nieuwe collecties krijgen een id-voorvoegsel in `COLLECTIES`, velden in `VELDEN`, regels in de validator,
  en werken met de bestaande operaties `toevoegen` / `wijzigen` / `verwijderen` / `verplaatsen`.
- Liever **weinig, goed gedefinieerde velden** dan een volledig BIM-schema.

Hieronder: voorstel, te verfijnen in de FASE-documenten. Namen zijn werknamen.

### 3.1 schemaVersie 2 — ruimte voor het programma van eisen (fase 5)

**`trappen`** (voorvoegsel `T`)
```jsonc
{ "id": "T1", "vanNiveau": "N1", "naarNiveau": "N2",
  "type": "recht" | "kwart" | "halfdraai" | "spiraal",   // kwart = kwartdraai, halfdraai = U/180°
  "oorsprong": [x, y], "richting": 0,                      // graden; vertrek van de onderste trede
  "breedte": 800, "aantalTreden": null,                    // null = berekend uit hoogteverschil en optrede
  "optrede": null, "aantrede": null,                       // null = afgeleid; grenzen komen uit instellingen, niet hardgecodeerd
  "draairichting": "links" | "rechts",                     // kwart/halfdraai/spiraal
  "diameter": null,                                        // enkel spiraal
  "status": "nieuw" }
```
Afgeleid (pure functies, niet opgeslagen): voetafdruk per niveau, trapgat in de vloer van `naarNiveau`,
loophoogte-lijn. Comfort- en veiligheidsregels voor trappen staan **niet** als vaste getallen in de code
(**na te gaan** welke regels gelden); ze komen in een instellingenblok met bron.

**Dakruimte / vrije hoogte** — geen nieuwe collectie, maar afgeleide geometrie:
- `vrijeHoogte(model, niveau, punt)` = afstand van vloerpeil tot onderkant dak (met `dak.dikte`) of plafond.
- `hoogtelijnen(model, niveau, [h1, h2, …])` = polylijnen waar de vrije hoogte gelijk is aan h (instelbaar; de voorbeeldwaarden 1,50 m en 2,20 m zijn geen norm).
- In `ruimtes` een optioneel veld `hoogtegrenzen: [1500, 2200]`; kerncijfers tonen dan per ruimte de oppervlakte
  per hoogteband. **Welke hoogtegrenzen officieel meetellen** voor "nuttige" of "bewoonbare" oppervlakte (en voor
  welk doel: vergunning, EPB, verkoop, kadaster) is **na te gaan**; de app rekent met wat de gebruiker instelt.
- `niveaus` krijgt optioneel `soort: "verdieping" | "zolder" | "kelder"` (puur informatief, voor weergave en controles).

**`inrichting`** (voorvoegsel `I`) — sanitair en meubels als symbolen
```jsonc
{ "id": "I1", "niveau": "N2", "ruimte": "R7", "soort": "douche" | "lavabo" | "wc" | "bad" | "keuken" | "bed" | "kast" | "wasmachine" | …,
  "positie": [x, y], "rotatie": 0, "breedte": 900, "diepte": 900, "hoogte": null, "status": "nieuw" }
```
2D: symbool; 3D: eenvoudig blok. Gebruikt voor programma-toetsing ("badkamer met lavabo + douche") en vrije-hoogtecontrole
(staat de douche op een plek met voldoende hoogte?). Standaardmaten per soort zijn instelbaar, geen norm.

**Programma van eisen** (optioneel object op het ontwerp of apart bestand `designs/programma-<id>.json`)
```jsonc
{ "programma": { "eisen": [
  { "functie": "slaapkamer", "aantal": 2, "minOppervlakte": null, "niveau": "zolder" },
  { "functie": "badkamer", "aantal": 1, "inrichting": ["lavabo", "douche"] },
  { "functie": "berging", "aantal": 1 },
  { "trap": { "van": "N1", "naar": "N2", "type": ["kwart", "halfdraai", "spiraal"] } } ] } }
```
De toets (`toetsProgramma(model, programma)`) geeft per eis `voldoet` / `voldoet niet` / `onbekend` met uitleg.

**`ruimtes.functie`** blijft een korte lijst: sanitair (douche, lavabo, wc) wordt niet als ruimtefunctie toegevoegd maar als symbool in `inrichting` geplaatst.

### 3.2 schemaVersie 3 — opbouwen en herkomst (fase 7)

**`opbouwen`** (voorvoegsel `B`) — bibliotheek in het ontwerp (of gedeeld bestand `designs/opbouwen.json`)
```jsonc
{ "id": "B1", "naam": "HSB-buitenwand variant A", "soort": "wand" | "vloer" | "dak",
  "lagen": [  // van buiten naar binnen (wand), boven naar onder (vloer/dak)
    { "materiaal": "…", "dikte": 0, "lambda": null, "functie": "afwerking" | "drager" | "isolatie" | "winddicht" | "luchtdicht" | "dampremmend" | "installatiezone" | "constructie" | "spouw",
      "constructief": { "stijlBreedte": null, "stijlDiepte": null, "hartafstand": null },  // enkel bij houtskelet-laag
      "bron": "…" } ] }
```
- `muren`, `vloeren`, `daken` krijgen optioneel `opbouw: "B1"`. De `dikte` van de muur blijft leidend voor de geometrie;
  de validator waarschuwt als `dikte ≠ Σ lagen`.
- `lambda` en materialen vult de gebruiker of leverancier in (met `bron`), **nooit door de app verzonnen**.
  Indicatieve U-waarde = eenvoudige serieschakeling van lagen met correctie voor de houtfractie — duidelijk gelabeld als
  "indicatief, geen EPB-berekening"; de exacte rekenmethode is **na te gaan**.

**Herkomst van maten**: optioneel veld `zekerheid: "opgemeten" | "plan" | "geschat"` op elementen (of per veld in een
`maatHerkomst`-object). Nuttig voor de bestaande toestand.

### 3.3 Elementen (prefab) — schemaVersie 3 of 4 (fase 8)

**`elementen`** (voorvoegsel `E`) — prefab-panelen **afgeleid** uit muren/vloeren/daken, maar opgeslagen
(omdat de verdeling een ontwerpbeslissing is en op de werf een status krijgt)
```jsonc
{ "id": "E12", "deelVan": { "collectie": "muren", "id": "M31" },
  "van": 0, "tot": 2400,                    // positie langs de muuras (mm); voor vloer/dak: contour
  "hoogte": 2800, "opbouw": "B1",
  "openingen": ["O8"],                       // openingen die in dit paneel vallen
  "gewichtIndicatie": null,                  // kg, enkel als alle lagen een dichtheid hebben (anders null)
  "productie": { "leverancierCode": null },
  "status": "ontwerp", "planning": { "gepland": null, "geplaatst": null } }
```
- Generator `opsElementVerdeling(model, muurId, { maxLengte, maxHoogte, voorkeurNaden })` geeft operaties terug;
  naden niet door openingen, maxima uit instellingen (leverancier/transport, **na te gaan**).
- Validator: elementen dekken hun bronmuur exact, overlappen niet, openingen liggen niet op een naad.
- Wijzigt de bronmuur daarna ⇒ de elementen worden als **verouderd** gemarkeerd (niet stil aangepast).

### 3.4 Details (fase 8)

**`details`** (voorvoegsel `X`): `{ id, naam, soort: "voet"|"vloer"|"dakrand"|"raam"|"aansluiting-bestaand"|…, opbouwen: ["B1","B4"], locaties: [{ collectie, id }], aandachtspunten: ["luchtdicht doorlopend", …], tekening: <eenvoudige 2D-lijnen in mm> | null, status }`.
De app tekent een detail **schematisch** uit de opbouwen (lagen naast elkaar, aansluiting op elkaar); geen detailtekenpakket.

### 3.5 Fase-metadata per ontwerp

Op het ontwerp: `fase: "bestaand" | "voorontwerp" | "aanvraag" | "uitvoering" | "werf"` (standaard `voorontwerp`).
De app toont per fase andere panelen, checklists en promptvoorbeelden; de modelinhoud blijft dezelfde.

### 3.6 Status per element uitbreiden

Nu: `status ∈ bestaand | nieuw | afbraak` = **wat** (bestaand/nieuw/weg). Dat blijft zo (kleurcode, kerncijfers).
Nieuw, apart veld: `voortgang ∈ ontwerp | vergund | besteld | geproduceerd | geleverd | geplaatst | opgeleverd`
(optioneel, standaard afwezig = `ontwerp`). Bij afbraakelementen: `ontwerp | vergund | afgebroken`.
Zo blijven de twee assen (wat vs. hoe ver) gescheiden en breekt niets in fase 1–3.

### 3.7 Snapshots ("vastzetten") en afwijkingen

- **Vastzetten** = kopie van het ontwerp als apart bestand `designs/<id>@<label>.json` (bv. `@ingediend`, `@vergund`),
  met `vastgezet: { label, datum, opmerking }` en **alleen-lezen** in de app (validator weigert ops op een vastgezet ontwerp).
- Vergelijken met de snapshot gebeurt met de bestaande `diff()` / `beschrijfDiff()`.
- **`afwijkingen`** (voorvoegsel `A`): `{ id, datum, omschrijving, elementen: [ids], soort: "meerwerk"|"minwerk"|"wijziging", ops: [...], status: "voorgesteld"|"aanvaard"|"uitgevoerd" }`
  — een afwijking draagt de operaties die het model aanpassen, zodat ze terug te volgen zijn.

### 3.8 Migraties (samengevat)

| van → naar | wat |
|---|---|
| 1 → 2 | `schemaVersie: 2`; lege `trappen`, `inrichting`; geen verplichte velden. Bestaande ruimtes met functie `trap` blijven. |
| 2 → 3 | lege `opbouwen`; `fase` = `voorontwerp` als het ontbreekt (en `bestaand` voor `designs/bestaand.json`). |
| 3 → 4 | lege `elementen`, `details`, `afwijkingen`. |

Elke migratie is een pure functie met een test "v(n) in → v(n+1) uit, valideert, niets verloren". De app weigert
nieuwere versies dan ze kent (bestaat al).

---

## 4. Opdrachten in gewone taal

Basis (fase 4, `docs/FASE4.md` op branch `fase4/basis`): Claude krijgt schema + operaties + het ontwerp en antwoordt
met `{ samenvatting, vragen?, varianten: [{ naam, beschrijving, ops }] }`. De app valideert, toont een **diff** en
past pas toe na bevestiging. Dat principe blijft in elke fase gelden: **Claude wijzigt nooit rechtstreeks**.

### Per fase

| fase | voorbeelden van opdrachten | wat Claude teruggeeft |
|---|---|---|
| bestaand | "de verdieping is 2,75 m hoog", "voeg de trap toe in de hal" | ops + vragen bij twijfel |
| voorontwerp | "breek de achterbouw en garage 2 af en maak een compact plan: draaitrap naar zolder, 2 slaapkamers, kleine berging, kleine badkamer (lavabo + douche) onder het dak" | **N varianten**, elk met ops, plus de programma-toets per variant |
| aanvraag | "controleer of alle stukken er zijn", "wat is het nieuwe bouwvolume?", "wat verschilt er met de bestaande toestand?" | checklist-resultaat, cijfers, geen ops (of ops om ontbrekende info toe te voegen) |
| uitvoering | "gebruik opbouw B2 voor alle nieuwe buitenwanden", "verdeel de zolderwanden in elementen van max. X m" | ops (opbouw toewijzen, elementen genereren) |
| werf | "elementen E1–E8 zijn geplaatst", "meerwerk: extra raam in de zijgevel" | ops op `voortgang`, nieuwe `afwijking` met ops |

### Hoog-niveau bewerkingen (in `js/model/bewerkingen.js`, pure functies → `{ ops, fout?, info? }`)

Claude kan deze ook zelf "nabootsen" met ruwe ops, maar gerichte bewerkingen zijn betrouwbaarder en testbaar.
Waar mogelijk laat het promptveld Claude een **bewerking met parameters** kiezen in plaats van coördinaten te gokken
(aanbeveling; uitwerken in de FASE-documenten).

| bewerking | doet |
|---|---|
| `opsAfbraakZone(model, niveau, contour \| ids)` | alle elementen binnen een zone of een gebouwdeel op `afbraak`; muren die de zone kruisen worden gesplitst; ruimtes erin verwijderd; meldt bestaande muren die op de rand liggen (mogelijk dragend → signaal) |
| `opsMuurSplitsen(model, id, positie)` | nodig voor afbraakzones en elementverdeling |
| `opsTrapPlaatsen(model, { van, naar, type, oorsprong, richting, breedte })` | trap + trapgat in de vloer van het bovenste niveau; fout als hij niet past of de loophoogte niet haalt (grens uit instellingen) |
| `opsZolderInrichten(model, niveau, { indeling })` | niveau onder het dak aanmaken als het ontbreekt, ruimtes indelen binnen de hoogtelijnen, scheidingswanden tekenen |
| `opsInrichtingPlaatsen(model, ruimte, soort, { positie?, rotatie? })` | sanitair/meubel; zonder positie: eerste plek tegen een wand met voldoende vrije hoogte |
| `opsProgrammaVanEisen(model, programma, { n })` | **geen** volledige automatische planner; het levert de toets en een lijst randvoorwaarden. De varianten zelf maakt Claude (met de andere bewerkingen), de toets controleert ze. Een eigen layout-algoritme is onzeker en voorlopig niet gepland. |
| `opsOpbouwToewijzen(model, filter, opbouwId)` | bv. alle nieuwe buitenmuren |
| `opsElementVerdeling(model, ids, opties)` | prefab-panelen genereren |
| `opsVoortgang(model, ids, voortgang, datum?)` | werfstatus |
| `opsVastzetten(model, label)` | snapshot (levert een nieuw ontwerp, geen ops op het bestaande) |

### Veiligheidsregels voor het promptveld (blijvend)
- Alle voorstellen worden gevalideerd vóór ze getoond worden; diff + kerncijfers voor/na.
- Vastgezette (vergunde) ontwerpen kan Claude niet wijzigen; wel een afwijking voorstellen.
- Claude verzint geen prijzen, λ-waarden, normwaarden of regelgeving; ontbreekt info, dan stelt het een vraag of laat het veld `null`.
- Claude krijgt geen adres of namen mee (die staan niet in het model; zo houden).

---

## 5. Output en interoperabiliteit

Randvoorwaarden: geen buildstap, statische hosting (GitHub Pages), publieke site, alles in de browser, ook op telefoon/tablet.
Exports gebeuren dus **in de browser** en worden gedownload; ze komen **niet** in de repo (kunnen persoonlijke info bevatten
zodra de gebruiker die toevoegt — regel 8).

| formaat | doel | aanpak (voorstel) | onzekerheid |
|---|---|---|---|
| **SVG / PDF op schaal** | plannen, doorsneden, gevels om af te drukken of te bespreken | plattegrond is al SVG; schaal (1:50, 1:100) + papierformaat + kader; PDF via de afdrukfunctie van de browser met een print-stylesheet, of een kleine PDF-schrijver in JS (gevendored, nog te kiezen) | afdrukken op exacte schaal via de browser is te testen |
| **DXF** | plannen naar de architect | DXF (ASCII) is een tekstformaat: lijnen, polylijnen, tekst, lagen per status. Zelf schrijven in een pure functie is haalbaar en testbaar | welke DXF-versie/lagen de architect wil — **open vraag** |
| **IFC** | open BIM, naar BIM-software van architect/ingenieur/leverancier | er bestaan open-source JavaScript-bibliotheken om IFC te lezen/schrijven; welke bruikbaar is zonder buildstap (ES-module, WASM) moet **later onderzocht** worden. Alternatief: een minimale IFC-export zelf schrijven (IFC-SPF is tekst) met muren, openingen, vloeren, ruimtes | grootste onzekerheid; pas zinvol als de architect/leverancier IFC gebruikt |
| **CSV** | kerncijfers (bestaat), stuklijsten, elementlijsten, opleveringslijst | zoals de bestaande CSV-export (Excel-BE: `;` en decimale komma) | — |
| **JSON** | het model zelf; uitwisseling met Claude Code | bestaat | — |
| **glTF / OBJ** | 3D naar andere viewers of de leverancier | Three.js heeft exporters in zijn voorbeeldmap; meevendoren zoals de rest **(na te gaan welke bestanden nodig zijn)** | laag |

**Import** (later): DXF-plattegronden (zoals nu al via een script voor de bestaande toestand), eventueel IFC.
DWG en SketchUp blijven buiten bereik (zie STATUS).

---

## 6. Roadmap

Fase 1–3 zijn klaar; fase 4 (promptveld) is in aanbouw. Volgorde hieronder is een voorstel; fasen 6–10 kunnen herschikt worden
naargelang wat de gebruiker eerst nodig heeft (bv. aanvraag vóór uitvoering, of export eerder).

### Fase 5 — programma van eisen: trap, zolder, sanitair, afbraakzone (schemaVersie 2)
- **Doel:** de voorbeeldopdracht ("achterbouw en garage 2 afbreken, compact plan met draaitrap naar zolder, 2 slaapkamers,
  kleine berging, kleine badkamer met lavabo + douche onder het dak") kan volledig via promptveld én Claude Code.
- **Scope:** `trappen` (recht/kwart/halfdraai/spiraal) in model, 2D (symbool met looplijn) en 3D (treden); trapgat;
  vrije hoogte en hoogtelijnen onder het dak + oppervlakte per hoogteband; `niveaus.soort`; `inrichting` (sanitair + enkele meubels)
  in 2D/3D; `programma` + `toetsProgramma`; bewerkingen `opsAfbraakZone`, `opsMuurSplitsen`, `opsTrapPlaatsen`,
  `opsZolderInrichten`, `opsInrichtingPlaatsen`; migratie 1→2; promptveld kent de nieuwe bewerkingen; kerncijfers per hoogteband.
- **Afhankelijk van:** fase 4 (promptveld) voor de taal-kant; de model-kant kan parallel starten. Hoogtes van de bestaande toestand
  (nu geschat) — zonder betere hoogtes zijn de zolderresultaten indicatief.
- **Klaar als:** (1) de voorbeeldopdracht levert minstens 2 geldige varianten op `designs/bestaand.json` die in 2D/3D tonen: afbraak
  rood, trap met trapgat, zolder met ruimtes binnen hoogtelijnen, badkamer met lavabo- en douchesymbool; (2) `toetsProgramma`
  geeft per variant een correcte voldoet/voldoet-niet-lijst (getest); (3) oude v1-ontwerpen laden en valideren na migratie;
  (4) `npm test` groen, QA goedgekeurd.
- **Onzeker:** welke trapregels en hoogtegrenzen als standaard ingesteld worden (enkel instelbaar, met bron als die er is);
  hoe goed Claude zonder layout-algoritme compacte plannen maakt — eerst testen met de voorbeeldopdracht.

### Fase 6 — bestaand en aanvraag-voorbereiding (schemaVersie 2→3, deel)
- **Doel:** de app levert de informatie voor het aanvraagdossier en zet een versie vast.
- **Scope:** `fase`-veld; herkomst/zekerheid van maten; perceel met afstanden tot grenzen en terreinpeil; doorsneden en gevels
  als 2D-weergave (uit het model, met kleurcode bestaand/nieuw/afbraak); oppervlakte- en volumetabel bestaand vs. nieuw;
  checklist aanvraag (inhoud **na te gaan met de architect**, door de gebruiker aan te vullen); `vastzetten` als snapshot + vergelijk.
- **Afhankelijk van:** fase 5 (trap/zolder nodig in doorsneden); input van de architect over wat hij wil krijgen.
- **Klaar als:** voor een variant kunnen plattegronden, minstens 2 doorsneden en 4 gevels getoond en als SVG gedownload worden;
  een vastgezette versie is alleen-lezen en een latere variant toont de verschillen ermee; checklist werkt; tests + QA.
- **Onzeker:** hoe doorsneden door hellende daken en trappen er netjes uitzien zonder CAD-kwaliteit.

### Fase 7 — opbouwen en bouwfysische aandachtspunten (schemaVersie 3)
- **Doel:** houtskelet-opbouwen definiëren en toewijzen; indicatieve U-waarden; aandachtspunten luchtdichting.
- **Scope:** `opbouwen`-bibliotheek (UI om lagen te bewerken), verwijzing per muur/vloer/dak, controle dikte = Σ lagen,
  indicatieve U-waarde (met duidelijke disclaimer, methode **na te gaan**), weergave van lagen in plattegrond en doorsnede,
  aandachtspuntenlijst per aansluiting, `opsOpbouwToewijzen`, promptveld: "kies opbouw".
- **Afhankelijk van:** fase 6 (doorsneden). λ-waarden en materialen van de gebruiker/leverancier.
- **Klaar als:** elke nieuwe muur/vloer/dak in een testvariant heeft een opbouw; lagen zijn zichtbaar in 2D-doorsnede;
  U-indicatie is nagerekend in tests op een handmatig voorbeeld; geen enkele λ zonder `bron` in de repo.

### Fase 8 — prefab-elementen en details (schemaVersie 4)
- **Doel:** muren/vloeren/daken opdelen in prefab-elementen en de belangrijkste aansluitdetails schematisch tonen.
- **Scope:** `elementen` + `opsElementVerdeling` (maxima uit instellingen), elementnummers in 2D/3D, elementaanzicht per paneel,
  element- en houtlijst (CSV), gewicht-indicatie als dichtheden gekend zijn, `details` schematisch, "verouderd"-markering bij wijzigingen.
- **Afhankelijk van:** fase 7; afspraken met een prefableverancier (maximummaten, naadregels, gewenst lijstformaat) — **open vraag**.
- **Klaar als:** voor een testvariant worden alle nieuwe HSB-wanden verdeeld zonder naden door openingen, dekking exact (getest),
  lijsten downloadbaar, 3D toont elementen afzonderlijk.
- **Onzeker:** hoeveel een leverancier aan zo'n verdeling heeft — vaak tekent die zelf in eigen software; misschien volstaat een
  indicatieve verdeling voor raming en planning.

### Fase 9 — export (DXF, PDF op schaal, later IFC)
- **Doel:** plannen en lijsten tot bij architect, ingenieur en leverancier krijgen.
- **Scope:** DXF-export (lagen per status/elementtype), afdruk/PDF op schaal met kader, glTF/OBJ; onderzoek IFC (bibliotheek of
  minimale eigen export) als aparte verkenning met beslissing.
- **Afhankelijk van:** antwoord op "welke software gebruikt de architect/leverancier". Kan deels vroeger (DXF-plattegrond kan al na fase 5).
- **Klaar als:** een DXF opent correct in minstens één CAD-programma bij de gebruiker/architect (handmatige test), afdruk op 1:50 klopt
  op papier (meten), IFC-beslissing gedocumenteerd.

### Fase 10 — werfopvolging
- **Doel:** uitvoering opvolgen in hetzelfde model.
- **Scope:** `voortgang` per element, planning per element/fase, 3D gekleurd per voortgang, `afwijkingen` (meerwerk/minwerk) met ops,
  vergelijking met de vergunde snapshot, opleveringslijst; telefoonvriendelijk (op de werf).
- **Afhankelijk van:** fase 6 (snapshot), fase 8 (elementen).
- **Klaar als:** op de telefoon kan je elementen als geplaatst aanduiden (ook via promptveld), afwijkingen registreren en een
  opleveringslijst als CSV downloaden; afwijking t.o.v. de vergunde versie wordt gesignaleerd.

### Doorlopend
- Bestaande toestand verfijnen zodra hoogtes/opmeting beschikbaar zijn.
- Prijzen in `designs/prijzen.json` uitbreiden met posten voor trap, sanitair, HSB-wand per m², elementen — **enkel met bron of
  door de gebruiker ingevuld**.

---

## 7. Risico's en open vragen

### Risico's
1. **Scope-drift naar BIM/CAD.** Elke fase kan eindeloos uitdijen. Tegengif: per fase "klaar als"-criteria en de vraag
   "wat heeft de architect/leverancier hier werkelijk aan?".
2. **Schijnzekerheid.** Indicatieve U-waarden, gewichten of oppervlaktes kunnen als officieel gelezen worden. Elke afgeleide waarde
   draagt een label ("indicatief") en de herkomst van invoer.
3. **Hoogtes van de bestaande toestand zijn geschat.** Alles onder het dak (zolder, trap, vrije hoogte) hangt ervan af.
4. **Kwaliteit van Claude-voorstellen** voor compacte plannen is onbekend; mogelijk veel iteraties of handwerk nodig.
5. **Anonimiteit**: aanvraag- en werfinformatie (perceel, data, leveranciers, namen) is gevoeliger dan schetsen. Regel 8 blijft gelden;
   werf- en aanvraaggegevens die niet anoniem kunnen, horen niet in de repo (eventueel alleen lokaal in de browser of in een aparte privé-opslag — **te beslissen**).
6. **Modelgroei en prestaties op telefoon** (elementen, details, 3D met veel panelen).
7. **Exportkwaliteit**: een DXF/IFC die "bijna" klopt kost de architect meer tijd dan hij bespaart.
8. **Regelgeving verandert**; de app codeert daarom geen regels in, alleen door de gebruiker ingestelde waarden met bron.

### Open vragen voor de gebruiker
1. **Referentieproject.** De door de gebruiker aangeleverde link naar een referentieproject (houten prefab-woning) kon vanuit deze omgeving **niet gelezen
   worden** (netwerk geblokkeerd). Wat spreekt je erin aan: het bouwsysteem (prefab houtskeletelementen), het beeld/materiaal,
   het bouwproces/de snelheid? Plak eventueel de relevante tekst, of laat het domein toe in de netwerkinstellingen van de sessie.
2. Is er al een **architect**? Welke **CAD/BIM-software** gebruikt die (en wil die DXF, IFC, PDF of enkel een gesprek met schetsen)?
3. Is er al een **prefab-leverancier** of aannemer in beeld? Welke maximummaten, lijstformaten of software gebruikt die?
4. Welke **exportformaten** heb je zelf nodig, en in welke volgorde (bv. eerst PDF/DXF van plattegronden)?
5. Kunnen de **hoogtes** van de woning opgemeten worden (verdiepingshoogtes, nok, goot, dakhelling, zoldervloer)?
6. Is de **zolder** nu bereikbaar en wat is de draagkracht/opbouw van de zoldervloer? (vraag voor de ingenieur)
7. Wil je de aanvraagfase en de werf in de app opvolgen, of stopt het nut voor jou na het voorontwerp?
8. Welke **hoogtegrenzen** wil je zien onder het dak (voorbeeld: 1,50 m en 2,20 m)? Waarvoor (comfort, vergunning, EPB)?
9. Wil je **opbouwen** zelf invullen, of komen die van architect/leverancier/EPB-verslaggever?
10. Werf- en aanvraagdata (data, leveranciers): mogen die in de (publieke) repo als ze geen namen/adres bevatten, of liever lokaal?

### Na te gaan (verzameld)
- Wanneer een architect verplicht is bij verbouwen in Vlaanderen en welke uitzonderingen er zijn.
- Welke stukken, schalen en kleurconventies een aanvraagdossier via het omgevingsloket vraagt.
- Of en hoe de verbouwing EPB-plichtig is en welke eisen gelden.
- Regels/aanbevelingen voor trappen (optrede, aantrede, breedte, loophoogte) en voor minimale hoogtes/oppervlaktes van verblijfsruimtes.
- Definitie van "nuttige"/"bewoonbare" oppervlakte onder een hellend dak (en voor welk doel).
- Rekenmethode voor indicatieve U-waarden van houtskeletwanden.
- Transportmaten en kraanbeperkingen voor prefab-elementen (leverancier).
- Bruikbare open-source JS-bibliotheken voor IFC zonder buildstap.
- LOD-definities (enkel leidraad).
