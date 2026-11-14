// Vervanger voor het npm-pakket `standardwebhooks` (enkel CommonJS, dus niet als ES-module te laden zonder bundler).
// De Anthropic-SDK importeert het alleen voor `client.beta.webhooks.unwrap()` (handtekening van webhooks controleren),
// iets wat enkel op een server zin heeft. In de browser wordt het nooit gebruikt; aanroepen geeft een duidelijke fout.
// Gekoppeld via de importmap in index.html (en de resolve-hook in tests/ai.test.js).

export class Webhook {
  constructor() {
    throw new Error('Webhook-verificatie is niet beschikbaar in deze browser-app (standardwebhooks is niet meegeleverd).');
  }
}
