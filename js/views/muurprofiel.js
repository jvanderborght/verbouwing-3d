// Bovenkant van muren onder daken (3D). Pure functies, geen DOM, geen Three.js — getest in tests/views-fase5.test.js.
//
// Een muur is standaard een rechthoek (t = langs de as, z = hoogte boven het vloerpeil, 0..H). Ligt er een dak
// boven dat lager komt dan H (typisch op een zolder), dan volgt de bovenkant de onderkant van dat dak:
//   bovenkant(x, y) = min(H, rustvlak + dakHoogteIn(dak, x, y) − peil)  over alle daken boven het niveau.
// Dat gebeurt per zijvlak van de muur (links/rechts van de as), zodat een muur evenwijdig aan de nok een schuine
// bovenkant krijgt en een muur dwars op de nok een geknikte. Muren met eigen `hoogte` (knieschotten) blijven H hoog
// zolang het dak hoger ligt.
//
// Welke daken tellen: status ≠ afbraak (een afbraakmuur wordt ook door afbraakdaken begrensd); rustvlak boven het
// vloerpeil, of óp het vloerpeil als het dak hellend is (zolder in het dak van het niveau eronder). Een plat dak op
// of onder het vloerpeil (bv. van een aanbouw naast een verdieping) telt niet. Het punt moet binnen de rechthoekige
// begrenzing van het dak (+ overstek) liggen.

import { begrenzing, dakHoogteIn, niveauBovenkant, muurRichting, muurHoogte } from '../model/geometry.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Daken die muren op een niveau kunnen afknippen.
 * @returns {Array<{ dak, rust:number, b:{minX,minY,maxX,maxY} }>}
 */
export function begrenzendeDaken(model, niveauId, { metAfbraak = false } = {}) {
  const n = (model?.niveaus || []).find((x) => x.id === niveauId);
  if (!n) return [];
  const uit = [];
  for (const d of model.daken || []) {
    if (!Array.isArray(d.contour) || d.contour.length < 3) continue;
    if (d.status === 'afbraak' && !metAfbraak) continue;
    const rust = niveauBovenkant(model, d.niveau);
    const hellend = d.type !== 'plat' && isGetal(d.helling) && d.helling > 0;
    // rust het dak op het vloerpeil (typisch: zolder in het dak van het niveau eronder), dan telt enkel een hellend dak
    if (rust < n.peil - 1 || (rust <= n.peil + 1 && !hellend)) continue;
    const b = begrenzing(d.contour);
    const o = (isGetal(d.overstek) ? d.overstek : 0) + 1;
    uit.push({ dak: d, rust, b: { minX: b.minX - o, minY: b.minY - o, maxX: b.maxX + o, maxY: b.maxY + o } });
  }
  return uit;
}

/**
 * Evaluator (x, y) → bovenkant (mm boven het vloerpeil van het niveau) voor een muur met hoogte H.
 * Zonder dak erboven: H.
 */
export function bovenkantFunctie(model, niveauId, H, opties = {}) {
  const n = (model?.niveaus || []).find((x) => x.id === niveauId);
  const daken = begrenzendeDaken(model, niveauId, opties);
  const peil = n ? n.peil : 0;
  return (x, y) => {
    let z = H;
    for (const { dak, rust, b } of daken) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      z = Math.min(z, rust + dakHoogteIn(dak, x, y) - peil);
    }
    return Math.max(0, z);
  };
}

/** Lineaire interpolatie in een profiel [[t, z], …] (gesorteerd op t); buiten het bereik: eindwaarde. */
export function profielWaarde(profiel, t) {
  if (!profiel.length) return 0;
  if (t <= profiel[0][0]) return profiel[0][1];
  for (let i = 0; i < profiel.length - 1; i++) {
    const [ta, za] = profiel[i], [tb, zb] = profiel[i + 1];
    if (t <= tb) return tb - ta < 1e-9 ? zb : za + ((zb - za) * (t - ta)) / (tb - ta);
  }
  return profiel[profiel.length - 1][1];
}

