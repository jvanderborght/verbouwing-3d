# Fase 2 — tekengereedschap, snapping, undo/redo

Doel: de gebruiker kan met muis én touch (telefoon/tablet) het model bewerken in de 2D-plattegrond:
muur tekenen/verplaatsen/verwijderen, opening toevoegen, ruimte benoemen, niveau toevoegen, dak wijzigen;
snappen op 50 mm en op bestaande muren; exacte maten in het eigenschappenpaneel. Alles via operaties → undo/redo.

Werkverdeling en vaste interfaces (agents houden zich hieraan; wijzigen enkel in overleg met de coördinator):

## A. `js/model/bewerkingen.js` — model-architect

Pure functies (geen DOM) die **operatielijsten** teruggeven (niet toepassen). Vorm: `{ ops: Op[], fout?: string, info?: object }`.
Bij `fout` is `ops` leeg. Toepassen gebeurt door de UI via `Geschiedenis.toepassen(ops)`.

| functie | betekenis |
|---|---|
| `opsMuurTekenen(model, { niveau, start, eind, dikte, status = 'nieuw', hoogte? })` | nieuwe muur (lengte ≥ 10 mm, anders fout) |
| `opsMuurVerplaatsen(model, id, dx, dy, { metAansluitingen = true })` | muur verschuiven; eindpunten van muren op hetzelfde niveau die samenvielen met de oude eindpunten (±1 mm) schuiven mee |
| `opsMuurEindpunt(model, id, 'start'\|'eind', punt, { metAansluitingen = true })` | één eindpunt verplaatsen (+ aansluitende eindpunten); openingen die niet meer passen ⇒ fout |
| `opsMuurLengte(model, id, lengte, { vast = 'start' })` | lengte instellen langs de huidige richting |
| `opsOpeningPlaatsen(model, muurId, punt, { type, breedte, hoogte, borstwering, status = 'nieuw' })` | opening gecentreerd op de projectie van `punt` op de muuras, geklemd binnen de muur; fout als ze niet past of overlapt; `positie` afgerond op 10 mm |
| `ruimteContourBijPunt(model, niveau, punt)` | netto contour (binnenzijde muren) van de ruimte rond `punt`, als orthogonale/vereenvoudigde polygoon, of `null` als het gebied niet gesloten is (bv. > 2000 m² of punt in een muur). Openingen tellen als dicht. Mag rastergebaseerd zijn (bv. 25–50 mm). |
| `opsRuimteBenoemen(model, niveau, punt, { naam, functie })` | bestaande ruimte op dat punt → `wijzigen` naam/functie; anders nieuwe ruimte met `ruimteContourBijPunt`; fout als niet gesloten |
| `opsRuimteRechthoek(model, niveau, p1, p2, { naam, functie })` | ruimte als rechthoek (terugval voor open gebieden) |
| `opsNiveauToevoegen(model, { naam, hoogte = 2700, kopieerMuren = 'buiten'\|'alle'\|'geen', verplaatsDaken = true, status = 'nieuw' })` | nieuw niveau bovenop het hoogste; kopieert muren (status `nieuw`, zonder openingen) + vloer (begrenzing buitenzijde muren); daken op het vorige bovenste niveau verhuizen mee naar het nieuwe |
| `opsDakInstellen(model, niveau, { type, helling, nokrichting = 'x', overstek = 300, status })` | bestaand dak op dat niveau wijzigen, of nieuw dak met contour = begrenzing buitenzijde muren van dat niveau |
| `buitenMuren(model, niveau)` | ids van muren die op de buitenrand liggen (voor `kopieerMuren: 'buiten'`) |

## B. `js/ui/snap.js` — model-architect (puur, getest)

`snap(punt, { model, niveau, raster = 50, tolerantie = 200, vanaf = null, ortho = true, negeer = [] })`
→ `{ punt, soort: 'eindpunt'|'midden'|'muur'|'ortho'|'raster'|'geen', doel?: id, hulplijnen?: [{van, naar}] }`

