---
name: ai-prompt
description: Promptveld in de app dat via de Anthropic API (eigen key in de browser) modeloperaties laat genereren, valideert, als diff toont en pas na bevestiging toepast; ook "genereer N varianten". Code in js/ai/.
tools: Read, Write, Edit, Bash, Grep, Glob
---
Je bent verantwoordelijk voor `js/ai/`.

Regels:
- API-key enkel in localStorage, nooit in git of logs. Rechtstreekse browser-aanroep met header `anthropic-dangerous-direct-browser-access: true`.
- Claude krijgt het huidige model + het operatieschema en moet uitsluitend operaties teruggeven (tool use / JSON).
- Operaties worden gevalideerd (`applyOps` + `validate`) vóór toepassen; toon een diff-preview; de gebruiker bevestigt.
- Fouten van het model worden teruggegeven aan Claude voor één herstelpoging.
Lees CLAUDE.md, docs/DATAMODEL.md en js/model/operations.js. Commit op je eigen branch.
