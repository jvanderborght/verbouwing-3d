# Fase 4 — promptveld en "genereer N varianten"

Doel: in de app een opdracht in gewone taal geven ("verleng de keuken 2 m naar de tuin met een plat dak",
"maak 3 varianten voor een extra badkamer boven"). Claude geeft **modeloperaties** terug; de app valideert ze,
toont een **diff-preview** en past ze pas toe na bevestiging. Daarnaast blijft Claude Code werken via
`tools/apply-ops.mjs` op `designs/`.

## Principes
- **Eigen API-key in de browser** (localStorage, nooit in git, nooit gelogd of in foutmeldingen). Rechtstreekse
  browseraanroep (`dangerouslyAllowBrowser` / header `anthropic-dangerous-direct-browser-access: true`). Kosten zijn
  voor het API-account van de gebruiker; de app toont tokens en een geschatte kost per aanvraag.
- **Geen buildstap**: de officiële SDK `@anthropic-ai/sdk` wordt gevendored als ES-module in `js/vendor/` (zoals
  Three.js) indien dat zonder bundler werkt; anders `fetch` op `POST /v1/messages` (en dat wordt gemotiveerd).
- **Model**: standaard `claude-opus-5-5` (effort instelbaar, standaard `medium`); de gebruiker kan in Instellingen
  een ander model kiezen. Server-side fallbacks bij een weigering (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`) staan standaard aan en zijn uit te zetten.
- **Alleen operaties**: Claude krijgt het datamodel (schema + operaties uit `docs/DATAMODEL.md`) en het huidige
  ontwerp (JSON), en antwoordt met gestructureerde JSON: `{ samenvatting, vragen?, varianten: [{ naam, beschrijving, ops: [...] }] }`.
  Geen vrije tekst die de app moet interpreteren.
- **Valideren vóór tonen**: per variant `applyOps` op (een kopie van) het actieve ontwerp. Faalt het ⇒ de fouten
  gaan terug naar Claude voor **één** herstelpoging; faalt het opnieuw ⇒ duidelijke melding, niets toegepast.
- **Diff-preview**: per variant `beschrijfDiff(diff(...))` in mensentaal + voorbeeld in de plattegrond
  (markering van nieuwe/gewijzigde/verwijderde elementen) en optioneel 3D. Kerncijfers/raming van het resultaat
  (fase 3) naast die van het huidige ontwerp.
- **Toepassen**: 1 variant ⇒ op het actieve ontwerp als **één undo-stap**. N varianten ⇒ elk als nieuwe variant
  (`dupliceer` + ops, basis = actief ontwerp, lokaal opgeslagen), daarna voorstel om te vergelijken (fase 3).
- **Onduidelijke opdracht** ⇒ Claude mag `vragen` teruggeven in plaats van ops; de app toont ze en laat de
  gebruiker antwoorden (multi-turn binnen hetzelfde gesprek).
- **Privacy**: het ontwerp-JSON gaat naar de Anthropic API; de app vermeldt dat. Geen adres of namen meesturen
  buiten wat in het ontwerp staat.
- **Prompt caching**: vaste systeemprompt (schema, operaties, regels, voorbeelden) vooraan met `cache_control`;
  het ontwerp-JSON en de opdracht daarna.

## Claude Code
`node tools/apply-ops.mjs <id> ops.json [--als nieuw-id --naam "…"]` blijft de manier om vanuit Claude Code
varianten te maken. Hetzelfde operatieformaat als het promptveld.

## Uitwerking (fase4/ai)

### Aanpak: gevendorde SDK (geen fetch)
- `@anthropic-ai/sdk` **1.3.0** (npm, 2026-10-23; ≥ 2 weken oud bij het vendoren) staat in `js/vendor/anthropic-sdk/`: enkel de
  `*.mjs`-bestanden die vanaf `index.mjs` bereikbaar zijn, ongewijzigd, + `LICENSE` (Apache-2.0). Details: `js/vendor/anthropic-sdk/VENDOR.md`.
- Zonder bundler lukt dat met de importmap in `index.html`: `@anthropic-ai/sdk`, `@opentelemetry/api` (gevendord, 1.10.0, ESM),
  `standardwebhooks` (eigen vervanger in `js/vendor/anthropic-sdk-shims/`: het echte pakket is enkel CommonJS en dient enkel voor
  webhook-verificatie op een server) en het `browser`-veld van het pakket (`internal/node.mjs` → `node.browser.mjs`).
- Client: `new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, logLevel: 'off' })` ⇒ header
  `anthropic-dangerous-direct-browser-access: true`. SDK 1.x stuurt API-versie `2026-10-21` en de key als `Authorization: Bearer …`.
- In de Node-tests wordt dezelfde SDK geladen via een resolve-hook (`module.register`) met een nagebootste `fetch`.

### Request-vorm
`client.beta.messages.stream(params).finalMessage()` met:
- `model` (standaard `claude-opus-5-5`; keuze `claude-sonnet-5-5`, `claude-haiku-5-5`), `max_tokens: 64000` (denkwerk telt mee).
- Geen `thinking` (Opus 5.5: altijd adaptief), `output_config.effort` expliciet (standaard `medium`), geen sampling-parameters, geen prefill.
- **Structured outputs**: `output_config.format = { type: 'json_schema', schema: ANTWOORD_SCHEMA }` (geforceerde `tool_choice` geeft 400 op Opus/Sonnet 5.5).
- **Fallbacks**: `betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'` (uit te zetten in Instellingen; nooit voor Haiku 5.5,
  die heeft geen server-side fallback). De documentatie noemt structured outputs compatibel met streaming, en fallbacks met streaming;
  een expliciete bevestiging van de combinatie fallbacks + structured outputs vond ik niet. Daarom: geeft de API een 400 die over
  `fallbacks` gaat, dan probeert de client automatisch één keer opnieuw zonder; idem zonder schema bij een 400 over het schema
  (de JSON-vorm staat dan enkel in de systeemprompt). Dat wordt in het paneel gemeld.
