---
name: ontwerp-opdracht
description: Voert een ontwerpopdracht in gewone taal uit op een ontwerp in designs/ zonder app en zonder API-key (operaties + macro's via tools/apply-ops.mjs). Gebruik bij "voer opdracht uit op ontwerp …", "maak variant(en) van …", "breek … af", "programma van eisen", "zolder/trap/badkamer toevoegen", "verbouw …", of als de gebruiker een JSON-antwoord van Claude uit de handmatige modus van de app wil toepassen.
---

# Ontwerpopdracht uitvoeren via Claude Code

Route 1 om opdrachten in gewone taal uit te voeren **zonder eigen Anthropic API-key**: jij (Claude Code) speelt de rol van het
promptveld. Je schrijft dezelfde operaties (met macro's) als het promptveld en past ze toe met `tools/apply-ops.mjs`, dat exact
dezelfde verwerking gebruikt als de app (`js/ai/opsbestand.js` → `js/ai/macros.js` + `js/ai/verwerk.js`: macro's uitvouwen,
`applyOps` + `validate`, diff, meldingen, programmatoets).

## Bronnen van de regels (lees ze, niet dupliceren)
- `docs/DATAMODEL.md` — schema v2, eenheden (mm), assen, statussen, operaties.
- `js/ai/prompt.js` → `SYSTEEMPROMPT` — de volledige regels voor operaties en macro's (afbraak, id's, maten, geometrie, trap/zolder/
  inrichting, programma van eisen, wat niet modelleerbaar is) met twee volledige voorbeelden. Volg die regels letterlijk.
- `js/ai/macros.js` — parameters van `afbraakZone`, `zolderNiveau`, `trapPlaatsen`, `inrichtingPlaatsen`, `muurSplitsen`.
- Voorbeeld: `tools/voorbeelden/zolder-programma.ops.json` (basisoperaties) en `antwoordPveMacro()` in `tests/ai-voorbeelden.js` (macro's).

## Werkwijze
1. **Branch**: werk niet op `main`. Maak een branch, bv. `ontwerp/<korte-omschrijving>` (geen adres of namen in de branchnaam).
2. **Ontwerp lezen**: `designs/<id>.json` (ontwerp-id's in `designs/index.json`). Zoek de betrokken ruimtes, muren, niveaus en id's op;
   herken een gebouwdeel ("de achterbouw", "garage 2") aan ruimtenamen en contouren. Is de opdracht echt onduidelijk (welk niveau,
   welke kant)? Stel dan eerst 1–3 korte vragen aan de gebruiker in plaats van te gokken.
3. **Ops-bestand schrijven** in een tijdelijke map **buiten `designs/`** (bv. de scratchpad of `/tmp`), niet in de repo:
   - één variant: een lijst operaties of `{ "ops": [...] }`;
   - meerdere varianten: het antwoordformaat van het promptveld
     `{ "samenvatting": "...", "varianten": [{ "naam": "...", "beschrijving": "...", "ops": [...] }] }`.
   - `item`/`velden` mogen gewone JSON-objecten zijn (of JSON-tekst). Macro's zijn toegestaan en aanbevolen.
   - Geef nieuwe elementen expliciete id's (vanaf het volgende vrije nummer per voorvoegsel); verwijs niet naar id's die een macro zelf
     uitdeelt.
4. **Eerst droog controleren**:
   `node tools/apply-ops.mjs <id> <ops-bestand> --droog` (bij het antwoordformaat eventueel `--variant <n>`).
   Lees de uitvoer: diff, macro-info, **meldingen** (bv. blijvende randmuren van `afbraakZone`: mogelijk dragend — vermeld dat aan de
   gebruiker) en de **toets aan het programma van eisen** (voldoet / voldoet niet / onbekend). Fout (afsluitcode 1)? Verbeter het
   ops-bestand en probeer opnieuw.
5. **Schrijven**:
   - nieuwe variant(en): `node tools/apply-ops.mjs <id> <ops-bestand> --als <nieuw-id> --naam "<naam>"` (één variant), of zonder
     `--als` bij het antwoordformaat: elke variant wordt `designs/<id>-<slug>.json`. De index wordt bijgewerkt.
   - het ontwerp zelf bijwerken: gewone ops zonder `--als` (enkel als de gebruiker dat vraagt).
6. **Valideren**: `node tools/validate.mjs` en `npm test` moeten groen zijn.
7. **Tonen aan de gebruiker**: de samenvatting van de diff (nieuw / afbraak / gewijzigd / verwijderd, per niveau), de meldingen, de
   programmatoets en je aannames (maten die jij koos). Zeg uitdrukkelijk dat het een schets is (stabiliteit, EPB en vergunning blijven
   voor architect/ingenieur).
8. **Commit en push op de branch** (Nederlands, kort; geen adres of namen). **Vraag bevestiging vóór merge naar `main`.**
   QA vóór merge (CLAUDE.md): wijzigt de branch enkel ontwerpdata (`designs/*.json` en `designs/index.json`), dan volstaat een lichte
   check — `node tools/validate.mjs` + `npm test` groen, en de gebruiker heeft de diff gezien en akkoord gegeven. Raakt de branch ook
   code, docs of tools, dan eerst de `qa-reviewer`.

## Regels (kort; details in de systeemprompt)
- **Afbraak = status**: bestaande elementen die verdwijnen krijgen `status: "afbraak"` (of `afbraakZone`), nooit `verwijderen`.
  Ruimtes hebben geen status: die verwijder je of geef je de nieuwe indeling. Nieuwe elementen krijgen `status: "nieuw"`.
- **Maten**: maten van de gebruiker exact overnemen; ontbrekende maten zelf kiezen en als **aanname** melden.
- **Geen normen verzinnen**: geen wettelijke eisen, trapnormen of minimale oppervlaktes als "norm". In het programma van eisen enkel wat
  de gebruiker vroeg (`minOppervlakte`/`hoogteGrens` alleen als de gebruiker ze noemt). Werkwaarden zijn geen normen.
- **Geen prijzen verzinnen** (`designs/prijzen.json` vult de gebruiker zelf in).
- **Anoniem**: geen adres, straat, gemeente, perceelnummer, coördinaten, foto's of namen in ontwerpen, bestandsnamen, ontwerpnamen,
  beschrijvingen, branches of commitberichten. Plannen/foto's van de gebruiker niet committen.
- Wat schema v2 niet kan (dakkapellen, dakramen, isolatie, technieken, leuningen …): niet verzinnen, wel melden als "Niet modelleerbaar".

## Antwoord uit de handmatige modus van de app
Plakt de gebruiker een JSON-antwoord van Claude (uit de app, knop "Kopieer opdracht voor Claude"), dan kan je dat bestand rechtstreeks
gebruiken: `apply-ops.mjs` aanvaardt ook tekst met een ```json-codeblok. Werk verder vanaf stap 4.
