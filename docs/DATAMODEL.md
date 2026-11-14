# Datamodel (schemaVersie 1)

Eén JSON-object per variant, bestand `designs/<id>.json`. Code: `js/model/`.

## Conventies

- Alle maten in **mm**. Hoeken in graden.
- Oorsprong `[0, 0]` = linkerbenedenhoek gelijkvloers (buitenhoek links-voor). **x** → rechts (langs de straatgevel), **y** → naar achter (tuin), **z** → omhoog.
- Elk element heeft een `id`, uniek over het hele ontwerp. Voorvoegsels: `N` niveau, `M` muur, `O` opening, `R` ruimte, `V` vloer, `D` dak.
- `status` ∈ `bestaand` | `nieuw` | `afbraak` (kleur: grijs / blauw / rood transparant).

## Ontwerp

| veld | type | |
|---|---|---|
| `schemaVersie` | 1 | verplicht |
| `id` | `[a-z0-9-_]` | = bestandsnaam |
| `naam` | tekst | |
| `beschrijving` | tekst | optioneel |
| `basis` | id \| null | variant waarvan deze afgeleid is |
| `perceel` | `{ contour }` | optioneel; perceelgrens, x mag negatief zijn |
| `niveaus`, `muren`, `openingen`, `ruimtes`, `vloeren`, `daken` | lijsten | |

## Elementen

**niveau** `{ id, naam, peil, hoogte, vloerdikte? }` — `peil` = z van de afgewerkte vloer; `hoogte` = verdiepingshoogte (vloer tot vloer) = standaard muurhoogte.

**muur** `{ id, niveau, start:[x,y], eind:[x,y], dikte, hoogte?, status }` — `start`/`eind` liggen op de **as** van de muur. `hoogte` overschrijft die van het niveau.

**opening** `{ id, muur, type: deur|raam, positie, breedte, hoogte, borstwering, status }` — `positie` = afstand langs de muuras vanaf `muur.start` tot de rand van de opening. `borstwering` = onderkant boven vloerpeil (deur: 0).
Regels: opening valt binnen de muurlengte en -hoogte; openingen in dezelfde muur overlappen niet (afbraak-openingen uitgezonderd).

**ruimte** `{ id, niveau, naam, functie, contour }` — `contour` = netto binnencontour. Functies: zie `FUNCTIES` in `js/model/schema.js`.

**vloer** `{ id, niveau, contour, dikte, status }` — bruto buitencontour.

**dak** `{ id, niveau, type: plat|lessenaar|zadel|schild, contour, helling, nokrichting?: x|y, overstek?, dikte?, status }` — rust op de bovenkant van `niveau` (peil + hoogte). Hellende daken worden berekend op de rechthoekige begrenzing van `contour`. `nokrichting` = richting van de nok (zadel/schild) of van de hoge rand (lessenaar; die ligt aan de max-zijde).

## Operaties

Alle wijzigingen lopen via `applyOps(model, ops)` (`js/model/operations.js`). Een lijst operaties wordt **atomair** toegepast en daarna gevalideerd; bij een fout blijft het model ongewijzigd.

```jsonc
{ "op": "toevoegen",   "collectie": "muren", "item": { "niveau": "N0", "start": [0, 9000], "eind": [0, 12000], "dikte": 300, "status": "nieuw" } }
{ "op": "wijzigen",    "collectie": "openingen", "id": "O2", "velden": { "breedte": 3200 } }   // null = optioneel veld wissen
{ "op": "verwijderen", "collectie": "muren", "id": "M6" }      // cascade: openingen van die muur; bij niveau: alles erop
{ "op": "verplaatsen", "collectie": "muren", "id": "M6", "dx": 500, "dy": 0 }  // opening: dx langs de muur; niveau: dx = peilverschil
{ "op": "ontwerp",     "velden": { "naam": "Variant B", "beschrijving": "…" } }
```

## Bewerkingen (hoog niveau)

`js/model/bewerkingen.js` (ook via `js/model/index.js`) vertaalt gebruikersacties naar **operatielijsten**; ze passen niets toe.
Vorm: `{ ops, fout?, info? }` — bij `fout` (Nederlandse melding) is `ops` leeg. Toepassen via `applyOps` / `Geschiedenis.toepassen`.
Volledige signaturen: `docs/FASE2.md` deel A. Afspraken:

- **Aansluitingen** = eindpunten van andere muren op hetzelfde niveau binnen ±1 mm. `opsMuurVerplaatsen` schuift die mee;
  **T-aansluitingen** (eindpunt van een andere muur op de as van de verschoven muur) volgen enkel de component loodrecht op die muur.
  `opsMuurEindpunt` / `opsMuurLengte` verplaatsen alleen samenvallende eindpunten (T-aansluitingen op een muur die draait of korter wordt, volgen niet).
- **Openingen** behouden hun afstand tot het eindpunt dat niet beweegt (alleen `start` verplaatst ⇒ `positie` schuift mee met de lengteverandering).
  Past een opening daarna niet meer ⇒ fout. Nieuwe opening: gecentreerd op de projectie, geklemd, `positie` op 10 mm.
- **Ruimtedetectie** (`ruimteContourBijPunt`): muren worden als rechthoeken (met `muurAansluiting`) op een raster gezet en vanaf het punt
  wordt een flood fill gedaan. Het raster is niet-uniform: lijnen op elke x/y van assen-evenwijdige muren ⇒ voor orthogonale plannen
  is de contour **exact** (binnenvlakken). Schuine muren ⇒ extra uniforme lijnen (25 mm, grover bij zeer grote plannen) en een
  vereenvoudigde (Douglas-Peucker) benadering. **Afbraakmuren tellen niet als wand** (je benoemt de nieuwe toestand); openingen tellen als dicht.
  Raakt de vulling de rand (1 m buiten de muren) of is ze > 2000 m² ⇒ `null`. Contour: tegenwijzerzin, afgerond op 1 mm.
- **Buitenmuren** (`buitenMuren`): niet-afbraakmuren waarvan een zijvlak grenst aan het gebied buiten alle muren (flood fill vanaf de rand).
  `buitenContour` = rand van alles wat niet "buiten" is (terugval: rechthoekige begrenzing als het plan open is).
- `opsNiveauToevoegen`: nieuw niveau op peil + hoogte van het niveau met het hoogste peil; gekopieerde muren zonder openingen en zonder eigen hoogte;
  vloer = `buitenContour` van het vorige bovenste niveau (`vloerdikte`, standaard 300); daken van dat niveau verhuizen mee.
- `opsDakInstellen`: wijzigt het eerste dak op het niveau (of optie `id`); anders nieuw dak op de rechthoekige begrenzing van de buitenzijde van de muren.

Snappen in de plattegrond: `js/ui/snap.js` (`snap`, `snapDelta`), prioriteit eindpunt > midden > muuras > uitlijning (x/y van bestaande eindpunten) > ortho > raster.

## Vanuit Claude Code

```bash
node tools/apply-ops.mjs voorbeeld ops.json                        # wijzig designs/voorbeeld.json
node tools/apply-ops.mjs voorbeeld ops.json --als variant-b --naam "Variant B"  # nieuwe variant
node tools/validate.mjs                                             # alle ontwerpen + index + prijzen
npm test
```