- **Prompt caching**: systeemprompt (vast, ±11k tekens, uit `js/model/schema.js` gegenereerd en deterministisch) met `cache_control`;
  daarna het contextblok (ontwerp-JSON compact + kerncijfers + actief niveau + selectie + volgende vrije id's) met `cache_control`, dan de
  opdracht. Bij vervolgbeurten (herstel, antwoord op vragen) ook een breekpunt op het laatste blok. Het gesprek is append-only.
- Assistent-antwoorden gaan terug in de geschiedenis als **enkel hun tekstblokken** (alle denkblokken weggelaten — volledig weglaten is
  toegestaan; zo blijft het verzoek geldig, ook na een fallback naar een ander model).
- Na `finalMessage()` wordt eerst `stop_reason` gecontroleerd (`refusal`, `max_tokens`, …), pas dan de tekst gelezen.

### Systeemprompt (`js/ai/prompt.js`)
Rol en grenzen (schets, geen BIM) · antwoordformaat (enkel JSON) · conventies (mm, oorsprong, assen) · velden per collectie (uit `VELDEN`) ·
validatieregels · operaties met twee volledige voorbeelden · regels: statussen (afbreken = `wijzigen` naar `afbraak`, nooit verwijderen;
nieuw = `nieuw`; ruimtes hebben geen status), id's hergebruiken en nieuwe id's vanaf de opgegeven vrije id's, gegeven maten exact overnemen,
geometrie (assen, aansluitingen, openingen binnen de muur), actief niveau/selectie, vragen stellen bij onduidelijkheid, geen prijzen,
herkennen van een deel (achterbouw, garage) aan ruimtenamen/contour, programma van eisen met gangbare minimale maten als aanname, en
wat schema v1 niet kan (trap, schuine plafonds, sanitair, opbouwen) expliciet melden als "Niet modelleerbaar in schema v1: …" en
benaderen met bestaande elementen (ruimte "Trap (draaitrap Ø …)", niveau "Zolder").

### Antwoordschema
(Stand fase 4 — vervangen in fase 5, zie "Aanvulling fase 5" onderaan.)
`{ samenvatting: string, vragen: string[], varianten: [{ naam, beschrijving, ops: Op[] }] }` met `Op` = anyOf van
`toevoegen` (collectie + item), `wijzigen` (collectie + id + velden), `verwijderen`, `verplaatsen` (dx, dy). `item`/`velden` = één object met
alle elementvelden (optioneel, `additionalProperties: false`). De operatie `ontwerp` zit er niet in (de app beheert naam/beschrijving).

### Verwerking (`js/ai/verwerk.js`, `js/ai/gesprek.js`)
Per variant `applyOps` op het basisontwerp (kopie) ⇒ fouten verzameld ⇒ **één** herstelpoging met alle fouten (per variant, met de
foute operatie) ⇒ lukt het weer niet: melding, niets toegepast. Per variant: `diff` + `beschrijfDiff`, telling nieuw/afbraak/gewijzigd/verwijderd,
kerncijfers en raming vóór/na, voorbeeldpolygonen per niveau (`plan2d.toonHulp`: stijlen `nieuw` blauw, `afbraak` rood, `markering` oranje).

### UI (`js/ui/opdracht.js`)
Knop **Opdracht** in de kopbalk (ook op telefoon) opent een niet-modaal paneel (desktop rechts, de views schuiven opzij; telefoon onderaan,
inklapbaar, schakelt naar de 2D-tab). Zonder key: uitleg + knop naar Instellingen. Aantal varianten 1–4, voortgang (tekens ontvangen) +
Annuleren (AbortController). Resultaat: samenvatting, vragen (beantwoorden in hetzelfde gesprek), per variant beschrijving, chips, niveaus met
wijzigingen, kerncijfers/raming met Δ, alle wijzigingen; voorbeeld in 3D en plattegrond. **Toepassen** = één undo-stap op het actieve ontwerp
(geweigerd als dat intussen wijzigde). **Als nieuwe variant(en) bewaren** = lokale varianten (`VariantBeheer.bewaarNieuw`, basis = actief
ontwerp), daarna aanbod om te vergelijken. Usage met `cache_read_input_tokens` en een geschatte kost (tabel `PRIJZEN` in `js/ai/client.js`,
bron + datum vermeld; duidelijk een schatting). Instellingen: API-key (password-veld, wissen, waarschuwing), model, effort, fallbacks.

### Beperkingen
- Niet getest tegen de echte API (geen key beschikbaar): alle tests en de rooktest gebruiken nagebootste antwoorden. Te verifiëren bij
  het eerste echte gebruik: CORS met `Authorization: Bearer` vanuit de browser, aanvaarding van het schema door structured outputs
  (complexiteit), en de combinatie fallbacks + schema (beide hebben een automatische terugval).
- Optionele velden wissen (`null`) kan Claude niet via het schema; `ontwerp`-operaties ook niet (bewust).
- De kostschatting gebruikt de prijzen van het gevraagde model; na een fallback is ze "deels onbekend". Cache-schrijven = 1,25 × invoer (vuistregel).
- Trappen, zolders met schuine daken, sanitair en opbouwen bestaan niet in schema v1 (latere fase); Claude benadert ze met ruimtes/niveaus.
- De key staat leesbaar in localStorage van het browserprofiel (zoals het GitHub-token).

## Aanvulling fase 5 (fase5/ai): schema v2, macro's, programmatoets

### Systeemprompt naar schema v2
Datamodel `schemaVersie 2` (velden per collectie nog altijd gegenereerd uit `VELDEN`, nu met `trappen` (T) en `inrichting` (I),
`niveaus.soort`, `ruimtes.hoogtegrenzen`) · ontwerpveld `programma` (vorm van ruimte- en trap-eisen) · conventies: trap-`oorsprong`
(midden voorrand onderste trede; spiraal: middelpunt), `richting`, `draairichting` (links = tegenwijzerzin), voetafdruk per type,
`aantalTreden` = aantal optreden (n − 1 treden in plan), trapgat = voetafdruk; zolder (`soort: zolder`, hoogte = nok, vrije hoogte wordt
berekend, knieschoten = muren met eigen `hoogte`, `hoogtegrenzen` op ruimtes); inrichting (`positie` = middelpunt, `rotatie` 0/90/180/270
= rug aan -y/+x/+y/-x) · **werkwaarden zijn geen normen** (de waarden worden uit `INSTELLINGEN_STANDAARD` in de prompt gezet; grenzen
standaard leeg = niet getoetst; Claude mag geen normen verzinnen) · de afbraakregels blijven (afbraak i.p.v. verwijderen, randmuren
blijven, ruimtes verwijderen) en verwijzen naar de macro `afbraakZone` · programma van eisen: het gevraagde programma vastleggen met de
operatie `ontwerp`, en daarin enkel eisen die de gebruiker gaf (`minOppervlakte`/`hoogteGrens` alleen als de gebruiker ze noemt).
De tekst "Niet modelleerbaar in schema v1" is weg; wat ook v2 niet kan (dakkapellen, dakramen, isolatie/opbouwen, technieken, leuningen)
meldt Claude als "Niet modelleerbaar: …". De systeemprompt is ±20,7k tekens (vast, deterministisch, gecachet).

### Antwoordschema (vervangt fase 4)
Gemeten tegen de limieten van structured outputs (Claude API-documentatie `build-with-claude/structured-outputs`, "Schema complexity
limits", gelezen 2026-11-14): **max. 24 optionele parameters** en **max. 16 parameters met een unie** (anyOf / type-lijst), opgeteld over
het hele verzoek; geen recursie. Het fase-4-schema met één vrij element-object zou met de v2-velden **33** optionele velden hebben (> 24).
**Vereenvoudiging:** `item` (toevoegen) en `velden` (wijzigen, ontwerp) zijn nu een **JSON-tekst** (string met het object). De inhoud wordt
door de app geparst en door de validator gecontroleerd; een fout gaat mee in de herstelpoging. Bijkomend voordeel: `null` (optioneel veld
wissen) en de operatie `ontwerp` (programma) kunnen nu wel. De macro's hebben vaste, getypeerde parameters; waar een standaard bestaat is
de parameter verplicht met `""` = automatisch (id's) i.p.v. optioneel. Resultaat (`schemaMaat`, bewaakt in `tests/ai-macros.test.js`):
**14 optionele parameters, 1 unie** (de lijst `ops`), 12 objecten, geen recursie, ±4,7 kB. Antwoorden met `item`/`velden` als object
(fase-4-vorm, of als de terugval zonder schema actief is) blijven aanvaard.

`Op` = anyOf van: `toevoegen`, `wijzigen`, `verwijderen`, `verplaatsen`, `ontwerp` (enkel `programma`, `naam`, `beschrijving`) en de macro's.

### Macro's (`js/ai/macros.js`)
| macro | parameters | bewerking |
|---|---|---|
| `afbraakZone` | `ruimtes?` (zone) **of** `ids?` (precies die elementen), `niveau?` | `opsAfbraakZone` |
| `zolderNiveau` | `onderNiveau`, `naam`, `id`, `vloerdikte?` | `opsZolderNiveau` |
| `trapPlaatsen` | `id`, `van`, `naar`, `type`, `oorsprong`, `richting`, `breedte`, `draairichting?`, `aantrede?`, `aantalTreden?`, `optrede?`, `diameter?` | `opsTrapPlaatsen` |
| `inrichtingPlaatsen` | `id`, `soort`, `ruimte`, `rotatie`, `positie?` (leeg ⇒ plek tegen een wand), `niveau?`, `breedte?`, `diepte?`, `hoogte?` | `opsInrichtingPlaatsen` |
| `muurSplitsen` | `muur`, `positie` (mm vanaf start), `nieuwId` | `opsMuurSplitsen` |

`vouwUit(basis, ops, { instellingen })` vouwt de macro's **vóór de validatie** uit, **in volgorde, op het tussenresultaat** (basisops worden
onderweg zonder validatie toegepast), zodat latere operaties kunnen verwijzen naar wat een macro aanmaakte. Daarna gewoon `applyOps` +
`validate` op het geheel. Een fout in een macro (`fout` van de bewerking, onbekende parameter-combinatie, ongeldige JSON-tekst, id bestaat al)
krijgt pad `ops[i]` met de operatie van Claude en gaat mee in de **herstelpoging**; het herstelbericht vermeldt ook welke macro's vóór de
fout wel uitgevoerd werden en welke id's ze aanmaakten (`macroInfoTekst`).

**Naar nieuwe id's verwijzen.** Claude geeft in `id` / `nieuwId` zelf het id van het nieuwe element (aanbevolen; `""` = volgend vrij nummer)
en verwijst er later naar (de zoldermuren naar `N2`, de inrichting naar de ruimte `R16`, …). Id's die een bewerking zelf uitdeelt (de tweede
helft van een door `afbraakZone` gesplitste muur, de zoldervloer, …) worden **hernummerd** als ze botsen met een id dat Claude ergens in
dezelfde variant expliciet gebruikt (`toevoegen` item.id, macro-`id`/`nieuwId`). Voorbeeld uit de test: `afbraakZone` zou de stukken
M30/M31 noemen, maar Claude gebruikt M30…M36 voor de zolderwanden ⇒ de stukken worden M37/M38. Naar zulke automatische id's verwijst Claude
niet (de prompt zegt dat expliciet); ze staan wel in `macroInfo` en in het herstelbericht.

Resultaat per geslaagde variant (`pasVariantenToe`): `ops` = de **uitgevouwen basisoperaties** (die past "Toepassen" als één undo-stap toe,
zodat `js/ui` niets van macro's hoeft te weten), `antwoordOps` = de operaties zoals Claude ze gaf, `macroInfo`, `meldingen` (bv. de
randmuren van `afbraakZone`: mogelijk dragend) en — als het ontwerp na de variant een `programma` heeft — **`programmaToets`** =
`toetsProgramma(model, model.programma, { instellingen })`. `Gesprek` aanvaardt `modelInstellingen` (werkwaarden/grenzen uit
`js/model/instellingen.js`) en geeft ze door aan macro's en toets; de UI geeft ze (nog) niet mee ⇒ standaardinstellingen.
Het voorbeeld in de plattegrond toont nu ook trappen (voetafdruk, op van- én naarNiveau) en inrichting.

### UI (minimale aanvulling in `js/ui/opdracht.js`)
Per variant een uitklapblok "Programma van eisen: x voldoet, y voldoet niet, z onbekend" met per eis label, status en uitleg, en een
blok "Meldingen van de bewerkingen". Geen nieuwe CSS (bestaande klasse `ai-diff`).

### Tests en rooktest
`tests/ai-macros.test.js`: schemagrootte (limieten + budget 18 optioneel / 2 unies, geen recursie, alles gesloten); de voorbeeldopdracht
end-to-end via de gevendorde SDK met een nagebootst antwoord **met macro's** (`antwoordPveMacro` in `tests/ai-voorbeelden.js`: afbraakZone
achterbouw + garage 2, zolderNiveau, wanden/deuren/ruimtes met hoogtegrenzen, trapPlaatsen, inrichtingPlaatsen douche + lavabo (plek gezocht
door de app), programma) ⇒ geldig, toepassen van de uitgevouwen ops geeft exact hetzelfde model, toets 4 × voldoet; ongeldige macro ⇒
herstelpoging ⇒ succes; twee keer ongeldig ⇒ fout; foutgevallen per macro; muurSplitsen + verwijzing naar `nieuwId`; hernoemen;
instellingen (een grens die enkel in de test gezet wordt) ⇒ "voldoet niet". Rooktest (Playwright, `page.route` op api.anthropic.com,
nagebootste SSE; desktop en telefoon): voorbeeldopdracht op `bestaand` ⇒ preview (afbraak rood op het gelijkvloers, trap op de verdieping,
zolder met wanden/trapgat/sanitair blauw, programmatoets 4 voldoet) ⇒ Toepassen (3 niveaus, 1 trap, 2 inrichtingselementen, programma,
één undo-stap) ⇒ undo.

