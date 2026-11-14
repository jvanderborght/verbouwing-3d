// Promptveld "Opdracht aan Claude" (fase 4): opdracht → Claude geeft operaties → validatie → diff-preview → bevestigen.
// Niet-modaal paneel (desktop rechts, telefoon onderaan) zodat de plattegrond het voorbeeld blijft tonen.
// Alle wijzigingen lopen via de callbacks van de app (operaties op de Geschiedenis / nieuwe varianten).
// Twee werkwijzen (fase 5c): "Met API-key" (rechtstreeks naar de Anthropic API) en "Handmatig" (zonder key: de opdracht
// wordt gekopieerd naar een Claude-chat naar keuze en het JSON-antwoord wordt teruggeplakt; zelfde verwerking en preview).

import { h, leeg } from './dom.js';
import { meld } from './dialogen.js';
import { cijfersVoor, totaalTekst } from './kerncijferspaneel.js';
import { fmtM2, fmtM3, fmtBedrag, fmtGetal } from '../metrics/index.js';
import { normaliseerInstellingen, MODELLEN, MAX_VARIANTEN } from '../ai/prompt.js';
import { AiClient, PRIJZEN_BRON } from '../ai/client.js';
import { Gesprek } from '../ai/gesprek.js';
import { voorbeeldHulp } from '../ai/verwerk.js';
import { HandmatigGesprek, tekstGrootte } from '../ai/handmatig.js';

const FASE = { vraag: 'Claude denkt na…', herstel: 'Fouten teruggestuurd naar Claude (herstelpoging)…' };
const SOORT_LABEL = { nieuw: 'nieuw', afbraak: 'afbraak', gewijzigd: 'gewijzigd', verwijderd: 'verwijderd' };

const PRIVACY = {
  api: 'Het actieve ontwerp (JSON met maten) en je opdracht gaan naar de Anthropic API, met je eigen key; de kosten zijn voor je API-account. Er wordt niets toegepast zonder jouw bevestiging.',
  handmatig: 'Privacy: de gekopieerde tekst bevat het volledige actieve ontwerp (JSON met maten en ruimtenamen) en je opdracht; die komen terecht in de Claude-chat waarin je ze plakt (en in de geschiedenis van dat account). Plak ze enkel in een chat die je organisatie toelaat. Er wordt niets toegepast zonder jouw bevestiging.',
};

