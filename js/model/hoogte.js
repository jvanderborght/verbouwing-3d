// Vrije hoogte onder daken en plafonds, hoogtelijnen en oppervlakte per hoogteband (schemaVersie 2).
// Pure functies, geen DOM. Zie docs/DATAMODEL.md "Vrije hoogte".
//
// Vrije hoogte in punt p op niveau N = (laagste "bovengrens" boven het vloerpeil van N) − N.peil, met als bovengrens:
//  - de onderkant van de vloer van elk HOGER niveau (peil > N.peil) dat in p een vloer heeft (status ≠ afbraak),
//    behalve in het trapgat van een trap naar dat niveau. Heeft dat hogere niveau géén vloeren, dan geldt het
//    als volledig (onderkant = peil − vloerdikte).
//  - de onderkant van elk dak (status ≠ afbraak) dat rust op een niveau met bovenkant ≥ N.peil en waarvan de
//    rechthoekige begrenzing p bevat: rustvlak + dakHoogteIn(dak, p). De dakdikte ligt BOVEN die lijn (zoals in
//    de 3D-weergave: onderkant dak = rustvlak aan de contourrand), dus ze vermindert de vrije hoogte niet.
//  - is er niets boven p, dan is de vrije hoogte de verdiepingshoogte van N.
// Resultaat ≥ 0 (mm).

import { begrenzing, dakHoogteIn, polygoonOppervlakte, puntInPolygoon, polygoonOffset, niveauBovenkant, lengte } from './geometry.js';
import { INSTELLINGEN_STANDAARD, instelling } from './instellingen.js';
import { trapGeometrie } from './trappen.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const telt = (x) => x.status !== 'afbraak';
const MAX_CELLEN = 250_000;

/** Vloercontouren (status ≠ afbraak) van een niveau = begrenzing van dat niveau. Lege lijst als er geen vloeren zijn. */
export function niveauBegrenzing(model, niveauId) {
  return (model.vloeren || []).filter((v) => v.niveau === niveauId && telt(v) && Array.isArray(v.contour) && v.contour.length >= 3).map((v) => v.contour);
}

/** Ligt p in een van de polygonen (met tolerantie `tol` mm naar buiten)? */
export function inEenVan(p, polygonen, tol = 1) {
  return polygonen.some((c) => puntInPolygoon(p, tol ? polygoonOffset(c, tol) : c));
}

/**
 * Snelle evaluator van de bovengrens (absolute z) boven punten, vanaf peil `peilRef`. Bouwt de lijsten één keer op.
 * @returns {(p:number[]) => number|null}
 */
export function bovengrensFunctie(model, peilRef, opties = {}) {
  const niveaus = model.niveaus || [];
  const plafonds = [];
  for (const n of niveaus) {
    if (!isGetal(n.peil) || n.peil <= peilRef + 0.5) continue;
    const vloeren = (model.vloeren || []).filter((v) => v.niveau === n.id && telt(v) && Array.isArray(v.contour) && v.contour.length >= 3);
    const gaten = (model.trappen || []).filter((t) => t.naarNiveau === n.id && telt(t))
      .map((t) => trapGeometrie(model, t, opties)?.voetafdruk).filter(Boolean);
    plafonds.push({
      onder: n.peil - (n.vloerdikte ?? 0),
      vloeren: vloeren.map((v) => ({ contour: v.contour, b: begrenzing(v.contour), onder: n.peil - (isGetal(v.dikte) ? v.dikte : (n.vloerdikte ?? 0)) })),
      gaten: gaten.map((g) => ({ contour: g, b: begrenzing(g) })),
    });
  }
  const daken = (model.daken || []).filter((d) => telt(d) && Array.isArray(d.contour) && d.contour.length >= 3)
    .map((d) => ({ d, rust: niveauBovenkant(model, d.niveau), b: begrenzing(d.contour) }))
    .filter((x) => x.rust >= peilRef - 0.5);
  const inB = (b, [x, y]) => x >= b.minX - 1e-6 && x <= b.maxX + 1e-6 && y >= b.minY - 1e-6 && y <= b.maxY + 1e-6;
  const inPoly = (o, p) => inB(o.b, p) && puntInPolygoon(p, o.contour);
  return (p) => {
    let z = Infinity;
    for (const pl of plafonds) {
      if (pl.gaten.some((g) => inPoly(g, p))) continue;
      if (!pl.vloeren.length) { z = Math.min(z, pl.onder); continue; }
      for (const v of pl.vloeren) if (inPoly(v, p)) z = Math.min(z, v.onder);
    }
    for (const x of daken) if (inB(x.b, p)) z = Math.min(z, x.rust + dakHoogteIn(x.d, p[0], p[1]));
    return z === Infinity ? null : z;
  };
}