/**
 * Stuksgewijs lineair profiel van g(t) op [t0, t1]: uniform vertrek (≤ `stap`), daarna halveren waar het midden
 * meer dan `tol` mm van de koorde ligt (knikken van daken, nok, overgang naar H), en collineaire punten weg.
 * @param {(t:number) => number} g
 * @returns {number[][]} [[t, z], …]
 */
export function profielVan(g, t0, t1, { stap = 250, tol = 0.5, minStap = 1 } = {}) {
  if (!(t1 > t0)) return [[t0, g(t0)], [t0, g(t0)]];
  const n = Math.max(1, Math.ceil((t1 - t0) / stap));
  const pts = [];
  const verfijn = (ta, za, tb, zb, diepte) => {
    const tm = (ta + tb) / 2, zm = g(tm);
    if (diepte < 14 && tb - ta > minStap && Math.abs(zm - (za + zb) / 2) > tol) {
      verfijn(ta, za, tm, zm, diepte + 1);
      pts.push([tm, zm]);
      verfijn(tm, zm, tb, zb, diepte + 1);
    } else if (diepte < 3) {
      // ook bij een (toevallig) lineair midden nog wat dieper kijken: een knik tussen twee monsters kan zich verbergen
      const tq = (ta + tm) / 2, tr = (tm + tb) / 2;
      const zq = g(tq), zr = g(tr);
      if (Math.abs(zq - (za + zm) / 2) > tol || Math.abs(zr - (zm + zb) / 2) > tol) {
        verfijn(ta, za, tm, zm, diepte + 1);
        pts.push([tm, zm]);
        verfijn(tm, zm, tb, zb, diepte + 1);
      }
    }
  };
  let ta = t0, za = g(t0);
  pts.push([ta, za]);
  for (let i = 1; i <= n; i++) {
    const tb = i === n ? t1 : t0 + ((t1 - t0) * i) / n, zb = g(tb);
    verfijn(ta, za, tb, zb, 0);
    pts.push([tb, zb]);
    ta = tb; za = zb;
  }
  return vereenvoudigProfiel(pts, tol / 2);
}

/** Verwijdert punten die (binnen tol mm) op de rechte tussen hun buren liggen. */
export function vereenvoudigProfiel(pts, tol = 0.25) {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]]);
  const uit = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = uit[uit.length - 1], b = pts[i], c = pts[i + 1];
    if (c[0] - a[0] < 1e-9) continue;
    const z = a[1] + ((c[1] - a[1]) * (b[0] - a[0])) / (c[0] - a[0]);
    if (Math.abs(z - b[1]) > tol) uit.push(b);
  }
  uit.push(pts[pts.length - 1]);
  return uit.map((p) => [p[0], p[1]]);
}

/**
 * Profielen van de bovenkant van een muur langs beide zijvlakken (links = +normaal, rechts = −normaal).
 * @returns {{ H:number, links:number[][], rechts:number[][], vrij:boolean }}  vrij = nergens lager dan H (gewone rechthoek)
 */
export function muurProfielen(model, muur, t0, t1, opties = {}) {
  const H = muurHoogte(model, muur);
  const f = bovenkantFunctie(model, muur.niveau, H, { metAfbraak: muur.status === 'afbraak', ...opties });
  const { ux, uy, nx, ny } = muurRichting(muur);
  const [sx, sy] = muur.start;
  const zijde = (s) => profielVan((t) => f(sx + ux * t + nx * s, sy + uy * t + ny * s), t0, t1);
  const links = zijde(muur.dikte / 2), rechts = zijde(-muur.dikte / 2);
  const vrij = [...links, ...rechts].every((p) => p[1] >= H - 0.5);
  return { H, links, rechts, vrij };
}

/** t-waarden waar het profiel het niveau c kruist (strikt binnen een segment). */
function kruisingen(profiel, c) {
  const uit = [];
  for (let i = 0; i < profiel.length - 1; i++) {
    const [ta, za] = profiel[i], [tb, zb] = profiel[i + 1];
    if ((za - c) * (zb - c) < 0) uit.push(ta + ((c - za) * (tb - ta)) / (zb - za));
  }
  return uit;
}