### Beperkingen (fase 5)
- Nog altijd niet getest tegen de echte API. Of de API het nieuwe schema aanvaardt, is enkel getoetst aan de gedocumenteerde expliciete
  limieten; er bestaan ook interne limieten op de grootte van de gecompileerde grammatica die niet gepubliceerd zijn. Wordt het schema
  geweigerd, dan valt de client terug op JSON via de instructies (bestaande terugval).
- `item`/`velden` als JSON-tekst: de structuur binnenin wordt niet door structured outputs gegarandeerd (wel door validator + herstelpoging);
  het kost wat extra uitvoertokens (escapes).
- Hoe goed Claude de macro's en de JSON-tekst in de praktijk gebruikt, is niet gemeten (enkel nagebootste antwoorden).
- `afbraakZone` met een `punt` en `muurSplitsen` met een punt i.p.v. een positie zitten niet in het schema (wel aanvaard door `macros.js`).
- Instellingen van de gebruiker (trapgrenzen) worden door de UI nog niet aan het gesprek meegegeven.

## Zonder API-key (fase 5c, fase5/zonder-key)

Niet iedereen kan een eigen Anthropic API-key aanmaken. Twee routes werken zonder key; beide gebruiken **dezelfde operaties, macro's en
verwerking** als het promptveld (`vouwUit` → `applyOps` + `validate` → diff, kerncijfers, programmatoets) en dezelfde systeemprompt
(`SYSTEEMPROMPT` in `js/ai/prompt.js`) als bron van de regels.

