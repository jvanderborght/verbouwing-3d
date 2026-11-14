// Variantbeheer: inladen (Pages/API), werkkopieën, nieuw/dupliceren/hernoemen/verwijderen,
// import/export en synchronisatie met GitHub. DOM-vrij: beslissingen die de gebruiker moet nemen
// (conflict, overschrijven) worden als async callbacks meegegeven.

import { migreer, validate, formatteerFouten, naarJson, dupliceer, leegModel, Geschiedenis } from '../model/index.js';
import { LokaleOpslag, GitHubClient, GitHubFout, modelHash, SLEUTELS } from './opslag.js';

const GERESERVEERD = new Set(['index', 'prijzen']);
export const ID_PATROON = /^[a-z0-9][a-z0-9-_]*$/;
/** Hoe lang na een opslag de (gecachte) Pages-versie nog als "verouderd" geldt. */
export const PAGES_VERTRAGING_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- zuivere logica

/** Ontwerp-id afgeleid uit een naam: "Variant B – zolder" → "variant-b-zolder"; uniek t.o.v. `bestaande`. */
export function idUitNaam(naam, bestaande = []) {
  const bezet = new Set(bestaande);
  let basis = String(naam ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/[-_]+$/g, '');
  if (!basis || !ID_PATROON.test(basis)) basis = 'variant';
  if (GERESERVEERD.has(basis)) basis = `${basis}-ontwerp`;
  if (!bezet.has(basis)) return basis;
  for (let n = 2; ; n++) { const k = `${basis}-${n}`; if (!bezet.has(k)) return k; }
}

/**
 * Vergelijkt lokaal, basis (laatst gekende GitHub-versie waarop lokaal gebaseerd is) en de actuele GitHub-versie.
 * Alle argumenten zijn hashes (of null).
 * @returns {'gelijk'|'neem-github'|'behoud-lokaal'|'conflict'|'enkel-lokaal'}
 */
export function vergelijkMetGithub({ lokaal, basis, github }) {
  if (github == null) return 'enkel-lokaal';
  if (lokaal === github) return 'gelijk';
  if (basis != null && lokaal === basis) return 'neem-github';   // enkel GitHub veranderde
  if (basis != null && github === basis) return 'behoud-lokaal'; // enkel lokaal veranderde
  return 'conflict';                                             // beide veranderden (of geen gemeenschappelijke basis)
}

/**
 * Toestand voor de gebruiker.
 * @returns {'gelijk'|'gewijzigd'|'enkel-lokaal'|'github-nieuwer'|'conflict'}
 */
export function bepaalToestand({ lokaal, basis, github = null }) {
  if (basis == null) {
    if (github == null) return 'enkel-lokaal';
    return github === lokaal ? 'gelijk' : 'conflict';
  }
  if (github != null && github !== basis && github !== lokaal) return lokaal === basis ? 'github-nieuwer' : 'conflict';
  return lokaal === basis ? 'gelijk' : 'gewijzigd';
}

export const TOESTAND_LABELS = {
  'gelijk': 'Gelijk met GitHub',
  'gewijzigd': 'Lokale wijzigingen – niet op GitHub',
  'enkel-lokaal': 'Enkel lokaal – nog niet op GitHub',
  'github-nieuwer': 'Nieuwere versie op GitHub',
  'conflict': 'Conflict: ook op GitHub gewijzigd',
};

/**
 * Bij het openen: werkkopie of de versie van de Pages-site?
 * De Pages-site kan na een opslag nog enkele minuten de oude versie serveren; binnen dat venster
 * wint de werkkopie. `gezaghebbend` = versie komt rechtstreeks uit de API (niet gecachet).
 * @returns {{ bron: 'werkkopie'|'github', toestand: string, githubBetrouwbaar: boolean }}
 */
export function kiesBijLaden({ lokaal, basis, github, basisTijd = 0, nu = Date.now(), gezaghebbend = false, venster = PAGES_VERTRAGING_MS }) {
  if (lokaal == null) return { bron: 'github', toestand: 'gelijk', githubBetrouwbaar: true };
  if (github == null || github === basis || github === lokaal) {
    return { bron: 'werkkopie', toestand: bepaalToestand({ lokaal, basis: github === lokaal ? lokaal : basis }), githubBetrouwbaar: github != null };
  }
  // github verschilt van basis én van lokaal
  if (!gezaghebbend && basis != null && nu - basisTijd < venster) {
    return { bron: 'werkkopie', toestand: bepaalToestand({ lokaal, basis }), githubBetrouwbaar: false };
  }
  if (basis != null && lokaal === basis) return { bron: 'github', toestand: 'gelijk', githubBetrouwbaar: true };
  return { bron: 'werkkopie', toestand: 'conflict', githubBetrouwbaar: true };
}

