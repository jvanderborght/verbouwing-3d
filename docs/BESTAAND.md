# Bestaande toestand — eerste schatting

Ontwerp: `designs/bestaand.json`, gegenereerd door `node tools/maak-bestaand.mjs`.
Pas maten aan in het script (bovenaan staan de constanten) en draai het opnieuw; daarna `npm test`.

Dit is een **schatting**, geen opmeting. Behalve de twee gegeven breedtes komt alles uit één schuine
straatfoto of is het een aanname. Gebruik het model om varianten te schetsen, niet om op te bouwen.

## Maten en bronnen

Bron: **gegeven** = door de eigenaar opgegeven · **foto** = afgeleid uit één straatfoto (schuin vooraanzicht) · **aanname** = niet zichtbaar, gekozen om een volledig model te hebben.
Alle maten afgerond op 50 mm. Oorsprong = buitenhoek links-voor, gelijkvloers.

| element | maat in het model | bron | onzekerheid |
|---|---|---|---|
| Breedte woning (buitenwerks) | 7000 | gegeven | exact |
| Breedte perceel | 14000 | gegeven | exact |
| Diepte woning (buitenwerks) | 9000 | aanname | onbekend — kan meters afwijken |
| Positie woning op het perceel | gecentreerd (perceel x −3500 … 10500) | aanname | onbekend |
| Voortuin (afstand perceelgrens–voorgevel) | 8000 (y = −8000) | aanname | onbekend |
| Perceeldiepte | tot y = 30000 | aanname | onbekend |
| Aantal bouwlagen | 2 + zadeldak | foto | zeker |
| Verdiepingshoogte gelijkvloers (vloer-tot-vloer) | 3000 | foto | ±10–20 % |
| Verdiepingshoogte verdieping | 2800 | foto | ±10–20 % |
| Kroonlijst/goot boven maaiveld | ≈ 5800 (3000 + 2800) | foto | ±10–20 % |
| Vloerdikte verdieping | 300 | aanname | onbekend |
| Buitenmuren | 300 (spouwmuur) | foto/aanname | typisch 280–350 |
| Dak: type en nokrichting | zadeldak, nok evenwijdig aan de straat (`x`) | foto | zeker |
| Dakhelling | 45° | foto | ±5–10° |
| Overstek | 500 (in het model **rondom**) | foto | ±10–20 %; op de foto enkel zeker aan de voorgevel — het model kent maar één overstekwaarde |
| Dakdikte | 300 | aanname | onbekend |
| **Voorgevel gelijkvloers** (x = vanaf buitenhoek links) | | | |
| Smal hoog raam (rondboog) | x 700–1500, b 800 × h 1700, borstwering 600 | foto | ±10–20 %; rondboog niet gemodelleerd (rechthoek) |
| Voordeur | x 2550–3550, b 1000 × h 2200 | foto | ±10–20 % |
| Zijlicht naast de deur | x 3600–4000, b 400 × h 2200, borstwering 0 | foto | ±20 %; aan welke kant van de deur het zit: nakijken |
| Breed raam | x 4750–6750, b 2000 × h 1700, borstwering 600 | foto | ±10–20 % |
| **Voorgevel verdieping** | | | |
| Raam links | x 1050–2850, b 1800 × h 1400, borstwering 900 | foto | ±10–20 % |
| Raam rechts | x 4000–5800, b 1800 × h 1400, borstwering 900 | foto | ±10–20 % |
| **Linker zijgevel (topgevel)** (y = vanaf voorgevel) | | | |
| Klein raam gelijkvloers | y 3700–4300, b 600 × h 1000, borstwering 1000 | foto (maat) + aanname (positie) | 1 of 2 ramen; positie in de diepte gegokt |
| Raam verdieping 1 | y 2000–2600, b 600 × h 1200, borstwering 800 | foto (maat) + aanname (positie, borstwering) | positie gegokt |
| Raam verdieping 2 | y 5500–6100, b 600 × h 1200, borstwering 800 | foto (maat) + aanname (positie, borstwering) | positie gegokt |
| Rechter zijgevel, achtergevel | geen openingen | aanname | onbekend (niet zichtbaar) |
| Binnenindeling | één ruimte per niveau, functie `overig` | aanname | onbekend |

**Niet gemodelleerd maar wel gezien:** schoorsteen aan de linker topgevel, een smal zolderraam in de linker topgevel,
de rondboog van het smalle raam op het gelijkvloers.

## Open vragen aan de eigenaar

1. **Links** staat een lager volume van 1 bouwlaag met plat dak. Hoort dat bij de woning (bv. garage, berging, uitbouw)? Breedte, diepte, hoogte?
2. **Rechts** staat een smalle strook (≈ 2–2,5 m) met een garagepoort op het gelijkvloers en een raam erboven, onder een lager hellend dak. Hoort die bij de woning? Zo ja: valt ze binnen de opgegeven 7 m of komt ze erbij?
3. **Daarnaast** een volume met overdekt terras/luifel en schilddak — waarschijnlijk de buur, graag bevestigen.
4. Aan welke kant van de voordeur zit het zijlicht? Zijn er 1 of 2 ramen op het gelijkvloers in de linker zijgevel?
5. Is er een achterbouw, en hoe ziet de achtergevel eruit?
6. Is de zolder bewoonbaar of enkel berging (zolderraam in de topgevel)?

## Zo verfijn je dit

a. **Diepte en exacte gebouwcontour** — open Geopunt Vlaanderen (geopunt.be, kaart met de GRB-laag "gebouwen")
   en meet met het meetgereedschap de diepte van het hoofdvolume, eventuele achterbouw en zijvolumes,
   en de afstand tot de perceelgrenzen (perceellaag). Zet die maten in `tools/maak-bestaand.mjs` (`D`, perceelcontour).
   Vul hier geen adres of perceelnummer in — enkel de afgeleide maten.

b. **Hoogtes** — tel de baksteenlagen in de gevel (bv. van maaiveld tot dorpel, tot de goot).
   Vuistregel: een Belgische gevelsteen telt ongeveer 65 mm per laag inclusief voeg — dat is een
   **vuistregel, geen norm**: meet zelf 10 lagen op met een meetlint en deel door 10 voor de echte laaghoogte.

c. **Breedtes van ramen en deuren** — meet ze buiten op met een meetlint (dagmaat, tussen het metselwerk),
   plus de afstand van de buitenhoek tot de rand van elke opening. Dat zijn exact de `x`-waarden in de tabel hierboven.

d. **Bestaande plannen** — vraag bij de gemeente (dienst omgeving/bouwaanvragen-archief) de plannen van de
   oorspronkelijke bouwaanvraag op. Die geven diepte, hoogtes, indeling en gevels in één keer en zijn
   betrouwbaarder dan alle schattingen hierboven. Plannen en foto's zelf **niet** in de repo zetten (CLAUDE.md regel 8),
   enkel de afgelezen maten.
