# Bestaande toestand

Ontwerp: `designs/bestaand.json`, gegenereerd door `node tools/maak-bestaand.mjs`.
Pas maten aan in het script en draai het opnieuw; daarna `npm test` (`tests/bestaand.test.js` controleert het resultaat).

**Bron van de plattegrond:** het bestaande plan (DXF, kader "origineel", getekend in **cm**; 1 tekeneenheid = 1 cm,
bevestigd door de maatlijnen met stijl "schaal_1-50", o.a. de totale diepte 1250). Het DXF-bestand zelf en renders ervan
staan **niet** in de repo (CLAUDE.md regel 8); enkel de afgelezen maten.

Een grondplan bevat **geen hoogtes**. Alles in de hoogte is een foto-schatting of aanname (zie onder).

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

## Aangenomen (niet in het plan)

| element | waarde in het model | bron |
|---|---|---|
| Verdiepingshoogte gelijkvloers / verdieping | 3000 / 2800 | foto-schatting (±10–20 %) |
| Vloerdikte verdieping, vloerplaat gelijkvloers | 300 | aanname |
| Dak hoofdvolume | zadeldak 45°, nok evenwijdig aan de straat, overstek 500 rondom, dikte 300 | foto-schatting |
| Dak achterbouw | plat, op 3000, dikte 300 | aanname (plan toont enkel de contour) |
| Raamhoogtes voorgevel | GV: smal raam en breed raam borstwering 600 / hoogte 1700; voordeur en zijlicht 2200 | foto-schatting |
| Raamhoogtes verdieping voorgevel | borstwering 900 / hoogte 1400 | foto-schatting |
| Ramen 60 cm breed in de linker zijgevel | GV 1000 / 1000, VD 800 / 1200 | foto-schatting |
| Overige ramen | borstwering 900 / hoogte 1400 | standaard |
| Schuifraam achtergevel | borstwering 0 / hoogte 2200 | aanname |
| Binnendeuren, achterdeur, doorgangen | hoogte 2100 | aanname |
| Garages | muurhoogte = 3000 (hoogte gelijkvloers), plat dak 250, poorten 2100 hoog | aanname |
| Perceel | 14 m breed (gegeven), x −7000 … 7000 (woning tegen de rechter grens), y −8000 … 22000 | positie en diepte **aanname** |

Ruimtes zijn berekend met `ruimteContourBijPunt` (netto contour tussen de muurvlakken). Functies: wc, badkamer, garages en berging
volgen uit het plan of uit notities erin; "Keuken (achterbouw)" en "Kamer achterbouw" zijn interpretaties (zie twijfels).
Niet als element gemodelleerd: balken, trap (enkel als deel van "Hal met trap" / "Overloop met trap"), schouw, zolder.

## Wat de rest van het DXF zegt

- **Hoogtes:** de rest van het DXF (ook in cm, ondanks `$INSUNITS` = mm) bevat enkel **plattegronden** van varianten en schetsen
  (gelijkvloers, verdieping, een zolderschets, oppervlaktes). Geen doorsnedes, geen peilaanduidingen, geen gevelaanzichten,
  geen verticale maatlijnen. Verdiepingshoogtes, vloerdiktes, nokhoogte en dakhelling blijven dus schattingen.
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

## Open vragen aan de eigenaar

1. Verdiepingshoogtes (vloer tot vloer), nok- en goothoogte, dakhelling — of een doorsnede van het oorspronkelijke plan.
2. Hoeveel wijkt de muur van de berging af van de lijn van de balk in de leefruimte?
3. Wat staat er rechts tegen de rechter zijgevel (gemene muur / aangebouwde buur)?
4. Ligging en vorm van het perceel en of de garages op hetzelfde perceel staan; voortuindiepte.
5. Wat zijn "17m" en "10m" (toegelaten bouwdieptes?) en de lijn op 14,5 m?
6. Functie van de kamer links in de achterbouw; is de kamer voor-links op de verdieping de badkamer?
7. Hoogte van de garages en de achterbouw; dakopbouw (plat dak?).
