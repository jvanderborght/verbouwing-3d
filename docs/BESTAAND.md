# Bestaande toestand

Ontwerp: `designs/bestaand.json`, gegenereerd door `node tools/maak-bestaand.mjs`.
Pas maten aan in het script en draai het opnieuw; daarna `npm test` (`tests/bestaand.test.js` en `tests/bestaand-ifc.test.js`
controleren het resultaat). Daarna ook de afgeleide ontwerpen/voorbeelden opnieuw genereren:
`node tools/voorbeelden/maak-zolder-programma.mjs` en `node tools/voorbeelden/maak-zolder-trap-hal.mjs`.
Tests van de app-logica gebruiken een vaste kopie van de fase-5-toestand (`tests/fixtures/`), los van dit ontwerp.

**Bron van de plattegrond:** het bestaande plan (DXF, kader "origineel", getekend in **cm**; 1 tekeneenheid = 1 cm,
bevestigd door de maatlijnen met stijl "schaal_1-50", o.a. de totale diepte 1250). Het DXF-bestand zelf en renders ervan
staan **niet** in de repo (CLAUDE.md regel 8); enkel de afgelezen maten.

**Bron van de hoogtes, de bestaande trap en het dak:** een 3D-model van de gebruiker (SketchUp), aangeleverd als
**IFC** (IFC4, mm; enkel de traphal: linker strook van het hoofdvolume, gelijkvloers t.e.m. zoldervloer, met de bestaande trap
en een nieuw getekende trap naar de zolder) en als **STEP** van dezelfde file (met het dak). Ook die bestanden en renders ervan
staan **niet** in de repo; enkel de afgelezen maten (zie "Uit het 3D-model").
Wat noch in het plan noch in het 3D-model staat, blijft een foto-schatting of aanname (zie onder).

## Assenstelsel

Het kader "origineel" bevat een plattegrond gelijkvloers en verdieping, elk 700 × 1250 cm, en de garages.
Lokale oorsprong = buitenhoek links-voor van de woning (voorgevel = straatkant met voordeur, y = 0), x naar rechts, y naar achter.
Dat valt samen met de app-conventie; omrekening mm = cm × 10. In het script staan alle plan-maten in cm (`mm()` rekent om).

## Uit het plan (exact afgelezen, cm)

| element | maat | opmerking |
|---|---|---|
| Woning buitenwerks | 700 × 1250 | breedte = gegeven 7 m ✓ |
| Hoofdvolume (2 bouwlagen) | 0 … 800 diep | op de verdieping is y 800…1250 enkel een contour (= dak achterbouw) |
| Achterbouw (1 bouwlaag) | 800 … 1250 | |
| Buitenmuren | 28 (9 gevelsteen + 5 spouw + 14 binnenblad) | lijnen op 0/9/14/28 |
| Rechter zijgevel | 14 (686 … 700), **geen openingen** | over de volle diepte |
| Oude achtergevel | y 772 … 800 (28) | loopt door op gelijkvloers; is de achtergevel van de verdieping |
| Dragende binnenmuur | x 272 … 286 (14) | gelijkvloers enkel y 28 … 482; daarachter een **balk** (gestippeld, x 258 … 286) met penant 256 … 286 × 760 … 772; verdieping over de volle diepte |
| Balk dwars in de leefruimte | y 361 … 370, x 286 … 686 (gestippeld) | op de verdieping is dat een wand (9) tussen twee slaapkamers |
| Muur achterbouw | x 258 … 286 (28, opgebouwd als spouwmuur 14 + 5 + 9) | y 800 … 1250 |
| Binnenwanden gelijkvloers | wc/inkom x 101 … 110 (9); inkom/hal y 178 … 187 (9); hal/leefruimte y 468 … 482 (14); kast onder de trap x 101 … 110, y 366 … 468; berging y 1115 … 1124 (9) | |
| Binnenwanden verdieping | badkamer y 268 … 277 (9); overloop y 468 … 482 (14); slaapkamers rechts y 361 … 370 (9) | |

**Openingen** (binnendagmaat = buitenkant van het raamkader; de buitendagmaat in de gevelsteen is telkens 5 cm smaller per kant):