/** Tekst naar het klembord. → true als het lukte (anders toont de UI de tekst om zelf te kopiëren). */
async function naarKlembord(tekst) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(tekst); return true; }
  } catch { /* terugval hieronder */ }
  try {
    const ta = h('textarea', { readonly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0' });
    ta.value = tekst;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
}

const delta = (a, b, fmt) => {
  if (a == null || b == null) return '';
  const d = b - a;
  if (Math.abs(d) < 0.05) return '=';
  return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
};

/** Fase 5: toets aan het programma van eisen van de variant (toetsProgramma), of null. */
function programmaBlok(t) {
  if (!t) return null;
  const s = t.samenvatting;
  return h('details', { class: 'ai-diff ai-programma', open: true },
    h('summary', {}, `Programma van eisen: ${s.voldoet} voldoet, ${s['voldoet niet']} voldoet niet, ${s.onbekend} onbekend`),
    t.fout ? h('p', { class: 'ai-info' }, t.fout) : null,
    h('ul', {}, ...t.resultaten.map((r) => h('li', { 'data-status': r.status }, h('strong', {}, `${r.label}: ${r.status}`), ` — ${r.uitleg}`))));
}

export class OpdrachtPaneel {
  /**
   * @param {{
   *   el: HTMLElement, knop: HTMLElement, beheer, aiOpslag,
   *   context: () => ({ niveau: string|null, selectie: string|null }),
   *   opVoorbeeld: (v: null | { model, hulp: (niveau) => object, niveaus: string[] }) => void,
   *   opToepassen: (ops: Array, label: string) => boolean,
   *   opBewaarNieuw: (lijst: Array<{ model, naam, beschrijving }>, basisId: string) => Promise<void>,
   *   opInstellingen: () => Promise<void>, opNiveau: (id) => void, opOpen?: (open: boolean) => void,
   * }} o
   */
  constructor(o) {
    this.o = o;
    this.el = o.el;
    this.gesprek = null;
    this.resultaat = null;    // laatste beoordeel()-resultaat
    this.actief = 0;          // index van de variant in voorbeeld
    this.bezig = null;        // AbortController
    this.basisId = null;
    this.bouw();
  }

  get isOpen() { return !this.el.hidden; }

  open() {
    this.el.hidden = false;
    this.o.knop?.setAttribute('aria-expanded', 'true');
    this.el.classList.remove('ingeklapt');
    this.vernieuwKey();
    this.o.opOpen?.(true);
    this.toonVoorbeeld();
    setTimeout(() => { if (!this.bezig) this.invoer.focus({ preventScroll: true }); }, 0);
  }

  sluit() {
    this.bezig?.abort();
    this.el.hidden = true;
    this.o.knop?.setAttribute('aria-expanded', 'false');
    this.o.opVoorbeeld(null);
    this.o.opOpen?.(false);
  }

  wissel() { if (this.isOpen) this.sluit(); else this.open(); }

  // ---------------------------------------------------------------- opbouw

  bouw() {
    leeg(this.el);
    this.invoer = h('textarea', {
      id: 'ai-opdracht', rows: 3, enterkeyhint: 'send', spellcheck: 'true', autocapitalize: 'sentences',
      placeholder: 'Bv. "Verleng de keuken 2 m naar de tuin met een plat dak" of "Breek de achterbouw af en maak 2 slaapkamers onder het dak"',
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.genereer(); } },
    });
    this.aantal = h('select', { id: 'ai-aantal', class: 'compact' }, ...Array.from({ length: MAX_VARIANTEN }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    this.genKnop = h('button', { type: 'button', class: 'knop primair', id: 'ai-genereer', onclick: () => this.genereer() }, 'Genereer');
    this.kopKnop = h('button', { type: 'button', class: 'knop primair', id: 'ai-kopieer', hidden: true, onclick: () => this.kopieer() }, 'Kopieer opdracht voor Claude');
    const modusKnop = (m, label) => h('button', { type: 'button', class: 'knop klein', 'data-modus': m, 'aria-pressed': 'false', onclick: () => this.zetModus(m) }, label);
    this.modusKnoppen = { api: modusKnop('api', 'Met API-key'), handmatig: modusKnop('handmatig', 'Handmatig (zonder key)') };
    this.modusRij = h('div', { class: 'ai-modus', role: 'group', 'aria-label': 'Werkwijze' }, this.modusKnoppen.api, this.modusKnoppen.handmatig);
    this.privacy = h('p', { class: 'ai-privacy' });
    this.annKnop = h('button', { type: 'button', class: 'knop', id: 'ai-annuleer', hidden: true, onclick: () => this.bezig?.abort() }, 'Annuleren');
    this.voortgang = h('div', { class: 'ai-voortgang', role: 'status', 'aria-live': 'polite' });
    this.geenKey = h('div', { class: 'ai-geen-key', hidden: true });
    this.formulier = h('div', { class: 'ai-formulier' },
      h('label', { class: 'veld-label', for: 'ai-opdracht' }, 'Wat wil je veranderen?'),
      this.invoer,
      h('div', { class: 'ai-rij' },
        h('label', { class: 'ai-aantal', for: 'ai-aantal' }, 'Varianten', this.aantal),
        h('span', { class: 'ai-spatie' }),
        this.annKnop, this.genKnop, this.kopKnop),
      this.voortgang,
      this.privacy);
    // handmatige modus: kopiëren → in een Claude-chat plakken → antwoord terugplakken
    this.kopieInfo = h('p', { class: 'ai-kopie-info', id: 'ai-kopie-info', role: 'status', 'aria-live': 'polite' });
    this.kopieVak = h('textarea', { id: 'ai-kopie-tekst', class: 'ai-kopie-tekst', rows: 4, readonly: true, hidden: true, 'aria-label': 'Tekst voor Claude (zelf selecteren en kopiëren)' });
    this.plak = h('textarea', {
      id: 'ai-plak', rows: 4, spellcheck: 'false', autocapitalize: 'off',
      placeholder: 'Plak hier het volledige antwoord van Claude (het JSON-codeblok mag met de tekst errond).',
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.verwerkGeplakt(); } },
    });
    this.verwerkKnop = h('button', { type: 'button', class: 'knop primair', id: 'ai-verwerk', onclick: () => this.verwerkGeplakt() }, 'Verwerken');
    this.handBlok = h('div', { class: 'ai-hand', hidden: true },
      h('ol', { class: 'ai-stappen' },
        h('li', {}, 'Typ je opdracht en klik "Kopieer opdracht voor Claude".'),
        h('li', {}, 'Plak de tekst als nieuw gesprek in een Claude-chat die je organisatie toelaat. Dat werkt met elke Claude-chat: de tekst bevat de regels, het antwoordschema en het ontwerp.'),
        h('li', {}, 'Kopieer het antwoord van Claude, plak het hieronder en klik "Verwerken". Je krijgt dezelfde controle en hetzelfde voorbeeld als met een API-key.')),
      this.kopieInfo, this.kopieVak,
      h('label', { class: 'veld-label', for: 'ai-plak' }, 'Plak het antwoord van Claude'),
      this.plak,
      h('div', { class: 'ai-rij' }, h('span', { class: 'ai-spatie' }), this.verwerkKnop));
    this.uitvoer = h('div', { class: 'ai-uitvoer', id: 'ai-uitvoer' });
    const kop = h('div', { class: 'ai-kop' },
      h('h2', { id: 'ai-titel' }, 'Opdracht aan Claude'),
      h('button', { type: 'button', class: 'knop klein ai-inklap', 'aria-label': 'In- of uitklappen', title: 'In-/uitklappen (plattegrond bekijken)', onclick: () => this.el.classList.toggle('ingeklapt') }, '▾'),
      h('button', { type: 'button', class: 'knop klein', 'aria-label': 'Sluiten', title: 'Sluiten', onclick: () => this.sluit() }, '×'));
    this.el.append(kop, h('div', { class: 'ai-romp' }, this.modusRij, this.geenKey, this.formulier, this.handBlok, this.uitvoer));
    this.el.setAttribute('aria-labelledby', 'ai-titel');
  }

  /** 'api' (met key) of 'handmatig' (zonder key altijd, of als de gebruiker dat kiest). */
  get modus() { return this.o.aiOpslag.key() && this.o.aiOpslag.modus() !== 'handmatig' ? 'api' : 'handmatig'; }

  zetModus(m) {
    if (this.bezig) return;
    if (m === 'api' && !this.o.aiOpslag.key()) { this.vernieuwKey(); return; }
    this.o.aiOpslag.bewaarModus(m);
    this.vernieuwKey();
  }

  vernieuwKey() {
    const heeft = !!this.o.aiOpslag.key();
    const hand = this.modus === 'handmatig';
    for (const [m, k] of Object.entries(this.modusKnoppen)) {
      k.setAttribute('aria-pressed', String((m === 'handmatig') === hand));
      k.classList.toggle('actief', (m === 'handmatig') === hand);
    }
    this.modusKnoppen.api.disabled = !heeft || !!this.bezig;
    this.modusKnoppen.api.title = heeft ? 'Rechtstreeks via de Anthropic API met je eigen key' : 'Geen API-key ingesteld op dit toestel';
    this.geenKey.hidden = heeft;
    this.formulier.classList.remove('uit');
    this.handBlok.hidden = !hand;
    this.genKnop.hidden = hand;
    this.kopKnop.hidden = !hand;
    this.invoer.disabled = !!this.bezig;
    this.genKnop.disabled = !heeft || !!this.bezig;
    this.privacy.textContent = PRIVACY[hand ? 'handmatig' : 'api'];
    this.el.classList.toggle('handmatig', hand);
    if (!heeft) {
      leeg(this.geenKey);
      this.geenKey.append(
        h('p', {}, 'Geen API-key op dit toestel: je werkt ', h('strong', {}, 'handmatig'), ' (kopiëren en plakken naar een Claude-chat). Daarvoor is geen key nodig.'),
        h('p', { class: 'ai-key-link' }, 'Heb je wel een eigen Anthropic API-key? ',
          h('button', { type: 'button', class: 'link', id: 'ai-key-instellen', onclick: async () => { await this.o.opInstellingen(); this.vernieuwKey(); } }, 'API-key instellen')));
    }
  }

  // ---------------------------------------------------------------- aanvraag

  #instellingen() { return normaliseerInstellingen(this.o.aiOpslag.instellingen()); }

  async genereer() {
    if (this.modus === 'handmatig') { await this.kopieer(); return; }
    const tekst = this.invoer.value.trim();
    if (this.bezig) return;
    if (!tekst) { this.invoer.focus(); meld('Typ eerst een opdracht.', 'info', { duur: 2500 }); return; }
    const key = this.o.aiOpslag.key();
    if (!key) { this.vernieuwKey(); return; }
    const basis = this.o.beheer.model;
    if (!basis) return;
    const ctx = this.o.context();
    this.basisId = this.o.beheer.actiefId;
    this.gesprek = new Gesprek({
      client: new AiClient({ apiKey: key }), instellingen: this.#instellingen(), basis,
      niveau: ctx.niveau, selectie: ctx.selectie, aantal: Number(this.aantal.value) || 1,
    });
    this.resultaat = null;
    this.o.opVoorbeeld(null);
    await this.#voerUit((opties) => this.gesprek.start(tekst, opties));
  }

  async beantwoord(tekst) {
    if (!this.gesprek || this.bezig || !tekst.trim()) return;
    if (this.gesprek.handmatig) { await this.#kopieerAntwoord(tekst); return; }
    await this.#voerUit((opties) => this.gesprek.beantwoord(tekst.trim(), opties));
  }

  // ---------------------------------------------------------------- handmatig (zonder key)

  #nieuwHandGesprek() {
    const basis = this.o.beheer.model;
    if (!basis) return null;
    const ctx = this.o.context();
    this.basisId = this.o.beheer.actiefId;
    this.gesprek = new HandmatigGesprek({ basis, niveau: ctx.niveau, selectie: ctx.selectie, aantal: Number(this.aantal.value) || 1 });
    this.resultaat = null;
    this.o.opVoorbeeld(null);
    leeg(this.uitvoer);
    return this.gesprek;
  }

  /** Toont een tekst die niet naar het klembord kon, om zelf te selecteren en te kopiëren. */
  #toonKopieVak(tekst) {
    this.kopieVak.value = tekst;
    this.kopieVak.hidden = false;
    this.kopieVak.focus({ preventScroll: true });
    this.kopieVak.select();
  }

  /** "Kopieer opdracht voor Claude": systeemprompt + schema + context + opdracht naar het klembord. */
  async kopieer() {
    if (this.bezig) return;
    const opdracht = this.invoer.value.trim();
    if (!opdracht) { this.invoer.focus(); meld('Typ eerst een opdracht.', 'info', { duur: 2500 }); return; }
    const g = this.#nieuwHandGesprek();
    if (!g) return;
    const tekst = g.kopieertekst(opdracht);
    const { tekens, kB } = tekstGrootte(tekst);
    const grootte = `${fmtGetal(tekens, 0)} tekens, ${fmtGetal(kB, 1)} kB`;
    this.kopieVak.hidden = true;
    this.plak.value = '';
    if (await naarKlembord(tekst)) {
      this.kopieInfo.textContent = `Opdracht gekopieerd (${grootte}). Plak ze als nieuw gesprek in een Claude-chat en plak het antwoord hieronder.`;
      meld('Opdracht gekopieerd naar het klembord.', 'ok', { duur: 2500 });
      this.plak.focus({ preventScroll: true });
    } else {
      this.kopieInfo.textContent = `Kopiëren naar het klembord lukte niet. Selecteer de tekst hieronder (${grootte}) en kopieer ze zelf.`;
      this.#toonKopieVak(tekst);
    }
  }

  /** "Verwerken": JSON uit het geplakte antwoord halen en verwerken zoals een API-antwoord. */
  verwerkGeplakt() {
    if (this.bezig) return;
    const tekst = this.plak.value;
    if (!tekst.trim()) { this.plak.focus(); meld('Plak eerst het antwoord van Claude.', 'info', { duur: 2500 }); return; }
    const g = this.gesprek?.handmatig ? this.gesprek : this.#nieuwHandGesprek();
    if (!g) return;
    const r = g.verwerk(tekst);
    if (r.actie === 'leeg') { meld(r.melding, 'info', { duur: 2500 }); return; }
    this.resultaat = r;
    this.actief = 0;
    this.#nieuwResultaat = true;
    this.render();
  }

  async #kopieerHerstel() {
    const t = this.resultaat?.herstelvraag;
    if (!t) return;
    if (await naarKlembord(t)) {
      meld('Herstelvraag gekopieerd. Plak ze in hetzelfde gesprek met Claude.', 'ok', { duur: 3000 });
      this.plak.value = '';
      this.plak.focus({ preventScroll: true });
    } else {
      this.kopieInfo.textContent = 'Kopiëren lukte niet. Selecteer de herstelvraag hieronder en kopieer ze zelf.';
      this.#toonKopieVak(t);
    }
  }

  async #kopieerAntwoord(tekst) {
    const t = this.gesprek.antwoord(tekst.trim());
    if (await naarKlembord(t)) {
      meld('Antwoord gekopieerd. Plak het in hetzelfde gesprek met Claude en plak daarna het nieuwe JSON-antwoord hierboven.', 'ok', { duur: 4000 });
      this.plak.value = '';
      this.plak.focus({ preventScroll: true });
    } else {
      this.kopieInfo.textContent = 'Kopiëren lukte niet. Selecteer de tekst hieronder en kopieer ze zelf.';
      this.#toonKopieVak(t);
    }
  }

  async #voerUit(fn) {
    const ac = new AbortController();
    this.bezig = ac;
    this.#zetBezig(true);
    leeg(this.uitvoer);
    this.voortgang.textContent = FASE.vraag;
    const start = Date.now();
    try {
      const r = await fn({
        signal: ac.signal,
        opVoortgang: ({ fase, tekens }) => {
          const s = Math.round((Date.now() - start) / 1000);
          this.voortgang.textContent = `${FASE[fase] || FASE.vraag}${tekens ? ` ${fmtGetal(tekens, 0)} tekens ontvangen` : ''} (${s} s)`;
        },
      });
      this.resultaat = r;
      this.actief = 0;
      this.#nieuwResultaat = true;
      this.voortgang.textContent = '';
      this.render();
    } catch (e) {
      this.voortgang.textContent = '';
      const soort = e?.soort || 'onbekend';
      if (soort === 'geannuleerd') { meld('Aanvraag geannuleerd. Er werd niets gewijzigd.', 'info'); this.#toonFout('Geannuleerd.', true); }
      else {
        // geen e.stack/e.cause loggen: de melding bevat nooit de key, de rest is niet nodig
        this.#toonFout(e?.message || 'Onbekende fout.');
        if (soort === 'auth') this.#knopInstellingen();
      }
    } finally {
      this.bezig = null;
      this.#zetBezig(false);
    }
  }

  #zetBezig(aan) {
    this.annKnop.hidden = !aan;
    this.genKnop.disabled = aan || !this.o.aiOpslag.key();
    this.kopKnop.disabled = aan;
    this.verwerkKnop.disabled = aan;
    for (const k of Object.values(this.modusKnoppen)) k.disabled = aan || (k === this.modusKnoppen.api && !this.o.aiOpslag.key());
    this.invoer.disabled = aan;
    this.aantal.disabled = aan;
    this.el.classList.toggle('bezig', aan);
  }

  #toonFout(tekst, zacht = false) {
    leeg(this.uitvoer);
    this.uitvoer.append(h('div', { class: zacht ? 'ai-info' : 'ai-fout', role: zacht ? 'status' : 'alert' }, ...String(tekst).split('\n').flatMap((r, i) => (i ? [h('br'), r] : [r]))));
    this.#usage();
  }

  #knopInstellingen() {
    this.uitvoer.append(h('button', { type: 'button', class: 'knop', onclick: async () => { await this.o.opInstellingen(); this.vernieuwKey(); } }, 'Instellingen openen'));
  }

  // ---------------------------------------------------------------- resultaat

  render() {
    const r = this.resultaat;
    leeg(this.uitvoer);
    if (!r) return;
    const g = this.gesprek;
    if (r.data?.samenvatting) this.uitvoer.append(h('p', { class: 'ai-samenvatting' }, r.data.samenvatting));
    for (const a of g?.aanpassingen || []) this.uitvoer.append(h('p', { class: 'ai-info' }, a));
    for (const f of g?.fallbacks || []) this.uitvoer.append(h('p', { class: 'ai-info' }, `Het gekozen model weigerde; ${f.naar || 'een ander model'} heeft het antwoord afgewerkt (server-side fallback).`));
    if (r.herstelPogingen) this.uitvoer.append(h('p', { class: 'ai-info' }, 'Het eerste antwoord bevatte fouten; Claude heeft het na één herstelpoging verbeterd.'));

    if (r.actie === 'fout') {
      this.uitvoer.append(h('div', { class: 'ai-fout', role: 'alert' }, ...String(r.melding).split('\n').flatMap((x, i) => (i ? [h('br'), x] : [x]))));
      if (g?.handmatig) this.uitvoer.append(h('p', { class: 'ai-uitleg' }, 'Begin opnieuw met "Kopieer opdracht voor Claude" (in een nieuw gesprek), eventueel met een eenvoudigere opdracht of minder varianten.'));
    } else if (r.actie === 'herstel') {
      this.#renderHerstel(r);
    } else if (r.actie === 'vragen') {
      this.#renderVragen(r.data.vragen);
    } else if (r.actie === 'toon') {
      this.#renderVarianten(r.varianten);
    }
    this.#usage();
    this.toonVoorbeeld();
    // resultaat in beeld (vooral op telefoon staat het onder het formulier)
    const romp = this.uitvoer.parentElement;
    if (romp && this.#nieuwResultaat) { romp.scrollTop = Math.max(0, this.uitvoer.offsetTop - romp.offsetTop - 8); this.#nieuwResultaat = false; }
  }

  #nieuwResultaat = false;

  /** Handmatig: het antwoord kon niet verwerkt worden ⇒ fouten + knop om de herstelvraag te kopiëren (één herstelpoging). */
  #renderHerstel(r) {
    // enkel de foutregels ("- …"); de macro-info ("· …") staat wel in de herstelvraag voor Claude
    const regels = String(r.foutTekst || '').split('\n').filter((x) => /^- /.test(x)).map((x) => x.slice(2));
    this.uitvoer.append(
      h('div', { class: 'ai-fout ai-herstel', role: 'alert' },
        h('strong', {}, 'Het antwoord kon niet verwerkt worden; er werd niets gewijzigd.'),
        h('ul', {}, ...regels.map((x) => h('li', {}, x)))),
      h('p', { class: 'ai-uitleg' }, 'Kopieer de herstelvraag, plak ze in HETZELFDE gesprek met Claude, en plak het verbeterde antwoord hierboven. Dat kan één keer.'),
      h('div', { class: 'ai-acties' }, h('button', { type: 'button', class: 'knop primair', id: 'ai-herstel-kopieer', onclick: () => this.#kopieerHerstel() }, 'Kopieer herstelvraag')));
  }

  #renderVragen(vragen) {
    const antw = h('textarea', { id: 'ai-antwoord', rows: 3, enterkeyhint: 'send', placeholder: 'Je antwoord…' });
    const stuur = () => this.beantwoord(antw.value);
    antw.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); stuur(); } });
    this.uitvoer.append(h('div', { class: 'ai-vragen' },
      h('h3', {}, 'Claude heeft eerst nog vragen'),
      h('ol', {}, ...vragen.map((v) => h('li', {}, v))),
      h('label', { class: 'veld-label', for: 'ai-antwoord' }, 'Antwoord'),
      antw,
      this.gesprek?.handmatig ? h('p', { class: 'ai-uitleg' }, 'Je antwoord wordt gekopieerd; plak het in hetzelfde gesprek met Claude en plak daarna het nieuwe antwoord hierboven.') : null,
      h('div', { class: 'ai-rij' }, h('span', { class: 'ai-spatie' }), h('button', { type: 'button', class: 'knop primair', id: 'ai-antwoord-stuur', onclick: stuur }, this.gesprek?.handmatig ? 'Kopieer antwoord voor Claude' : 'Antwoord versturen'))));
    setTimeout(() => antw.focus({ preventScroll: true }), 0);
  }

  #renderVarianten(varianten) {
    const basis = this.gesprek.basis;
    const c0 = cijfersVoor(basis);
    const n = varianten.length;
    const kaarten = varianten.map((v, i) => {
      const c1 = cijfersVoor(v.model);
      const rij = (label, a, b, fmt, fmtD) => h('tr', {}, h('th', {}, label), h('td', {}, fmt(b)), h('td', { class: 'ai-delta' }, delta(a, b, fmtD)));
      const r0 = c0.raming, r1 = c1.raming;
      const tel = v.telling;
      const chips = Object.entries(tel).filter(([, x]) => x).map(([s, x]) => h('span', { class: `ai-chip ai-${s}` }, `${x} ${SOORT_LABEL[s]}`));
      const niveaus = voorbeeldHulp(basis, v.model, v.diff, null).niveaus;
      const nvNaam = (id) => (v.model.niveaus.find((x) => x.id === id) || basis.niveaus.find((x) => x.id === id))?.naam || id;
      return h('article', { class: `ai-variant${i === this.actief ? ' actief' : ''}`, 'data-index': String(i) },
        h('div', { class: 'ai-variant-kop' },
          h('h3', {}, n > 1 ? `${i + 1}. ${v.naam}` : v.naam),
          n > 1 ? h('button', { type: 'button', class: 'knop klein', 'aria-pressed': String(i === this.actief), onclick: () => { this.actief = i; this.render(); } }, i === this.actief ? 'In voorbeeld' : 'Toon voorbeeld') : null),
        v.beschrijving ? h('p', { class: 'ai-beschrijving' }, v.beschrijving) : null,
        h('div', { class: 'ai-chips' }, ...chips),
        niveaus.length ? h('p', { class: 'ai-niveaus' }, 'Wijzigingen op: ', ...niveaus.map((id) => h('button', { type: 'button', class: 'link', onclick: () => { this.actief = i; this.o.opNiveau(id); this.render(); } }, nvNaam(id)))) : null,
        h('table', { class: 'kc-tabel ai-cijfers' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'na'), h('th', {}, 'Δ'))),
          h('tbody', {},
            rij('Bruto', c0.kerncijfers.bruto, c1.kerncijfers.bruto, fmtM2, fmtM2),
            rij('Netto', c0.kerncijfers.netto, c1.kerncijfers.netto, fmtM2, fmtM2),
            rij('Volume', c0.kerncijfers.volume.totaal, c1.kerncijfers.volume.totaal, fmtM3, fmtM3),
            h('tr', {}, h('th', {}, 'Raming'), h('td', {}, totaalTekst(r1)), h('td', { class: 'ai-delta' }, r0.volledig && r1.volledig ? delta(r0.totaal, r1.totaal, (x) => fmtBedrag(x, r1.valuta)) : '')))),
        h('details', { class: 'ai-diff' }, h('summary', {}, `Alle wijzigingen (${v.diff.length})`),
          h('ul', {}, ...v.diffTekst.map((t) => h('li', {}, t)))),
        v.waarschuwingen?.length ? h('p', { class: 'ai-info' }, `${v.waarschuwingen.length} aandachtspunt(en) na toepassen.`) : null,
        programmaBlok(v.programmaToets),
        v.meldingen?.length ? h('details', { class: 'ai-diff ai-meldingen' }, h('summary', {}, `Meldingen van de bewerkingen (${v.meldingen.length})`),
          h('ul', {}, ...v.meldingen.map((t) => h('li', {}, t)))) : null,
        h('div', { class: 'ai-acties' },
          h('button', { type: 'button', class: `knop${n === 1 ? ' primair' : ''}`, 'data-actie': 'toepassen', onclick: () => this.toepassen(i) }, 'Toepassen'),
          n === 1 ? h('button', { type: 'button', class: 'knop', 'data-actie': 'bewaren', onclick: () => this.bewaar([i]) }, 'Als nieuwe variant bewaren') : null));
    });
    this.uitvoer.append(h('div', { class: 'ai-varianten' }, ...kaarten));
    if (n > 1) {
      this.uitvoer.append(h('div', { class: 'ai-acties ai-alle' },
        h('button', { type: 'button', class: 'knop primair', id: 'ai-alle-bewaren', onclick: () => this.bewaar(varianten.map((_, i) => i)) }, `Als ${n} nieuwe varianten bewaren`)));
    }
    this.uitvoer.append(h('p', { class: 'ai-uitleg' }, 'Voorbeeld in de plattegrond: blauw = nieuw, rood = afbraak, oranje = gewijzigd. "Toepassen" wijzigt het actieve ontwerp in één stap (ongedaan maken met Ctrl+Z / ↶).'));
  }

  #usage() {
    const g = this.gesprek;
    if (!g || !g.verbruik.length) return;
    const u = g.usage;
    const kost = u.kost > 0 ? `≈ $${u.kost < 0.01 ? u.kost.toFixed(4) : u.kost.toFixed(3)}${u.kostOnbekend ? ' (deels onbekend)' : ''}` : (u.kostOnbekend ? 'onbekend' : '$0');
    const model = MODELLEN.find((m) => m.id === g.instellingen.model)?.naam.replace(' (standaard)', '') || g.instellingen.model;
    this.uitvoer.append(h('p', { class: 'ai-usage', id: 'ai-usage' },
      `${model}, effort ${g.instellingen.effort} · ${g.verbruik.length} aanvra${g.verbruik.length === 1 ? 'ag' : 'gen'} · tokens: invoer ${fmtGetal(u.input_tokens, 0)}, uit cache gelezen ${fmtGetal(u.cache_read_input_tokens, 0)}, naar cache geschreven ${fmtGetal(u.cache_creation_input_tokens, 0)}, uitvoer ${fmtGetal(u.output_tokens, 0)} · geschatte kost ${kost} (schatting; prijzen: ${PRIJZEN_BRON})`));
  }

  // ---------------------------------------------------------------- voorbeeld en bevestigen

  /** Toont de actieve variant als voorbeeld in 3D en plattegrond (of wist het voorbeeld). */
  toonVoorbeeld() {
    const r = this.resultaat;
    const v = this.isOpen && r?.actie === 'toon' ? r.varianten[this.actief] : null;
    if (!v) { this.o.opVoorbeeld(null); return; }
    const basis = this.gesprek.basis;
    this.o.opVoorbeeld({ model: v.model, hulp: (niveau) => ({ polygonen: voorbeeldHulp(basis, v.model, v.diff, niveau).polygonen }), niveaus: voorbeeldHulp(basis, v.model, v.diff, null).niveaus });
  }

  #basisGewijzigd() {
    return this.o.beheer.actiefId !== this.basisId || this.o.beheer.model !== this.gesprek?.basis;
  }

  toepassen(i) {
    const v = this.resultaat?.varianten?.[i];
    if (!v) return;
    if (this.#basisGewijzigd()) {
      meld('Het actieve ontwerp is intussen gewijzigd of je bekijkt een ander ontwerp. Geef de opdracht opnieuw, of bewaar het voorstel als nieuwe variant.', 'fout');
      return;
    }
    const ok = this.o.opToepassen(v.ops, `Opdracht: ${v.naam}`);
    if (!ok) return;
    this.resultaat = null;
    this.plak.value = '';
    this.kopieInfo.textContent = '';
    leeg(this.uitvoer);
    this.uitvoer.append(h('p', { class: 'ai-ok', role: 'status' }, `"${v.naam}" toegepast als één stap. Ongedaan maken kan met Ctrl+Z of de knop ↶.`));
    this.#usage();
    this.o.opVoorbeeld(null);
    meld(`"${v.naam}" toegepast. Ongedaan maken: Ctrl+Z.`, 'ok');
  }

  async bewaar(indexen) {
    const r = this.resultaat;
    if (!r?.varianten) return;
    const basisNaam = this.gesprek.basis.naam;
    const lijst = indexen.map((i) => r.varianten[i]).map((v) => ({ model: v.model, naam: `${basisNaam} – ${v.naam}`, beschrijving: v.beschrijving }));
    await this.o.opBewaarNieuw(lijst, this.basisId);
  }
}
