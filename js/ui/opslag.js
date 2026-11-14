// Opslag: lokale werkkopieën (localStorage) en de GitHub REST API.
// DOM-vrij: storage en fetch worden geïnjecteerd, zodat dit in Node getest kan worden.
//
// Het GitHub-token leeft ENKEL in localStorage van deze browser. Het wordt nooit gelogd
// en komt nooit in foutmeldingen terecht.

import { naarJson, migreer } from '../model/index.js';

const PREFIX = 'verbouwing3d.';
export const SLEUTELS = {
  ontwerp: (id) => `${PREFIX}ontwerp.${id}`,
  ontwerpPrefix: `${PREFIX}ontwerp.`,
  instellingen: `${PREFIX}instellingen`,
  token: `${PREFIX}githubToken`,
  laatste: `${PREFIX}laatsteOntwerp`,
  ui: `${PREFIX}ui`,
};

export const STANDAARD_INSTELLINGEN = Object.freeze({ owner: 'jvanderborght', repo: 'verbouwing-3d', branch: 'main' });

/** localStorage indien beschikbaar (privévenster/geblokkeerd → null). */
export function standaardStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Alle localStorage-toegang loopt hierlangs, telkens in try/catch. */
export class LokaleOpslag {
  constructor(storage = standaardStorage()) { this.s = storage; }

  get beschikbaar() {
    try {
      if (!this.s) return false;
      const k = `${PREFIX}test`;
      this.s.setItem(k, '1');
      this.s.removeItem(k);
      return true;
    } catch { return false; }
  }

  lees(k) { try { return this.s ? this.s.getItem(k) : null; } catch { return null; } }
  schrijf(k, v) { try { if (!this.s) return false; this.s.setItem(k, v); return true; } catch { return false; } }
  wis(k) { try { if (this.s) this.s.removeItem(k); return true; } catch { return false; } }
  leesJson(k) { const t = this.lees(k); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } }
  schrijfJson(k, v) { return this.schrijf(k, JSON.stringify(v)); }

  sleutels() {
    try {
      if (!this.s) return [];
      const uit = [];
      for (let i = 0; i < this.s.length; i++) { const k = this.s.key(i); if (k != null) uit.push(k); }
      return uit;
    } catch { return []; }
  }

  // ---- werkkopieën: { model, basisHash, basisSha, basisTijd, hashVersie? } per ontwerp-id
  werkkopie(id) {
    const r = this.leesJson(SLEUTELS.ontwerp(id));
    return r && r.model && typeof r.model === 'object' ? r : null;
  }
  bewaarWerkkopie(id, rec) { return this.schrijfJson(SLEUTELS.ontwerp(id), rec); }
  wisWerkkopie(id) { return this.wis(SLEUTELS.ontwerp(id)); }
  werkkopieIds() {
    return this.sleutels().filter((k) => k.startsWith(SLEUTELS.ontwerpPrefix)).map((k) => k.slice(SLEUTELS.ontwerpPrefix.length));
  }

  // ---- instellingen (owner/repo/branch) en token
  instellingen() {
    const r = this.leesJson(SLEUTELS.instellingen) || {};
    const uit = { ...STANDAARD_INSTELLINGEN };
    for (const k of Object.keys(uit)) if (typeof r[k] === 'string' && r[k].trim()) uit[k] = r[k].trim();
    return uit;
  }
  bewaarInstellingen(v) {
    const uit = {};
    for (const k of Object.keys(STANDAARD_INSTELLINGEN)) if (typeof v?.[k] === 'string' && v[k].trim()) uit[k] = v[k].trim();
    return this.schrijfJson(SLEUTELS.instellingen, uit);
  }
  token() { const t = this.lees(SLEUTELS.token); return t && t.trim() ? t.trim() : null; }
  bewaarToken(t) { return t && t.trim() ? this.schrijf(SLEUTELS.token, t.trim()) : this.wisToken(); }
  wisToken() { return this.wis(SLEUTELS.token); }

  // ---- kleine UI-voorkeuren (tab, splitsing, …)
  ui() { return this.leesJson(SLEUTELS.ui) || {}; }
  bewaarUi(patch) { return this.schrijfJson(SLEUTELS.ui, { ...this.ui(), ...patch }); }
}

