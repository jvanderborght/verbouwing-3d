# verbouwing-3d

Schets- en vergelijkingstool om de verbouwing van een woning in 3D te ontwerpen en varianten te vergelijken.
Geen BIM/CAD: stabiliteit, EPB en vergunning blijven voor architect/ingenieur.

- **Live app:** https://jvanderborght.github.io/verbouwing-3d/
- **Ontwerpen:** `designs/*.json` (één bestand per variant) — zie [docs/DATAMODEL.md](docs/DATAMODEL.md)
- **Status:** [docs/STATUS.md](docs/STATUS.md)
- **Concept en roadmap (lange termijn, fase 5+):** [docs/CONCEPT.md](docs/CONCEPT.md)
- **Werkafspraken voor Claude Code:** [CLAUDE.md](CLAUDE.md)

Geen buildstap: open de live app op eender welk toestel, of bewerk `designs/` via Claude Code (claude.ai/code).

## Opdrachten in gewone taal zonder eigen API-key
- **In de app (handmatig):** knop **Opdracht** → "Kopieer opdracht voor Claude", plak de tekst in een Claude-chat die je organisatie
  toelaat, en plak het JSON-antwoord terug ("Verwerken"). Zelfde controle, voorbeeld en bevestiging als met een API-key.
  Let op: het ontwerp-JSON komt dan in die chat terecht.
- **Via Claude Code:** vraag bv. "voer opdracht uit op ontwerp bestaand: …" of "maak 2 varianten van …". De project-skill
  [`.claude/skills/ontwerp-opdracht`](.claude/skills/ontwerp-opdracht/SKILL.md) beschrijft de werkwijze: operaties (met macro's) in een
  tijdelijk bestand, `node tools/apply-ops.mjs <id> <bestand> [--droog] [--als <nieuw-id>] [--variant <n>]`, daarna `npm test`.
- Details: [docs/FASE4.md](docs/FASE4.md) → "Zonder API-key".
