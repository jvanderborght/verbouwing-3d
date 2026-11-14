// Eén gesprek met Claude over één opdracht: eerste vraag, eventueel één herstelpoging, vragen beantwoorden.
// DOM-vrij (getest in tests/ai.test.js met een nagebootste fetch). De geschiedenis wordt enkel aangevuld (append-only),
// zodat de prompt-cache en eventuele denkblokken geldig blijven.

import { eersteBericht, antwoordBericht, assistentBericht } from './prompt.js';
import { leesAntwoord, beoordeel } from './verwerk.js';
import { telUsage } from './client.js';

export class Gesprek {
  /**
   * @param {{ client: import('./client.js').AiClient, instellingen: object, basis: object,
   *           niveau?: string|null, selectie?: string|null, aantal?: number, modelInstellingen?: object }} o
   *   basis = het actieve ontwerp op het moment van de opdracht (blijft de basis voor alle varianten).
   *   modelInstellingen = instellingen van het datamodel (js/model/instellingen.js: werkwaarden, trapgrenzen) voor macro's en programmatoets.
   */
  constructor({ client, instellingen, basis, niveau = null, selectie = null, aantal = 1, modelInstellingen = null }) {
    this.client = client;
    this.instellingen = instellingen;
    this.basis = basis;
    this.niveau = niveau;
    this.selectie = selectie;
    this.aantal = aantal;
    this.modelInstellingen = modelInstellingen;
    this.berichten = [];
    this.verbruik = [];        // [{ usage, model }]
    this.aanpassingen = [];    // automatische terugval (fallbacks/schema)
    this.fallbacks = [];       // [{ van, naar }]
    this.herstelPogingen = 0;
  }

  get usage() { return telUsage(this.verbruik); }

  /** Eerste opdracht. → resultaat van beoordeel() (+ herstel al uitgevoerd). */
  async start(opdracht, opties = {}) {
    this.berichten = [eersteBericht(this.basis, opdracht, { aantal: this.aantal, niveau: this.niveau, selectie: this.selectie })];
    return this.#ronde(opties);
  }

  /** Antwoord op vragen van Claude (zelfde gesprek). */
  async beantwoord(tekst, opties = {}) {
    this.berichten.push(antwoordBericht(tekst, this.aantal));
    this.herstelPogingen = 0;
    return this.#ronde(opties);
  }

  async #ronde({ signal = null, opVoortgang = null } = {}) {
    for (;;) {
      opVoortgang?.({ fase: this.herstelPogingen ? 'herstel' : 'vraag', tekens: 0 });
      const { bericht, aanpassingen } = await this.client.genereer(this.instellingen, this.berichten, {
        signal, opTekst: (n) => opVoortgang?.({ fase: this.herstelPogingen ? 'herstel' : 'vraag', tekens: n }),
      });
      this.aanpassingen.push(...aanpassingen);
      this.verbruik.push({ usage: bericht.usage, model: bericht.model || this.instellingen.model });
      const gelezen = leesAntwoord(bericht);
      if (gelezen.fallback) this.fallbacks.push(gelezen.fallback);
      const r = beoordeel(this.basis, gelezen, { herstelPogingen: this.herstelPogingen, instellingen: this.modelInstellingen });
      // het antwoord komt in de geschiedenis (behalve bij een weigering of afgebroken antwoord: dat gesprek stopt)
      if (gelezen.status === 'ok' || gelezen.status === 'ongeldig') this.berichten.push(assistentBericht(bericht));
      if (r.actie === 'herstel') {
        this.herstelPogingen++;
        this.berichten.push(r.herstel);
        continue;
      }
      return { ...r, herstelPogingen: this.herstelPogingen, model: bericht.model };
    }
  }
}