// ---------------------------------------------------------------- hashing

/** Snelle 53-bit tekst-hash (cyrb53) als hex. Enkel om versies te vergelijken, niet cryptografisch. */
export function hashTekst(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Stabiele serialisatie: sleutels van objecten alfabetisch (recursief), lijsten in hun volgorde.
 * Twee modellen met dezelfde inhoud maar een andere sleutelvolgorde (bv. een generatorscript dat `trappen` vóór `niveaus`
 * zet) geven zo dezelfde tekst.
 */
export function stabieleJson(x) {
  const orden = (v) => {
    if (Array.isArray(v)) return v.map(orden);
    if (v && typeof v === 'object') {
      const uit = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) uit[k] = orden(v[k]);
      return uit;
    }
    return v;
  };
  return JSON.stringify(orden(x));
}

/**
 * Versie van de hashfunctie. 1 = hash van naarJson (sleutelvolgorde telde mee, geen migratie);
 * 2 = hash van de stabiele serialisatie van het naar de huidige schemaVersie gemigreerde model.
 * Werkkopieën bewaren de versie (`hashVersie`); oudere basis-hashes worden bij het laden omgezet (varianten.js).
 */
export const HASH_VERSIE = 2;

/**
 * Hash van een model: eerst gemigreerd naar de huidige schemaVersie, dan stabiel geserialiseerd. Een v1-werkkopie en
 * hetzelfde ontwerp als v2-bestand (met eventueel een andere sleutelvolgorde) krijgen dus dezelfde hash.
 */
export function modelHash(model) {
  if (!model) return null;
  let m = model;
  try { m = migreer(model); } catch { /* nieuwere versie dan de app kent: ongewijzigd hashen */ }
  return hashTekst(stabieleJson(m));
}

/** Hash zoals vóór HASH_VERSIE 2 (naarJson, zonder migratie). Enkel om oude basis-hashes te herkennen. */
export const oudeModelHash = (model) => (model ? hashTekst(naarJson(model)) : null);

// ---------------------------------------------------------------- base64 (UTF-8-correct)