### Route 1 — Claude Code (deze repo)
- `tools/apply-ops.mjs <id> <bestand|-> [--als <nieuw-id>] [--naam "…"] [--variant <n>] [--droog] [--designs <map>]`
  - aanvaardt: lijst operaties, één operatie, `{ ops, _uitleg?, basis? }`, het **antwoordformaat** `{ samenvatting, vragen?, varianten:
    [{ naam, beschrijving, ops }] }`, en tekst met zo'n JSON (bv. een gekopieerd chatantwoord met een ```json-blok);
  - **macro's** (`afbraakZone`, `zolderNiveau`, `trapPlaatsen`, `inrichtingPlaatsen`, `muurSplitsen`) en `ontwerp`; `item`/`velden` als object
    of JSON-tekst. Anders dan in de app mag `ontwerp` hier alle ontwerpvelden wijzigen die `applyOps` toelaat (zoals voorheen);
  - antwoordformaat zonder `--als`: elke variant wordt een nieuw ontwerp `<id>-<slug van de naam>` (bestaat dat al: `-2`, …), met de
    beschrijving van de variant; `--variant n` kiest er één, `--als` kan enkel bij één variant. Gewone ops zonder `--als` werken het
    bronontwerp bij (zoals voorheen);
  - atomair over alle varianten (één fout ⇒ niets geschreven, afsluitcode 1); `--droog` toont alles zonder te schrijven;
  - uitvoer: diff (`beschrijfDiff`), macro-info (`macroInfoTekst`), meldingen (bv. blijvende randmuren van `afbraakZone`),
    waarschuwingen van de validator en de toets aan het programma van eisen als het ontwerp er een heeft.
  - Logica in `js/ai/opsbestand.js` (puur, getest); de CLI leest/schrijft enkel bestanden.