/** Evaluator van de vrije hoogte (mm, ≥ 0) op een niveau. */
export function vrijeHoogteFunctie(model, niveauId, opties = {}) {
  const n = (model.niveaus || []).find((x) => x.id === niveauId);
  if (!n) return () => null;
  const bg = bovengrensFunctie(model, n.peil, opties);
  return (p) => {
    const z = bg(p);
    return Math.max(0, z == null ? n.hoogte : z - n.peil);
  };
}

/** Vrije hoogte (mm) op niveau `niveauId` in punt [x, y]; null bij onbekend niveau. */
export function vrijeHoogte(model, niveauId, punt, opties = {}) {
  return vrijeHoogteFunctie(model, niveauId, opties)(punt);
}

/**
 * Loophoogte van een trap: per trede de vrije hoogte boven het midden van de trede (vanaf de bovenkant van de trede).
 * @returns {{ min:number|null, perTrede:Array<{nummer, hoogte}> } | null}
 */
export function trapLoophoogte(model, trap, opties = {}) {
  const g = trapGeometrie(model, trap, opties);
  const van = (model.niveaus || []).find((n) => n.id === trap.vanNiveau);
  if (!g || g.fout || !van) return null;
  const bg = bovengrensFunctie(model, van.peil, opties);
  const perTrede = g.treden.map((t) => {
    const c = zwaartepunt(t.contour);
    const z = bg(c);
    return { nummer: t.nummer, hoogte: z == null ? null : z - (van.peil + t.z) };
  });
  const bekend = perTrede.filter((t) => t.hoogte != null).map((t) => t.hoogte);
  return { min: bekend.length ? Math.min(...bekend) : null, perTrede };
}