/** Tekst → base64 van de UTF-8-bytes (btoa alleen kan geen é, ë, €, …). */
export function naarBase64Utf8(tekst) {
  const bytes = new TextEncoder().encode(tekst);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** base64 (mag regeleinden bevatten, zoals de GitHub API teruggeeft) → tekst. */
export function vanBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------------------------------------------------------------- GitHub API

export class GitHubFout extends Error {
  /** soort: 'geen-token' | 'auth' | 'rechten' | 'limiet' | 'niet-gevonden' | 'conflict' | 'netwerk' | 'ongeldig' | 'onbekend' */
  constructor(melding, { status = 0, soort = 'onbekend' } = {}) {
    super(melding);
    this.name = 'GitHubFout';
    this.status = status;
    this.soort = soort;
  }
}

/** Nederlandstalige melding voor een HTTP-status van de GitHub API. */
export function githubFoutmelding(status, { limietOp = false, actie = 'lezen', doel = '', apiMelding = '' } = {}) {
  const wat = doel ? ` (${doel})` : '';
  if (status === 401) return { soort: 'auth', melding: 'GitHub weigert het token (401): het is ongeldig, verlopen of ingetrokken. Maak een nieuw token aan en plak het in Instellingen.' };
  if (status === 403 && limietOp) return { soort: 'limiet', melding: 'Te veel verzoeken naar GitHub (limiet bereikt). Wacht even en probeer opnieuw, of stel een token in (hogere limiet).' };
  if (status === 403) return { soort: 'rechten', melding: `GitHub weigert de toegang (403)${wat}. Controleer dat het token "Contents: Read and write" heeft voor deze repository.` };
  if (status === 404) return { soort: 'niet-gevonden', melding: `Niet gevonden op GitHub (404)${wat}. Controleer owner, repository en branch in Instellingen, en of het token toegang heeft tot deze repository.` };
  // 422 = sha-conflict ("sha wasn't supplied / does not match") óf een andere validatiefout van de API
  if (status === 422 && apiMelding && !/sha|match|conflict/i.test(apiMelding)) return { soort: 'onbekend', melding: `GitHub weigert de inhoud (422)${wat}. Probeer opnieuw of exporteer het ontwerp als JSON.` };
  if (status === 409 || status === 422) return { soort: 'conflict', melding: `Het bestand werd intussen op GitHub gewijzigd (${status})${wat}. Kies eerst "Ophalen van GitHub" en probeer dan opnieuw.` };
  if (status >= 500) return { soort: 'onbekend', melding: `GitHub heeft een storing (${status}). Probeer later opnieuw; je werk blijft lokaal bewaard.` };
  return { soort: 'onbekend', melding: `Onverwacht antwoord van GitHub bij ${actie} (${status})${wat}.` };
}

const coderPad = (pad) => pad.split('/').map(encodeURIComponent).join('/');

export class GitHubClient {
  constructor({ owner, repo, branch = 'main', token = null, fetch: f, api = 'https://api.github.com' } = {}) {
    this.owner = owner; this.repo = repo; this.branch = branch; this.api = api;
    this.#token = token || null;
    this.#fetch = f || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  }
  #token; #fetch; #auteur = null;

  /**
   * Anonieme auteur voor commits: het GitHub-noreply-adres van de token-eigenaar
   * (`<id>+<login>@users.noreply.github.com`). Zonder expliciete auteur gebruikt GitHub het
   * primaire e-mailadres van het account — dat mag niet publiek (CLAUDE.md regel 8).
   * Lukt GET /user niet, dan valt het terug op `<owner>@users.noreply.github.com`.
   */
  async auteur() {
    if (this.#auteur) return this.#auteur;
    let a = null;
    try {
      const res = await this.#fetch(`${this.api}/user`, { cache: 'no-store', headers: this.#headers() });
      if (res?.ok) {
        const u = await res.json();
        if (u && Number.isInteger(u.id) && typeof u.login === 'string') a = { name: u.login, email: `${u.id}+${u.login}@users.noreply.github.com` };
      }
    } catch { /* terugvallen */ }
    this.#auteur = a || { name: this.owner, email: `${this.owner}@users.noreply.github.com` };
    return this.#auteur;
  }

  get heeftToken() { return !!this.#token; }

  #headers(extra = {}) {
    const h = { Accept: 'application/vnd.github+json', ...extra };
    if (this.#token) h.Authorization = `Bearer ${this.#token}`;
    return h;
  }

  #repoUrl(rest) { return `${this.api}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${rest}`; }

  async #verzoek(url, opties, { actie, doel }) {
    if (!this.#fetch) throw new GitHubFout('Deze browser kan geen netwerkverzoeken doen.', { soort: 'netwerk' });
    let res;
    try { res = await this.#fetch(url, { cache: 'no-store', ...opties }); }
    catch { throw new GitHubFout('Geen verbinding met GitHub. Controleer je internetverbinding; je werk blijft lokaal bewaard.', { soort: 'netwerk' }); }
    if (res.ok) return res;
    if (res.status === 404 && actie === 'lezen-bestand') return null;
    const limietOp = res.headers?.get?.('x-ratelimit-remaining') === '0';
    let apiMelding = '';
    if (res.status === 422) { try { apiMelding = String((await res.json())?.message || ''); } catch { /* geen body */ } }
    const { soort, melding } = githubFoutmelding(res.status, { limietOp, actie, doel, apiMelding });
    throw new GitHubFout(melding, { status: res.status, soort });
  }

  async #json(res) {
    try { return await res.json(); }
    catch { throw new GitHubFout('GitHub gaf een onleesbaar antwoord.', { soort: 'ongeldig' }); }
  }

  /** Leest een bestand via de contents API. → { tekst, sha } of null als het niet bestaat. */
  async lees(pad) {
    const url = this.#repoUrl(`/contents/${coderPad(pad)}?ref=${encodeURIComponent(this.branch)}`);
    const res = await this.#verzoek(url, { method: 'GET', headers: this.#headers() }, { actie: 'lezen-bestand', doel: pad });
    if (!res) return null;
    const j = await this.#json(res);
    if (Array.isArray(j) || j.type !== 'file') throw new GitHubFout(`${pad} is geen bestand op GitHub.`, { soort: 'ongeldig' });
    if (j.encoding !== 'base64' || typeof j.content !== 'string') throw new GitHubFout(`${pad} is te groot om via de API te lezen.`, { soort: 'ongeldig' });
    return { tekst: vanBase64Utf8(j.content), sha: j.sha };
  }

  /** Schrijft één bestand (contents API, PUT). sha = huidige blob-sha (verplicht bij bestaand bestand). → { sha } */
  async schrijf(pad, tekst, { sha = null, bericht }) {
    if (!this.#token) throw new GitHubFout('Geen GitHub-token ingesteld. Stel er een in via Instellingen, of gebruik "Exporteer JSON".', { soort: 'geen-token' });
    const wie = await this.auteur();
    const body = { message: bericht, content: naarBase64Utf8(tekst), branch: this.branch, author: wie, committer: wie };
    if (sha) body.sha = sha;
    const url = this.#repoUrl(`/contents/${coderPad(pad)}`);
    const res = await this.#verzoek(url, { method: 'PUT', headers: this.#headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }, { actie: 'opslaan', doel: pad });
    const j = await this.#json(res);
    return { sha: j?.content?.sha ?? null, commit: j?.commit?.sha ?? null };
  }

  /**
   * Schrijft meerdere bestanden in één commit (Git Data API), bv. een nieuw ontwerp + designs/index.json.
   * Zo ziet de Pages-workflow nooit een tussentoestand waarin index en bestanden niet overeenkomen.
   * @param {Array<{pad: string, tekst: string}>} bestanden
   * @returns {Promise<{commit: string, shas: Record<string,string|null>}>}
   */
  async schrijfMeerdere(bestanden, { bericht }) {
    if (!this.#token) throw new GitHubFout('Geen GitHub-token ingesteld. Stel er een in via Instellingen, of gebruik "Exporteer JSON".', { soort: 'geen-token' });
    const opts = (method, body) => ({ method, headers: this.#headers(body ? { 'Content-Type': 'application/json' } : {}), ...(body ? { body: JSON.stringify(body) } : {}) });
    const ctx = { actie: 'opslaan', doel: `branch ${this.branch}` };
    const ref = await this.#json(await this.#verzoek(this.#repoUrl(`/git/ref/heads/${coderPad(this.branch)}`), opts('GET'), ctx));
    const basisCommit = ref.object.sha;
    const commit = await this.#json(await this.#verzoek(this.#repoUrl(`/git/commits/${basisCommit}`), opts('GET'), ctx));
    const tree = await this.#json(await this.#verzoek(this.#repoUrl('/git/trees'), opts('POST', {
      base_tree: commit.tree.sha,
      tree: bestanden.map((b) => ({ path: b.pad, mode: '100644', type: 'blob', content: b.tekst })),
    }), ctx));
    const nieuw = await this.#json(await this.#verzoek(this.#repoUrl('/git/commits'), opts('POST', { message: bericht, tree: tree.sha, parents: [basisCommit], author: await this.auteur(), committer: await this.auteur() }), ctx));
    // force: false → GitHub weigert (422) als de branch intussen verschoven is.
    await this.#verzoek(this.#repoUrl(`/git/refs/heads/${coderPad(this.branch)}`), opts('PATCH', { sha: nieuw.sha, force: false }), ctx);
    const shas = {};
    for (const b of bestanden) shas[b.pad] = (tree.tree || []).find((e) => e.path === b.pad)?.sha ?? null;
    return { commit: nieuw.sha, shas };
  }
}