/** JSON-tekst → gevalideerd ontwerp. Gooit nooit; geeft leesbare fouten terug. */
export function leesOntwerpTekst(tekst) {
  let data;
  try { data = JSON.parse(tekst); }
  catch (e) { return { ok: false, fouten: [`Geen geldige JSON: ${e.message}`], model: null, waarschuwingen: [] }; }
  let model;
  try { model = migreer(data); }
  catch (e) { return { ok: false, fouten: [e.message], model: null, waarschuwingen: [] }; }
  const r = validate(model);
  if (!r.geldig) return { ok: false, fouten: formatteerFouten({ fouten: r.fouten, waarschuwingen: [] }).split('\n'), model: null, waarschuwingen: r.waarschuwingen };
  return { ok: true, fouten: [], model, waarschuwingen: r.waarschuwingen };
}

/** designs/index.json bijwerken (puur): voegt id toe of past de naam aan. → { index, gewijzigd } */
export function werkIndexBij(index, id, naam) {
  const lijst = Array.isArray(index?.ontwerpen) ? index.ontwerpen.map((o) => ({ ...o })) : [];
  const i = lijst.findIndex((o) => o.id === id);
  if (i >= 0 && lijst[i].naam === naam) return { index: { ...index, ontwerpen: lijst }, gewijzigd: false };
  if (i >= 0) lijst[i].naam = naam; else lijst.push({ id, naam });
  return { index: { ...(index || {}), ontwerpen: lijst }, gewijzigd: true };
}

export const indexNaarJson = (index) => JSON.stringify(index, null, 2) + '\n';

// ---------------------------------------------------------------- beheer

export class VariantBeheer {
  /**
   * @param {{ opslag?: LokaleOpslag, fetch?: Function, basisUrl?: string, nu?: () => number, maakClient?: (inst) => GitHubClient }} o
   *   basisUrl = map met designs/ (relatief aan de pagina, werkt op GitHub Pages).
   */
  constructor({ opslag = new LokaleOpslag(), fetch: f, basisUrl = 'designs/', nu = () => Date.now(), maakClient } = {}) {
    this.opslag = opslag;
    this.fetch = f || globalThis.fetch?.bind(globalThis);
    this.basisUrl = basisUrl;
    this.nu = nu;
    this.maakClient = maakClient || ((inst) => new GitHubClient({ ...inst, fetch: this.fetch }));
    /** @type {Array<{id: string, naam: string}>} index zoals laatst gezien op GitHub/Pages */
    this.index = [];
    /** id → { model, hash, sha, gezaghebbend } laatst gekende GitHub-versie */
    this.github = new Map();
    /** id → Geschiedenis (blijft bestaan zolang de pagina open is) */
    this.geschiedenissen = new Map();
    /** id → { basisHash, basisSha, basisTijd, githubBetrouwbaar, conflict } */
    this.meta = new Map();
    this.actiefId = null;
    this.luisteraars = new Set();
  }

  /** Luisteraar: (soort, details) bij elke wijziging van model, lijst of toestand. */
  opWijziging(fn) { this.luisteraars.add(fn); return () => this.luisteraars.delete(fn); }
  #melden(soort, details = {}) { for (const fn of this.luisteraars) fn(soort, details); }

  client() {
    const inst = this.opslag.instellingen();
    return this.maakClient({ ...inst, token: this.opslag.token() });
  }

  get geschiedenis() { return this.actiefId ? this.geschiedenissen.get(this.actiefId) : null; }
  get model() { return this.geschiedenis?.huidig ?? null; }

  // ---------- inladen

