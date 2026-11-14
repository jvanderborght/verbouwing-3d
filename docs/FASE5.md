# Fase 5 — programma van eisen: trap, zolder, sanitair, afbraakzone (schemaVersie 2)

Uitwerking van `docs/CONCEPT.md` §3.1 en roadmap "Fase 5". Doel: de voorbeeldopdracht volledig kunnen uitvoeren op
`designs/bestaand.json`: *"breek de achterbouw en garage 2 af (afbraak) en maak een compact plan volgens een programma
van eisen: draaitrap naar zolder + 2 slaapkamers + kleine berging + kleine badkamer (lavabo + douche) onder het dak"*.

## Deel A — datamodel (model-architect; nu, parallel met fase 4)
Alleen `js/model/`, `js/metrics/`, `tools/`, `designs/`, `tests/`, `docs/DATAMODEL.md`. **Niet** `js/ui/`, `js/views/`, `js/ai/`, `index.html`, `css/`.

1. **schemaVersie 2** in `schema.js` + migratie `v1naarV2` in `migrate.js` (v1-bestanden laden blijft werken; opslaan in v2).
   - `niveaus.soort?: "verdieping" | "zolder" | "kelder"`.
   - `trappen` (voorvoegsel `T`): `vanNiveau`, `naarNiveau`, `type: recht|kwart|halfdraai|spiraal`, `oorsprong`, `richting`,
     `breedte`, `aantalTreden?`, `optrede?`, `aantrede?`, `draairichting?: links|rechts`, `diameter?` (spiraal), `status`.
   - `inrichting` (voorvoegsel `I`): `niveau`, `ruimte?`, `soort` (douche, lavabo, wc, bad, keuken, bed, kast, wasmachine, …),
     `positie`, `rotatie`, `breedte`, `diepte`, `hoogte?`, `status`.
   - `ruimtes.hoogtegrenzen?: number[]` (mm).
   - optioneel ontwerpveld `programma: { eisen: [...] }` (vorm zoals CONCEPT §3.1).
   - Cascade: niveau verwijderen ⇒ trappen (van/naar) en inrichting erop; ruimte verwijderen ⇒ `inrichting.ruimte` wissen.
2. **Afgeleide geometrie** (puur, getest): `trapVoetafdruk(trap)` per type (polygoon), `trapgat(model, trap)` in de vloer van
   `naarNiveau`, berekende `aantalTreden`/`optrede` uit het hoogteverschil (als niet opgegeven, met een instelbare
   doel-optrede — **geen norm in de code**; standaard uit een instellingenobject met veld `bron: null`),
   `vrijeHoogte(model, niveau, punt)` (onder daken; plafond = volgend niveau), `hoogtelijnen(model, niveau, [h…])`,
   `oppervlaktePerHoogteband(model, ruimte, grenzen)`.
3. **Validator**: trap binnen de begrenzing van beide niveaus, `naarNiveau` boven `vanNiveau`, inrichting binnen zijn niveau
   (waarschuwing als buiten de ruimte of onder een vrije hoogte lager dan het element), geldige soorten/types.
4. **Bewerkingen** (`bewerkingen.js`, `{ ops, fout?, info? }`):
   `opsAfbraakZone(model, { niveau?, ids? | punt? | ruimte? })` (alle elementen van een volume/ruimte op `afbraak`: muren,
   openingen, vloeren, daken, ruimtes worden verwijderd of gemarkeerd — beslis en documenteer),
   `opsTrapPlaatsen(model, {...})`, `opsInrichtingPlaatsen(model, {...})`,
   `opsZolderNiveau(model, { onderNiveau, naam })` (niveau `soort: zolder` op de bovenkant van het onderliggende niveau,
   vloer = begrenzing onder het dak, hoogte = nokhoogte), `toetsProgramma(model, programma)` → per eis
   `voldoet | voldoet niet | onbekend` + uitleg.
5. **Kerncijfers** (`js/metrics/`): per ruimte oppervlakte per hoogteband als `hoogtegrenzen` gezet is; aantal trappen;
   inrichting per soort; uitbreiding van de vergelijkingsrijen. Raming: geen nieuwe prijsposten tenzij in prijzen.json.
6. **Designs**: `bestaand.json` en `voorbeeld.json` naar v2 (generatorscripts mee aanpassen; bestaand krijgt de bestaande
   trap GV→verdieping als `trappen`-element indien uit het DXF af te leiden, anders niet).
7. **Claude Code**: `tools/apply-ops.mjs` en `tools/validate.mjs` werken met v2. Een **demonstratie** van de voorbeeldopdracht
   als ops-bestand `tools/voorbeelden/zolder-programma.ops.json` dat op `bestaand` toegepast een geldige variant geeft
   (niet committen als ontwerp; enkel als voorbeeld + test).

## Deel B — weergave, gereedschap en promptveld (na merge van fase 4)
- **viewer-3d**: trappen in 2D (symbool met loopijn en pijl, trapgat gestreept) en 3D (treden), inrichtingssymbolen 2D + blokken 3D,
  hoogtelijnen en hoogtebanden op zolder in 2D, schuine plafonds zichtbaar in 3D-doorsnede.
- **ui-toolbar**: gereedschap Trap en Inrichting (met soortkeuze), eigenschappen van trappen/inrichting, programma-editor + toetsresultaat.
- **ai-prompt**: systeemprompt naar schema v2 (trap, zolder, inrichting, programma, afbraakzone), voorbeeldopdracht end-to-end
  (nagebootst antwoord) in tests en rooktest.

### Uitwerking ai-prompt (fase5/ai)
Details in `docs/FASE4.md` → "Aanvulling fase 5". Kort:
- Systeemprompt naar schema v2 (trappen, inrichting, `niveaus.soort`, `ruimtes.hoogtegrenzen`, programma via de operatie `ontwerp`,
  trap-/zolder-/inrichtingsconventies, werkwaarden ≠ normen); de afbraakregels blijven.
- **Macro's** in het antwoordschema: `afbraakZone`, `zolderNiveau`, `trapPlaatsen`, `inrichtingPlaatsen`, `muurSplitsen` (+ `ontwerp`).
  `js/ai/macros.js` vouwt ze vóór de validatie uit met de bewerkingen van deel A, in volgorde op het tussenresultaat; Claude kiest zelf
  de id's van nieuwe elementen (`id`/`nieuwId`), automatisch uitgedeelde id's botsen er nooit mee. Macrofouten gaan mee in de herstelpoging.
- Schema binnen de gedocumenteerde limieten van structured outputs (14 optionele parameters van max. 24, 1 unie van max. 16) dankzij
  `item`/`velden` als JSON-tekst.
- Variant met een programma ⇒ `programmaToets` (toetsProgramma) in het resultaat en in het promptpaneel.
- Tests: `tests/ai-macros.test.js` (voorbeeldopdracht end-to-end met macro's, herstelpoging, schemagrootte); rooktest met nagebootste API.

## Geen normen verzinnen
Trapcomfortregels, hoogtegrenzen voor "bewoonbare" oppervlakte en standaardmaten van sanitair zijn **instelbaar** en
staan niet als norm in de code. Als ze ingevuld worden, dan met `bron` (zoals de prijsregel).