/**
 * Een rechthoekig muurstuk { t0, t1, z0, z1 } (z boven vloerpeil, zoals uit muurSegmenten) afknippen met de
 * profielen van beide zijvlakken. Bovenkant = min(z1, profiel), nooit onder z0.
 * @returns {null | { ts:number[], z0:number, links:number[], rechts:number[] }} null als er (bijna) niets overblijft.
 */
export function knipStuk(stuk, links, rechts) {
  const { t0, t1, z0, z1 } = stuk;
  if (!(t1 - t0 > 0.5)) return null;
  const ts = new Set([t0, t1]);
  for (const prof of [links, rechts]) {
    for (const [t] of prof) if (t > t0 + 0.01 && t < t1 - 0.01) ts.add(t);
    for (const c of [z0, z1]) for (const t of kruisingen(prof, c)) if (t > t0 + 0.01 && t < t1 - 0.01) ts.add(t);
  }
  const lijst = [...ts].sort((a, b) => a - b);
  const top = (prof, t) => Math.min(z1, Math.max(z0, profielWaarde(prof, t)));
  const L = lijst.map((t) => top(links, t)), R = lijst.map((t) => top(rechts, t));
  if (Math.max(...L, ...R) - z0 < 1) return null;
  return { ts: lijst, z0, links: L, rechts: R };
}

/**
 * Zijvlakken van een afgeknipt muurstuk als vierhoeken in lokale coördinaten [t, s, z]
 * (s = afstand loodrecht op de as, links = +dikte/2). Gesloten oppervlak: zijvlakken, bovenkant, onderkant, kopse kanten.
 * Ontaarde vierhoeken (hoogte 0) worden weggelaten.
 * @returns {number[][][]} lijst van [p0, p1, p2, p3] in tegenwijzerzin gezien van buitenaf
 */
export function stukVlakken(geknipt, dikte) {
  const { ts, z0, links, rechts } = geknipt;
  const h = dikte / 2;
  const uit = [];
  const voeg = (q) => {
    // weglaten als (bijna) zonder oppervlakte
    const d1 = q[2].map((v, i) => v - q[0][i]), d2 = q[3].map((v, i) => v - q[1][i]);
    const k = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
    if (Math.hypot(...k) > 1e-6) uit.push(q);
  };
  for (let i = 0; i < ts.length - 1; i++) {
    const a = ts[i], b = ts[i + 1];
    voeg([[a, h, z0], [a, h, links[i]], [b, h, links[i + 1]], [b, h, z0]]); // links (+s)
    voeg([[a, -h, z0], [b, -h, z0], [b, -h, rechts[i + 1]], [a, -h, rechts[i]]]); // rechts (−s)
    voeg([[a, -h, rechts[i]], [b, -h, rechts[i + 1]], [b, h, links[i + 1]], [a, h, links[i]]]); // bovenkant
    voeg([[a, -h, z0], [a, h, z0], [b, h, z0], [b, -h, z0]]); // onderkant
  }
  const n = ts.length - 1;
  voeg([[ts[0], -h, z0], [ts[0], -h, rechts[0]], [ts[0], h, links[0]], [ts[0], h, z0]]);
  voeg([[ts[n], -h, z0], [ts[n], h, z0], [ts[n], h, links[n]], [ts[n], -h, rechts[n]]]);
  return uit;
}

/** Oppervlakte (mm²) van één zijvlak van een afgeknipt stuk (trapeziumregel) — voor tests en kerncontroles. */
export function stukZijOppervlakte(geknipt, zijde = 'links') {
  const z = geknipt[zijde];
  let A = 0;
  for (let i = 0; i < geknipt.ts.length - 1; i++)
    A += ((geknipt.ts[i + 1] - geknipt.ts[i]) * (z[i] - geknipt.z0 + z[i + 1] - geknipt.z0)) / 2;
  return A;
}