| niveau | gevel | openingen (cm, langs x of y) |
|---|---|---|
| GV | voorgevel | raam 40 … 80 · voordeur 110 … 196 (scharnier 118, blad 78) · zijlicht 196 … 260 · raam 345 … 645 |
| GV | linker zijgevel | 192 … 252 · 380 … 440 · 560 … 710 · 883 … 1028 |
| GV | achtergevel | raam 116 … 176 · achterdeur 286 … 369 · schuifraam 369 … 686 |
| GV | binnen | doorgang (zonder deur) inkom→hal 130 … 252 · wc-deur 110 … 173 (63) · kastdeur 390 … 463 · deur hal→leefruimte 180 … 253 · doorgang oude achtergevel 355 … 473 · deur keuken→kamer achterbouw y 810 … 893 · bergingsdeur 165 … 248 |
| VD | voorgevel | 40 … 260 · 345 … 645 |
| VD | linker zijgevel | 380 … 440 · 560 … 710 |
| VD | achtergevel (y 772 … 800) | 346 … 626 |
| VD | binnen | 2 deuren in de binnenmuur y 283 … 356 en 379,5 … 452,5 · badkamer en overloop telkens x 180 … 253 |

**Garages** (in hetzelfde kader, zelfde schaal, positie t.o.v. de woning zoals getekend):
garage 1 buitenwerks x −801 … −306, y 1360 … 2140, muren 26, poort 245 breed (x −676 … −431), scheidingswand (9) op y ≈ 1910
zonder getekende deur, deur achteraan (x −486 … −391). Garage 2 ertegenaan x −306 … 44, y 1540 … 2140, poort 245 breed,
rechter- en achterwand 8 cm.

## Uit het 3D-model (IFC + STEP)

**Assenstelsel.** IFC → app: 180° gedraaid, niet gespiegeld: `x_app = 2710 − x_ifc`, `y_app = 4665 − y_ifc` (mm); z van het IFC
(bouwlaag geplaatst op −2800, dus z_punt − 2800) is t.o.v. de vloerpas van de verdieping. Controle met het plan (DXF):

| IFC | app (mm) | plan (DXF) |
|---|---|---|
| wand x 2410 … 2710 | linker zijgevel 0 … 300 | 0 … 280 |
| wand x −160 … 0 | dragende binnenmuur 2710 … 2870 | 2720 … 2860 |
| wand y 4365 … 4665 | voorgevel 0 … 300 | 0 … 280 |
| wand y −3310 … −3010 | oude achtergevel 7675 … 7975 | 7720 … 8000 |
| y 2780 / 2870 (GV) | 1885 / 1795 | wand inkom/hal 1780 … 1870 |
| y 1890 / 2000 (VD) | 2775 / 2665 | wand badkamer 2680 … 2770 |

Het IFC dekt enkel de linker strook (hal) van het voorste volume. Afwijkingen van 10–30 mm zijn normaal (verschillende tekeningen);
**het plan blijft leidend voor de plattegrond**.

**Hoogtes (exact uit het IFC, mm):**

| | z (t.o.v. vloerpas verdieping) | in het model |
|---|---|---|
| vloerpas gelijkvloers | −2775 | N0 peil 0, hoogte 2775 |
| tussenvloer | −160 … 0 (160 dik) | N1 peil 2775, `vloerdikte` 160, vloer V2 dikte 160 |
| zoldervloer | 2590 … 2775 (185 dik) | N1 hoogte 2775; N2 "Zolder" peil 5550, `vloerdikte` 185 |
| treden bestaande trap | bovenvlakken −2590, −2405, … , −185 | 15 optreden van 185 |
| treden nieuwe trap (verdieping → zolder) | bovenvlakken 185, 370, … , 2590; aankomst 2775 | 15 optreden van 185, treden 40 dik |

De vloerplaat van het gelijkvloers zit niet in het IFC (blijft 300, aanname). Alle bestaande ramen en deuren passen binnen 2775.

**Doorsnede.** In de SketchUp-file stond een doorsnedevlak dat mee in het IFC geëxporteerd is: boven de zoldervloer zitten in het
IFC enkel enkele verticale staafjes (±30 mm, vermoedelijk spijlen), **geen dak**. Het dak komt daarom uit de STEP-export.

**Dak (STEP, zonder doorsnede):** **symmetrisch zadeldak**, nok evenwijdig aan de straat. Bovenvlak voorzijde stijgt 3700 mm over
4655 mm ⇒ tan = 0,795 ⇒ **38,5°** (vervangt de foto-schatting 45°). Dikte ±300 mm loodrecht (383 mm verticaal). Het bovenvlak raakt
de zoldervloer (z 2775) aan de buitenzijde van de voorgevel; het **ondervlak** raakt ze ±482 mm binnen de buitengevel; geen knieschot.
Nok in het midden van de diepte (y ±3990): ondervlak nok ≈ 8340, bovenkant ≈ 8720 (absoluut, mm).

