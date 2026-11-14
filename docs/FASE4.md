# Fase 4 — promptveld en "genereer N varianten"

Doel: in de app een opdracht in gewone taal geven ("verleng de keuken 2 m naar de tuin met een plat dak",
"maak 3 varianten voor een extra badkamer boven"). Claude geeft **modeloperaties** terug; de app valideert ze,
toont een **diff-preview** en past ze pas toe na bevestiging. Daarnaast blijft Claude Code werken via
`tools/apply-ops.mjs` op `designs/`.

## Principes
- **Eigen API-key in de browser** (localStorage, nooit in git, nooit gelogd of in foutmeldingen). Rechtstreekse
  browseraanroep (`dangerouslyAllowBrowser` / header `anthropic-dangerous-direct-browser-access: true`). Kosten zijn
  voor het API-account van de gebruiker; de app toont tokens en een geschatte kost per aanvraag.
- **Geen buildstap**: de officiële SDK `@anthropic-ai/sdk` wordt gevendored als ES-module in `js/vendor/` (zoals
  Three.js) indien dat zonder bundler werkt; anders `fetch` op `POST /v1/messages` (en dat wordt gemotiveerd).
- **Model**: standaard `claude-opus-5-5` (effort instelbaar, standaard `medium`); de gebruiker kan in Instellingen
  een ander model kiezen. Server-side fallbacks bij een weigering (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`) staan standaard aan en zijn uit te zetten.
- **Alleen operaties**: Claude krijgt het datamodel (schema + operaties uit `docs/DATAMODEL.md`) en het huidige
  ontwerp (JSON), en antwoordt met gestructureerde JSON: `{ samenvatting, vragen?, varianten: [{ naam, beschrijving, ops: [...] }] }`.
  Geen vrije tekst die de app moet interpreteren.
- **Valideren vóór tonen**: per variant `applyOps` op (een kopie van) het actieve ontwerp. Faalt het ⇒ de fouten
  gaan terug naar Claude voor **één** herstelpoging; faalt het opnieuw ⇒ duidelijke melding, niets toegepast.
- **Diff-preview**: per variant `beschrijfDiff(diff(...))` in mensentaal + voorbeeld in de plattegrond
  (markering van nieuwe/gewijzigde/verwijderde elementen) en optioneel 3D. Kerncijfers/raming van het resultaat
  (fase 3) naast die van het huidige ontwerp.
- **Toepassen**: 1 variant ⇒ op het actieve ontwerp als **één undo-stap**. N varianten ⇒ elk als nieuwe variant
  (`dupliceer` + ops, basis = actief ontwerp, lokaal opgeslagen), daarna voorstel om te vergelijken (fase 3).
- **Onduidelijke opdracht** ⇒ Claude mag `vragen` teruggeven in plaats van ops; de app toont ze en laat de
  gebruiker antwoorden (multi-turn binnen hetzelfde gesprek).
- **Privacy**: het ontwerp-JSON gaat naar de Anthropic API; de app vermeldt dat. Geen adres of namen meesturen
  buiten wat in het ontwerp staat.
- **Prompt caching**: vaste systeemprompt (schema, operaties, regels, voorbeelden) vooraan met `cache_control`;
  het ontwerp-JSON en de opdracht daarna.

## Claude Code
`node tools/apply-ops.mjs <id> ops.json [--als nieuw-id --naam "…"]` blijft de manier om vanuit Claude Code
varianten te maken. Hetzelfde operatieformaat als het promptveld.
