// Bewerkingen op hoog niveau (fase 2). Pure functies, geen DOM.
// Elke functie geeft een OPERATIELIJST terug (niet toegepast): { ops, fout?, info? }.
// Bij `fout` is `ops` leeg. Toepassen gebeurt via applyOps / Geschiedenis.toepassen.
// Zie docs/FASE2.md (deel A) en docs/DATAMODEL.md ("Bewerkingen (hoog niveau)").

import {
  COLLECTIE_NAMEN, OPENING_TYPES, STATUSSEN, DAK_TYPES, NOKRICHTINGEN, FUNCTIES,
  TRAP_TYPES, DRAAIRICHTINGEN, INRICHTING_SOORTEN,
} from './schema.js';
import {
  lengte, muurLengte, muurRichting, muurHoogte, puntOpMuur, afstandTotSegment, begrenzing,
  polygoonOppervlakte, puntInPolygoon, muurAansluiting, muurDeelRechthoek, muurRechthoek, dakNokHoogte, niveauBovenkant,
} from './geometry.js';
import { metInstellingen, instelling, inrichtingMaat } from './instellingen.js';
import { trapGeometrie, trapVoetafdruk } from './trappen.js';
import { niveauBegrenzing, inEenVan, minVrijeHoogte, trapLoophoogte } from './hoogte.js';
import { inrichtingContour, polygonenOverlappen } from './vormen.js';
import { volgendId } from './operations.js';

export const MIN_MUURLENGTE = 10;       // mm
export const AANSLUIT_TOL = 1;          // mm: eindpunten binnen deze afstand vallen samen
export const MAX_RUIMTE_M2 = 2000;      // grotere gebieden gelden als niet gesloten

const rond01 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const rondP = (p) => [rond01(p[0]), rond01(p[1])];
const rondN = (v, n) => { const r = Math.round(v / n) * n; return r === 0 ? 0 : r; };
const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isPunt = (p) => Array.isArray(p) && p.length === 2 && p.every(isGetal);
const gelijk = (a, b, tol = 1e-6) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
const fout = (melding) => ({ ops: [], fout: melding });

/** Id-generator die rekening houdt met id's die binnen dezelfde operatielijst al uitgedeeld zijn. */
// Zoals volgendId (operations.js): max(model.idTeller, bestaande id's) + 1 — vrijgekomen id's worden niet hergebruikt.
function idMaker(model) {
  const uitgedeeld = [];
  return (collectie) => {
    const id = volgendId(model, collectie, uitgedeeld);
    uitgedeeld.push(id);
    return id;
  };
}

const vindMuur = (model, id) => model.muren.find((m) => m.id === id);
const heeftNiveau = (model, id) => model.niveaus.some((n) => n.id === id);

// ─────────────────────────────────────────────────────────────────────────────
// Muren
// ─────────────────────────────────────────────────────────────────────────────

