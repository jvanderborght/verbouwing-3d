// Aanroep van de Anthropic Messages API vanuit de browser, via de gevendorde officiële SDK (js/vendor/anthropic-sdk,
// geladen via de importmap). Rechtstreeks vanuit de browser: `dangerouslyAllowBrowser: true` (de SDK stuurt dan de
// header `anthropic-dangerous-direct-browser-access: true`).
//
// De API-key leeft ENKEL in localStorage (zie AiOpslag) en gaat enkel als authenticatieheader naar api.anthropic.com.
// Ze komt nooit in foutmeldingen, logs of de request-body: alle meldingen worden bovendien door `verberg()` gehaald.

import { bouwVerzoek, FALLBACK_BETA } from './prompt.js';

// ---------------------------------------------------------------- opslag van key en instellingen

const PREFIX = 'verbouwing3d.';
export const AI_SLEUTELS = Object.freeze({ key: `${PREFIX}anthropicKey`, instellingen: `${PREFIX}aiInstellingen` });

/** Key + AI-instellingen in localStorage (via LokaleOpslag uit js/ui/opslag.js of een nagebootste storage). */
export class AiOpslag {
  /** @param {{ lees(k): string|null, schrijf(k, v): boolean, wis(k): boolean }} opslag */
  constructor(opslag) { this.o = opslag; }
  key() { const t = this.o.lees(AI_SLEUTELS.key); return t && t.trim() ? t.trim() : null; }
  bewaarKey(k) { return k && String(k).trim() ? this.o.schrijf(AI_SLEUTELS.key, String(k).trim()) : this.wisKey(); }
  wisKey() { return this.o.wis(AI_SLEUTELS.key); }
  instellingen() { try { return JSON.parse(this.o.lees(AI_SLEUTELS.instellingen) || 'null'); } catch { return null; } }
  bewaarInstellingen(v) { return this.o.schrijf(AI_SLEUTELS.instellingen, JSON.stringify(v)); }
}

// ---------------------------------------------------------------- prijzen (schatting)

/**
 * Prijzen in USD per miljoen tokens. BRON: Claude API-documentatie zoals meegeleverd met de claude-api-skill
 * (shared/models.md en typescript/claude-api/README.md), gelezen op 2026-11-14. Controleer de actuele prijzen op
 * https://platform.claude.com/docs/en/about-claude/pricing — dit is enkel een SCHATTING.
 * - cacheLezen: zoals vermeld in models.md (Haiku 5.5: niet vermeld → 0,1 × invoer, de algemene vuistregel uit README).
 * - cacheSchrijven (5 min): 1,25 × invoer (algemene vuistregel uit README "~1.25x").
 * - Haiku 5.5: $0,10 / $0,50 bij een prompt ≤ 100K tokens, $0,50 / $2,50 daarboven.
 */
export const PRIJZEN = Object.freeze({
  'claude-opus-5-5': { invoer: 4, uitvoer: 20, cacheLezen: 0.2 },
  'claude-sonnet-5-5': { invoer: 2, uitvoer: 10, cacheLezen: 0.1 },
  'claude-haiku-5-5': { invoer: 0.1, uitvoer: 0.5, cacheLezen: 0.01, groot: { drempel: 100_000, invoer: 0.5, uitvoer: 2.5, cacheLezen: 0.05 } },
});
export const PRIJZEN_BRON = 'Claude API-documentatie (models.md), gelezen 2026-11-14';

/**
 * Geschatte kost in USD van één antwoord. null als het model niet in de tabel staat (bv. een fallbackmodel).
 * @param {{ input_tokens?, output_tokens?, cache_read_input_tokens?, cache_creation_input_tokens? }} usage
 */
export function schatKost(usage, modelId) {
  let p = PRIJZEN[modelId];
  if (!p || !usage) return null;
  const inv = usage.input_tokens || 0, uit = usage.output_tokens || 0;
  const lees = usage.cache_read_input_tokens || 0, schrijf = usage.cache_creation_input_tokens || 0;
  if (p.groot && inv + lees + schrijf > p.groot.drempel) p = { ...p, ...p.groot };
  return (inv * p.invoer + schrijf * p.invoer * 1.25 + lees * p.cacheLezen + uit * p.uitvoer) / 1e6;
}