function zwaartepunt(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return pts[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Minimale vrije hoogte over een polygoon (hoekpunten, middens van de randen en zwaartepunt). */
export function minVrijeHoogte(model, niveauId, contour, opties = {}) {
  const f = vrijeHoogteFunctie(model, niveauId, opties);
  const pts = [...contour, zwaartepunt(contour)];
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i], q = contour[(i + 1) % contour.length];
    pts.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  }
  // iets naar binnen, zodat een punt op de rand niet net buiten een dakbegrenzing valt
  const z = zwaartepunt(contour);
  const binnen = pts.map(([x, y]) => [x + (z[0] - x) * 1e-4, y + (z[1] - y) * 1e-4]);
  const w = binnen.map(f).filter((v) => v != null);
  return w.length ? Math.min(...w) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raster
// ─────────────────────────────────────────────────────────────────────────────

/** Raster dat de begrenzing b exact betegelt, met stap ≈ `stap` (groter als er te veel cellen zouden zijn). */
function maakRaster(b, stap) {
  let s = Math.max(1, stap);
  while ((b.breedte / s) * (b.diepte / s) > MAX_CELLEN) s *= 1.5;
  const nx = Math.max(1, Math.ceil(b.breedte / s - 1e-9)), ny = Math.max(1, Math.ceil(b.diepte / s - 1e-9));
  const dx = b.breedte / nx, dy = b.diepte / ny;
  const xs = Array.from({ length: nx + 1 }, (_, i) => b.minX + i * dx);
  const ys = Array.from({ length: ny + 1 }, (_, j) => b.minY + j * dy);
  return { nx, ny, dx, dy, xs, ys };
}

/** Alle lussen rond de cellen met `in[c] = 1` (buitenranden tegenwijzerzin, gaten wijzerzin). */
function traceerLussen(R, gebied) {
  const { nx, ny, xs, ys } = R;
  const W = nx + 1;
  const uit = new Map();
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
  const lussen = [];
  for (const startV of [...uit.keys()]) {
    while (uit.get(startV)?.length) {
      const lus = [startV];
      let vorig = startV, huidig = uit.get(startV).pop(), veilig = 0;
      while (huidig !== startV && veilig++ < 1e7) {
        lus.push(huidig);
        const opties = uit.get(huidig);
        if (!opties || !opties.length) break;
        let k = 0;
        if (opties.length > 1) {
          const p = xy(vorig), q = xy(huidig);
          const dx = Math.sign(q[0] - p[0]), dy = Math.sign(q[1] - p[1]);
          k = opties.findIndex((o) => { const r = xy(o); const ex = Math.sign(r[0] - q[0]), ey = Math.sign(r[1] - q[1]); return dx * ey - dy * ex < 0; });
          if (k < 0) k = 0;
        }
        vorig = huidig; huidig = opties.splice(k, 1)[0];
      }
      lussen.push(vereenvoudigLus(lus.map(xy)));
    }
  }
  return lussen.filter((l) => l.length >= 3);
}

function vereenvoudigLus(pts) {
  let p = pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
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

/** Marching squares: segmenten waar f = 0, enkel in cellen waarvan alle hoeken geldig zijn. Gekoppeld tot polylijnen. */
function isolijnen(R, f, geldig) {
  const { nx, ny, xs, ys } = R;
  const W = nx + 1;
  const segs = [];
  const interp = (p, q, fp, fq) => { const t = fp / (fp - fq); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ids = [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i];
    if (!ids.every((k) => geldig[k])) continue;
    const P = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]];
    const F = ids.map((k) => (f[k] === 0 ? 1e-9 : f[k]));
    const kruisingen = [];
    for (let e = 0; e < 4; e++) {
      const a = e, b = (e + 1) % 4;
      if ((F[a] > 0) !== (F[b] > 0)) kruisingen.push(interp(P[a], P[b], F[a], F[b]));
    }
    if (kruisingen.length === 2) segs.push([kruisingen[0], kruisingen[1]]);
    else if (kruisingen.length === 4) { segs.push([kruisingen[0], kruisingen[1]]); segs.push([kruisingen[2], kruisingen[3]]); }
  }
  // koppelen
  const sleutel = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const bij = new Map();
  segs.forEach((s, k) => { for (const p of s) { const key = sleutel(p); if (!bij.has(key)) bij.set(key, []); bij.get(key).push(k); } });
  const gebruikt = new Uint8Array(segs.length);
  const lijnen = [];
  for (let k = 0; k < segs.length; k++) {
    if (gebruikt[k]) continue;
    gebruikt[k] = 1;
    const lijn = [segs[k][0], segs[k][1]];
    for (const kant of [1, 0]) {
      for (;;) {
        const eind = kant ? lijn[lijn.length - 1] : lijn[0];
        const volgende = (bij.get(sleutel(eind)) || []).find((m) => !gebruikt[m]);
        if (volgende == null) break;
        gebruikt[volgende] = 1;
        const s = segs[volgende];
        const ander = sleutel(s[0]) === sleutel(eind) ? s[1] : s[0];
        if (kant) lijn.push(ander); else lijn.unshift(ander);
      }
    }
    lijnen.push(vereenvoudigLijn(lijn.map(([x, y]) => [Math.round(x), Math.round(y)]), 1));
  }
  return lijnen.filter((l) => l.length >= 2);
}

/** Douglas-Peucker op een open polylijn. */
function vereenvoudigLijn(pts, tol) {
  if (pts.length <= 2) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const L = lengte(a, b);
  let maxD = -1, k = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = L < 1e-9 ? lengte(p, a) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (d > maxD) { maxD = d; k = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...vereenvoudigLijn(pts.slice(0, k + 1), tol).slice(0, -1), ...vereenvoudigLijn(pts.slice(k), tol)];
}

/**
 * Hoogtelijnen op een niveau: per gevraagde hoogte h de lijnen waar de vrije hoogte = h en de gebieden waar ze ≥ h is,
 * binnen de begrenzing van het niveau (vloeren; zonder vloeren: daken boven het niveau).
 * Rastergebaseerd (stap: instelling hoogte.rasterStap); lijnen via marching squares (exact voor vlakke dakvlakken),
 * gebieden als celcontour (trapjes van één rasterstap bij schuine grenzen).
 * @returns {Array<{ hoogte:number, lijnen:number[][][], gebieden:number[][][] }>}
 */