In het model: `D1` zadel, helling 38,5, `contour` y 482 … 7498 (= waar het ondervlak de zoldervloer raakt, symmetrisch rond y 3990),
`overstek` 480, dikte 300. Het ondervlak in het model (`rustvlak 5550 + dakHoogteIn`) valt daarmee samen met het echte ondervlak:
nok 5550 + 3508 · tan 38,5° = 8340 (restafwijking < 5 mm, afronding van de helling); doorgetrokken in de overstek ligt het ondervlak
aan de buitenzijde van de gevel op 5550 − 482 · 0,795 ≈ 5167 = 5550 − 383, zoals in de STEP. **De overstek 480 is geen echte
overstek**: ze brengt het dakvlak tot aan de buitenzijde van de gevels. Omdat de app de overstek rondom toepast, steekt het dak in het
model ook aan de zijgevels 480 mm uit (weergave-artefact; de STEP toont aan de gevels geen overstek; de luifel vooraan op de foto is
niet gemodelleerd).

Zolder N2 = zoals `opsZolderNiveau` het opbouwt: hoogte = nokhoogte 2790, vloer V5 = dakcontour (0 … 7000 × 482 … 7498; de echte
zoldervloer loopt tot de muren, maar daar is de vrije hoogte < 0), ruimte "Zolder" (functie zolder) tussen de binnenvlakken van de
zijgevels. Het **asymmetrische dak** dat ook in de STEP staat (achterdakvlak 28,5° met verhoogde achtergevel) is een **concept**, geen
bestaande toestand, en is niet opgenomen.

**Bestaande trap GV → verdieping (T1).** Werkelijk (app-coördinaten): 1 trede naar −x (x 1080 … 1300, y 1885 … 2655), een kwartbordes
(x 300 … 1080, y 1885 … 2655), een rechte vlucht van 6 treden (aantrede ±187) naar +y langs de linker zijgevel (x 340 … 1080,
y 2655 … 3775), 3 draaitreden in de hoek achteraan en 2 treden naar +x (x 1040 … 1460, y 3860 … 4625); aankomst op de overloop naar +x.
Trapgat in de tussenvloer (IFC): x 300 … 1460, y 2775 … 4665.

Het schema kent geen trap met **twee kwartdraaien en ongelijke vluchten**; T1 is daarom **vereenvoudigd** tot een **kwarttrap**:
`oorsprong` [690, 2775], `richting` 90, `breedte` 780, `aantrede` 185, `draairichting` rechts, 15 × 185 (vluchten 6 + 5, 3 draaitreden).
Die volgt de vlucht langs de zijgevel, de draai en de aankomst naar +x en ligt in plan volledig onder de overloop (geen botsing met de
badkamerwand van de verdieping). Maar: de onderste trede en het bordes vallen weg (±0,77 m²), vlucht 2 is langer dan in werkelijkheid
(tot x 2005 i.p.v. 1460) en de treden liggen op andere hoogtes dan in werkelijkheid.
Afwijking (raster 10 mm): voetafdruk 2,19 m² tegen 2,53 m² echte treden; overlap = **66 % van de echte treden**, IoU 55 %;
trapgat vs. echt trapgat IoU 67 %. Een **rechte trap** (`oorsprong` [750, 1870], `richting` 90, breedte 820, aantrede 200) dekt meer
(85 %, IoU 81 %), maar heeft de verkeerde aankomstrichting en snijdt een trapgat door de badkamer van de verdieping (botst met die
wand); niet gekozen. T1 overlapt in plan de wand van de **kast onder de trap** (M10) — in werkelijkheid staat die kast ónder de trap;
de validator geeft daarover één waarschuwing.

