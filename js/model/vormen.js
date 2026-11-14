// Kleine vormhulpjes voor schemaVersie 2 (inrichting, overlap). Pure functies.

import { puntInPolygoon, afstandTotSegment } from './geometry.js';

/**
 * Contour (4 hoekpunten, tegenwijzerzin) van een inrichtingselement: `positie` = middelpunt, `breedte` langs de
 * lokale x-as, `diepte` langs de lokale y-as, `rotatie` in graden (0 ⇒ breedte langs +x, rugzijde aan −y).
 */
export function inrichtingContour({ positie, rotatie = 0, breedte, diepte }) {
  const a = ((rotatie || 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const [px, py] = positie;
  const r = (v) => { const x = Math.round(v * 10) / 10; return x === 0 ? 0 : x; };
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const u = (i * breedte) / 2, v = (j * diepte) / 2;
    return [r(px + u * c - v * s), r(py + u * s + v * c)];
  });
}

function afstandTotRand(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, afstandTotSegment(p, poly[i], poly[(i + 1) % poly.length]).afstand);
  return d;
}

const strikt = (p, poly, tol) => puntInPolygoon(p, poly) && afstandTotRand(p, poly) > tol;

function snijdenStrikt(a, b, c, d, tol) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const k = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(k) < 1e-9) return false;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / k;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / k;
  const La = Math.hypot(...r), Lc = Math.hypot(...s);
  return t * La > tol && (1 - t) * La > tol && u * Lc > tol && (1 - u) * Lc > tol;
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

/**
 * Overlappen de binnengebieden van twee (enkelvoudige) polygonen meer dan `tol` mm?
 * Raken (gemeenschappelijke rand of hoekpunt) telt niet als overlap.
 */
export function polygonenOverlappen(a, b, tol = 1) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++)
    if (snijdenStrikt(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length], tol)) return true;
  const proeven = (P) => {
    const pts = [...P, zwaartepunt(P)];
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; pts.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); }
    return pts;
  };
  if (proeven(a).some((p) => strikt(p, b, tol))) return true;
  if (proeven(b).some((p) => strikt(p, a, tol))) return true;
  return false;
}