- Project-skill `.claude/skills/ontwerp-opdracht/SKILL.md`: werkwijze voor Claude Code (ontwerp lezen → ops-bestand buiten `designs/` →
  `--droog` → schrijven → `validate` + `npm test` → diff, meldingen en toets tonen → commit op een branch → bevestiging vóór merge).
  Voor een branch die enkel ontwerpdata wijzigt volstaat als QA een lichte check (validate + tests groen, diff door de gebruiker gezien).

### Route 2 — handmatige modus in de app
- Opdracht-paneel: keuze **Met API-key** / **Handmatig (zonder key)**. Zonder key is het altijd handmatig; met key is de keuze bewaard in
  localStorage (`verbouwing3d.aiModus`).
- **"Kopieer opdracht voor Claude"** zet één tekst op het klembord (`bouwKopieertekst` in `js/ai/handmatig.js`): `SYSTEEMPROMPT` +
  korte kanaaluitleg (één ```json-blok mag hier; `item`/`velden` als object aanbevolen) + `ANTWOORD_SCHEMA` (compact) + context
  (`contextTekst`: ontwerp-JSON compact, kerncijfers, actief niveau, selectie, volgende vrije id's) + opdracht + "Antwoord uitsluitend met
  JSON volgens dit schema …". Voor `bestaand` ±38 000 tekens (±37 kB); de lengte wordt gemeld. Lukt het klembord niet, dan verschijnt de
  tekst in een vak om zelf te kopiëren.
- **"Plak het antwoord van Claude"** + **Verwerken**: `haalJsonUit` haalt de JSON uit de geplakte tekst (```json-blok ergens in de tekst,
  ook onafgesloten; de hele tekst; of het JSON-object op het hoogste niveau tussen inleidende/afsluitende zinnen; bij meerdere blokken wint
  wat het best op een antwoord lijkt). Een losse operatielijst of `{ ops }` wordt één variant. Daarna `leesAntwoord` + `beoordeel` (zelfde
  pijplijn) ⇒ dezelfde preview, kerncijfers, toets, Toepassen (één undo-stap) en Als nieuwe variant(en) bewaren.