**Nieuwe trap verdieping → zolder (getekend door de gebruiker).** Niet in de bestaande toestand; zie de variant
`zolder-programma-trap-hal` (`tools/voorbeelden/maak-zolder-trap-hal.mjs`). Werkelijk: breedte 740, eerst 4 treden van 200 naar −x
(x 1830 → 1030, y 2815 … 3555), dan 4 draaitreden naar +y, 1 trede, 4 draaitreden naar +x en 1 trede (x 1062 … 1262, y 3925 … 4665);
de 15e "trede" (x 1262 … 1462, z 2775) ligt gelijk met de zoldervloer. Trapgat in de zoldervloer (IFC): x 300 … 1462, y 2775 … 4665.
Volledig binnen de bestaande traphal, boven de bestaande trap. In het model: **halfdraaitrap** `oorsprong` [1830, 3185] (= voorrand van
trede 1), `richting` 180, `breedte` 740, `aantrede` 200, `draairichting` rechts, 15 × 185 (vluchten 4 + 4, 6 draaitreden). Het
tussenstuk tussen de twee draaien kan het schema niet uitdrukken: vlucht 2 ligt 370 mm te ver naar voren (y 3555 … 4295 i.p.v.
3925 … 4665) en eindigt op x 1830 i.p.v. 1462. Afwijking: voetafdruk 2,28 m² tegen 2,04 m² echte treden; overlap = **84 % van de
echte treden**, IoU 66 %, 52 % van de treden op de juiste plek én hoogte; trapgat vs. echt trapgat IoU 62 %. Geen botsing met muren.

**Overige objecten in het IFC (niet gebruikt):** "kast" (verdieping, x 300 … 1800, y 4825 … 5125, 1,8 m hoog — in de slaapkamer
links-achter tegen de wand van de overloop), "bed" (x 280 … 2710, y 6615 … 7675, in dezelfde kamer), "Layer0 4" (dunne vlakken boven de
trapgaten, z 80 … 2300 boven de verdieping — vermoedelijk een leuning/borstwering) en "doorzichtig" (doorzichtige vlakken over de hele
hoogte, vermoedelijk glas/ramen). Niet duidelijk of kast en bed bestaand zijn of een inrichtingsvoorstel ⇒ niet opgenomen.

## Aangenomen (niet in het plan en niet in het 3D-model)

| element | waarde in het model | bron |
|---|---|---|
| Vloerplaat gelijkvloers | 300 | aanname |
| Goot en overstek dak hoofdvolume | niet gemodelleerd (zie dak hierboven) | onbekend (luifel vooraan op de foto) |
| Dak achterbouw | plat, op 2775 (= hoogte gelijkvloers), dikte 300 | aanname (plan toont enkel de contour) |
| Raamhoogtes voorgevel | GV: smal raam en breed raam borstwering 600 / hoogte 1700; voordeur en zijlicht 2200 | foto-schatting |
| Raamhoogtes verdieping voorgevel | borstwering 900 / hoogte 1400 | foto-schatting |
| Ramen 60 cm breed in de linker zijgevel | GV 1000 / 1000, VD 800 / 1200 | foto-schatting |
| Overige ramen | borstwering 900 / hoogte 1400 | standaard |
| Schuifraam achtergevel | borstwering 0 / hoogte 2200 | aanname |
| Binnendeuren, achterdeur, doorgangen | hoogte 2100 | aanname |
| Garages | muurhoogte = hoogte gelijkvloers (2775), plat dak 250, poorten 2100 hoog | aanname |
| Perceel | 14 m breed (gegeven), x −7000 … 7000 (woning tegen de rechter grens), y −8000 … 22000 | positie en diepte **aanname** |

Ruimtes zijn berekend met `ruimteContourBijPunt` (netto contour tussen de muurvlakken). Functies: wc, badkamer, garages en berging
volgen uit het plan of uit notities erin; "Keuken (achterbouw)" en "Kamer achterbouw" zijn interpretaties (zie twijfels).
Niet als element gemodelleerd: balken, schouw. De trap staat als element T1 (vereenvoudigd); de ruimtes heten nog "Hal met trap" /
"Overloop met trap". De zolder (N2) heeft geen wanden; zijn ruimte is getekend tussen de binnenvlakken van de zijgevels eronder.

## Wat de rest van het DXF zegt

- **Hoogtes:** de rest van het DXF (ook in cm, ondanks `$INSUNITS` = mm) bevat enkel **plattegronden** van varianten en schetsen
  (gelijkvloers, verdieping, een zolderschets, oppervlaktes). Geen doorsnedes, geen peilaanduidingen, geen gevelaanzichten,
  geen verticale maatlijnen. Verdiepingshoogtes, vloerdiktes en dak komen daarom uit het 3D-model (zie hierboven).
