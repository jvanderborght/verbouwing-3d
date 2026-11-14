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

## Vanuit Claude Code

```bash
node tools/apply-ops.mjs voorbeeld ops.json                        # wijzig designs/voorbeeld.json
node tools/apply-ops.mjs voorbeeld ops.json --als variant-b --naam "Variant B"  # nieuwe variant
node tools/validate.mjs                                             # alle ontwerpen + index + prijzen
npm test
```
