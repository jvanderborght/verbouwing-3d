// Zuivere logica van het tekengereedschap (fase 2). Geen DOM: getest in tests/gereedschap.test.js.
//
// - lijst van gereedschappen en hun opties (+ normaliseren, bewaren in localStorage met try/catch)
// - muur-tekenstatemachine (keten van muren, lengte intypen in de huidige richting)
// - opbouw van de hulplaag (toonHulp) voor voorbeelden: muur, verplaatsing, opening
// - kleine rekenhulpjes (px → mm tolerantie, hoek, lengte-tekst)

import { STATUSSEN } from '../model/schema.js';
import { muurDeelRechthoek } from '../model/geometry.js';

/** Gereedschappen in de taakbalk. `modus` = modus van de plattegrond; `actie` = opent enkel een dialoog. */
export const GEREEDSCHAPPEN = Object.freeze([
  { id: 'selecteren', label: 'Selecteren', kort: 'Selecteer', modus: 'navigeren', toets: 'v' },
  { id: 'muur', label: 'Muur tekenen', kort: 'Muur', modus: 'gereedschap', toets: 'm' },
  { id: 'deur', label: 'Deur plaatsen', kort: 'Deur', modus: 'gereedschap', toets: 'd' },
  { id: 'raam', label: 'Raam plaatsen', kort: 'Raam', modus: 'gereedschap', toets: 'r' },
  { id: 'ruimte', label: 'Ruimte benoemen', kort: 'Ruimte', modus: 'gereedschap', toets: 'n' },
  { id: 'verwijderen', label: 'Verwijderen', kort: 'Wissen', modus: 'gereedschap', toets: 'x' },
  { id: 'niveau', label: 'Niveau toevoegen', kort: 'Niveau +', actie: true },
  { id: 'dak', label: 'Dak instellen', kort: 'Dak', actie: true },
]);

export const gereedschapInfo = (id) => GEREEDSCHAPPEN.find((g) => g.id === id) || null;
/** Gereedschap dat in de plattegrond tekent (dus de 2D-weergave nodig heeft). */
export const isTekengereedschap = (id) => gereedschapInfo(id)?.modus === 'gereedschap';

export const DIKTES = Object.freeze([100, 140, 200, 300]);
export const MIN_DIKTE = 20;
export const MAX_DIKTE = 1500;

export const STANDAARD_OPTIES = Object.freeze({
  muur: Object.freeze({ dikte: 140, status: 'nieuw' }),
  deur: Object.freeze({ breedte: 900, hoogte: 2100, borstwering: 0, status: 'nieuw' }),
  raam: Object.freeze({ breedte: 1200, hoogte: 1400, borstwering: 900, status: 'nieuw' }),
});

export const OPTIE_SLEUTEL = 'verbouwing3d.gereedschapOpties';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const binnen = (v, min, max) => isGetal(v) && v >= min && v <= max;

/** Vult ontbrekende/ongeldige opties aan met de standaardwaarden. Geeft altijd een volledig nieuw object. */
export function normaliseerOpties(ruw) {
  const r = ruw && typeof ruw === 'object' ? ruw : {};
  const uit = {};
  const m = r.muur || {};
  uit.muur = {
    dikte: binnen(m.dikte, MIN_DIKTE, MAX_DIKTE) ? Math.round(m.dikte) : STANDAARD_OPTIES.muur.dikte,
    status: STATUSSEN.includes(m.status) ? m.status : STANDAARD_OPTIES.muur.status,
  };
  for (const t of ['deur', 'raam']) {
    const o = r[t] || {};
    const s = STANDAARD_OPTIES[t];
    uit[t] = {
      breedte: binnen(o.breedte, 100, 20000) ? Math.round(o.breedte) : s.breedte,
      hoogte: binnen(o.hoogte, 100, 20000) ? Math.round(o.hoogte) : s.hoogte,
      borstwering: binnen(o.borstwering, 0, 20000) ? Math.round(o.borstwering) : s.borstwering,
      status: STATUSSEN.includes(o.status) ? o.status : s.status,
    };
  }
  return uit;
}

/** Leest de opties uit een Storage-achtig object. Elke fout (geblokkeerd, kapotte JSON) ⇒ standaardwaarden. */
export function laadOpties(storage) {
  try {
    const t = storage?.getItem(OPTIE_SLEUTEL);
    return normaliseerOpties(t ? JSON.parse(t) : null);
  } catch {
    return normaliseerOpties(null);
  }
}

/** Bewaart de opties. → true bij succes, false als de opslag niet beschikbaar of vol is. */
export function bewaarOpties(storage, opties) {
  try {
    if (!storage) return false;
    storage.setItem(OPTIE_SLEUTEL, JSON.stringify(normaliseerOpties(opties)));
    return true;
  } catch {
    return false;
  }
}

/** Snap-tolerantie in mm voor een tolerantie in schermpixels (12 px standaard). */
export function tolerantieMm(schaal, px = 12) {
  return px / (isGetal(schaal) && schaal > 0 ? schaal : 1);
}