- **"17m" en "10m":** hulplijnen (laag HULP) die vanaf de voorgevel 17 m (bij het gelijkvloers) en 10 m (bij de verdieping)
  naar achter meten, op 3 m links naast de woning getekend. Waarschijnlijk zijn het toegelaten bouwdieptes — **niet bevestigd**.
  De woning zelf is 12,5 m (GV) en 8,0 m (VD) diep.
- **Gestippelde lijn op 14,5 m diepte** met een notitie (een voornaam met vraagteken — niet overgenomen): loopt van 3 m links
  van de woning tot 3,47 m voorbij de rechter zijgevel. Mogelijk de bouwdiepte van de rechterbuur; **onbekend**, niet gemodelleerd.
- Notitie in het plan: "muur berging staat niet op zelfde lijn als balk living!" (zie twijfels).
- Latere varianten in het DXF tonen een totale diepte van 1260 (i.p.v. 1250) — dat zijn ontwerpen, niet de bestaande toestand.

## Twijfels en afwijkingen

1. **Muur berging vs. balk living.** In het plan liggen de muur van de achterbouw (x 258 … 286) en de balk in de leefruimte
   (x 258 … 286) op dezelfde lijn, maar de notitie zegt dat dat in werkelijkheid niet zo is. Hoeveel ze verschillen staat
   niet in het plan; het model volgt de tekening.
2. **Rechter zijgevel 14 cm, zonder ramen.** Dat wijst op een gemene muur of een gevel tegen de buur; het plan zegt niet wat er
   rechts staat.
3. **Garages vs. perceel.** Zoals getekend liggen de garages tot 8,01 m links van de woning. Met een rechthoekig perceel van 14 m
   en een woning van 7 m past dat niet (15,01 m nodig): de linker garagemuur steekt ±1 m buiten het aangenomen perceel.
   Ofwel is het perceel achteraan breder / niet rechthoekig, ofwel liggen de garages (deels) op een ander perceel,
   ofwel is hun positie in het kader niet exact.
4. **Muur achterbouw als spouwmuur** (x 258 … 286): mogelijk is het rechterdeel van de achterbouw (x 286 … 686) later bijgebouwd
   en was deze muur ooit een buitengevel. Het hoeft niet, maar het verklaart de opbouw.
5. **Functies achterbouw.** Rechts stonden hulplijnen die op keukenmeubelen lijken (laag HULP, misschien een ontwerpidee);
   links een kamer van 7,2 m² met raam in de zijgevel en één deur naar de keuken. Functies "keuken" en "overig" zijn interpretaties.
6. **Badkamer verdieping**: afgeleid uit een notitie "douche 80cm" in die kamer; het raam van 2,20 m breed is ongewoon breed voor een badkamer.
7. Het deel van de oude achtergevel x 605 … 686 is apart getekend (lijn op x 605); misschien een schouw of nis. Gemodelleerd als volle muur.
8. In de linker zijgevel tussen y 247 en 385 staat een kleine verspringing in de buitenste lijn (x 3 … 9); niet gemodelleerd.
9. **Plan vs. 3D-model**: de wanden in het IFC liggen 10–30 mm anders dan in het plan (bv. linker zijgevel 300 i.p.v. 280 dik, wand
   overloop op y 4665 i.p.v. 4680); het plan blijft leidend.
10. **Kast onder de trap**: het plan tekent de kastwand (x 101 … 110) tot y 475; de bovenste treden van de trap lopen erover.
    In het model geeft dat een waarschuwing (trap T1 overlapt muur M10); in werkelijkheid is de kast lager onder de trap.
11. Zijn de kast en het bed uit het IFC (slaapkamer links-achter) bestaand?

## Open vragen aan de eigenaar

1. Overstek/luifel en goot van het dak; hoogte van de achterbouw en de garages (niet in het 3D-model).
2. Hoeveel wijkt de muur van de berging af van de lijn van de balk in de leefruimte?
3. Wat staat er rechts tegen de rechter zijgevel (gemene muur / aangebouwde buur)?
4. Ligging en vorm van het perceel en of de garages op hetzelfde perceel staan; voortuindiepte.
5. Wat zijn "17m" en "10m" (toegelaten bouwdieptes?) en de lijn op 14,5 m?
6. Functie van de kamer links in de achterbouw; is de kamer voor-links op de verdieping de badkamer?
7. Hoogte van de garages en de achterbouw; dakopbouw (plat dak?).
