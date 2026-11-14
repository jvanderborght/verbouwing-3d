# Gevendorde Anthropic TypeScript-SDK

- Pakket: `@anthropic-ai/sdk` **1.3.0** (npm, gepubliceerd 2026-10-23), licentie Apache-2.0 (`LICENSE`; `LICENSE-MIT` voor oudere bijdragen).
- Enkel de ES-modulebestanden (`*.mjs`) die vanaf `index.mjs` bereikbaar zijn (statisch en dynamisch), ongewijzigd
  gekopieerd uit `npm pack @anthropic-ai/sdk@1.3.0`. Geen `.d.ts`, geen CommonJS, geen source maps.
- Wat een bundler zou doen, gebeurt via de importmap in `index.html`:
  - `@anthropic-ai/sdk` → `./js/vendor/anthropic-sdk/index.mjs`
  - het `browser`-veld van het pakket: `internal/node.mjs` → `internal/node.browser.mjs` en
    `tools/agent-toolset/node.mjs` → `tools/agent-toolset/node.browser.mjs` (anders laadt de browser `node:fs` …)
  - `@opentelemetry/api` → `./js/vendor/opentelemetry-api/index.mjs` (versie 1.10.0, Apache-2.0, ESM-build `dist/`)
  - `standardwebhooks` → `./js/vendor/anthropic-sdk-shims/standardwebhooks.mjs` (eigen vervanger: het echte pakket
    is enkel CommonJS en is alleen nodig voor webhook-verificatie op een server)
- Bijwerken: `npm pack @anthropic-ai/sdk@<versie>` in een tijdelijke map, de import-graaf vanaf `index.mjs` opnieuw
  aflopen (kale imports controleren!) en de bestanden vervangen. Daarna `npm test` en de rooktest.
