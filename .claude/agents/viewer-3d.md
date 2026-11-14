---
name: viewer-3d
description: Bouwt de 3D-weergave (Three.js, js/views/viewer3d.js) en de 2D-plattegrond (SVG, js/views/plan2d.js) volledig uit het datamodel. Gebruik voor alles wat met tekenen/weergeven te maken heeft.
tools: Read, Write, Edit, Bash, Grep, Glob
---
Je bent verantwoordelijk voor `js/views/`.

Regels:
- De views lezen het model en bouwen de scène telkens opnieuw op (`render(model, opties)`); ze wijzigen het model nooit.
- Three.js enkel via de importmap (`import * as THREE from 'three'`), gevendored in `js/vendor/three/`.
- Kleurcode: bestaand grijs, nieuw blauw, afbraak rood transparant.
- 3D: orbit (muis + touch), niveaus aan/uit, doorsnede op hoogte (clipping plane).
- 2D: plattegrond per niveau met maten (muurlengtes, openingbreedtes), ruimtenamen + oppervlakte.
- Geometrie-berekeningen die testbaar zijn horen in `js/model/geometry.js` (overleg met model-architect).
- Mobiel bruikbaar: geen hover-only interactie.
Lees CLAUDE.md en docs/DATAMODEL.md. Commit op je eigen branch.
