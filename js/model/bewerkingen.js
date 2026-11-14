// Bewerkingen op hoog niveau (fase 2). Pure functies, geen DOM.
// Elke functie geeft een OPERATIELIJST terug (niet toegepast): { ops, fout?, info? }.
// Bij `fout` is `ops` leeg. Toepassen gebeurt via applyOps / Geschiedenis.toepassen.
// Zie docs/FASE2.md (deel A) en docs/DATAMODEL.md ("Bewerkingen (hoog niveau)").

import { COLLECTIES, COLLECTIE_NAMEN, OPENING_TYPES, STATUSSEN, DAK_TYPES, NOKRICHTINGEN, FUNCTIES } from './schema.js';
import {
  lengte, muurLengte, muurRichting, muurHoogte, puntOpMuur, afstandTotSegment, begrenzing,
  polygoonOppervlakte, puntInPolygoon, muurAansluiting, muurDeelRechthoek,
} from './geometry.js';

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
function idMaker(model) {
  const bezet = new Set(COLLECTIE_NAMEN.flatMap((c) => (model[c] || []).map((x) => x.id)));
  return (collectie) => {
    const pre = COLLECTIES[collectie];
    let max = 0;
    for (const id of bezet) {
      const m = new RegExp(`^${pre}(\\d+)$`).exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    let n = max + 1;
    while (bezet.has(`${pre}${n}`)) n++;
    const id = `${pre}${n}`;
    bezet.add(id);
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
 */
export function buitenMuren(model, niveau) {
  const R = bouwRaster(model, niveau);
  if (!R) return [];
  const buiten = buitenGebied(R);
  const delta = R.schuin ? R.cel * 1.5 : 0.25;
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
        const c = celVan(R, [p[0] + r.nx * off, p[1] + r.ny * off]);
        if (c < 0 || buiten[c]) { gevonden = true; break; }
      }
    }
    if (gevonden) uit.push(m.id);
  }
  return uit;
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