/** Nieuwe muur. info.id = id van de nieuwe muur. */
export function opsMuurTekenen(model, { niveau, start, eind, dikte, status = 'nieuw', hoogte } = {}) {
  if (!heeftNiveau(model, niveau)) return fout(`Onbekend niveau "${niveau}".`);
  if (!isPunt(start) || !isPunt(eind)) return fout('Start- en eindpunt moeten [x, y] in mm zijn.');
  if (!isGetal(dikte) || dikte <= 0) return fout('Muurdikte moet een getal > 0 mm zijn.');
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig; kies uit: ${STATUSSEN.join(', ')}.`);
  if (hoogte !== undefined && hoogte !== null && (!isGetal(hoogte) || hoogte <= 0)) return fout('Muurhoogte moet > 0 mm zijn.');
  const s = rondP(start), e = rondP(eind);
  if (lengte(s, e) < MIN_MUURLENGTE) return fout(`Muur is te kort (minimaal ${MIN_MUURLENGTE} mm).`);
  const id = idMaker(model)('muren');
  const item = { id, niveau, start: s, eind: e, dikte, status };
  if (isGetal(hoogte)) item.hoogte = hoogte;
  return { ops: [{ op: 'toevoegen', collectie: 'muren', item }], info: { id } };
}

/**
 * Ops om de punten van een muur te wijzigen + openingen bij te stellen.
 * Openingen behouden hun afstand tot het eindpunt dat NIET verplaatst (enkel start verplaatst ⇒ positie
 * verschuift mee met de lengteverandering; anders blijft positie gelijk). Past een opening niet meer ⇒ fout.
 */
function muurPuntenOps(model, muur, nieuwStart, nieuwEind) {
  const s = rondP(nieuwStart), e = rondP(nieuwEind);
  const sV = !gelijk(s, muur.start), eV = !gelijk(e, muur.eind);
  if (!sV && !eV) return { ops: [] };
  const L = lengte(s, e);
  if (L < MIN_MUURLENGTE) return { fout: `Muur ${muur.id} wordt te kort (${Math.round(L)} mm; minimaal ${MIN_MUURLENGTE} mm).` };
  const velden = {};
  if (sV) velden.start = s;
  if (eV) velden.eind = e;
  const ops = [{ op: 'wijzigen', collectie: 'muren', id: muur.id, velden }];
  const verschuiving = sV && !eV ? L - muurLengte(muur) : 0;
  for (const o of model.openingen.filter((x) => x.muur === muur.id)) {
    const p = rond01(o.positie + verschuiving);
    if (p < 0 || p + o.breedte > L + 0.5)
      return { fout: `Opening ${o.id} past niet meer in muur ${muur.id} (muurlengte wordt ${Math.round(L)} mm).` };
    if (p !== o.positie) ops.push({ op: 'wijzigen', collectie: 'openingen', id: o.id, velden: { positie: p } });
  }
  return { ops };
}

/** Voegt muurPuntenOps van meerdere muren samen; geeft { ops } of { fout }. */
function verzamel(model, wijzigingen) {
  const ops = [];
  for (const [muur, s, e] of wijzigingen) {
    const r = muurPuntenOps(model, muur, s, e);
    if (r.fout) return { fout: r.fout };
    ops.push(...r.ops);
  }
  return { ops };
}

/**
 * Muur verschuiven over (dx, dy). Met aansluitingen:
 * - eindpunten van andere muren op hetzelfde niveau die samenvielen (±1 mm) met een eindpunt van de muur schuiven mee;
 * - T-aansluitingen (eindpunt van een andere muur op de as van deze muur, niet op een eindpunt) schuiven mee
 *   met de component van (dx, dy) loodrecht op deze muur, zodat ze op de as blijven.
 */
export function opsMuurVerplaatsen(model, id, dx, dy, { metAansluitingen = true } = {}) {
  const A = vindMuur(model, id);
  if (!A) return fout(`Muur "${id}" niet gevonden.`);
  if (!isGetal(dx) || !isGetal(dy)) return fout('Verplaatsing dx/dy moet numeriek zijn (mm).');
  if (dx === 0 && dy === 0) return { ops: [], info: { aansluitingen: [] } };
  const d = [dx, dy];
  const plus = (p, v) => [p[0] + v[0], p[1] + v[1]];
  const wijz = [[A, plus(A.start, d), plus(A.eind, d)]];
  const aansl = [];
  if (metAansluitingen) {
    const r = muurRichting(A);
    const loodrecht = (dx * r.nx + dy * r.ny);
    const dLood = [r.nx * loodrecht, r.ny * loodrecht];
    for (const B of model.muren) {
      if (B.id === A.id || B.niveau !== A.niveau) continue;
      const rb = muurRichting(B);
      const evenwijdig = Math.abs(r.ux * rb.uy - r.uy * rb.ux) < 0.02;
      const nieuw = (P) => {
        if (lengte(P, A.start) <= AANSLUIT_TOL || lengte(P, A.eind) <= AANSLUIT_TOL) return plus(P, d);
        if (!evenwijdig && afstandTotSegment(P, A.start, A.eind).afstand <= AANSLUIT_TOL) return plus(P, dLood);
        return P;
      };
      const s = nieuw(B.start), e = nieuw(B.eind);
      if (s !== B.start || e !== B.eind) { wijz.push([B, s, e]); aansl.push(B.id); }
    }
  }
  const r = verzamel(model, wijz);
  if (r.fout) return fout(r.fout);
  return { ops: r.ops, info: { aansluitingen: aansl } };
}

/** Eén eindpunt van een muur verplaatsen; eindpunten van andere muren die ermee samenvielen (±1 mm) volgen. */
export function opsMuurEindpunt(model, id, welk, punt, { metAansluitingen = true } = {}) {
  const A = vindMuur(model, id);
  if (!A) return fout(`Muur "${id}" niet gevonden.`);
  if (welk !== 'start' && welk !== 'eind') return fout('Kies eindpunt "start" of "eind".');
  if (!isPunt(punt)) return fout('Punt moet [x, y] in mm zijn.');
  const oud = A[welk];
  const wijz = [[A, welk === 'start' ? punt : A.start, welk === 'eind' ? punt : A.eind]];
  const aansl = [];
  if (metAansluitingen) {
    for (const B of model.muren) {
      if (B.id === A.id || B.niveau !== A.niveau) continue;
      const s = lengte(B.start, oud) <= AANSLUIT_TOL ? punt : B.start;
      const e = lengte(B.eind, oud) <= AANSLUIT_TOL ? punt : B.eind;
      if (s !== B.start || e !== B.eind) { wijz.push([B, s, e]); aansl.push(B.id); }
    }
  }
  const r = verzamel(model, wijz);
  if (r.fout) return fout(r.fout);
  return { ops: r.ops, info: { aansluitingen: aansl } };
}

/** Lengte instellen langs de huidige richting. vast = 'start' (eind verschuift) of 'eind' (start verschuift). */
export function opsMuurLengte(model, id, nieuweLengte, { vast = 'start', metAansluitingen = true } = {}) {
  const A = vindMuur(model, id);
  if (!A) return fout(`Muur "${id}" niet gevonden.`);
  if (!isGetal(nieuweLengte) || nieuweLengte < MIN_MUURLENGTE) return fout(`Lengte moet minstens ${MIN_MUURLENGTE} mm zijn.`);
  const { ux, uy } = muurRichting(A);
  if (vast === 'start') return opsMuurEindpunt(model, id, 'eind', [A.start[0] + ux * nieuweLengte, A.start[1] + uy * nieuweLengte], { metAansluitingen });
  if (vast === 'eind') return opsMuurEindpunt(model, id, 'start', [A.eind[0] - ux * nieuweLengte, A.eind[1] - uy * nieuweLengte], { metAansluitingen });
  return fout('vast moet "start" of "eind" zijn.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Openingen
// ─────────────────────────────────────────────────────────────────────────────

const OPENING_STANDAARD = {
  deur: { breedte: 900, hoogte: 2100, borstwering: 0 },
  raam: { breedte: 1200, hoogte: 1400, borstwering: 900 },
};

/**
 * Opening gecentreerd op de projectie van `punt` op de muuras, geklemd binnen de muur, positie op 10 mm.
 * info.id = id van de nieuwe opening.
 */
export function opsOpeningPlaatsen(model, muurId, punt, { type, breedte, hoogte, borstwering, status = 'nieuw' } = {}) {
  const M = vindMuur(model, muurId);
  if (!M) return fout(`Muur "${muurId}" niet gevonden.`);
  if (!OPENING_TYPES.includes(type)) return fout(`Type "${type}" is ongeldig; kies uit: ${OPENING_TYPES.join(', ')}.`);
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  if (!isPunt(punt)) return fout('Punt moet [x, y] in mm zijn.');
  const std = OPENING_STANDAARD[type];
  const b = breedte ?? std.breedte, h = hoogte ?? std.hoogte, bw = borstwering ?? std.borstwering;
  if (!isGetal(b) || b <= 0) return fout('Breedte moet > 0 mm zijn.');
  if (!isGetal(h) || h <= 0) return fout('Hoogte moet > 0 mm zijn.');
  if (!isGetal(bw) || bw < 0) return fout('Borstwering mag niet negatief zijn.');
  const L = muurLengte(M);
  if (b > L) return fout(`Opening (${b} mm) is breder dan muur ${M.id} (${Math.round(L)} mm).`);
  const H = muurHoogte(model, M);
  if (bw + h > H) return fout(`Opening is te hoog: borstwering ${bw} + hoogte ${h} > muurhoogte ${H} mm.`);
  const t = afstandTotSegment(punt, M.start, M.eind).t * L;
  const maxPos = Math.floor((L - b) / 10) * 10;
  const positie = Math.max(0, Math.min(maxPos, rondN(t - b / 2, 10)));
  if (status !== 'afbraak') {
    const botsing = model.openingen.find((o) => o.muur === M.id && o.status !== 'afbraak'
      && positie < o.positie + o.breedte - 0.5 && o.positie < positie + b - 0.5);
    if (botsing) return fout(`Opening overlapt met ${botsing.id} in muur ${M.id}.`);
  }
  const id = idMaker(model)('openingen');
  const item = { id, muur: M.id, type, positie, breedte: b, hoogte: h, borstwering: bw, status };
  return { ops: [{ op: 'toevoegen', collectie: 'openingen', item }], info: { id } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Raster per niveau (ruimtedetectie, buitenmuren, buitencontour)
// ─────────────────────────────────────────────────────────────────────────────
//
// Muren (zonder afbraak) worden als rechthoeken (met muurAansluiting, zodat hoeken sluiten) op een
// NIET-UNIFORM raster gezet: rasterlijnen op elke x/y van de hoekpunten van assen-evenwijdige muren
// ⇒ voor orthogonale plannen is het resultaat exact. Zijn er schuine muren, dan komen er uniforme
// lijnen bij (standaard 25 mm, grover bij zeer grote plannen) en wordt de contour benaderd.

const MARGE = 1000;
const MAX_CELLEN = 400_000;

function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

function uniekGesorteerd(waarden) {
  const s = [...waarden].sort((a, b) => a - b);
  const uit = [];
  for (const v of s) if (!uit.length || v - uit[uit.length - 1] > 0.5) uit.push(v);
  return uit;
}

/** Bouwt het raster voor een niveau, of null als er geen (niet-afbraak) muren zijn. */
function bouwRaster(model, niveau) {
  const muren = model.muren.filter((m) => m.niveau === niveau && m.status !== 'afbraak' && muurLengte(m) >= 1);
  if (!muren.length) return null;
  const rechthoeken = muren.map((m) => {
    const a = muurAansluiting(muren, m);
    const pts = muurDeelRechthoek(m, -a.start, muurLengte(m) + a.eind);
    const dx = Math.abs(m.eind[0] - m.start[0]), dy = Math.abs(m.eind[1] - m.start[1]);
    return { muur: m, pts, b: begrenzing(pts), ortho: dx < 0.01 || dy < 0.01 };
  });
  const alle = begrenzing(rechthoeken.flatMap((r) => r.pts));
  const x0 = alle.minX - MARGE, x1 = alle.maxX + MARGE, y0 = alle.minY - MARGE, y1 = alle.maxY + MARGE;
  const schuin = rechthoeken.some((r) => !r.ortho);
  const xw = [x0, x1], yw = [y0, y1];
  for (const r of rechthoeken) if (r.ortho) { xw.push(r.b.minX, r.b.maxX); yw.push(r.b.minY, r.b.maxY); }
  let cel = 0;
  if (schuin) {
    cel = 25;
    while (((x1 - x0) / cel) * ((y1 - y0) / cel) > MAX_CELLEN) cel *= 2;
    for (let x = Math.ceil(x0 / cel) * cel; x < x1; x += cel) xw.push(x);
    for (let y = Math.ceil(y0 / cel) * cel; y < y1; y += cel) yw.push(y);
  }
  const xs = uniekGesorteerd(xw), ys = uniekGesorteerd(yw);
  const nx = xs.length - 1, ny = ys.length - 1;
  const dicht = new Uint8Array(nx * ny);
  for (const r of rechthoeken) {
    const i0 = Math.max(0, lowerBound(xs, r.b.minX - 0.5) - 1), i1 = Math.min(nx, lowerBound(xs, r.b.maxX + 0.5) + 1);
    const j0 = Math.max(0, lowerBound(ys, r.b.minY - 0.5) - 1), j1 = Math.min(ny, lowerBound(ys, r.b.maxY + 0.5) + 1);
    for (let j = j0; j < j1; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (cy < r.b.minY || cy > r.b.maxY) continue;
      for (let i = i0; i < i1; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        if (cx < r.b.minX || cx > r.b.maxX) continue;
        if (r.ortho || puntInPolygoon([cx, cy], r.pts)) dicht[j * nx + i] = 1;
      }
    }
  }
  return { muren, rechthoeken, xs, ys, nx, ny, dicht, schuin, cel };
}

/** Cel-index van een punt, of -1 buiten het raster. */
function celVan(R, [px, py]) {
  if (px <= R.xs[0] || px >= R.xs[R.nx] || py <= R.ys[0] || py >= R.ys[R.ny]) return -1;
  const i = lowerBound(R.xs, px) - 1, j = lowerBound(R.ys, py) - 1;
  // exact op een rasterlijn: neem de cel rechts/boven
  const ii = R.xs[i + 1] === px ? i + 1 : i, jj = R.ys[j + 1] === py ? j + 1 : j;
  return Math.min(R.ny - 1, Math.max(0, jj)) * R.nx + Math.min(R.nx - 1, Math.max(0, ii));
}

/** Flood fill (4-buren) over open cellen. Geeft { gebied: Uint8Array, randGeraakt, oppervlakte }. */
function vul(R, startCellen, { stopAanRand = false } = {}) {
  const { nx, ny, xs, ys, dicht } = R;
  const gebied = new Uint8Array(nx * ny);
  const stapel = [];
  for (const c of startCellen) if (!dicht[c] && !gebied[c]) { gebied[c] = 1; stapel.push(c); }
  let randGeraakt = false, opp = 0;
  while (stapel.length) {
    const c = stapel.pop();
    const i = c % nx, j = (c - i) / nx;
    opp += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { randGeraakt = true; if (stopAanRand) break; }
    if (i > 0) duw(c - 1);
    if (i < nx - 1) duw(c + 1);
    if (j > 0) duw(c - nx);
    if (j < ny - 1) duw(c + nx);
  }
  function duw(k) { if (!dicht[k] && !gebied[k]) { gebied[k] = 1; stapel.push(k); } }
  return { gebied, randGeraakt, oppervlakte: opp };
}

/** Buitengebied: alle open cellen die met de rand van het raster verbonden zijn. */
function buitenGebied(R) {
  const rand = [];
  for (let i = 0; i < R.nx; i++) rand.push(i, (R.ny - 1) * R.nx + i);
  for (let j = 0; j < R.ny; j++) rand.push(j * R.nx, j * R.nx + R.nx - 1);
  return vul(R, rand).gebied;
}

/**
 * Traceert de buitenrand van een gebied (Uint8Array van cellen) als polygoon in mm (tegenwijzerzin).
 * Bij meerdere lussen wordt de lus met de grootste (positieve) oppervlakte gekozen.
 */
function traceerContour(R, gebied) {
  const { nx, ny, xs, ys } = R;
  const W = nx + 1;
  const uit = new Map(); // hoekpunt → lijst doelhoekpunten (randen met het gebied links)
  const voeg = (a, b) => { if (!uit.has(a)) uit.set(a, []); uit.get(a).push(b); };
  const isIn = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && gebied[j * nx + i] === 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!gebied[j * nx + i]) continue;
    const v00 = j * W + i, v10 = v00 + 1, v01 = v00 + W, v11 = v01 + 1;
    if (!isIn(i, j - 1)) voeg(v00, v10);
    if (!isIn(i + 1, j)) voeg(v10, v11);
    if (!isIn(i, j + 1)) voeg(v11, v01);
    if (!isIn(i - 1, j)) voeg(v01, v00);
  }
  const xy = (v) => [xs[v % W], ys[(v - (v % W)) / W]];
  const richting = (a, b) => { const p = xy(a), q = xy(b); return [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])]; };
  let beste = null, besteOpp = 0;
  for (const startV of [...uit.keys()]) {
    while (uit.get(startV)?.length) {
      const lus = [startV];
      let vorig = startV, huidig = uit.get(startV).pop();
      let veilig = 0;
      while (huidig !== startV && veilig++ < 1e7) {
        lus.push(huidig);
        const opties = uit.get(huidig);
        if (!opties || !opties.length) break;
        let k = 0;
        if (opties.length > 1) {
          // bij een knooppunt: rechtsaf (voegt de lussen samen)
          const [dx, dy] = richting(vorig, huidig);
          k = opties.findIndex((o) => { const [ex, ey] = richting(huidig, o); return dx * ey - dy * ex < 0; });
          if (k < 0) k = 0;
        }
        const volgende = opties.splice(k, 1)[0];
        vorig = huidig; huidig = volgende;
      }
      const pts = lus.map(xy);
      let s = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
      if (s / 2 > besteOpp) { besteOpp = s / 2; beste = pts; }
    }
  }
  return beste;
}

/** Verwijdert collineaire en dubbele punten (gesloten polygoon). */
function zonderCollineair(pts) {
  let p = pts.slice();
  let veranderd = true;
  while (veranderd && p.length > 3) {
    veranderd = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const kruis = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(kruis) < 1e-6 || lengte(a, b) < 1e-6) { p.splice(i, 1); veranderd = true; break; }
    }
  }
  return p;
}

/** Douglas-Peucker voor een gesloten polygoon (enkel bij schuine muren, om trapjes weg te werken). */
function vereenvoudig(pts, tol) {
  if (pts.length <= 4) return pts;
  const dp = (lijst) => {
    if (lijst.length <= 2) return lijst;
    const a = lijst[0], b = lijst[lijst.length - 1];
    let maxD = -1, k = 0;
    for (let i = 1; i < lijst.length - 1; i++) {
      const d = afstandTotSegment(lijst[i], a, b).afstand;
      if (d > maxD) { maxD = d; k = i; }
    }
    if (maxD <= tol) return [a, b];
    const l = dp(lijst.slice(0, k + 1)), r = dp(lijst.slice(k));
    return [...l.slice(0, -1), ...r];
  };
  let ver = 0, k = 0;
  for (let i = 1; i < pts.length; i++) { const d = lengte(pts[0], pts[i]); if (d > ver) { ver = d; k = i; } }
  const eerste = dp(pts.slice(0, k + 1));
  const tweede = dp([...pts.slice(k), pts[0]]);
  return [...eerste.slice(0, -1), ...tweede.slice(0, -1)];
}

/** Afronden op 1 mm, start bij het punt met kleinste y (dan x), tegenwijzerzin. */
function normaliseer(pts) {
  let p = zonderCollineair(pts.map(([x, y]) => [rondN(x, 1), rondN(y, 1)]));
  let k = 0;
  for (let i = 1; i < p.length; i++) if (p[i][1] < p[k][1] || (p[i][1] === p[k][1] && p[i][0] < p[k][0])) k = i;
  return [...p.slice(k), ...p.slice(0, k)];
}

/**
 * Netto contour (binnenzijde muren) van de ruimte rond `punt` op `niveau`, of null als het gebied niet
 * gesloten is, het punt in een muur ligt, of het gebied groter is dan 2000 m².
 * Afbraakmuren tellen NIET als wand (de ruimte wordt in de nieuwe toestand benoemd). Openingen tellen als dicht.
 */
export function ruimteContourBijPunt(model, niveau, punt) {
  if (!isPunt(punt)) return null;
  const R = bouwRaster(model, niveau);
  if (!R) return null;
  const c = celVan(R, punt);
  if (c < 0 || R.dicht[c]) return null;
  const v = vul(R, [c], { stopAanRand: true });
  if (v.randGeraakt || v.oppervlakte > MAX_RUIMTE_M2 * 1e6) return null;
  let pts = traceerContour(R, v.gebied);
  if (!pts) return null;
  pts = zonderCollineair(pts);
  if (R.schuin) pts = vereenvoudig(pts, R.cel * 2);
  pts = normaliseer(pts);
  return pts.length >= 3 && polygoonOppervlakte(pts) >= 1 ? pts : null;
}

/**
 * Ids van de muren op `niveau` die op de buitenrand liggen: minstens één zijvlak grenst aan het gebied
 * buiten alle muren. Afbraakmuren tellen niet mee (en worden nooit teruggegeven).
 * Is het plan niet gesloten, dan lekt "buiten" naar binnen en worden ook binnenmuren teruggegeven.
 *
 * Niveau ONDER EEN DAK (v2): heeft het niveau `soort: 'zolder'`, of geen enkele omsloten ruimte, en rusten er hellende
 * daken (status ≠ afbraak) op zijn vloerpeil, dan is er geen gesloten gevel om mee te werken (de flood-fill zou alles
 * bereiken). Dan geldt: een wand is een buitenmuur enkel als hij op de buitenrand van de dakvoetafdruk (contour zonder
 * overstek, unie van die daken) ligt — bv. een topgevel; alle andere wanden zijn binnenwanden.
 */
export function buitenMuren(model, niveau) {
  const R = bouwRaster(model, niveau);
  if (!R) return [];
  const buiten = buitenGebied(R);
  const daken = dakVoetafdrukkenOpPeil(model, niveau);
  const nv = model.niveaus.find((n) => n.id === niveau);
  const onderDak = daken.length > 0 && (nv?.soort === 'zolder' || !heeftBinnenruimte(R, buiten));
  // onder een dak: "buiten" = buiten de unie van de dakvoetafdrukken (50 mm voorbij het zijvlak)
  const isBuiten = onderDak
    ? (p) => !inEenVan(p, daken, 0)
    : (p) => { const c = celVan(R, p); return c < 0 || buiten[c] === 1; };
  const delta = onderDak ? DAKRAND_TOL : (R.schuin ? R.cel * 1.5 : 0.25);
  const uit = [];
  for (const m of R.muren) {
    const r = muurRichting(m);
    const L = r.L;
    const n = Math.max(3, Math.min(40, Math.ceil(L / 250)));
    let gevonden = false;
    for (let k = 0; k <= n && !gevonden; k++) {
      const t = L * (0.1 + (0.8 * k) / n);
      const p = puntOpMuur(m, t);
      for (const s of [1, -1]) {
        const off = s * (m.dikte / 2 + delta);
        if (isBuiten([p[0] + r.nx * off, p[1] + r.ny * off])) { gevonden = true; break; }
      }
    }
    if (gevonden) uit.push(m.id);
  }
  return uit;
}

/** Afstand (mm) voorbij het zijvlak waarop gekeken wordt of een wand op de rand van de dakvoetafdruk ligt. */
const DAKRAND_TOL = 50;

/** Contouren (zonder overstek) van de hellende daken (status ≠ afbraak) die op het vloerpeil van `niveau` rusten. */
function dakVoetafdrukkenOpPeil(model, niveau) {
  const nv = model.niveaus.find((n) => n.id === niveau);
  if (!nv) return [];
  return (model.daken || [])
    .filter((d) => d.status !== 'afbraak' && d.type !== 'plat' && isGetal(d.helling) && d.helling > 0
      && Array.isArray(d.contour) && d.contour.length >= 3 && Math.abs(niveauBovenkant(model, d.niveau) - nv.peil) < 1)
    .map((d) => d.contour);
}

/** Is er minstens één vrije cel die niet "buiten" ligt (een door muren omsloten gebied)? */
function heeftBinnenruimte(R, buiten) {
  for (let c = 0; c < buiten.length; c++) if (!buiten[c] && !R.dicht[c]) return true;
  return false;
}

/** Rechthoek (tegenwijzerzin) rond de buitenzijde van de (niet-afbraak) muren van een niveau, of null. */
function muurBegrenzing(model, niveau) {
  const R = bouwRaster(model, niveau);
  if (!R) return null;
  const b = begrenzing(R.rechthoeken.flatMap((r) => r.pts));
  const x0 = rondN(b.minX, 1), x1 = rondN(b.maxX, 1), y0 = rondN(b.minY, 1), y1 = rondN(b.maxY, 1);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * Buitencontour (buitenzijde muren) van een niveau: rand van alles wat niet "buiten" is.
 * Terugval op de rechthoekige begrenzing als het plan niet gesloten is. null zonder muren.
 */
export function buitenContour(model, niveau) {
  const R = bouwRaster(model, niveau);
  if (!R) return null;
  const buiten = buitenGebied(R);
  const binnen = new Uint8Array(buiten.length);
  let ruimte = false;
  for (let c = 0; c < buiten.length; c++) {
    binnen[c] = buiten[c] ? 0 : 1;
    if (!buiten[c] && !R.dicht[c]) ruimte = true;
  }
  if (!ruimte) return muurBegrenzing(model, niveau);
  let pts = traceerContour(R, binnen);
  if (!pts) return muurBegrenzing(model, niveau);
  pts = zonderCollineair(pts);
  if (R.schuin) pts = vereenvoudig(pts, R.cel * 2);
  return normaliseer(pts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ruimtes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bestaande ruimte op `punt` ⇒ naam/functie wijzigen; anders nieuwe ruimte met ruimteContourBijPunt.
 * info: { id, nieuw: boolean, contour? }
 */
export function opsRuimteBenoemen(model, niveau, punt, { naam, functie } = {}) {
  if (!heeftNiveau(model, niveau)) return fout(`Onbekend niveau "${niveau}".`);
  if (!isPunt(punt)) return fout('Punt moet [x, y] in mm zijn.');
  if (functie !== undefined && !FUNCTIES.includes(functie)) return fout(`Functie "${functie}" is ongeldig; kies uit: ${FUNCTIES.join(', ')}.`);
  if (naam !== undefined && (typeof naam !== 'string' || !naam.trim())) return fout('Geef een naam voor de ruimte.');
  const bestaand = model.ruimtes.find((r) => r.niveau === niveau && puntInPolygoon(punt, r.contour));
  if (bestaand) {
    const velden = {};
    if (naam !== undefined) velden.naam = naam.trim();
    if (functie !== undefined) velden.functie = functie;
    if (!Object.keys(velden).length) return { ops: [], info: { id: bestaand.id, nieuw: false } };
    return { ops: [{ op: 'wijzigen', collectie: 'ruimtes', id: bestaand.id, velden }], info: { id: bestaand.id, nieuw: false } };
  }
  if (naam === undefined) return fout('Geef een naam voor de ruimte.');
  const contour = ruimteContourBijPunt(model, niveau, punt);
  if (!contour) return fout('Hier is geen gesloten ruimte gevonden (gebied is open, te groot, of het punt ligt in een muur). Teken de ruimte als rechthoek.');
  const id = idMaker(model)('ruimtes');
  return {
    ops: [{ op: 'toevoegen', collectie: 'ruimtes', item: { id, niveau, naam: naam.trim(), functie: functie ?? 'overig', contour } }],
    info: { id, nieuw: true, contour },
  };
}

/** Ruimte als rechthoek tussen twee hoekpunten (terugval voor open gebieden). */
export function opsRuimteRechthoek(model, niveau, p1, p2, { naam, functie = 'overig' } = {}) {
  if (!heeftNiveau(model, niveau)) return fout(`Onbekend niveau "${niveau}".`);
  if (!isPunt(p1) || !isPunt(p2)) return fout('Hoekpunten moeten [x, y] in mm zijn.');
  if (typeof naam !== 'string' || !naam.trim()) return fout('Geef een naam voor de ruimte.');
  if (!FUNCTIES.includes(functie)) return fout(`Functie "${functie}" is ongeldig; kies uit: ${FUNCTIES.join(', ')}.`);
  const x0 = rondN(Math.min(p1[0], p2[0]), 1), x1 = rondN(Math.max(p1[0], p2[0]), 1);
  const y0 = rondN(Math.min(p1[1], p2[1]), 1), y1 = rondN(Math.max(p1[1], p2[1]), 1);
  if (x1 - x0 < 100 || y1 - y0 < 100) return fout('Rechthoek is te klein (minimaal 100 × 100 mm).');
  const contour = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const id = idMaker(model)('ruimtes');
  return { ops: [{ op: 'toevoegen', collectie: 'ruimtes', item: { id, niveau, naam: naam.trim(), functie, contour } }], info: { id, contour } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Niveaus en daken
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nieuw niveau bovenop het hoogste (grootste peil). Kopieert muren van het vorige bovenste niveau
 * ('buiten' = buitenMuren, 'alle' = alle niet-afbraakmuren, 'geen'), met status `status`, zonder openingen
 * en zonder eigen hoogte. Vloer = buitencontour van de muren van het vorige bovenste niveau.
 * Daken op het vorige bovenste niveau verhuizen mee (verplaatsDaken).
 * info: { id, muren: [nieuwe ids], vloer: id|null, daken: [verhuisde ids] }
 */
export function opsNiveauToevoegen(model, {
  naam, hoogte = 2700, kopieerMuren = 'buiten', verplaatsDaken = true, status = 'nieuw', vloerdikte = 300,
} = {}) {
  if (!isGetal(hoogte) || hoogte <= 0) return fout('Verdiepingshoogte moet > 0 mm zijn.');
  if (!['buiten', 'alle', 'geen'].includes(kopieerMuren)) return fout('kopieerMuren moet "buiten", "alle" of "geen" zijn.');
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  if (!isGetal(vloerdikte) || vloerdikte <= 0) return fout('Vloerdikte moet > 0 mm zijn.');
  if (!model.niveaus.length) return fout('Het ontwerp heeft geen niveaus.');
  const top = model.niveaus.reduce((a, b) => (b.peil > a.peil ? b : a));
  const nieuwId = idMaker(model);
  const id = nieuwId('niveaus');
  const nm = typeof naam === 'string' && naam.trim() ? naam.trim() : `Verdieping ${model.niveaus.length}`;
  const ops = [{ op: 'toevoegen', collectie: 'niveaus', item: { id, naam: nm, peil: top.peil + top.hoogte, hoogte, vloerdikte } }];
  const info = { id, muren: [], vloer: null, daken: [] };

  let bron = [];
  if (kopieerMuren === 'alle') bron = model.muren.filter((m) => m.niveau === top.id && m.status !== 'afbraak');
  else if (kopieerMuren === 'buiten') {
    const ids = new Set(buitenMuren(model, top.id));
    bron = model.muren.filter((m) => ids.has(m.id));
  }
  for (const m of bron) {
    const mid = nieuwId('muren');
    ops.push({ op: 'toevoegen', collectie: 'muren', item: { id: mid, niveau: id, start: [...m.start], eind: [...m.eind], dikte: m.dikte, status } });
    info.muren.push(mid);
  }
  const contour = buitenContour(model, top.id);
  if (contour) {
    const vid = nieuwId('vloeren');
    ops.push({ op: 'toevoegen', collectie: 'vloeren', item: { id: vid, niveau: id, contour, dikte: vloerdikte, status } });
    info.vloer = vid;
  }
  if (verplaatsDaken) for (const d of model.daken.filter((x) => x.niveau === top.id)) {
    ops.push({ op: 'wijzigen', collectie: 'daken', id: d.id, velden: { niveau: id } });
    info.daken.push(d.id);
  }
  return { ops, info };
}

/**
 * Dak op `niveau` instellen: bestaand dak wijzigen (optie `id`, anders het eerste dak op dat niveau),
 * of nieuw dak met contour = rechthoekige begrenzing van de buitenzijde van de muren van dat niveau.
 * Niet-opgegeven velden blijven bij een bestaand dak ongewijzigd (behalve de standaardwaarden uit de signatuur).
 * info: { id, nieuw: boolean }
 */
export function opsDakInstellen(model, niveau, { id, type, helling, nokrichting = 'x', overstek = 300, status, dikte } = {}) {
  if (!heeftNiveau(model, niveau)) return fout(`Onbekend niveau "${niveau}".`);
  if (type !== undefined && !DAK_TYPES.includes(type)) return fout(`Daktype "${type}" is ongeldig; kies uit: ${DAK_TYPES.join(', ')}.`);
  if (!NOKRICHTINGEN.includes(nokrichting)) return fout(`Nokrichting moet ${NOKRICHTINGEN.join(' of ')} zijn.`);
  if (helling !== undefined && (!isGetal(helling) || helling < 0 || helling > 75)) return fout('Helling moet tussen 0 en 75° liggen.');
  if (!isGetal(overstek) || overstek < 0) return fout('Overstek mag niet negatief zijn.');
  if (status !== undefined && !STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  if (dikte !== undefined && (!isGetal(dikte) || dikte <= 0)) return fout('Dakdikte moet > 0 mm zijn.');
  const bestaand = id ? model.daken.find((d) => d.id === id && d.niveau === niveau) : model.daken.find((d) => d.niveau === niveau);
  if (id && !bestaand) return fout(`Dak "${id}" niet gevonden op niveau ${niveau}.`);
  if (bestaand) {
    const t = type ?? bestaand.type;
    const velden = { type: t, nokrichting, overstek };
    if (helling !== undefined) velden.helling = helling;
    else if (t === 'plat') velden.helling = 0;
    if (status !== undefined) velden.status = status;
    if (dikte !== undefined) velden.dikte = dikte;
    return { ops: [{ op: 'wijzigen', collectie: 'daken', id: bestaand.id, velden }], info: { id: bestaand.id, nieuw: false } };
  }
  if (!type) return fout('Kies een daktype.');
  const contour = muurBegrenzing(model, niveau);
  if (!contour) return fout(`Niveau ${niveau} heeft geen muren om het dak op te leggen.`);
  const did = idMaker(model)('daken');
  const item = { id: did, niveau, type, contour, helling: helling ?? (type === 'plat' ? 0 : 35), nokrichting, overstek, status: status ?? 'nieuw' };
  if (dikte !== undefined) item.dikte = dikte;
  return { ops: [{ op: 'toevoegen', collectie: 'daken', item }], info: { id: did, nieuw: true } };
}

// ═════════════════════════════════════════════════════════════════════════════
// Fase 5 (schemaVersie 2): muur splitsen, afbraakzone, trap, inrichting, zolder
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Ops om een muur op de opgegeven afstanden (mm vanaf start, oplopend) in stukken te knippen.
 * Het eerste stuk behoudt het id; de andere krijgen nieuwe id's. Openingen verhuizen mee naar hun stuk;
 * een opening die over een knip ligt ⇒ fout.
 * @returns {{ ops, delen: Array<{ id, t0, t1 }> } | { fout }}
 */
function knipOps(model, muur, ts, nieuwId) {
  const L = muurLengte(muur);
  const grenzen = [0, ...ts, L];
  for (let i = 1; i < grenzen.length; i++)
    if (grenzen[i] - grenzen[i - 1] < MIN_MUURLENGTE) return { fout: `Splitsen van muur ${muur.id} geeft een stuk korter dan ${MIN_MUURLENGTE} mm.` };
  const delen = [];
  const ops = [];
  for (let i = 0; i < grenzen.length - 1; i++) {
    const t0 = grenzen[i], t1 = grenzen[i + 1];
    const s = rondP(puntOpMuur(muur, t0)), e = rondP(puntOpMuur(muur, t1));
    if (i === 0) {
      ops.push({ op: 'wijzigen', collectie: 'muren', id: muur.id, velden: { eind: e } });
      delen.push({ id: muur.id, t0, t1 });
    } else {
      const id = nieuwId('muren');
      const item = { id, niveau: muur.niveau, start: s, eind: e, dikte: muur.dikte, status: muur.status };
      if (isGetal(muur.hoogte)) item.hoogte = muur.hoogte;
      ops.push({ op: 'toevoegen', collectie: 'muren', item });
      delen.push({ id, t0, t1 });
    }
  }
  for (const o of model.openingen.filter((x) => x.muur === muur.id)) {
    const deel = delen.find((d) => o.positie >= d.t0 - 0.5 && o.positie + o.breedte <= d.t1 + 0.5);
    if (!deel) return { fout: `Opening ${o.id} ligt over de knip in muur ${muur.id}; verschuif of verklein ze eerst.` };
    if (deel.id !== muur.id) ops.push({ op: 'wijzigen', collectie: 'openingen', id: o.id, velden: { muur: deel.id, positie: rond01(Math.max(0, o.positie - deel.t0)) } });
  }
  return { ops, delen };
}

/**
 * Muur splitsen op `positie` (mm langs de as vanaf start) of op de projectie van een punt [x, y].
 * info: { ids: [bestaand id, nieuw id] }
 */
export function opsMuurSplitsen(model, id, positie) {
  const M = vindMuur(model, id);
  if (!M) return fout(`Muur "${id}" niet gevonden.`);
  const L = muurLengte(M);
  const t = isPunt(positie) ? afstandTotSegment(positie, M.start, M.eind).t * L : positie;
  if (!isGetal(t)) return fout('Geef een positie (mm vanaf het begin van de muur) of een punt [x, y].');
  const r = knipOps(model, M, [rond01(t)], idMaker(model));
  if (r.fout) return fout(r.fout);
  return { ops: r.ops, info: { ids: r.delen.map((d) => d.id) } };
}

/** Op afbraak zetten: bestaand → afbraak, nieuw → verwijderen (bestond nooit), afbraak → niets. */
function afbreekOp(collectie, item) {
  if (item.status === 'afbraak') return null;
  if (item.status === 'nieuw') return { op: 'verwijderen', collectie, id: item.id };
  return { op: 'wijzigen', collectie, id: item.id, velden: { status: 'afbraak' } };
}

const ZONE_PROEF = 100; // mm voorbij het muurvlak waar gekeken wordt aan welke ruimte de muur grenst

/** Snijpunten (t langs de as) van de lijn evenwijdig aan de muuras op afstand d met de randen van polygonen. */
function snijT(muur, d, polygonen) {
  const { ux, uy, nx, ny, L } = muurRichting(muur);
  const ox = muur.start[0] + nx * d, oy = muur.start[1] + ny * d;
  const uit = [];
  for (const pts of polygonen) for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const sx = b[0] - a[0], sy = b[1] - a[1];
    const k = ux * sy - uy * sx;
    if (Math.abs(k) < 1e-9) continue;
    const t = ((a[0] - ox) * sy - (a[1] - oy) * sx) / k;
    const u = ((a[0] - ox) * uy - (a[1] - oy) * ux) / k;
    if (u >= -1e-9 && u <= 1 + 1e-9 && t > 0 && t < L) uit.push(t);
  }
  return uit;
}

/**
 * Indeling van een muur in stukken die bij de zone horen ('A' = afbreken) en stukken die blijven ('B').
 * Een stuk hoort bij de zone als een zijde aan een zoneruimte grenst en geen zijde aan een andere ruimte.
 * Stukken die nergens aan grenzen (bv. ter hoogte van een kruisende muur) nemen de klasse van hun buren; tussen A en B
 * wordt geknipt op de as van een kruisende muur (anders in het midden).
 * @returns {{ delen: Array<{c:'A'|'B', t0, t1}>, rand: boolean }} rand = blijvende muur die aan de zone grenst
 */
function deelMuurIn(muur, zone, behoud, andereMuren) {
  const r = muurRichting(muur);
  const { nx, ny, L } = r;
  const d = muur.dikte / 2 + ZONE_PROEF;
  const murenRh = andereMuren.map(muurRechthoek);
  const vormen = [...zone, ...behoud, ...murenRh];
  const ts = uniekGesorteerd([0, L, ...snijT(muur, d, vormen), ...snijT(muur, -d, vormen)]);
  // 'muur' = de proef valt in een andere muur (aansluiting): zegt niets over zone of niet
  const klasse = (p) => (zone.some((c) => puntInPolygoon(p, c)) ? 'zone' : behoud.some((c) => puntInPolygoon(p, c)) ? 'behoud'
    : murenRh.some((c) => puntInPolygoon(p, c)) ? 'muur' : 'leeg');
  const stukken = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const tm = (ts[i] + ts[i + 1]) / 2;
    const p = puntOpMuur(muur, tm);
    const k = [klasse([p[0] + nx * d, p[1] + ny * d]), klasse([p[0] - nx * d, p[1] - ny * d])];
    const c = k.includes('behoud') ? 'B' : k.includes('muur') ? 'L' : k.includes('zone') ? 'A' : 'L';
    const rand = k.includes('zone') && k.includes('behoud');
    const vorige = stukken[stukken.length - 1];
    if (vorige && vorige.c === c) { vorige.t1 = ts[i + 1]; vorige.rand ||= rand; }
    else stukken.push({ c, t0: ts[i], t1: ts[i + 1], rand });
  }
  const randGeraakt = stukken.some((s) => s.rand);
  if (!stukken.some((s) => s.c === 'A')) return { delen: [{ c: 'B', t0: 0, t1: L }], rand: randGeraakt };
  for (let i = 0; i < stukken.length; i++) {
    const s = stukken[i];
    if (s.c !== 'L') continue;
    const voor = stukken[i - 1]?.c, na = stukken[i + 1]?.c;
    if ((voor ?? na) === (na ?? voor)) { s.c = voor ?? na ?? 'B'; continue; }
    let knip = null;
    for (const B of andereMuren) {
      const rb = muurRichting(B);
      const k = r.ux * rb.uy - r.uy * rb.ux;
      if (Math.abs(k) < 0.02) continue;
      const t = ((B.start[0] - muur.start[0]) * rb.uy - (B.start[1] - muur.start[1]) * rb.ux) / k;
      const u = ((B.start[0] - muur.start[0]) * r.uy - (B.start[1] - muur.start[1]) * r.ux) / k;
      if (t > s.t0 + 0.5 && t < s.t1 - 0.5 && u >= -B.dikte && u <= rb.L + B.dikte) { knip = t; break; }
    }
    if (knip == null) knip = (s.t0 + s.t1) / 2;
    stukken.splice(i, 1, { c: voor, t0: s.t0, t1: knip }, { c: na, t0: knip, t1: s.t1 });
    i++;
  }
  const delen = [];
  for (const s of stukken) {
    const vorige = delen[delen.length - 1];
    if (vorige && vorige.c === s.c) vorige.t1 = s.t1;
    else delen.push({ c: s.c, t0: s.t0, t1: s.t1 });
  }
  const goed = delen.filter((x) => x.t1 - x.t0 > 0.5);
  return { delen: goed, rand: goed.some((x) => x.c === 'B') && (randGeraakt || goed.some((x) => x.c === 'A')) };
}

const isRechthoek = (c) => {
  if (!Array.isArray(c) || c.length !== 4) return false;
  const b = begrenzing(c);
  return Math.abs(polygoonOppervlakte(c) - b.breedte * b.diepte) < 1;
};
const rhPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/**
 * Een gebouwdeel afbreken. Twee manieren:
 *  - `ids`: precies die elementen (muren met hun openingen, openingen, vloeren, daken, trappen, inrichting → afbraak;
 *    ruimtes → verwijderd; niveau-id ⇒ alle elementen op dat niveau).
 *  - zone via `ruimte` (id of lijst id's) of `punt` (+ `niveau`: de ruimte die het punt bevat):
 *    · muren die enkel aan zoneruimtes (of aan niets) grenzen ⇒ afbraak; muren die ook aan een blijvende ruimte
 *      grenzen (GEDEELDE muren, bv. de oude achtergevel of een scheidingsmuur) blijven en worden gemeld als
 *      `randMuren` (mogelijk dragend / worden buitengevel). Muren die deels in de zone liggen worden gesplitst
 *      (op de as van de kruisende muur);
 *    · openingen in af te breken muurstukken ⇒ afbraak; de ruimtes van de zone ⇒ verwijderd;
 *    · vloeren/daken van dat niveau binnen de zonebegrenzing (rechthoek rond de zoneruimtes + af te breken muurstukken)
 *      ⇒ afbraak; rechthoekige vloeren en platte daken die er deels in liggen (strook aan één zijde) ⇒ gesplitst;
 *      anders een melding;
 *    · trappen (vanNiveau) en inrichting in de zone ⇒ afbraak.
 *  Elementen met status `nieuw` worden verwijderd i.p.v. op afbraak gezet (ze bestonden nog niet).
 * info: { niveau, ruimtes, afbraak: [ids], verwijderd: [ids], gesplitst: [{ id, nieuw: [ids] }], randMuren: [ids], meldingen: [tekst] }
 */
export function opsAfbraakZone(model, { niveau, ids, punt, ruimte } = {}) {
  const nieuwId = idMaker(model);
  const ops = [];
  const info = { niveau: niveau ?? null, ruimtes: [], afbraak: [], verwijderd: [], gesplitst: [], randMuren: [], meldingen: [] };
  const breekAf = (collectie, item) => {
    const op = afbreekOp(collectie, item);
    if (!op) return;
    ops.push(op);
    (op.op === 'verwijderen' ? info.verwijderd : info.afbraak).push(item.id);
  };
  const openingenVan = (muurId) => model.openingen.filter((o) => o.muur === muurId);

  if (ids !== undefined) {
    const lijst = Array.isArray(ids) ? ids : [ids];
    if (!lijst.length) return fout('Geef minstens één id.');
    const gezien = new Set();
    const doe = (c, x) => {
      if (gezien.has(x.id)) return;
      gezien.add(x.id);
      if (c === 'ruimtes') { ops.push({ op: 'verwijderen', collectie: 'ruimtes', id: x.id }); info.verwijderd.push(x.id); return; }
      if (c === 'muren' && x.status !== 'nieuw') for (const o of openingenVan(x.id)) if (!gezien.has(o.id)) { gezien.add(o.id); breekAf('openingen', o); }
      if (c === 'muren' && x.status === 'nieuw') for (const o of openingenVan(x.id)) gezien.add(o.id); // cascade
      breekAf(c, x);
    };
    for (const id of lijst) {
      const c = COLLECTIE_NAMEN.find((cc) => (model[cc] || []).some((x) => x.id === id));
      if (!c) return fout(`Element "${id}" niet gevonden.`);
      if (c === 'niveaus') {
        for (const cc of ['muren', 'vloeren', 'daken', 'inrichting', 'ruimtes']) for (const y of (model[cc] || []).filter((z) => z.niveau === id)) doe(cc, y);
        for (const t of (model.trappen || []).filter((z) => z.vanNiveau === id)) doe('trappen', t);
      } else doe(c, model[c].find((y) => y.id === id));
    }
    return { ops, info };
  }

  // ── zone ──
  let zoneRuimtes;
  if (ruimte !== undefined) {
    const lijst = Array.isArray(ruimte) ? ruimte : [ruimte];
    zoneRuimtes = lijst.map((id) => model.ruimtes.find((r) => r.id === id));
    const i = zoneRuimtes.findIndex((r) => !r);
    if (i >= 0) return fout(`Ruimte "${lijst[i]}" niet gevonden.`);
  } else if (isPunt(punt)) {
    if (!heeftNiveau(model, niveau)) return fout(`Onbekend niveau "${niveau}".`);
    const r = model.ruimtes.find((x) => x.niveau === niveau && puntInPolygoon(punt, x.contour));
    if (!r) return fout('Op dit punt ligt geen ruimte; benoem eerst de ruimte of geef de id\'s van de elementen.');
    zoneRuimtes = [r];
  } else return fout('Geef de zone op met ids, ruimte of punt.');
  if (!zoneRuimtes.length) return fout('Geef minstens één ruimte.');
  const nv = zoneRuimtes[0].niveau;
  if (zoneRuimtes.some((r) => r.niveau !== nv)) return fout('Alle ruimtes van de zone moeten op hetzelfde niveau liggen.');
  if (niveau !== undefined && niveau !== null && niveau !== nv) return fout(`Ruimte ${zoneRuimtes[0].id} ligt op niveau ${nv}, niet op ${niveau}.`);
  info.niveau = nv;
  info.ruimtes = zoneRuimtes.map((r) => r.id);
  const zone = zoneRuimtes.map((r) => r.contour);
  const zoneIds = new Set(info.ruimtes);
  const behoud = model.ruimtes.filter((r) => r.niveau === nv && !zoneIds.has(r.id)).map((r) => r.contour);
  const muren = model.muren.filter((m) => m.niveau === nv && m.status !== 'afbraak' && muurLengte(m) >= 1);

  const afbraakDelen = []; // rechthoeken van af te breken muurstukken (voor de zonebegrenzing)
  for (const m of muren) {
    const { delen, rand } = deelMuurIn(m, zone, behoud, muren.filter((x) => x.id !== m.id));
    if (rand) info.randMuren.push(m.id);
    if (!delen.some((d) => d.c === 'A')) continue;
    for (const d of delen) if (d.c === 'A') afbraakDelen.push(muurDeelRechthoek(m, d.t0, d.t1));
    if (delen.length === 1) {
      if (m.status !== 'nieuw') for (const o of openingenVan(m.id)) breekAf('openingen', o);
      breekAf('muren', m);
      continue;
    }
    const k = knipOps(model, m, delen.slice(1).map((d) => rond01(d.t0)), nieuwId);
    if (k.fout) return fout(k.fout);
    ops.push(...k.ops);
    info.gesplitst.push({ id: m.id, nieuw: k.delen.slice(1).map((d) => d.id) });
    k.delen.forEach((stuk, i) => {
      if (delen[i].c !== 'A') return;
      if (m.status !== 'nieuw') {
        for (const o of openingenVan(m.id)) if (o.positie >= stuk.t0 - 0.5 && o.positie + o.breedte <= stuk.t1 + 0.5) breekAf('openingen', o);
      }
      breekAf('muren', { ...m, id: stuk.id });
    });
  }

  // vloeren en daken van dit niveau
  const zb = begrenzing([...zone.flat(), ...afbraakDelen.flat()]);
  const binnenZb = (c, tol = 1) => c.every(([x, y]) => x >= zb.minX - tol && x <= zb.maxX + tol && y >= zb.minY - tol && y <= zb.maxY + tol);
  for (const c of ['vloeren', 'daken']) for (const x of model[c].filter((y) => y.niveau === nv && y.status !== 'afbraak')) {
    if (binnenZb(x.contour)) { breekAf(c, x); continue; }
    const b = begrenzing(x.contour);
    const ox0 = Math.max(b.minX, zb.minX), ox1 = Math.min(b.maxX, zb.maxX), oy0 = Math.max(b.minY, zb.minY), oy1 = Math.min(b.maxY, zb.maxY);
    if (ox1 - ox0 < 1 || oy1 - oy0 < 1) continue; // raakt de zone niet
    const hellend = c === 'daken' && x.type !== 'plat' && x.helling;
    const volleBreedte = ox0 <= b.minX + 1 && ox1 >= b.maxX - 1, volleDiepte = oy0 <= b.minY + 1 && oy1 >= b.maxY - 1;
    let rest = null, deel = null;
    if (isRechthoek(x.contour) && !hellend) {
      if (volleBreedte && oy0 <= b.minY + 1) { rest = rhPts(b.minX, oy1, b.maxX, b.maxY); deel = rhPts(b.minX, b.minY, b.maxX, oy1); }
      else if (volleBreedte && oy1 >= b.maxY - 1) { rest = rhPts(b.minX, b.minY, b.maxX, oy0); deel = rhPts(b.minX, oy0, b.maxX, b.maxY); }
      else if (volleDiepte && ox0 <= b.minX + 1) { rest = rhPts(ox1, b.minY, b.maxX, b.maxY); deel = rhPts(b.minX, b.minY, ox1, b.maxY); }
      else if (volleDiepte && ox1 >= b.maxX - 1) { rest = rhPts(b.minX, b.minY, ox0, b.maxY); deel = rhPts(ox0, b.minY, b.maxX, b.maxY); }
    }
    const naam = c === 'vloeren' ? 'Vloer' : 'Dak';
    if (!rest) { info.meldingen.push(`${naam} ${x.id} ligt deels in de zone en is niet aangepast (enkel rechthoekige vloeren en platte daken met een strook aan één zijde worden gesplitst).`); continue; }
    ops.push({ op: 'wijzigen', collectie: c, id: x.id, velden: { contour: rest.map(rondP) } });
    if (x.status === 'nieuw') { info.gesplitst.push({ id: x.id, nieuw: [] }); continue; }
    const id = nieuwId(c);
    ops.push({ op: 'toevoegen', collectie: c, item: { ...x, id, contour: deel.map(rondP), status: 'afbraak' } });
    info.gesplitst.push({ id: x.id, nieuw: [id] });
    info.afbraak.push(id);
  }
  for (const c of ['vloeren', 'daken']) for (const x of model[c].filter((y) => y.niveau !== nv && y.status !== 'afbraak' && binnenZb(y.contour, -1)))
    info.meldingen.push(`${c === 'vloeren' ? 'Vloer' : 'Dak'} ${x.id} (niveau ${x.niveau}) ligt boven of onder de zone en is niet aangepast.`);

  const inZone = (p) => zone.some((c) => puntInPolygoon(p, c));
  for (const t of (model.trappen || []).filter((x) => x.vanNiveau === nv && isPunt(x.oorsprong))) {
    const v = trapVoetafdruk(t, { model });
    const c = v ? begrenzing(v) : null;
    if (c && inZone([(c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2])) breekAf('trappen', t);
  }
  for (const x of (model.inrichting || []).filter((y) => y.niveau === nv && (zoneIds.has(y.ruimte) || (!y.ruimte && isPunt(y.positie) && inZone(y.positie))))) breekAf('inrichting', x);
  for (const r of zoneRuimtes) { ops.push({ op: 'verwijderen', collectie: 'ruimtes', id: r.id }); info.verwijderd.push(r.id); }
  if (info.randMuren.length) info.meldingen.push(`Blijvende muren op de rand van de zone (mogelijk dragend; worden mogelijk buitengevel): ${info.randMuren.join(', ')}.`);
  return { ops, info };
}

/**
 * Nieuwe trap. Parameters: { van|vanNiveau, naar|naarNiveau, type, oorsprong, richting = 0, breedte, aantalTreden?, optrede?,
 * aantrede?, draairichting? (standaard links bij kwart/halfdraai/spiraal), diameter?, status = 'nieuw', instellingen? }.
 * Fout als: type/niveaus ongeldig, naar niet boven van, geometrie onmogelijk, voetafdruk buiten de vloer(en) van een van
 * beide niveaus, botsing met een (niet-afbraak)muur op een van beide niveaus, of loophoogte < ingestelde grens (als die ingesteld is).
 * info: { id, maten, voetafdruk, trapgat: { niveau, contour }, loophoogte (min, mm of null) }
 */
export function opsTrapPlaatsen(model, p = {}) {
  const van = p.van ?? p.vanNiveau, naar = p.naar ?? p.naarNiveau;
  const { type, oorsprong, richting = 0, breedte, status = 'nieuw', instellingen } = p;
  if (!heeftNiveau(model, van)) return fout(`Onbekend vanNiveau "${van}".`);
  if (!heeftNiveau(model, naar)) return fout(`Onbekend naarNiveau "${naar}".`);
  if (!TRAP_TYPES.includes(type)) return fout(`Traptype "${type}" is ongeldig; kies uit: ${TRAP_TYPES.join(', ')}.`);
  if (!isPunt(oorsprong)) return fout('Oorsprong moet [x, y] in mm zijn.');
  if (!isGetal(richting)) return fout('Richting moet een hoek in graden zijn.');
  if (!isGetal(breedte) || breedte <= 0) return fout('Breedte moet > 0 mm zijn.');
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  if (p.draairichting !== undefined && !DRAAIRICHTINGEN.includes(p.draairichting)) return fout(`Draairichting moet ${DRAAIRICHTINGEN.join(' of ')} zijn.`);
  for (const k of ['aantalTreden', 'optrede', 'aantrede', 'diameter']) if (p[k] !== undefined && p[k] !== null && (!isGetal(p[k]) || p[k] <= 0)) return fout(`${k} moet > 0 zijn.`);
  if (p.aantalTreden != null && !Number.isInteger(p.aantalTreden)) return fout('aantalTreden moet een geheel getal zijn.');
  const nv = (id) => model.niveaus.find((n) => n.id === id);
  if (nv(naar).peil <= nv(van).peil) return fout(`Niveau ${naar} ligt niet boven ${van}.`);
  const inst = metInstellingen(instellingen);
  const id = idMaker(model)('trappen');
  const item = { id, vanNiveau: van, naarNiveau: naar, type, oorsprong: rondP(oorsprong), richting, breedte };
  for (const k of ['aantalTreden', 'optrede', 'aantrede', 'diameter', 'draairichting']) if (p[k] !== undefined && p[k] !== null) item[k] = p[k];
  if (type !== 'recht' && !item.draairichting) item.draairichting = 'links';
  item.status = status;
  const g = trapGeometrie(model, item, { instellingen: inst });
  if (!g || g.fout) return fout(g?.fout || 'Trapgeometrie kan niet berekend worden.');
  for (const n of [van, naar]) {
    const grens = niveauBegrenzing(model, n);
    if (grens.length && !g.voetafdruk.every((q) => inEenVan(q, grens, 2))) return fout(`De trap past niet binnen de vloer(en) van niveau ${n}${n === naar ? ' (trapgat)' : ''}.`);
    const botsing = model.muren.find((m) => m.niveau === n && m.status !== 'afbraak' && muurLengte(m) >= 1 && polygonenOverlappen(g.voetafdruk, muurRechthoek(m), 2));
    if (botsing) return fout(`De trap botst met muur ${botsing.id} op niveau ${n}.`);
  }
  const lh = trapLoophoogte({ ...model, trappen: [...(model.trappen || []), item] }, item, { instellingen: inst });
  const minLh = instelling(inst, 'trap.minLoophoogte');
  if (isGetal(minLh) && lh?.min != null && lh.min < minLh - 0.5) return fout(`Loophoogte ${Math.round(lh.min)} mm is lager dan de ingestelde ${minLh} mm.`);
  return {
    ops: [{ op: 'toevoegen', collectie: 'trappen', item }],
    info: { id, maten: g.maten, voetafdruk: g.voetafdruk, trapgat: { niveau: naar, contour: g.voetafdruk }, loophoogte: lh?.min ?? null },
  };
}

/**
 * Inrichtingselement (sanitair, meubel) plaatsen. Parameters: { soort, ruimte?, niveau?, positie?, rotatie?, breedte?, diepte?,
 * hoogte?, status = 'nieuw', instellingen? }. Ontbrekende maten komen uit de instellingen (werkwaarden, geen norm).
 * Zonder `positie` (vereist `ruimte`): eerste plek met de rugzijde tegen een rand van de ruimtecontour, volledig in de ruimte,
 * zonder overlap met andere inrichting en (als de hoogte gekend is) met voldoende vrije hoogte. Zoekstap 50 mm.
 * info: { id, positie, rotatie, contour }
 */
export function opsInrichtingPlaatsen(model, p = {}) {
  const { soort, status = 'nieuw', instellingen } = p;
  if (!INRICHTING_SOORTEN.includes(soort)) return fout(`Soort "${soort}" is ongeldig; kies uit: ${INRICHTING_SOORTEN.join(', ')}.`);
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  const r = p.ruimte !== undefined && p.ruimte !== null ? model.ruimtes.find((x) => x.id === p.ruimte) : null;
  if (p.ruimte != null && !r) return fout(`Ruimte "${p.ruimte}" niet gevonden.`);
  const niveau = p.niveau ?? r?.niveau;
  if (!heeftNiveau(model, niveau)) return fout(`Onbekend niveau "${niveau}".`);
  if (r && r.niveau !== niveau) return fout(`Ruimte ${r.id} ligt niet op niveau ${niveau}.`);
  const inst = metInstellingen(instellingen);
  const maat = inrichtingMaat(inst, soort);
  const breedte = p.breedte ?? maat.breedte, diepte = p.diepte ?? maat.diepte, hoogte = p.hoogte ?? maat.hoogte ?? null;
  if (!isGetal(breedte) || breedte <= 0 || !isGetal(diepte) || diepte <= 0) return fout('Breedte en diepte moeten > 0 mm zijn.');
  if (hoogte !== null && (!isGetal(hoogte) || hoogte <= 0)) return fout('Hoogte moet > 0 mm zijn.');
  let positie = p.positie, rotatie = p.rotatie ?? 0;
  if (!isGetal(rotatie)) return fout('Rotatie moet een hoek in graden zijn.');
  if (positie === undefined || positie === null) {
    if (!r) return fout('Geef een positie of een ruimte (dan wordt een plek tegen een wand gezocht).');
    const plek = zoekPlek(model, r, { breedte, diepte, hoogte, instellingen: inst });
    if (!plek) return fout(`Geen plek gevonden voor ${soort} (${breedte} × ${diepte} mm) tegen een wand van ${r.naam}${hoogte != null ? ` met vrije hoogte ≥ ${hoogte} mm` : ''}.`);
    ({ positie, rotatie } = plek);
  }
  if (!isPunt(positie)) return fout('Positie moet [x, y] in mm zijn.');
  const id = idMaker(model)('inrichting');
  const item = { id, niveau };
  if (r) item.ruimte = r.id;
  Object.assign(item, { soort, positie: rondP(positie), rotatie: rond01(((rotatie % 360) + 360) % 360), breedte, diepte });
  if (hoogte != null) item.hoogte = hoogte;
  item.status = status;
  return { ops: [{ op: 'toevoegen', collectie: 'inrichting', item }], info: { id, positie: item.positie, rotatie: item.rotatie, contour: inrichtingContour(item) } };
}

function zoekPlek(model, r, { breedte, diepte, hoogte, instellingen }) {
  let c = r.contour;
  let s = 0;
  for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; s += a[0] * b[1] - b[0] * a[1]; }
  if (s < 0) c = c.slice().reverse();
  const anderen = (model.inrichting || []).filter((x) => x.niveau === r.niveau && x.status !== 'afbraak' && isPunt(x.positie)).map(inrichtingContour);
  const STAP = 50;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const L = lengte(a, b);
    if (L < breedte) continue;
    const ex = (b[0] - a[0]) / L, ey = (b[1] - a[1]) / L;
    const nx = -ey, ny = ex; // naar binnen (tegenwijzerzin)
    const rotatie = (Math.atan2(ey, ex) * 180) / Math.PI;
    for (let t = 0; t + breedte <= L + 1e-6; t += STAP) {
      const m = [a[0] + ex * (t + breedte / 2) + nx * (diepte / 2), a[1] + ey * (t + breedte / 2) + ny * (diepte / 2)];
      const cont = inrichtingContour({ positie: m, rotatie, breedte, diepte });
      if (!cont.every((q) => inEenVan(q, [r.contour], 1))) continue;
      if (anderen.some((o) => polygonenOverlappen(o, cont, 1))) continue;
      if (hoogte != null && (minVrijeHoogte(model, r.niveau, cont, { instellingen }) ?? Infinity) < hoogte) continue;
      return { positie: rondP(m), rotatie: rond01(((rotatie % 360) + 360) % 360) };
    }
  }
  return null;
}

/**
 * Zolderniveau onder het (hellende) dak van `onderNiveau`: nieuw niveau `soort: 'zolder'` op de bovenkant van onderNiveau
 * (peil = peil + hoogte), hoogte = hoogste nokhoogte van de hellende daken op onderNiveau; per hellend dak een vloer met
 * de contour van het dak (= begrenzing onder het dak). De daken blijven op onderNiveau rusten (anders zouden ze stijgen).
 * Opties: { naam = 'Zolder', vloerdikte (standaard die van onderNiveau, anders 300 zoals opsNiveauToevoegen), status = 'nieuw' }.
 * info: { id, hoogte, vloeren: [ids], daken: [ids] }
 */
export function opsZolderNiveau(model, { onderNiveau, naam = 'Zolder', vloerdikte, status = 'nieuw' } = {}) {
  const onder = model.niveaus.find((n) => n.id === onderNiveau);
  if (!onder) return fout(`Onbekend niveau "${onderNiveau}".`);
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  const top = onder.peil + onder.hoogte;
  const erboven = model.niveaus.find((n) => n.id !== onder.id && n.peil >= top - 1);
  if (erboven) return fout(`Boven ${onder.id} ligt al niveau ${erboven.id} (${erboven.naam}).`);
  const daken = model.daken.filter((d) => d.niveau === onder.id && d.status !== 'afbraak' && d.type !== 'plat' && d.helling > 0);
  if (!daken.length) return fout(`Niveau ${onder.id} heeft geen hellend dak; een zolder onder een plat dak heeft geen hoogte.`);
  const dikte = vloerdikte ?? onder.vloerdikte ?? 300;
  if (!isGetal(dikte) || dikte <= 0) return fout('Vloerdikte moet > 0 mm zijn.');
  const hoogte = Math.round(Math.max(...daken.map(dakNokHoogte)));
  if (hoogte <= 0) return fout('Het dak heeft geen hoogte.');
  const nieuw = idMaker(model);
  const id = nieuw('niveaus');
  const nm = typeof naam === 'string' && naam.trim() ? naam.trim() : 'Zolder';
  const ops = [{ op: 'toevoegen', collectie: 'niveaus', item: { id, naam: nm, peil: top, hoogte, vloerdikte: dikte, soort: 'zolder' } }];
  const vloeren = [];
  for (const d of daken) {
    const vid = nieuw('vloeren');
    ops.push({ op: 'toevoegen', collectie: 'vloeren', item: { id: vid, niveau: id, contour: d.contour.map(rondP), dikte, status } });
    vloeren.push(vid);
  }
  return { ops, info: { id, hoogte, vloeren, daken: daken.map((d) => d.id) } };
}