/** Telt het verbruik van meerdere antwoorden op (herstelpoging, vervolgvragen). */
export function telUsage(lijst) {
  const t = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, kost: 0, kostOnbekend: false };
  for (const { usage, model } of lijst) {
    if (!usage) continue;
    for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) t[k] += usage[k] || 0;
    const k = schatKost(usage, model);
    if (k == null) t.kostOnbekend = true; else t.kost += k;
  }
  return t;
}

// ---------------------------------------------------------------- fouten

export class AiFout extends Error {
  /** soort: 'geen-key' | 'auth' | 'rechten' | 'niet-gevonden' | 'ongeldig' | 'te-groot' | 'limiet' | 'overbelast' | 'storing' | 'netwerk' | 'geannuleerd' | 'onbekend' */
  constructor(melding, { soort = 'onbekend', status = 0 } = {}) {
    super(melding);
    this.name = 'AiFout';
    this.soort = soort;
    this.status = status;
  }
}

/** Haalt elk voorkomen van de key (en sk-ant-…-achtige tekenreeksen) uit een tekst. */
export function verberg(tekst, key) {
  let t = String(tekst ?? '');
  if (key) t = t.split(key).join('[key]');
  return t.replace(/sk-ant-[A-Za-z0-9_\-]{6,}/g, '[key]');
}

const apiMelding = (err) => {
  const b = err?.error;
  const m = b?.error?.message ?? b?.message;
  return typeof m === 'string' ? m : '';
};
const apiType = (err) => err?.error?.error?.type ?? err?.type ?? null;

/** Zet een fout van de SDK (of fetch) om in een AiFout met een Nederlandse melding. Bevat nooit de key. */
export function vertaalFout(err, { key = null, afgebroken = false } = {}) {
  if (err instanceof AiFout) return err;
  const naam = err?.constructor?.name || err?.name || '';
  const status = typeof err?.status === 'number' ? err.status : 0;
  const type = apiType(err);
  const detail = verberg(apiMelding(err), key).slice(0, 300);
  const mk = (melding, soort) => new AiFout(verberg(melding, key), { soort, status });
  if (afgebroken || naam === 'APIUserAbortError' || naam === 'AbortError') return mk('Aanvraag geannuleerd.', 'geannuleerd');
  if (status === 401 || type === 'authentication_error') return mk('De API-key werd geweigerd (401): ze is ongeldig, ingetrokken of fout geplakt. Controleer of vervang de key in Instellingen.', 'auth');
  if (status === 403 || type === 'permission_error') return mk(`Geen toegang (403)${detail ? `: ${detail}` : ''}. Controleer de rechten van de key en het gekozen model.`, 'rechten');
  if (status === 404 || type === 'not_found_error') return mk(`Niet gevonden (404)${detail ? `: ${detail}` : ''}. Is het gekozen model beschikbaar voor deze key?`, 'niet-gevonden');
  if (status === 413 || type === 'request_too_large') return mk('De aanvraag is te groot (413). Probeer een kleiner ontwerp of een kortere opdracht.', 'te-groot');
  if (status === 429 || type === 'rate_limit_error') return mk('Limiet bereikt (429): te veel aanvragen of tokens per minuut, of het tegoed is op. Wacht even en probeer opnieuw; controleer anders je limieten en tegoed in de Anthropic Console.', 'limiet');
  if (status === 529 || type === 'overloaded_error') return mk('De API is tijdelijk overbelast (529). Probeer het over enkele minuten opnieuw.', 'overbelast');
  if (status === 400 || type === 'invalid_request_error') return mk(`Ongeldige aanvraag (400)${detail ? `: ${detail}` : ''}.`, 'ongeldig');
  if (status >= 500 || type === 'api_error') return mk(`Storing bij de API (${status || 'api_error'}). Probeer later opnieuw.`, 'storing');
  if (/APIConnection/.test(naam) || err instanceof TypeError || /fetch|network|connection/i.test(String(err?.message))) {
    return mk(/Timeout/.test(naam) ? 'Geen antwoord binnen de tijd (time-out). Probeer opnieuw, eventueel met een lagere effort.' : 'Geen verbinding met de Anthropic API. Controleer je internetverbinding (of een browserextensie die het verzoek blokkeert) en probeer opnieuw.', 'netwerk');
  }
  return mk(`Onverwachte fout bij de aanvraag${status ? ` (${status})` : ''}.`, 'onbekend');
}