/** Eenheidsvector van a naar b, of null als ze (bijna) samenvallen. */
export function richtingVan(a, b) {
  if (!a || !b) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  return L < 1e-6 ? null : [dx / L, dy / L];
}

/** Punt op afstand `lengte` van `start` in richting `richting` (eenheidsvector), afgerond op 0,1 mm. */
export function puntInRichting(start, richting, lengte) {
  const r = (v) => { const x = Math.round(v * 10) / 10; return x === 0 ? 0 : x; };
  return [r(start[0] + richting[0] * lengte), r(start[1] + richting[1] * lengte)];
}

export const RICHTINGEN = Object.freeze({ rechts: [1, 0], omhoog: [0, 1], links: [-1, 0], omlaag: [0, -1] });

/** Hoek van een muur in graden (0 = naar rechts, 90 = naar achter/omhoog in plan), in [0, 360). */
export function muurHoek(muur) {
  const a = (Math.atan2(muur.eind[1] - muur.start[1], muur.eind[0] - muur.start[0]) * 180) / Math.PI;
  const h = Math.round(((a % 360) + 360) % 360 * 10) / 10;
  return h === 360 ? 0 : h;
}

/** "3.250 mm" (Vlaamse duizendtallen). */
export function mmTekst(v) {
  return `${Math.round(v).toLocaleString('nl-BE')} mm`;
}

const zelfde = (a, b, tol = 0.5) => !!a && !!b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/**
 * Toestand van het muurgereedschap. Een keten van muren: het eerste punt start de keten, elk volgend punt
 * levert een muur van het vorige punt tot dat punt (de UI past ze toe en roept dan `bevestig` op).
 * Esc / dubbeltik / "Klaar" ⇒ stop().
 */
export class MuurTekenaar {
  constructor() { this.stop(); }

  /** Is er een keten bezig (beginpunt gekozen)? */
  get actief() { return this.start != null; }

  stop() {
    this.start = null;        // huidig beginpunt [x, y] of null
    this.vorigeRichting = null;
    this.aanwijzer = null;    // laatst bekende (gesnapte) aanwijzerpositie, bepaalt de huidige richting
    this.aantal = 0;          // aantal muren in deze keten
  }

  /** Aanwijzer bewogen (gesnapt punt) of null (onbekend, bv. na een getypte lengte). */
  zetAanwijzer(p) { this.aanwijzer = p ? [p[0], p[1]] : null; }

  /**
   * Punt plaatsen (tik of loslaten na slepen).
   * → { soort: 'start' } | { soort: 'muur', start, eind } | { soort: 'niets' }
   */
  plaats(p) {
    if (!this.start) { this.start = [p[0], p[1]]; this.aanwijzer = null; return { soort: 'start' }; }
    if (zelfde(p, this.start)) return { soort: 'niets' };
    return { soort: 'muur', start: [...this.start], eind: [p[0], p[1]] };
  }

  /** Muur tot `eind` werd toegepast: de keten loopt verder vanaf `eind`. */
  bevestig(eind) {
    const r = richtingVan(this.start, eind);
    if (r) this.vorigeRichting = r;
    this.start = [eind[0], eind[1]];
    this.aantal++;
  }

  /** Richting voor een getypte lengte: naar de aanwijzer, anders die van de vorige muur, anders naar rechts. */
  huidigeRichting() {
    return richtingVan(this.start, this.aanwijzer) || this.vorigeRichting || [1, 0];
  }

  /**
   * Muur met een getypte lengte, in `richting` (of de huidige richting).
   * → { soort: 'muur', start, eind } | { soort: 'fout', melding }
   */
  metLengte(lengte, richting = null) {
    if (!this.start) return { soort: 'fout', melding: 'Tik eerst het beginpunt van de muur in de plattegrond.' };
    if (!isGetal(lengte) || lengte < 10) return { soort: 'fout', melding: 'Geef een lengte van minstens 10 mm.' };
    const r = richting || this.huidigeRichting();
    return { soort: 'muur', start: [...this.start], eind: puntInRichting(this.start, r, lengte) };
  }
}

/** Tekstje voor de hint in de optiebalk. */
export function hintVoor(gereedschap, { keten = false, rechthoek = 0 } = {}) {
  switch (gereedschap) {
    case 'selecteren': return 'Tik op een element om het te selecteren. Sleep een geselecteerde muur of haar eindpunten.';
    case 'muur': return keten
      ? 'Tik het volgende punt (of typ een lengte + Enter). Dubbeltik, Esc of Klaar om te stoppen.'
      : 'Tik het beginpunt van de muur, of sleep van begin- naar eindpunt.';
    case 'deur': return 'Tik op een muur om er een deur in te plaatsen.';
    case 'raam': return 'Tik op een muur om er een raam in te plaatsen.';
    case 'ruimte': return rechthoek === 1 ? 'Rechthoek: tik de eerste hoek.'
      : rechthoek === 2 ? 'Rechthoek: tik de tegenoverliggende hoek.'
        : 'Tik in een gesloten ruimte om ze te benoemen.';
    case 'verwijderen': return 'Tik op een muur, opening of ruimte om ze te verwijderen.';
    default: return '';
  }
}

