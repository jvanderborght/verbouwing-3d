# Datamodel (schemaVersie 2)

Eén JSON-object per variant, bestand `designs/<id>.json`. Code: `js/model/`.
Wijzigingen ten opzichte van versie 1: zie [Migratie](#migratie) en de secties gemarkeerd met **v2**.

## Conventies

- Alle maten in **mm**. Hoeken in graden.
- Oorsprong `[0, 0]` = linkerbenedenhoek gelijkvloers (buitenhoek links-voor). **x** → rechts (langs de straatgevel), **y** → naar achter (tuin), **z** → omhoog.
- Elk element heeft een `id`, uniek over het hele ontwerp. Voorvoegsels: `N` niveau, `M` muur, `O` opening, `R` ruimte, `V` vloer, `D` dak, `T` trap (v2), `I` inrichting (v2), `K` dakkapel (optioneel).
- `status` ∈ `bestaand` | `nieuw` | `afbraak` (kleur: grijs / blauw / rood transparant).

## Ontwerp

| veld | type | |
|---|---|---|
| `schemaVersie` | 2 | verplicht |
| `id` | `[a-z0-9-_]` | = bestandsnaam |
| `naam` | tekst | |
| `beschrijving` | tekst | optioneel |
| `basis` | id \| null | variant waarvan deze afgeleid is |
| `perceel` | `{ contour }` | optioneel; perceelgrens, x mag negatief zijn |
| `programma` | `{ eisen, beschrijving? }` | optioneel (v2); programma van eisen, zie [Programma van eisen](#programma-van-eisen-v2) |
| `idTeller` | `{ [voorvoegsel]: geheel getal ≥ 0 }` | optioneel (v2, geen nieuwe schemaVersie); hoogste ooit uitgedeelde nummer per id-voorvoegsel (`N`, `M`, `O`, `R`, `V`, `D`, `T`, `I`). Boekhouding van `applyOps`, zie [id's](#ids-worden-niet-hergebruikt) |
| `niveaus`, `muren`, `openingen`, `ruimtes`, `vloeren`, `daken`, `trappen`, `inrichting` | lijsten | `trappen`, `inrichting` sinds v2 (verplicht, mag leeg) |
| `dakkapellen` | lijst | **optioneel** (geen nieuwe schemaVersie): ontbreekt = leeg, zie [Dakkapellen](#dakkapellen-optionele-collectie) |

## Elementen

**niveau** `{ id, naam, peil, hoogte, vloerdikte?, soort? }` — `peil` = z van de afgewerkte vloer; `hoogte` = verdiepingshoogte (vloer tot vloer) = standaard muurhoogte.
`soort` (v2) ∈ `verdieping` | `zolder` | `kelder`, puur informatief (weergave, controles, programma). Een niveau zonder soort telt in het programma als `verdieping`.

**muur** `{ id, niveau, start:[x,y], eind:[x,y], dikte, hoogte?, status }` — `start`/`eind` liggen op de **as** van de muur. `hoogte` overschrijft die van het niveau.

**opening** `{ id, muur, type: deur|raam, positie, breedte, hoogte, borstwering, status }` — `positie` = afstand langs de muuras vanaf `muur.start` tot de rand van de opening. `borstwering` = onderkant boven vloerpeil (deur: 0).
Regels: opening valt binnen de muurlengte en -hoogte; openingen in dezelfde muur overlappen niet (afbraak-openingen uitgezonderd).

**ruimte** `{ id, niveau, naam, functie, contour, hoogtegrenzen? }` — `contour` = netto binnencontour. Functies: zie `FUNCTIES` in `js/model/schema.js`
(sanitair is géén functie maar `inrichting`). `hoogtegrenzen` (v2) = lijst vrije hoogtes in mm (> 0), bv. `[1500, 2200]`: de kerncijfers tonen dan
de oppervlakte per hoogteband `[0, 1500)`, `[1500, 2200)`, `[2200, ∞)`. **Welke grenzen officieel meetellen (en waarvoor) is na te gaan; de app rekent met wat de gebruiker invult.**

**vloer** `{ id, niveau, contour, dikte, status }` — bruto buitencontour. De vloeren van een niveau vormen ook zijn **begrenzing** (v2: trappen en inrichting moeten erbinnen liggen).

**dak** `{ id, niveau, type: plat|lessenaar|zadel|schild, contour, helling, nokrichting?: x|y, overstek?, dikte?, basisHoogte?, hogeZijde?: min|max, status }` — rust op de bovenkant van `niveau` (peil + hoogte). Hellende daken worden berekend op de rechthoekige begrenzing van `contour`. `nokrichting` = richting van de nok (zadel/schild) of van de hoge rand (lessenaar; standaard aan de max-zijde).
De onderkant van het dak volgt `rustvlak + dakHoogteIn(dak, x, y)`; de `dikte` ligt daarboven (zoals in de 3D-weergave).
Optioneel, zonder nieuwe schemaVersie (ontbreekt het veld, dan geldt het oude gedrag):
- `basisHoogte` (mm, ≥ 0, standaard 0; enkel hellende daken): de hele onderkant ligt zoveel hoger, dus aan de lage rand(en) `basisHoogte`
  boven het rustvlak — bv. een knieschot of verhoogde gevel. `dakHoogteIn` en `dakNokHoogte` tellen ze mee, `dakVolume` = grondvlak × basis + hellend deel.
- `hogeZijde` (enkel lessenaar, standaard `max`): aan welke zijde (loodrecht op `nokrichting`) de hoge rand ligt. `min` ⇒ hoge rand aan
  minY (nokrichting x) of minX (nokrichting y).

Validator: `basisHoogte` < 0 ⇒ fout; `basisHoogte` > 0 op een plat dak ⇒ waarschuwing (genegeerd); `hogeZijde` bij een ander type dan
lessenaar ⇒ waarschuwing (genegeerd). Alle afgeleiden gebruiken dezelfde functies (`js/model/geometry.js`): vrije hoogte, hoogtelijnen en
-banden (`hoogte.js`), muren onder het dak (`muurprofiel.js`), kerncijfers (volume via `dakVolume`; dakoppervlak = grondvlak / cos helling,
de basis verandert dat niet), 3D (`dakVlakken`, `dakGevels`).

**Gevelvullingen (3D)**: `dakGevels(dak)` geeft de vullingen tussen rustvlak en dak (kopse kanten; lessenaar: onder de hoge rand; met
`basisHoogte`: ook onder de lage rand(en)). `zichtbareDakGevels(model, dak)` (`js/model/dakgevels.js`, gebruikt door de 3D-weergave) laat
een vulling weg als (a) een ander hellend dak met hetzelfde rustvlak aan de overkant van die rand ligt (begrenzingsrand op dezelfde lijn,
≥ 50 % overlap; dat dak telt als het niet afbraak is, of als beide afbraak zijn) — bv. twee lessenaars die elkaar aan de nok raken — of
(b) muren (≠ afbraak) op een niveau met vloerpeil = rustvlak, evenwijdig en met de as binnen dikte/2 + 20 mm van het gevelvlak, samen
≥ 90 % van de gevellengte bedekken — bv. een verhoogde achtergevel of topgevel als muur op de zolder.
**Beperking**: `overstek` geldt rondom; bij daken die elkaar aan de nok raken moet ze 0 zijn (anders steken de dakplaten door).

**trap** (v2, voorvoegsel `T`)
`{ id, vanNiveau, naarNiveau, type: recht|kwart|halfdraai|spiraal, oorsprong:[x,y], richting, breedte, aantalTreden?, optrede?, aantrede?, draairichting?: links|rechts, diameter?, status }`
- `oorsprong` = midden van de voorrand van de onderste trede (recht/kwart/halfdraai) of het **middelpunt** (spiraal). `richting` = looprichting bij vertrek in graden (0 = +x, 90 = +y); spiraal: richting van de eerste trede.
- `aantalTreden` = aantal **optreden** n. In plan liggen n − 1 treden (de n-de is de vloer van `naarNiveau`). Leeg ⇒ n = afronding(hoogteverschil / doel-optrede); `optrede` leeg ⇒ hoogteverschil / n. `aantrede` leeg ⇒ werkwaarde.
- `draairichting` (kwart/halfdraai/spiraal, standaard `links` = tegenwijzerzin gezien van boven); `diameter` enkel spiraal (leeg ⇒ 2 × `breedte`).
- `kwart` = kwartdraai (L), `halfdraai` = U (180°), beide met draaitreden (zie [Trappen](#trappen-v2)).

**inrichting** (v2, voorvoegsel `I`) — sanitair en meubels als symbool
`{ id, niveau, ruimte?, soort, positie:[x,y], rotatie, breedte, diepte, hoogte?, status }`
- `soort` ∈ douche, lavabo, wc, bad, keuken, bed, kast, wasmachine, droogkast, bureau, tafel, zetel, overig (`INRICHTING_SOORTEN`).
- `positie` = **middelpunt**; `breedte` langs de lokale x-as, `diepte` langs de lokale y-as; `rotatie` 0 ⇒ breedte langs +x, rugzijde aan −y (voorzijde kijkt naar +y).
- `hoogte` (optioneel) wordt gebruikt voor de vrije-hoogtecontrole (bv. gebruikshoogte van een douche).

**dakkapel** (optioneel, voorvoegsel `K`) — zie [Dakkapellen](#dakkapellen-optionele-collectie)
`{ id, dak, zijde, positieX, positieZ, breedte, hoogte, type?: plat, diepte?, dakdikte?, zijwangDikte?, raam?: { breedte, hoogte, borstwering? }, status }`

## Operaties

Alle wijzigingen lopen via `applyOps(model, ops)` (`js/model/operations.js`). Een lijst operaties wordt **atomair** toegepast en daarna gevalideerd; bij een fout blijft het model ongewijzigd.

```jsonc
{ "op": "toevoegen",   "collectie": "muren", "item": { "niveau": "N0", "start": [0, 9000], "eind": [0, 12000], "dikte": 300, "status": "nieuw" } }
{ "op": "wijzigen",    "collectie": "openingen", "id": "O2", "velden": { "breedte": 3200 } }   // null = optioneel veld wissen
{ "op": "verwijderen", "collectie": "muren", "id": "M6" }      // cascade: zie hieronder
{ "op": "verplaatsen", "collectie": "muren", "id": "M6", "dx": 500, "dy": 0 }  // opening: dx langs de muur; niveau: dx = peilverschil
{ "op": "ontwerp",     "velden": { "naam": "Variant B", "beschrijving": "…" } }   // ook basis, perceel, programma (v2)
```

Cascade bij `verwijderen`: muur ⇒ haar openingen; niveau ⇒ alles erop (muren + openingen, ruimtes, vloeren, daken, inrichting) en de
trappen van of naar dat niveau (v2); ruimte ⇒ `inrichting.ruimte` wordt gewist (het element blijft) (v2); dak (ook via een niveau) ⇒ zijn dakkapellen.
`verplaatsen` werkt ook op trappen (`oorsprong`) en inrichting (`positie`); bij een dakkapel enkel de component langs de nok (`positieX`).

### Id's worden niet hergebruikt

Een id dat ooit uitgedeeld werd, komt niet terug (anders toont een diff "R15 gewijzigd" waar een garage verdween en een badkamer
bijkwam). `volgendId(model, collectie)` = voorvoegsel + (max(`idTeller[voorvoegsel]`, hoogste bestaande nummer) + 1). `applyOps` werkt
`idTeller` bij:
- `verwijderen`: altijd, voor elk verdwenen id (ook de cascade: openingen van een muur, alles op een niveau);
- `toevoegen`: enkel als er voor dat voorvoegsel al een teller is (anders volstaan de bestaande id's en blijft het veld weg — geen ruis
  in ontwerpen zonder verwijderingen).

De bewerkingen (`js/model/bewerkingen.js`) en de macro's van het promptveld delen id's uit met dezelfde regel. `idTeller` kan niet via
de operatie `ontwerp` gewijzigd worden en `diff`/`beschrijfDiff` negeren het. Geen migratie nodig: ontbreekt het veld, dan gelden de
bestaande id's. Validator: object met enkel gekende voorvoegsels en gehele getallen ≥ 0 (anders fout).

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
  **v2 — niveau onder een dak**: rusten er hellende daken (status ≠ afbraak) op het vloerpeil van het niveau én heeft het `soort: 'zolder'`
  of omsluiten zijn muren niets, dan is er geen gesloten gevel en zou de flood fill alles bereiken. Dan is een wand enkel een buitenmuur
  als hij op de buitenrand van de dakvoetafdruk ligt (unie van de dakcontouren zonder overstek; een punt 50 mm voorbij een zijvlak ligt
  buiten die unie) — bv. een topgevel. Knieschotten en scheidingswanden op de zolder zijn binnenwanden.
  `buitenContour` = rand van alles wat niet "buiten" is (terugval: rechthoekige begrenzing als het plan open is).
- `opsNiveauToevoegen`: nieuw niveau op peil + hoogte van het niveau met het hoogste peil; gekopieerde muren zonder openingen en zonder eigen hoogte;
  vloer = `buitenContour` van het vorige bovenste niveau (`vloerdikte`, standaard 300); daken van dat niveau verhuizen mee.
- `opsDakInstellen`: wijzigt het eerste dak op het niveau (of optie `id`); anders nieuw dak op de rechthoekige begrenzing van de buitenzijde van de muren.

Snappen in de plattegrond: `js/ui/snap.js` (`snap`, `snapDelta`), prioriteit eindpunt > midden > muuras > uitlijning (x/y van bestaande eindpunten) > ortho > raster.


### Bewerkingen fase 5 (v2)

- `opsMuurSplitsen(model, id, positie | [x, y])` — knipt een muur; het eerste stuk houdt het id, openingen verhuizen mee;
  een opening over de knip ⇒ fout. `info.ids`.
- `opsAfbraakZone(model, { ids } | { ruimte } | { niveau, punt })` — een gebouwdeel afbreken. **Regel:**
  - `ids`: precies die elementen (muur ⇒ ook haar openingen; niveau-id ⇒ alles erop). Ruimtes worden **verwijderd** (een ruimte beschrijft
    de nieuwe toestand en heeft geen status).
  - zone (ruimte-id's of de ruimte onder `punt`): per muur wordt langs beide zijvlakken (100 mm voorbij het vlak) gekeken waaraan ze grenst.
    Een muurstuk wordt **afbraak** als een zijde aan een zoneruimte grenst en **geen** zijde aan een blijvende ruimte. **Gedeelde muren**
    (ook aan een blijvende ruimte, bv. de oude achtergevel of de scheidingsmuur tussen twee garages) **blijven `bestaand`** en komen in
    `info.randMuren` (mogelijk dragend; worden mogelijk buitengevel — signaal voor de ingenieur). Stukken ter hoogte van een kruisende muur
    of zonder ruimte ernaast volgen hun buren; muren die deels in de zone liggen worden gesplitst op de as van de kruisende muur.
  - openingen in afgebroken stukken ⇒ afbraak; zoneruimtes ⇒ verwijderd; trappen (vanNiveau) en inrichting in de zone ⇒ afbraak.
  - vloeren/daken van het niveau binnen de zonebegrenzing (rechthoek rond zoneruimtes + afgebroken muurstukken) ⇒ afbraak; rechthoekige
    vloeren en **platte** daken die er deels in liggen met een strook aan één zijde ⇒ gesplitst (blijvend deel houdt het id); anders en
    elementen op andere niveaus ⇒ melding in `info.meldingen`, niet aangepast.
  - elementen met status `nieuw` worden verwijderd i.p.v. op afbraak gezet. `info`: `{ niveau, ruimtes, afbraak, verwijderd, gesplitst, randMuren, meldingen }`.
- `opsTrapPlaatsen(model, { van, naar, type, oorsprong, richting, breedte, aantalTreden?, optrede?, aantrede?, draairichting?, diameter?, status?, instellingen? })` —
  fout als de voetafdruk buiten de vloer(en) van een van beide niveaus valt, botst met een muur op een van beide niveaus, of (enkel als
  ingesteld) de loophoogte te laag is. `info`: `{ id, maten, voetafdruk, trapgat, loophoogte }`.
- `opsInrichtingPlaatsen(model, { soort, ruimte?, niveau?, positie?, rotatie?, breedte?, diepte?, hoogte?, status?, instellingen? })` — maten
  standaard uit de instellingen (werkwaarden). Zonder `positie`: eerste plek (stap 50 mm, randen van de contour in volgorde) met de rugzijde
  tegen een rand, volledig in de ruimte, zonder overlap met andere inrichting en met vrije hoogte ≥ `hoogte` (als gekend).
- `opsZolderNiveau(model, { onderNiveau, naam = 'Zolder', vloerdikte?, status = 'nieuw' })` — niveau `soort: zolder` op peil = bovenkant
  van onderNiveau, hoogte = hoogste nokhoogte van de hellende daken op onderNiveau, per hellend dak een vloer met de dakcontour. De daken
  blijven op onderNiveau rusten. Fout als er al een niveau boven ligt of als er geen hellend dak is.
- `toetsProgramma` — zie [Programma van eisen](#programma-van-eisen-v2) (geeft geen ops).

Kerncijfers (v2, `js/metrics/kerncijfers.js`): `ruimtes` (per ruimte met `hoogtegrenzen`: banden), `hoogtebanden` (som per band),
`trappen` (aantal per status), `inrichting` (aantal per soort). Een **zolderniveau** krijgt als volume het volume van de hellende daken die
op zijn peil rusten (die tellen dan niet nog eens bij `volume.daken`). De vergelijkingstabel krijgt rijen per hoogteband, trappen en inrichtingssoort.
Geen nieuwe prijsposten.
**Muur-m²** (`muren.nieuwBuiten/nieuwBinnen/afbraak`): bruto = zijvlak afgeknipt onder de daken erboven (`muurOppervlakteOnderDak`,
gemiddelde van beide zijvlakken, `js/model/muurprofiel.js` — dezelfde geometrie als de 3D-weergave), min de openingen. Zonder dak dat
lager komt dan de muurhoogte: lengte × hoogte zoals voorheen.

## Dakkapellen (optionele collectie)

Code: `js/model/dakkapellen.js` (geometrie), `js/model/dakkapel-regels.js` (validatie), `js/model/dakkapel-bewerkingen.js` (bewerking).
Tests: `tests/dakkapellen.test.js` (handmatig nagerekend op een zadeldak van 45°).

**Waarom geen schemaVersie 3?** De collectie is optioneel: een ontwerp zonder `dakkapellen` is geldig en betekent "geen dakkapellen".
Oude bestanden hoeven dus niet gemigreerd te worden en blijven byte-identiek (ook de v1-synchronisatie van werkkopieën blijft werken);
`applyOps` maakt de lijst aan bij de eerste `toevoegen`. Een oudere app die een ontwerp mét dakkapellen laadt, meldt "onbekend veld"
(waarschuwing) en toont ze niet — aanvaardbaar voor een schetstool.

| veld | betekenis |
|---|---|
| `dak` | hellend dak (`zadel`, `lessenaar`, `schild`) |
| `zijde` | welk dakvlak: nokrichting `x` ⇒ `voor` (goot aan min y) / `achter`; nokrichting `y` ⇒ `links` (goot aan min x) / `rechts`. Een zadeldak heeft twee dakvlakken, dus het dak alleen volstaat niet. Lessenaar: enkel de lage zijde (`voor`/`links`). |
| `positieX` | coördinaat van het **midden** langs de nok (x bij nokrichting x, y bij nokrichting y), in het assenstelsel van het ontwerp. Midden i.p.v. linkerrand: breedte wijzigen houdt de dakkapel gecentreerd in haar kamer. |
| `positieZ` | **onderkant van het voorvlak boven de zoldervloer** = het vloerpeil van het laagste niveau tussen het rustvlak van het dak en de nok (de zolder); zonder zo'n niveau het rustvlak (waarschuwing). Het voorvlak (buitenvlak) staat waar de onderkant van het hoofddak die hoogte heeft. `0` = voorvlak op de goot (in het gevelvlak). |
| `breedte` | buitenmaat langs de nok, zijwangen inbegrepen |
| `hoogte` | voorvlak van zijn onderkant (op het dakvlak) tot de onderkant van het platte dakje ⇒ **vrije hoogte onder de dakkapel = positieZ + hoogte** |
| `type` | voorlopig enkel `plat` (leeg = plat); uitbreidbaar met andere dakjes |
| `diepte` | horizontaal vanaf het voorvlak. Leeg ⇒ tot waar het dakje het hoofddak snijdt. Korter ⇒ achterwand. Langer ⇒ fout. |
| `dakdikte`, `zijwangDikte` | leeg ⇒ werkwaarden `dakkapel.dakdikte` (200) en `dakkapel.zijwangDikte` (120) — weergave/binnenmaat, geen norm |
| `raam` | `{ breedte, hoogte, borstwering? }`, gecentreerd in het voorvlak; `borstwering` = onderkant boven de zoldervloer (zoals bij openingen), leeg ⇒ onderaan het voorvlak. Eén raam als veld i.p.v. een opening op een afgeleide muur: eenvoudigst te bewerken; uitbreidbaar naar `ramen: [...]`. |

**Afgeleide geometrie** (`dakkapelGeometrie(model, k)`): lokaal assenstelsel van het dakvlak (u langs de nok, d = horizontale afstand
vanaf de goot); h(d) = onderkant hoofddak boven het rustvlak via `dakHoogteIn` (de nok wordt numeriek gezocht, dus ook bij een nok
buiten het midden). Voorvlak op d waar h = positieZ + peil − rust; dakje op plafond = peil + positieZ + hoogte; diepte tot h = plafond − rust.
Resultaat: `voetafdruk` (buitenmaat, plan), `binnen` (zone met verhoogd plafond: minus zijwangen en voorvlak, en achterwand),
`uitsparing` (rechthoek in het hoofddak), `raam`, `voorvlakM2` (breedte × hoogte, bruto), `raamM2`, `volume` (toename boven de onderkant
van het hoofddak, buitenbreedte × ∫(plafond − h) dd).

**Vrije hoogte**: binnen `binnen` is de bovengrens van dat dak max(hoofddak, plafond) (`dakkapelVerhoging`, gebruikt door
`js/model/hoogte.js` en `js/model/muurprofiel.js`). Hoogtelijnen, hoogtebanden en muurbovenkanten (zolderwanden onder een dakkapel)
volgen dus mee.

**Validatie** (fouten): verwijzing en zijde passen bij het dak; breedte, hoogte > 0; past langs de nok binnen het dak; voorvlak niet
voorbij de goot (positieZ ≥ hoogte van de goot); dakje niet boven de nok (melding noemt de maximale hoogte); niet over een hoekkeper
(het dakvlak moet over de hele breedte gelijk zijn); `diepte` niet langer dan afgeleid; raam binnen het voorvlak; geen overlap met
een andere dakkapel (≠ afbraak) in hetzelfde dakvlak. Waarschuwingen: dakkapel in een af te breken dak; geen zolderniveau in het dak.

**Bewerking** `opsDakkapelPlaatsen(model, { dak, zijde?, positieX?, positieZ?, punt?, breedte?, hoogte?, diepte?, dakdikte?, zijwangDikte?,
raam?, type?, status = 'nieuw' })` — met `punt` (tikpunt): zijde = helft van het dak waarin het punt ligt, positieX = het punt, positieZ =
hoogte van het dak in het punt (het voorvlak komt op het tikpunt). Ontbrekende breedte/hoogte/positieZ ⇒ werkwaarden
`dakkapel.voorstelBreedte` (2000), `voorstelHoogte` (1400), `voorstelPositieZ` (800), vermeld in `info.standaard`. Fout als ze niet past
of overlapt. `info`: `{ id, dVoor, diepte, plafond, vrijeHoogte, niveau, standaard }`.

**Kerncijfers**: `dakkapellen: { aantal, bestaand, nieuw, afbraak, voorvlakM2, raamM2, volume }` (sommen over status ≠ afbraak); het
volume telt bij het zolderniveau in dat dak (anders bij `volume.daken`). Vergelijkingstabel: rijen "Dakkapellen" (aantal, voorvlak,
raam, volumetoename) zodra een variant er heeft. Geen prijsposten (nog geen prijzen voor dakkapellen).

**Weergave**: 3D — voorvlak met raam (kader + glas), zijwangen (onderrand volgt het dakvlak), plat dakje, eventueel achterwand; het
hoofddak krijgt een uitsparing (dakvlak min rechthoek, `vlakkenMetUitsparingen`). 2D — op de zolder: gestreepte contour (boven het
snijvlak), voorvlak, zijwangen, label en breedtemaat aan de gootzijde; selecteerbaar. Eigenschappen: Positie x, Positie z (onderkant
boven zoldervloer), Breedte, Hoogte, raam (B/H/borstwering), afgeleide maten; bij een hellend dak knoppen "Dakkapel voor/achter"
(midden van het dakvlak of de dichtste vrije plek). Promptveld: macro `dakkapelPlaatsen`.

**Beperkingen**: enkel plat dakje; geen dakramen (vlakke ramen in het dakvlak); het raam is altijd gecentreerd; de dakkapel moet in één
dakvlak blijven (geen dakkapel over een kil of hoekkeper); geen constructie (kepers, raveelwerk) — stabiliteit blijft voor de ingenieur.

## Instellingen — geen normen in de code (v2)

`js/model/instellingen.js` (`INSTELLINGEN_STANDAARD`, `metInstellingen(gedeeltelijk)`, `instelling(inst, 'groep.naam')`). Twee soorten:

| soort | betekenis | standaard |
|---|---|---|
| **grens** | regel waartegen getoetst wordt: `trap.minOptrede`, `maxOptrede`, `minAantrede`, `maxAantrede`, `minBreedte`, `minLoophoogte` | `waarde: null`, `bron: null` ⇒ **niet getoetst**. Vult de gebruiker een grens in, dan hoort er een `bron` bij. Overschrijding = waarschuwing (validator), "voldoet niet" (programmatoets), fout in `opsTrapPlaatsen` (enkel loophoogte). |
| **werkwaarde** | vertrekwaarde die technisch nodig is om iets te berekenen; **geen norm**, de validator geeft er nooit een melding op | `dakkapel.zijwangDikte` 120, `dakkapel.dakdikte` 200, `dakkapel.voorstelBreedte/voorstelHoogte/voorstelPositieZ` 2000/1400/800 (vertrekmaten om een dakkapel te plaatsen), `trap.doelOptrede` 180 mm (enkel om een aantal treden voor te stellen), `trap.aantrede` 250 mm (voetafdruk als de trap geen aantrede heeft), `trap.draaitredenPerKwart` 3 (1 = bordes), `hoogte.hoogtelijnen` [1500, 2200] (voorbeeldwaarden CONCEPT §3.1), `hoogte.rasterStap` 25 mm, `inrichting.<soort>` breedte × diepte (vertrekmaat om een symbool te plaatsen) |

Functies die rekenen aanvaarden een optie `{ instellingen }` (gedeeltelijk object). `validate(model, { instellingen })` idem;
`applyOps` valideert met de standaard (dus zonder grenzen).

## Trappen (v2)

`js/model/trappen.js`: `trapMaten(model, trap)`, `trapGeometrie(model, trap)` → `{ maten, voetafdruk, looplijn, treden: [{ nummer, contour, z }] }`,
`trapVoetafdruk(trap, { model })`, `trapgat(model, trap)` → `{ niveau: naarNiveau, contour }`. Lokaal assenstelsel: u = `richting`, v = links (rechts gespiegeld).

| type | voetafdruk (vereenvoudigd) |
|---|---|
| recht | rechthoek `breedte` × (n − 1)·aantrede |
| kwart | L: vlucht 1 + hoekvierkant `breedte` × `breedte` met k draaitreden (waaier vanuit de binnenhoek) + vlucht 2 haaks. k = `trap.draaitredenPerKwart`; de overige n − 1 − k treden worden verdeeld (vlucht 1 krijgt de extra trede) |
| halfdraai | U: vlucht 1 + draaizone (2·`breedte` × `breedte`) met 2k draaitreden + vlucht 2 evenwijdig terug, naast vlucht 1 (geen trapoog) |
| spiraal | cirkel met `diameter` (48-hoek); treden = sectoren met hoek aantrede / (R/2) (looplijn op halve straal) |

**Niet uit te drukken** (gebleken bij het 3D-model van de bestaande woning, zie `docs/BESTAAND.md`): een trap met twee kwartdraaien
en een tussenvlucht (U met ongelijke vluchten of een rechte vlucht tussen de draaien), een bordes in de ene draai en draaitreden in de
andere, en een vluchtverdeling anders dan "vlucht 1 krijgt de extra trede". Zulke trappen worden benaderd met het best passende type.

**Vereenvoudigingen:** het **trapgat = de volledige voetafdruk** in de vloer van `naarNiveau` (in werkelijkheid hoeft het enkel zo groot
te zijn als nodig voor de loophoogte); draaitreden zijn een gelijke verdeling van de buitenrand, niet volgens een verzwaaimethode;
geen trapboom- of spildikte. Loophoogte (`trapLoophoogte`, `js/model/hoogte.js`) = per trede de vrije hoogte boven het zwaartepunt van de trede.

## Vrije hoogte, hoogtelijnen, hoogtebanden (v2)

`js/model/hoogte.js`:
- `vrijeHoogte(model, niveau, [x, y])` = laagste bovengrens − peil van het niveau (≥ 0). Bovengrenzen: onderkant van de vloer van elk
  **hoger** niveau dat in dat punt een vloer heeft (behalve in het trapgat van een trap naar dat niveau; een hoger niveau zonder vloeren telt
  als volledig) en onderkant van elk dak (status ≠ afbraak) dat rust op een niveau met bovenkant ≥ peil, binnen de rechthoekige begrenzing
  van het dak: `rustvlak + dakHoogteIn`. Niets erboven ⇒ verdiepingshoogte.
- `hoogtelijnen(model, niveau, [h…])` → per h `{ hoogte, lijnen, gebieden }`: lijnen waar de vrije hoogte = h (marching squares; exact voor
  vlakke dakvlakken) en gebieden waar ze ≥ h (celcontour, trapjes van één rasterstap), binnen de vloeren van het niveau.
- `oppervlaktePerHoogteband(model, ruimte, grenzen?)` → `{ banden: [{ van, tot, m2 }], m2 }`; raster (cellen betegelen de begrenzing van de
  ruimte exact), daarna geschaald zodat de som = netto-oppervlakte. Nauwkeurigheid ± een halve rasterstap × lengte van de bandgrens.

## Validatie (v2)

| regel | ernst |
|---|---|
| `naarNiveau` ≠ `vanNiveau` en ligt erboven (peil) | fout |
| trapgeometrie mogelijk (genoeg treden voor de draaitreden; `aantalTreden` geheel ≥ 2) | fout |
| voetafdruk binnen de vloer(en) van beide niveaus (niveau zonder vloeren: niet getoetst; tolerantie 2 mm) | fout |
| `aantalTreden × optrede` ≠ hoogteverschil (± 5 mm) | waarschuwing |
| ingestelde trapgrenzen (instellingen) overschreden | waarschuwing |
| trap overlapt een (niet-afbraak)muur op van- of naarNiveau | waarschuwing |
| inrichting binnen de vloer(en) van zijn niveau | fout |
| `inrichting.ruimte` ligt op hetzelfde niveau | fout |
| inrichting (deels) buiten zijn ruimte | waarschuwing |
| inrichting met `hoogte` waar de vrije hoogte lager is (min over hoeken, randmiddens, zwaartepunt) | waarschuwing |
| `hoogtegrenzen` = lijst getallen > 0 | fout |
| programma: structuur, geldige functies / inrichtingssoorten / traptypes | fout; onbekende velden: waarschuwing |

## Programma van eisen (v2)

```jsonc
"programma": { "beschrijving": "…", "eisen": [
  { "functie": "slaapkamer", "aantal": 2, "niveau": "zolder", "minOppervlakte": null },          // niveau = id of soort
  { "functie": "badkamer", "niveau": "zolder", "inrichting": ["lavabo", "douche"] },
  { "functie": "slaapkamer", "minOppervlakte": 9, "hoogteGrens": 2200 },                      // enkel m² met vrije hoogte ≥ 2200 tellen
  { "trap": { "van": "N1", "naar": "zolder", "type": ["kwart", "halfdraai", "spiraal"] } } ] }
```
`toetsProgramma(model, programma = model.programma, { instellingen })` (`js/model/programma.js`) →
`{ resultaten: [{ index, label, status, uitleg, ruimtes? | trappen? }], samenvatting }`, status ∈ `voldoet` | `voldoet niet` | `onbekend`.
- Ruimte-eis: ruimtes met die functie (op dat niveau/soort) die aan alle criteria voldoen; minstens `aantal` (standaard 1) ⇒ voldoet.
  `minOppervlakte` leeg ⇒ niet getoetst (vermeld in de uitleg). Inrichting hoort bij een ruimte via `ruimte`, of (zonder `ruimte`) met het
  middelpunt in de contour; een element met `hoogte` op een te lage plek telt niet. Elke eis telt onafhankelijk (twee eisen met dezelfde
  functie kunnen dezelfde ruimte tellen).
- Trap-eis: trappen (≠ afbraak) met passende van/naar en type; ingestelde trapgrenzen en loophoogte tellen mee (standaard geen).
- `onbekend`: eis ongeldig (bv. onbekende functie) of niveauverwijzing bestaat niet.

## Migratie

`migreer(model)` (`js/model/migrate.js`) migreert stap voor stap naar de huidige versie; pure functies (origineel ongewijzigd). Wordt
toegepast bij elk laden: app (`leesOntwerpTekst`: designs, werkkopieën in localStorage, imports), `tools/validate.mjs`, `tools/apply-ops.mjs`.
Opslaan gebeurt altijd in de nieuwste versie. Een nieuwere versie dan de app kent ⇒ fout.

| van → naar | wat |
|---|---|
| 1 → 2 (`v1naarV2`) | `schemaVersie: 2`; lege `trappen` en `inrichting` als ze ontbreken. Geen verplichte velden bij; bestaande ruimtes met functie `trap` blijven. Niets gaat verloren. |

Synchronisatie van oude werkkopieën (`js/ui/varianten.js`, `alsV1`/`normaliseerBasis`): een v1-werkkopie bewaart de hash van het
v1-bestand als basis. Het v2-bestand op GitHub wordt als "dezelfde basis" herkend als het, zonder de informatieve v2-velden, het v1-bestand
is: weggelaten worden lege `trappen`/`inrichting`, `niveaus[].soort === 'verdieping'` (gelijkwaardig aan geen soort) en `idTeller`.
Echte v2-inhoud (trappen, inrichting, soort zolder/kelder, hoogtegrenzen, programma) telt wel ⇒ dan blijft het een conflict.
`soort: 'verdieping'` blijft daarom in `designs/bestaand.json` en `voorbeeld.json` staan (de UI gebruikt het).

## Vanuit Claude Code

```bash
node tools/apply-ops.mjs voorbeeld ops.json                        # wijzig designs/voorbeeld.json
node tools/apply-ops.mjs voorbeeld ops.json --als variant-b --naam "Variant B"  # nieuwe variant
node tools/validate.mjs                                             # alle ontwerpen + index + prijzen (migreert eerst)
npm test
```

Een ops-bestand is een lijst operaties, één operatie, of `{ "ops": [...], "_uitleg": "…", "basis": "<ontwerp-id>" }`.
Beide tools migreren het ontwerp eerst naar de huidige schemaVersie.

**Demonstratie** (fase 5): `tools/voorbeelden/zolder-programma.ops.json` — afbraak achterbouw + garage 2, (bestaande) zolder, halfdraaitrap
van de verdieping naar de zolder in de slaapkamer links-achter, 2 slaapkamers, berging, badkamer met lavabo en douche, programma van eisen.
Gegenereerd met de bewerkingen door `node tools/voorbeelden/maak-zolder-programma.mjs`; getest in `tests/fase5.test.js`. Het is **geen
ontwerp** (staat niet in `designs/`); de maten zijn een plausibel voorstel.

**Variant** `designs/zolder-programma-trap-hal.json` ("Zolder volgens programma — trap in bestaande traphal"), gegenereerd door
`node tools/voorbeelden/maak-zolder-trap-hal.mjs`: zelfde programma, maar met de trap naar de zolder die de gebruiker tekende (3D-model,
vereenvoudigd tot een halfdraaitrap) in de bestaande traphal, zonder een slaapkamer op te offeren. Getest in `tests/bestaand-ifc.test.js`.

Tests van de app-logica (bewerkingen, promptveld, weergave, UI) gebruiken een **vaste** kopie van de bestaande toestand en de demonstratie
zoals bij fase 5 (`tests/fixtures/bestaand-fase5.json`, `tests/fixtures/zolder-programma-fase5.ops.json`), zodat nieuwe opmetingen in
`designs/bestaand.json` die tests niet breken. Tests over de ontwerpen zelf lezen `designs/`.

**Concept asymmetrisch dak**: `designs/concept-asymmetrisch-dak.json`, gegenereerd door `node tools/voorbeelden/maak-concept-asym-dak.mjs`
uit `designs/bestaand.json` (opnieuw draaien als bestaand.json wijzigt). Bestaand zadeldak ⇒ voordakvlak blijft (lessenaar, bestaand;
verlengd tot de nieuwe nok met een nieuw stuk met `basisHoogte`), oud achterdakvlak = afbraak-lessenaar (`hogeZijde: min`), nieuw
achterdak = lessenaar 28,5° met `hogeZijde: min` en `basisHoogte` (knieschot) op een verhoogde achtergevel (muur op de zolder).
De nok ligt waar de onderkanten van beide dakvlakken elkaar snijden.

**Variant met dakkapellen**: `designs/zolder-dakkapellen.json` wordt gegenereerd door
`node tools/voorbeelden/maak-zolder-dakkapellen.mjs [--rapport]` vanuit `designs/bestaand.json` (robuust: elementen worden op naam en
geometrie gezocht). Draai het opnieuw na een wijziging aan `bestaand.json`. Bronnen en aannames staan in de kop van het script.

**Demonstratie** (fase 5): `tools/voorbeelden/zolder-programma.ops.json` — afbraak achterbouw + garage 2, zolder, halfdraaitrap van de
verdieping naar de zolder, 2 slaapkamers, berging, badkamer met lavabo en douche, programma van eisen. Gegenereerd met de bewerkingen door
`node tools/voorbeelden/maak-zolder-programma.mjs`; getest in `tests/fase5.test.js`. Het is **geen ontwerp** (staat niet in `designs/`);
de maten zijn een plausibel voorstel.
