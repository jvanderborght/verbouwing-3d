# Fase 3 — kerncijfers, kostenraming, vergelijkweergave

Alle berekeningen zijn **pure functies** op het model (`js/metrics/`), getest met handmatig nagerekende voorbeelden.
Eenheden in de uitvoer: m², m³, stuks. Afronding pas bij weergave (2 decimalen m², 1 decimaal m³).

## Kerncijfers per variant (`js/metrics/kerncijfers.js` → `kerncijfers(model)`)

Elementen met status `afbraak` tellen **niet** mee voor de toestand-na-verbouwing, tenzij hieronder anders vermeld.

| cijfer | definitie |
|---|---|
| **bruto m² per niveau** | som van de oppervlakte van de vloeren (`vloeren`, status ≠ afbraak) op dat niveau; is er geen vloer, dan de oppervlakte van `buitenContour(model, niveau)` |
| **netto m² per niveau** | som van de oppervlakte van de ruimtes (`ruimtes`) op dat niveau |
| **bruto volume (m³)** | Σ per niveau (bruto m² × niveau.hoogte) + Σ `dakVolume` van daken (status ≠ afbraak) |
| **m² nieuwe muur (buiten / binnen)** | muren met status `nieuw`: lengte × hoogte − oppervlakte van hun openingen; buiten/binnen via `buitenMuren` |
| **m² af te breken muur** | muren met status `afbraak`: lengte × hoogte (bruto, zonder aftrek van openingen); plus `doorbraken`: openingen met status `nieuw` in muren met status `bestaand` (m², apart vermeld) |
| **ramen** | aantal en m² (breedte × hoogte) per status (bestaand / nieuw / afbraak) |
| **deuren** | aantal per status |
| **dakoppervlak (m²)** | per dak (status ≠ afbraak): plat = grondvlak incl. overstek; hellend = rechthoekige begrenzing incl. overstek / cos(helling) (benadering voor zadel/lessenaar/schild); apart nieuw vs bestaand |
| **nieuw vloeroppervlak (m²)** | som van vloeren met status `nieuw` |

## Kostenraming (`js/metrics/kosten.js` → `raming(model, prijzen)`)

Enkel op basis van `designs/prijzen.json` (prijzen van de gebruiker, of op diens vraag opgezochte richtprijzen met `bron`, `bereik`, `opmerking`). **Nooit prijzen verzinnen.** Lege prijs (`null`) ⇒ post toont "—"; heeft die post een hoeveelheid > 0, dan is de raming **onvolledig** (totaal = som van de gekende posten met vermelding "minstens"). Bij hoeveelheid 0 is het bedrag 0 en blijft de raming volledig (0 × onbekend = 0). Met `bereik` ⇒ ook bandbreedte Σ hoeveelheid × min/max. Bedragen worden bij weergave op de euro afgerond.

| post (sleutel in prijzen.json) | hoeveelheid |
|---|---|
| `muur_nieuw_buiten` | m² nieuwe buitenmuur |
| `muur_nieuw_binnen` | m² nieuwe binnenmuur |
| `muur_afbraak` | m² af te breken muur + m² doorbraken |
| `raam_nieuw` | m² nieuwe ramen |
| `deur_nieuw` | stuks nieuwe deuren |
| `vloer_nieuw` | m² nieuwe vloer |
| `dak_plat_nieuw` | m² nieuw plat dak |
| `dak_hellend_nieuw` | m² nieuw hellend dak |
| `afwerking_nieuw_vloeroppervlak` | m² nieuwe vloer (zelfde hoeveelheid als `vloer_nieuw`) |

Onbekende sleutels in prijzen.json worden genegeerd (met waarschuwing). `btw` (`"incl"`/`"excl"`/vrije tekst/`null`) wordt enkel getoond. `_herkomst` (bv. "richtprijzen van internet") wordt prominent getoond in paneel, vergelijkweergave en CSV, en verdwijnt zodra de gebruiker het veld weghaalt (eigen offerteprijzen).
Altijd vermelden: *indicatief — geen offerte; stabiliteit, EPB en vergunning niet inbegrepen*.

## Vergelijkweergave

- Kies 2–3 varianten (standaard: "Bestaande toestand" + actieve variant). Eerste kolom = referentie.
- Per variant een kleine 3D-weergave en/of plattegrond (zelfde niveau voor alle kolommen), naast elkaar op desktop; op telefoon onder elkaar of horizontaal swipebaar.
- Tabel met alle kerncijfers en de raming; verschillen t.o.v. de referentiekolom (Δ, + groen/− rood waar zinvol).
- Export van de tabel als CSV (download).
- Kerncijfers ook compact in het eigenschappenpaneel voor de actieve variant.