// ---------------------------------------------------------------- hulplaag (voorbeelden)

/** Maatlijn evenwijdig aan a→b, `afstand` mm links van de looprichting. */
function maatNaast(a, b, afstand, tekst) {
  const r = richtingVan(a, b);
  if (!r) return null;
  const n = [-r[1], r[0]];
  const v = (p) => [p[0] + n[0] * afstand, p[1] + n[1] * afstand];
  return { van: v(a), naar: v(b), stijl: 'maat', tekst };
}

/**
 * Hulplaag voor een muur in opbouw.
 * @param {{ start?: number[]|null, punt: number[], dikte: number, snap?: object|null, schaal: number, vast?: Array<{van, naar, dikte}> }} o
 */
export function hulpMuur({ start = null, punt, dikte, snap = null, schaal = 1 }) {
  const hulp = { lijnen: [], punten: [], labels: [], polygonen: [] };
  for (const h of snap?.hulplijnen || []) hulp.lijnen.push({ van: h.van, naar: h.naar, stijl: 'hulplijn' });
  if (start && punt && !zelfde(start, punt, 0.01)) {
    const L = Math.hypot(punt[0] - start[0], punt[1] - start[1]);
    hulp.lijnen.push({ van: start, naar: punt, stijl: 'voorbeeld', dikte });
    const m = maatNaast(start, punt, dikte / 2 + 22 / (schaal || 1), mmTekst(L));
    if (m) hulp.lijnen.push(m);
  }
  if (start) hulp.punten.push({ p: start, soort: 'snap' });
  if (punt) hulp.punten.push({ p: punt, soort: 'snap' });
  if (snap && snap.soort && snap.soort !== 'raster' && snap.soort !== 'geen' && punt) {
    hulp.labels.push({ p: [punt[0] + 16 / (schaal || 1), punt[1] - 16 / (schaal || 1)], tekst: SNAP_LABEL[snap.soort] || '' });
  }
  return hulp;
}

export const SNAP_LABEL = { eindpunt: 'eindpunt', midden: 'midden', muur: 'op muur', uitlijning: 'uitgelijnd', ortho: '' };

/**
 * Nieuwe geometrie van muren uit een operatielijst (wijzigen/toevoegen van muren), voor een live voorbeeld.
 * → [{ id, van, naar, dikte }]
 */
export function murenUitOps(model, ops) {
  const uit = [];
  for (const op of ops || []) {
    if (op.collectie !== 'muren') continue;
    if (op.op === 'toevoegen') uit.push({ id: op.item.id, van: op.item.start, naar: op.item.eind, dikte: op.item.dikte });
    else if (op.op === 'wijzigen') {
      const m = model.muren.find((x) => x.id === op.id);
      if (!m) continue;
      uit.push({ id: m.id, van: op.velden.start || m.start, naar: op.velden.eind || m.eind, dikte: op.velden.dikte || m.dikte });
    }
  }
  return uit;
}

/** Hulplaag voor een versleepte muur/greep: alle gewijzigde muren als voorbeeld + maat van de hoofdmuur. */
export function hulpSlepen(model, ops, { id, grepen = [], snap = null, schaal = 1, label = null }) {
  const hulp = { lijnen: [], punten: [...grepen], labels: [], polygonen: [] };
  for (const h of snap?.hulplijnen || []) hulp.lijnen.push({ van: h.van, naar: h.naar, stijl: 'hulplijn' });
  for (const m of murenUitOps(model, ops)) {
    hulp.lijnen.push({ van: m.van, naar: m.naar, stijl: 'voorbeeld', dikte: m.dikte });
    if (m.id === id) {
      const L = Math.hypot(m.naar[0] - m.van[0], m.naar[1] - m.van[1]);
      const mt = maatNaast(m.van, m.naar, m.dikte / 2 + 22 / (schaal || 1), mmTekst(L));
      if (mt) hulp.lijnen.push(mt);
    }
  }
  if (snap?.punt) hulp.punten.push({ p: snap.punt, soort: 'snap' });
  if (label) hulp.labels.push(label);
  return hulp;
}

/** Contour van een opening (uit een 'toevoegen'-operatie) in plan, voor het voorbeeld. */
export function openingContour(model, item) {
  const m = model.muren.find((x) => x.id === item.muur);
  if (!m) return null;
  return muurDeelRechthoek({ ...m, dikte: m.dikte + 60 }, item.positie, item.positie + item.breedte);
}

/** Lengte van een verplaatsing als tekst: "Δx 300 · Δy −50 mm". */
export function deltaTekst(dx, dy) {
  const f = (v) => Math.round(v).toLocaleString('nl-BE');
  return `Δx ${f(dx)} · Δy ${f(dy)} mm`;
}