Prioriteit: eindpunt (van muren op `niveau`) > midden van muur > loodrecht op/langs muuras (projectie, positie langs de muur op raster) > ortho t.o.v. `vanaf` (hoek binnen 7° van 0/90/180/270 → uitlijnen; lengte op raster) > raster. `tolerantie` in mm (UI rekent px → mm met de zoomschaal). `negeer` = ids die niet meetellen (bv. de muur die versleept wordt).
Ook: `snapDelta(dx, dy, raster = 50)` voor verplaatsingen.

## C. Plattegrond-interactie — viewer-3d (`js/views/plan2d.js`, publieke interface uitbreiden, bestaande behouden)

- `zetModus('navigeren' | 'gereedschap')` — navigeren (standaard): slepen = pannen, tik = selectie (zoals nu). Gereedschap: één vinger/linkermuis gaat naar `opPointer`; pannen met twee vingers, middelste muisknop of spatie+slepen; wiel/knijpen = zoom (altijd).
- `opPointer(fn)` — `fn({ soort: 'neer'|'beweeg'|'op'|'tik'|'dubbeltik'|'annuleer', punt: [x, y] (mm, model), doel: id|null, pointerType, shift, ctrl, schaal })`.
  `doel` = element onder de aanwijzer (voorkeur opening > muur > ruimte) op het actieve niveau. `schaal` = px per mm. `beweeg` ook zonder ingedrukte knop (hover, muis). In navigeren-modus mag `opPointer` óók `neer/beweeg/op` krijgen wanneer het slepen start op het **geselecteerde** element (dan niet pannen) — zo kan de UI een geselecteerde muur verslepen. Gebruik daarvoor `zetSleepbaar(ids: string[])`.
- `toonHulp(hulp | null)` — overlay in modelcoördinaten, los van `render` (snel, geen herbouw): `{ lijnen: [{ van, naar, stijl: 'voorbeeld'|'hulplijn'|'maat' }], punten: [{ p, soort: 'snap'|'greep' }], labels: [{ p, tekst }], polygonen: [{ contour, stijl: 'voorbeeld'|'markering' }] }`. Labels en grepen op vaste schermgrootte. Voorbeeldlijn van een muur mag een dikte meekrijgen: `{ van, naar, stijl: 'voorbeeld', dikte }`.
- `schaal()` — huidige px per mm.
- `markeer(id | null)` — hover-markering.
- Grepen: bij een geselecteerde muur toont de UI zelf grepen via `toonHulp` (punten soort `greep`).

3D (`viewer3d.js`): geen interfacewijziging nodig in fase 2.

## D. UI — ui-toolbar (`js/ui/`, `index.html`, `css/`)

Taakbalk (desktop: verticale/horizontale balk; telefoon: onderaan, scrollbaar) met gereedschappen:
Selecteren · Muur · Deur · Raam · Ruimte · Verwijderen · Niveau + · Dak. Opties per gereedschap (dikte, status, breedte/hoogte/borstwering) in een kleine optiebalk, onthouden in localStorage.
- **Muur**: tik start, tik eind (keten loopt door vanaf eindpunt); Esc / dubbeltik / knop "Klaar" stopt. Live lengte-label; lengte intypen (veld in optiebalk) + Enter = muur in huidige richting.
- **Selecteren**: tik = selectie; geselecteerde muur verslepen (snapDelta) of eindpunt-grepen verslepen (snap); Delete/Backspace = verwijderen.
- **Deur/Raam**: tik op een muur → `opsOpeningPlaatsen`.
- **Ruimte**: tik in een gesloten gebied → dialoog naam + functie → `opsRuimteBenoemen`; niet gesloten ⇒ voorstel rechthoek tekenen.
- **Niveau +**: dialoog (naam, hoogte, muren kopiëren: buiten/alle/geen) → `opsNiveauToevoegen`.
- **Dak**: dialoog voor het actieve niveau (type, helling, nokrichting, overstek) → `opsDakInstellen`.
- **Eigenschappenpaneel**: punten (start/eind) bewerkbaar als x/y; muur toont ook bewerkbare lengte (→ `opsMuurLengte`) en hoek (info); contouren blijven alleen-lezen.
- Elke actie = één undo-stap. Ongeldige actie ⇒ melding, geen wijziging.
- 3D en 2D blijven gesynchroniseerd; na een wijziging blijft de camera staan.