export function hoogtelijnen(model, niveauId, hoogtes, opties = {}) {
  const inst = opties.instellingen || INSTELLINGEN_STANDAARD;
  const lijst = (Array.isArray(hoogtes) ? hoogtes : instelling(inst, 'hoogte.hoogtelijnen') || []).filter(isGetal);
  const n = (model.niveaus || []).find((x) => x.id === niveauId);
  if (!n || !lijst.length) return [];
  let domein = niveauBegrenzing(model, niveauId);
  if (!domein.length) domein = (model.daken || []).filter((d) => telt(d) && niveauBovenkant(model, d.niveau) >= n.peil - 0.5).map((d) => d.contour);
  if (!domein.length) return lijst.map((h) => ({ hoogte: h, lijnen: [], gebieden: [] }));
  const b = begrenzing(domein.flat());
  const R = maakRaster(b, opties.stap ?? instelling(inst, 'hoogte.rasterStap') ?? 25);
  const f = vrijeHoogteFunctie(model, niveauId, opties);
  const W = R.nx + 1;
  // hoekpunten: iets naar binnen getrokken zodat punten op de rand binnen tellen
  const hoek = new Float64Array(W * (R.ny + 1));
  const geldig = new Uint8Array(W * (R.ny + 1));
  const inDomein = (p) => domein.some((c) => puntInPolygoon(p, c));
  for (let j = 0; j <= R.ny; j++) for (let i = 0; i <= R.nx; i++) {
    const p = [Math.min(b.maxX - 0.01, Math.max(b.minX + 0.01, R.xs[i])), Math.min(b.maxY - 0.01, Math.max(b.minY + 0.01, R.ys[j]))];
    if (!inDomein(p)) continue;
    geldig[j * W + i] = 1;
    hoek[j * W + i] = f(p);
  }
  const cel = new Float64Array(R.nx * R.ny);
  const celIn = new Uint8Array(R.nx * R.ny);
  for (let j = 0; j < R.ny; j++) for (let i = 0; i < R.nx; i++) {
    const p = [(R.xs[i] + R.xs[i + 1]) / 2, (R.ys[j] + R.ys[j + 1]) / 2];
    if (!inDomein(p)) continue;
    celIn[j * R.nx + i] = 1;
    cel[j * R.nx + i] = f(p);
  }
  return lijst.map((h) => {
    const veld = Float64Array.from(hoek, (v) => v - h);
    const gebied = new Uint8Array(R.nx * R.ny);
    for (let c = 0; c < gebied.length; c++) if (celIn[c] && cel[c] >= h) gebied[c] = 1;
    return { hoogte: h, lijnen: isolijnen(R, veld, geldig), gebieden: traceerLussen(R, gebied) };
  });
}

/**
 * Oppervlakte van een ruimte per hoogteband.
 * @param ruimte ruimte-object of -id
 * @param grenzen hoogtes in mm (standaard ruimte.hoogtegrenzen); banden [0, g1), [g1, g2), …, [gk, ∞)
 * @returns {{ ruimte, niveau, grenzen:number[], banden:Array<{van:number, tot:number|null, m2:number}>, m2:number } | null}
 *   Rastergebaseerd (cellen exact binnen de begrenzing van de ruimte); de banden worden geschaald zodat hun som
 *   gelijk is aan de exacte netto-oppervlakte van de contour.
 */
export function oppervlaktePerHoogteband(model, ruimte, grenzen, opties = {}) {
  const r = typeof ruimte === 'string' ? (model.ruimtes || []).find((x) => x.id === ruimte) : ruimte;
  if (!r || !Array.isArray(r.contour) || r.contour.length < 3) return null;
  const g = [...new Set((Array.isArray(grenzen) ? grenzen : (r.hoogtegrenzen || [])).filter((v) => isGetal(v) && v > 0))].sort((a, b) => a - b);
  const banden = [];
  let vorige = 0;
  for (const x of g) { banden.push({ van: vorige, tot: x, m2: 0 }); vorige = x; }
  banden.push({ van: vorige, tot: null, m2: 0 });
  const exact = polygoonOppervlakte(r.contour) / 1e6;
  const b = begrenzing(r.contour);
  const inst = opties.instellingen || INSTELLINGEN_STANDAARD;
  const R = maakRaster(b, opties.stap ?? instelling(inst, 'hoogte.rasterStap') ?? 25);
  const f = vrijeHoogteFunctie(model, r.niveau, opties);
  let totaal = 0;
  const celM2 = (R.dx * R.dy) / 1e6;
  for (let j = 0; j < R.ny; j++) for (let i = 0; i < R.nx; i++) {
    const p = [(R.xs[i] + R.xs[i + 1]) / 2, (R.ys[j] + R.ys[j + 1]) / 2];
    if (!puntInPolygoon(p, r.contour)) continue;
    const h = f(p);
    let k = banden.length - 1;
    for (let m = 0; m < g.length; m++) if (h < g[m]) { k = m; break; }
    banden[k].m2 += celM2;
    totaal += celM2;
  }
  if (totaal > 0) for (const x of banden) x.m2 *= exact / totaal;
  return { ruimte: r.id, niveau: r.niveau, grenzen: g, banden, m2: exact };
}