// ---------------------------------------------------------------- client

/** Standaard: de gevendorde SDK via de importmap (in Node-tests via een resolve-hook). */
async function laadSdk() {
  const mod = await import('@anthropic-ai/sdk');
  return mod.default || mod.Anthropic;
}

export class AiClient {
  /**
   * @param {{ apiKey: string, Anthropic?: Function, laad?: () => Promise<Function>, fetch?: Function, maxRetries?: number }} o
   *   `Anthropic`/`laad`/`fetch` zijn er voor de tests.
   */
  constructor({ apiKey, Anthropic = null, laad = laadSdk, fetch: f = null, maxRetries = 2 } = {}) {
    if (!apiKey) throw new AiFout('Geen API-key ingesteld. Voeg je Anthropic API-key toe in Instellingen.', { soort: 'geen-key' });
    this.#key = apiKey;
    this.#Anthropic = Anthropic;
    this.#laad = laad;
    this.#fetch = f;
    this.maxRetries = maxRetries;
  }
  #key; #Anthropic; #laad; #fetch; #sdk = null;

  async #client() {
    if (this.#sdk) return this.#sdk;
    const A = this.#Anthropic || await this.#laad();
    const opties = { apiKey: this.#key, dangerouslyAllowBrowser: true, maxRetries: this.maxRetries, logLevel: 'off' };
    if (this.#fetch) opties.fetch = this.#fetch;
    this.#sdk = new A(opties);
    return this.#sdk;
  }

  /**
   * Eén Messages-aanroep met streaming. Geeft het volledige bericht terug (finalMessage), of gooit een AiFout.
   * Automatische terugval (één keer, gemeld in `aanpassingen`):
   *  - 400 over `fallbacks` ⇒ opnieuw zonder fallbacks;
   *  - 400 over het schema/output_config.format ⇒ opnieuw zonder structured outputs (JSON enkel via de prompt).
   * @param {object} instellingen { model, effort, fallbacks }
   * @param {Array} berichten
   * @param {{ signal?: AbortSignal, opTekst?: (aantalTekens: number) => void }} o
   * @returns {Promise<{ bericht: object, params: object, aanpassingen: string[] }>}
   */
  async genereer(instellingen, berichten, { signal = null, opTekst = null } = {}) {
    const client = await this.#client();
    const aanpassingen = [];
    let opties = { structured: true, fallbacks: true };
    for (let poging = 0; poging < 3; poging++) {
      const params = bouwVerzoek(instellingen, berichten, opties);
      try {
        const stream = client.beta.messages.stream(params, signal ? { signal } : undefined);
        if (opTekst) {
          let n = 0;
          stream.on('text', (delta) => { n += delta.length; try { opTekst(n); } catch { /* UI-fout negeren */ } });
        }
        const bericht = await stream.finalMessage();
        return { bericht, params, aanpassingen };
      } catch (err) {
        const fout = vertaalFout(err, { key: this.#key, afgebroken: !!signal?.aborted });
        const detail = apiMelding(err);
        if (fout.soort === 'ongeldig' && opties.fallbacks && params.fallbacks && /fallback/i.test(detail)) {
          opties = { ...opties, fallbacks: false };
          aanpassingen.push(`Server-side fallbacks werden geweigerd voor dit model; opnieuw geprobeerd zonder (${FALLBACK_BETA}).`);
          continue;
        }
        if (fout.soort === 'ongeldig' && opties.structured && /output_config|format|schema/i.test(detail)) {
          opties = { ...opties, structured: false };
          aanpassingen.push('Het antwoordschema (structured outputs) werd geweigerd; opnieuw geprobeerd met JSON via de instructies.');
          continue;
        }
        throw fout;
      }
    }
    throw new AiFout('De aanvraag werd herhaaldelijk geweigerd.', { soort: 'ongeldig' });
  }
}