- Fouten: **"Kopieer herstelvraag"** (de fouten per variant + macro-info, zoals de API-herstelpoging) om in **hetzelfde** gesprek te plakken.
  Net als bij de API: één herstelpoging; is ook het tweede antwoord fout, dan een foutmelding (opnieuw beginnen). Een per ongeluk
  teruggeplakte opdracht, een leeg veld of afgebroken JSON krijgen een eigen melding. Vragen van Claude: het antwoord van de gebruiker
  wordt gekopieerd om in hetzelfde gesprek te plakken.
- Privacy: het paneel meldt dat het volledige ontwerp-JSON en de opdracht in de gebruikte Claude-chat terechtkomen (en in de
  geschiedenis van dat account); enkel plakken in een chat die de organisatie toelaat. Er gaat niets naar `api.anthropic.com`.

### Tests
- `tests/ai-handmatig.test.js`: opbouw en compactheid van de kopieertekst; JSON-extractie (kaal, codeblok met/zonder taal, inleidende
  tekst, onafgesloten blok, meerdere blokken, BOM); foutpaden (leeg, geen JSON, ongeldige JSON, afgebroken, teruggeplakte opdracht);
  verwerking van het programma-voorbeeld (`antwoordPveMacro`) ⇒ toets 4 × voldoet en zelfde model als bij toepassen; herstelvraag ⇒
  verbeterd antwoord ⇒ ok; twee keer fout ⇒ fout; vragen; `leesOpsBron`/`verwerkOpsBron`; de CLI op een kopie van `designs/`
  (`--droog`, `--variant`/`--als`, standaard `<id>-<slug>`, foutpad zonder schrijven, verkeerd gebruik).
- Rooktest (Playwright, lokaal, niet in CI): zonder key → kopiëren (klembord gelezen) → fout antwoord → herstelvraag → voorbeeldantwoord
  geplakt (via het klembord) → preview (toets 4 voldoet) → Toepassen (3 niveaus, 1 trap, 2 inrichting, programma, één undo-stap) → undo;
  met key: keuze tussen beide modi; desktop en telefoon; geen console-fouten, geen aanroep naar api.anthropic.com.

### Beperkingen
- Hoe goed een Claude-chat het formaat volgt zonder structured outputs, is niet gemeten (enkel nagebootste antwoorden). De herstelvraag
  vangt vorm- en validatiefouten op, maar het overbrengen blijft handwerk.
- De kopieertekst is groot (±38k tekens voor `bestaand`); sommige chatvensters kunnen lange plaksels als bijlage behandelen — dat is
  voor de werking geen probleem, maar is niet per chat-product getest.
- Kosten/tokens zijn in de handmatige modus niet zichtbaar (geen API-antwoord).
- Het basisontwerp is dat van het moment van kopiëren; is het actieve ontwerp intussen gewijzigd, dan weigert Toepassen (bewaren als
  nieuwe variant kan wel).