  async #haalPages(pad) {
    const res = await this.fetch(this.basisUrl + pad, { cache: 'no-cache' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Kon ${pad} niet laden (HTTP ${res.status}).`);
    return res.text();
  }

  /** Laadt designs/index.json van de site. Netwerkfout → lege index (lokale werkkopieën blijven bruikbaar). */
  async laadIndex() {
    try {
      const t = await this.#haalPages('index.json');
      const j = t ? JSON.parse(t) : { ontwerpen: [] };
      this.index = (j.ontwerpen || []).filter((o) => o && typeof o.id === 'string').map((o) => ({ id: o.id, naam: o.naam || o.id }));
      return { ok: true };
    } catch (e) {
      return { ok: false, melding: `De lijst met ontwerpen kon niet geladen worden (${e.message}). Enkel lokale kopieën zijn beschikbaar.` };
    }
  }

  /** Alle gekende ontwerpen (index + lokale werkkopieën) met toestand. */
  lijst() {
    const uit = [];
    const gezien = new Set();
    for (const o of this.index) { uit.push({ id: o.id, naam: this.#naamVan(o.id) || o.naam, toestand: this.toestand(o.id) }); gezien.add(o.id); }
    for (const id of this.opslag.werkkopieIds().sort()) {
      if (gezien.has(id)) continue;
      uit.push({ id, naam: this.#naamVan(id) || id, toestand: this.toestand(id) });
    }
    return uit;
  }

  #naamVan(id) {
    const g = this.geschiedenissen.get(id);
    if (g) return g.huidig.naam;
    return this.opslag.werkkopie(id)?.model?.naam ?? null;
  }

  bestaat(id) { return this.index.some((o) => o.id === id) || !!this.opslag.werkkopie(id) || this.geschiedenissen.has(id); }
  alleIds() { return [...new Set([...this.index.map((o) => o.id), ...this.opslag.werkkopieIds(), ...this.geschiedenissen.keys()])]; }

  toestand(id) {
    const g = this.geschiedenissen.get(id);
    const wk = g ? null : this.opslag.werkkopie(id);
    const meta = this.meta.get(id) || (wk ? { basisHash: wk.basisHash ?? null } : null);
    if (!g && !wk) return this.index.some((o) => o.id === id) ? 'gelijk' : 'enkel-lokaal';
    if (meta?.conflict) return 'conflict';
    const lokaal = modelHash(g ? g.huidig : wk.model);
    const gh = this.github.get(id);
    const githubBetrouwbaar = meta?.githubBetrouwbaar ?? false;
    return bepaalToestand({ lokaal, basis: meta?.basisHash ?? null, github: gh && githubBetrouwbaar ? gh.hash : null });
  }

  /**
   * Opent een ontwerp: werkkopie en/of GitHub-versie (Pages; als die ontbreekt via de API).
   * @returns {Promise<{ ok: boolean, melding?: string, waarschuwingen?: Array }>}
   */
  async open(id) {
    if (this.geschiedenissen.has(id)) { this.#activeer(id); return { ok: true }; }
    const wk = this.opslag.werkkopie(id);
    let gh = this.github.get(id) || null;
    const meldingen = [];
    // Enkel ontwerpen uit de index staan op de site (anders 404-ruis in de console).
    if (!gh && this.index.some((o) => o.id === id)) {
      try {
        let tekst = await this.#haalPages(`${id}.json`).catch(() => null);
        let gezaghebbend = false, sha = null;
        if (tekst == null) {
          // Net toegevoegd op een ander toestel: Pages is nog niet bijgewerkt → API.
          const r = await this.client().lees(`designs/${id}.json`).catch(() => null);
          if (r) { tekst = r.tekst; sha = r.sha; gezaghebbend = true; }
        }
        if (tekst != null) {
          const r = leesOntwerpTekst(tekst);
          if (r.ok) { gh = { model: r.model, hash: modelHash(r.model), sha, gezaghebbend }; this.github.set(id, gh); }
          else meldingen.push(`De GitHub-versie van "${id}" is ongeldig:\n${r.fouten.join('\n')}`);
        }
      } catch (e) { meldingen.push(e.message); }
    }

    let model, meta;
    if (wk) {
      const lk = leesOntwerpTekst(JSON.stringify(wk.model));
      const lokaalOk = lk.ok;
      if (!lokaalOk) meldingen.push(`De lokale kopie van "${id}" is ongeldig en wordt genegeerd:\n${lk.fouten.join('\n')}`);
      const keuze = lokaalOk
        ? kiesBijLaden({ lokaal: modelHash(lk.model), basis: wk.basisHash ?? null, github: gh?.hash ?? null, basisTijd: wk.basisTijd || 0, nu: this.nu(), gezaghebbend: gh?.gezaghebbend })
        : { bron: 'github', githubBetrouwbaar: true };
      if (keuze.bron === 'werkkopie') {
        model = lk.model;
        const syncNu = gh && gh.hash === modelHash(model);
        meta = {
          basisHash: syncNu ? gh.hash : (wk.basisHash ?? null),
          basisSha: syncNu ? (gh.sha ?? wk.basisSha ?? null) : (wk.basisSha ?? null),
          basisTijd: wk.basisTijd || 0,
          githubBetrouwbaar: keuze.githubBetrouwbaar,
          conflict: keuze.toestand === 'conflict',
        };
        if (meta.conflict) meldingen.push(`"${model.naam}" werd ook op GitHub gewijzigd. Kies "Ophalen van GitHub" om te beslissen welke versie je houdt.`);
      } else if (gh) {
        model = gh.model;
        meta = { basisHash: gh.hash, basisSha: gh.sha, basisTijd: gh.gezaghebbend ? this.nu() : 0, githubBetrouwbaar: true, conflict: false };
        this.opslag.wisWerkkopie(id);
      }
    } else if (gh) {
      model = gh.model;
      meta = { basisHash: gh.hash, basisSha: gh.sha, basisTijd: gh.gezaghebbend ? this.nu() : 0, githubBetrouwbaar: true, conflict: false };
    }
    if (!model) return { ok: false, melding: meldingen.join('\n') || `Ontwerp "${id}" kon niet geladen worden.` };
    if (model.id !== id) { meldingen.push(`Let op: bestand "${id}" bevat id "${model.id}".`); }

    this.meta.set(id, meta);
    this.#maakGeschiedenis(id, model);
    this.#activeer(id);
    return { ok: true, melding: meldingen.join('\n') || undefined, waarschuwingen: validate(model).waarschuwingen };
  }

  /**
   * Leest een ontwerp ZONDER het te openen of te activeren (bv. om te vergelijken). Wijzigt niets.
   * Volgorde: geopend ontwerp (huidige toestand) > werkkopie op dit toestel > gekende GitHub-versie > Pages.
   * @returns {Promise<{ ok: boolean, model?: object, melding?: string }>}
   */
  async leesModel(id) {
    const g = this.geschiedenissen.get(id);
    if (g) return { ok: true, model: g.huidig };
    const wk = this.opslag.werkkopie(id);
    if (wk) {
      const r = leesOntwerpTekst(JSON.stringify(wk.model));
      if (r.ok) return { ok: true, model: r.model };
    }
    const gh = this.github.get(id);
    if (gh) return { ok: true, model: gh.model };
    if (this.index.some((o) => o.id === id)) {
      try {
        const t = await this.#haalPages(`${id}.json`);
        if (t != null) {
          const r = leesOntwerpTekst(t);
          if (r.ok) return { ok: true, model: r.model };
          return { ok: false, melding: `"${id}" is geen geldig ontwerp:\n${r.fouten.join('\n')}` };
        }
      } catch (e) { return { ok: false, melding: e.message }; }
    }
    return { ok: false, melding: `Ontwerp "${id}" kon niet geladen worden.` };
  }

  #maakGeschiedenis(id, model) {
    const g = new Geschiedenis(model);
    g.opWijziging(() => { this.#bewaar(id); this.#melden('model', { id }); });
    this.geschiedenissen.set(id, g);
    return g;
  }

  #activeer(id) {
    this.actiefId = id;
    this.opslag.schrijf(SLEUTELS.laatste, id);
    this.#melden('actief', { id });
  }

  /** Schrijft de werkkopie weg. Geeft false als localStorage vol of geblokkeerd is. */
  #bewaar(id) {
    const g = this.geschiedenissen.get(id);
    if (!g) return true;
    const m = this.meta.get(id) || {};
    const ok = this.opslag.bewaarWerkkopie(id, { model: g.huidig, basisHash: m.basisHash ?? null, basisSha: m.basisSha ?? null, basisTijd: m.basisTijd || 0 });
    if (!ok) this.#melden('opslag-fout', { id });
    return ok;
  }

  laatsteId() { return this.opslag.lees(SLEUTELS.laatste); }

  // ---------- acties

  /** Nieuw ontwerp: leeg of kopie van het actieve. → { ok, id } */
  nieuw(naam, { kopie = false } = {}) {
    naam = String(naam || '').trim() || 'Nieuw ontwerp';
    const id = idUitNaam(naam, this.alleIds());
    const model = kopie && this.model ? dupliceer(this.model, id, naam) : leegModel(id, naam);
    if (!kopie) model.basis = null;
    const r = validate(model);
    if (!r.geldig) return { ok: false, melding: formatteerFouten(r) };
    this.meta.set(id, { basisHash: null, basisSha: null, basisTijd: 0, githubBetrouwbaar: false, conflict: false });
    this.#maakGeschiedenis(id, model);
    this.#bewaar(id);
    this.#activeer(id);
    return { ok: true, id };
  }

  dupliceer(naam) { return this.nieuw(naam, { kopie: true }); }

  /**
   * Bewaart een (al gevalideerd) model als nieuwe lokale variant ZONDER ze te openen (promptveld: N varianten).
   * Nieuw id uit de naam; basis = `basisId`. → { ok, id } of { ok: false, melding }
   */
  bewaarNieuw(model, naam, { basisId = null } = {}) {
    naam = String(naam || '').trim() || 'Variant';
    const id = idUitNaam(naam, [...this.alleIds(), ...GERESERVEERD]);
    const m = { ...model, id, naam, basis: basisId ?? model.basis ?? null };
    const r = validate(m);
    if (!r.geldig) return { ok: false, melding: formatteerFouten(r) };
    this.meta.set(id, { basisHash: null, basisSha: null, basisTijd: 0, githubBetrouwbaar: false, conflict: false });
    this.#maakGeschiedenis(id, m);
    if (!this.#bewaar(id)) return { ok: false, melding: 'Kon de variant niet lokaal bewaren (opslag vol of geblokkeerd).' };
    this.#melden('lijst', { id });
    return { ok: true, id };
  }

  /** Hernoemt via een `ontwerp`-operatie (undo-baar); id blijft. */
  hernoem(naam) {
    const g = this.geschiedenis;
    if (!g) return { ok: false, melding: 'Geen ontwerp geopend.' };
    naam = String(naam || '').trim();
    if (!naam) return { ok: false, melding: 'Naam mag niet leeg zijn.' };
    if (naam === g.huidig.naam) return { ok: true };
    const r = g.toepassen([{ op: 'ontwerp', velden: { naam } }], 'Hernoemen');
    return r.ok ? { ok: true } : { ok: false, melding: formatteerFouten(r) };
  }

  /** Verwijdert de lokale kopie (+ geschiedenis). Een ontwerp dat op GitHub staat blijft daar bestaan. */
  verwijder(id) {
    this.opslag.wisWerkkopie(id);
    this.geschiedenissen.delete(id);
    this.meta.delete(id);
    if (this.actiefId === id) this.actiefId = null;
    this.#melden('lijst', { id });
    return { ok: true, blijftOpGithub: this.index.some((o) => o.id === id) };
  }

  exporteer() {
    const m = this.model;
    if (!m) return null;
    return { bestandsnaam: `${m.id}.json`, tekst: naarJson(m) };
  }

  /** Stap 1 van import: lezen en valideren. Niets wordt toegepast. */
  controleerImport(tekst) {
    const r = leesOntwerpTekst(tekst);
    if (!r.ok) return r;
    const idOngeldig = GERESERVEERD.has(r.model.id);
    return { ...r, conflict: idOngeldig || this.bestaat(r.model.id), voorstelId: idUitNaam(r.model.naam || r.model.id, [...this.alleIds(), ...GERESERVEERD]) };
  }

  /**
   * Stap 2 van import. wijze: 'nieuw' (nieuw id) of 'vervang' (bestaand ontwerp overschrijven, undo-baar).
   */
  async importeer(model, { wijze = 'nieuw', nieuwId } = {}) {
    if (wijze === 'vervang') {
      const id = model.id;
      if (!this.geschiedenissen.has(id) && this.bestaat(id)) { const o = await this.open(id); if (!o.ok) return o; }
      if (!this.geschiedenissen.has(id)) {
        this.meta.set(id, { basisHash: null, basisSha: null, basisTijd: 0, githubBetrouwbaar: false, conflict: false });
        this.#maakGeschiedenis(id, model);
        this.#bewaar(id);
      } else {
        this.geschiedenissen.get(id).vastleggen(model, 'Import');
      }
      this.#activeer(id);
      return { ok: true, id };
    }
    const id = nieuwId || idUitNaam(model.naam || model.id, [...this.alleIds(), ...GERESERVEERD]);
    const m = { ...model, id };
    // Zelfde naam als een bestaand ontwerp? Dan onderscheiden, anders zijn ze in de kiezer niet uit elkaar te houden.
    if (this.lijst().some((o) => o.naam === m.naam)) m.naam = `${m.naam} (import)`;
    const r = validate(m);
    if (!r.geldig) return { ok: false, melding: formatteerFouten(r) };
    this.meta.set(id, { basisHash: null, basisSha: null, basisTijd: 0, githubBetrouwbaar: false, conflict: false });
    this.#maakGeschiedenis(id, m);
    this.#bewaar(id);
    this.#activeer(id);
    return { ok: true, id };
  }

  // ---------- GitHub

  /**
   * Slaat het actieve ontwerp op naar GitHub (designs/<id>.json, + index.json in dezelfde commit als nodig).
   * @param {{ bevestigOverschrijven?: (info) => Promise<boolean> }} o
   * @returns {Promise<{ ok: boolean, melding: string, soort?: string }>}
   */
  async opslaanNaarGithub({ bevestigOverschrijven = async () => false } = {}) {
    const g = this.geschiedenis;
    if (!g) return { ok: false, melding: 'Geen ontwerp geopend.' };
    const model = g.huidig, id = model.id;
    const v = validate(model);
    if (!v.geldig) return { ok: false, melding: `Niet opgeslagen: het ontwerp is ongeldig.\n${formatteerFouten({ fouten: v.fouten, waarschuwingen: [] })}` };
    if (id !== this.actiefId) return { ok: false, melding: `Intern id "${id}" verschilt van bestand "${this.actiefId}"; exporteer en importeer opnieuw.` };
    const client = this.client();
    if (!client.heeftToken) return { ok: false, soort: 'geen-token', melding: 'Geen GitHub-token ingesteld. Stel er een in via Instellingen, of gebruik "Exporteer JSON".' };

    const pad = `designs/${id}.json`;
    const tekst = naarJson(model);
    const lokaal = modelHash(model);
    try {
      const [huidig, idx] = await Promise.all([client.lees(pad), client.lees('designs/index.json')]);
      const meta = this.meta.get(id) || {};
      let remoteHash = null;
      if (huidig) {
        const r = leesOntwerpTekst(huidig.tekst);
        remoteHash = r.ok ? modelHash(r.model) : 'ongeldig';
      }
      const v2 = vergelijkMetGithub({ lokaal, basis: meta.basisHash ?? null, github: remoteHash });
      if (v2 === 'gelijk' && idx && !werkIndexBij(JSON.parse(idx.tekst), id, model.naam).gewijzigd) {
        this.#zetBasis(id, model, huidig.sha);
        return { ok: true, melding: 'Al gelijk met GitHub; niets te doen.' };
      }
      if (v2 === 'neem-github' || v2 === 'conflict') {
        const ja = await bevestigOverschrijven({ id, naam: model.naam, zonderBasis: meta.basisHash == null });
        if (!ja) return { ok: false, soort: 'geannuleerd', melding: 'Opslaan geannuleerd. Kies "Ophalen van GitHub" om de GitHub-versie te bekijken.' };
      }
      let index = { ontwerpen: [] };
      if (idx) { try { index = JSON.parse(idx.tekst); } catch { /* kapotte index: herschrijven */ } }
      const ni = werkIndexBij(index, id, model.naam);
      let sha;
      if (ni.gewijzigd) {
        const r = await client.schrijfMeerdere(
          [{ pad, tekst }, { pad: 'designs/index.json', tekst: indexNaarJson(ni.index) }],
          { bericht: huidig ? `Ontwerp ${id} bijgewerkt vanuit de app` : `Ontwerp ${id} toegevoegd vanuit de app` },
        );
        sha = r.shas[pad];
        this.index = ni.index.ontwerpen.map((o) => ({ id: o.id, naam: o.naam }));
      } else {
        sha = (await client.schrijf(pad, tekst, { sha: huidig?.sha ?? null, bericht: `Ontwerp ${id} bijgewerkt vanuit de app` })).sha;
      }
      this.#zetBasis(id, model, sha);
      return { ok: true, melding: `Opgeslagen naar GitHub (${client.owner}/${client.repo}, ${client.branch}). De website is binnen enkele minuten bijgewerkt.` };
    } catch (e) {
      if (e instanceof GitHubFout) return { ok: false, soort: e.soort, melding: e.message };
      return { ok: false, melding: `Opslaan mislukt: ${e.message}` };
    }
  }

  #zetBasis(id, model, sha) {
    const hash = modelHash(model);
    this.meta.set(id, { basisHash: hash, basisSha: sha ?? null, basisTijd: this.nu(), githubBetrouwbaar: true, conflict: false });
    this.github.set(id, { model, hash, sha: sha ?? null, gezaghebbend: true });
    this.#bewaar(id);
    this.#melden('toestand', { id });
  }

  /**
   * Haalt index + actief ontwerp op via de API (geen Pages-cache).
   * @param {{ kiesBijConflict?: (info) => Promise<'lokaal'|'github'|null> }} o
   */
  async ophalenVanGithub({ kiesBijConflict = async () => null } = {}) {
    const client = this.client();
    try {
      const idx = await client.lees('designs/index.json');
      if (idx) {
        try {
          const j = JSON.parse(idx.tekst);
          this.index = (j.ontwerpen || []).filter((o) => o && typeof o.id === 'string').map((o) => ({ id: o.id, naam: o.naam || o.id }));
        } catch { /* index onleesbaar: oude lijst houden */ }
      }
      const id = this.actiefId;
      if (!id) { this.#melden('lijst'); return { ok: true, melding: 'Lijst met ontwerpen bijgewerkt.' }; }
      const r = await client.lees(`designs/${id}.json`);
      this.#melden('lijst');
      if (!r) return { ok: true, melding: `"${id}" staat nog niet op GitHub. Kies "Opslaan naar GitHub" om het toe te voegen.` };
      const lr = leesOntwerpTekst(r.tekst);
      if (!lr.ok) return { ok: false, melding: `De GitHub-versie is ongeldig en wordt niet geladen:\n${lr.fouten.join('\n')}` };
      const gh = { model: lr.model, hash: modelHash(lr.model), sha: r.sha, gezaghebbend: true };
      this.github.set(id, gh);
      const g = this.geschiedenis;
      const meta = this.meta.get(id) || {};
      const v = vergelijkMetGithub({ lokaal: modelHash(g.huidig), basis: meta.conflict ? null : (meta.basisHash ?? null), github: gh.hash });
      const neemGithub = () => { this.meta.set(id, { basisHash: gh.hash, basisSha: gh.sha, basisTijd: this.nu(), githubBetrouwbaar: true, conflict: false }); g.vastleggen(gh.model, 'Ophalen van GitHub'); };
      const behoudLokaal = () => { this.meta.set(id, { basisHash: gh.hash, basisSha: gh.sha, basisTijd: this.nu(), githubBetrouwbaar: true, conflict: false }); this.#bewaar(id); this.#melden('toestand', { id }); };
      if (v === 'gelijk') { behoudLokaal(); return { ok: true, melding: 'Gelijk met GitHub.' }; }
      if (v === 'neem-github') { neemGithub(); return { ok: true, melding: 'Laatste versie van GitHub geladen. (Ongedaan maken kan.)' }; }
      if (v === 'behoud-lokaal') { behoudLokaal(); return { ok: true, melding: 'GitHub is niet gewijzigd; je lokale wijzigingen staan er nog niet op.' }; }
      const keuze = await kiesBijConflict({ id, naam: g.huidig.naam });
      if (keuze === 'github') { neemGithub(); return { ok: true, melding: 'GitHub-versie geladen. Je lokale versie kan je terughalen met Ongedaan maken.' }; }
      if (keuze === 'lokaal') { behoudLokaal(); return { ok: true, melding: 'Lokale versie behouden. Bij "Opslaan naar GitHub" overschrijft ze de GitHub-versie.' }; }
      return { ok: false, soort: 'geannuleerd', melding: 'Niets gewijzigd.' };
    } catch (e) {
      if (e instanceof GitHubFout) return { ok: false, soort: e.soort, melding: e.message };
      return { ok: false, melding: `Ophalen mislukt: ${e.message}` };
    }
  }
}
