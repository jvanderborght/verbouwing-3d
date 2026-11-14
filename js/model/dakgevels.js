// Gevelvullingen onder een dak die echt zichtbaar moeten zijn (3D). Pure functies, geen DOM, geen Three.js —
// getest in tests/dak-basis.test.js.
//
// dakGevels() (geometry.js) geeft per hellend dak de vullingen tussen rustvlak en dak: kopse kanten, de rand onder de
// hoge zijde van een lessenaar en (met basisHoogte) de rand onder de lage zijde. Wanneer daken aan elkaar sluiten
// (bv. twee lessenaars tegen elkaar aan de nok) of wanneer een getekende muur die gevel al vormt (bv. een verhoogde
// achtergevel of topgevel op de zolder), zou die vulling dubbel of midden in het volume staan. Regel:
//
//  Een gevelvlak vervalt als
//   (a) een ANDER hellend dak met hetzelfde rustvlak (± 1 mm) aan de overkant van die rand ligt (zijn begrenzing heeft
//       een rand op dezelfde lijn en overlapt minstens de helft van de gevellengte), en dat dak telt: status ≠ afbraak,
//       of beide daken zijn afbraak; of
//   (b) muren (status ≠ afbraak) op een niveau met vloerpeil = rustvlak (± 1 mm), evenwijdig aan de gevel en met hun
//       as binnen dikte/2 + 20 mm van het gevelvlak, samen minstens 90 % van de gevellengte bedekken.

import { begrenzing, dakGevels, niveauBovenkant } from './geometry.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const hellend = (d) => d && d.type !== 'plat' && isGetal(d.helling) && d.helling > 0;

/** Lijn van een gevelvlak: { as: 'x'|'y' (constante coördinaat), c, a, b } (a..b = bereik langs de lijn). */
function gevelLijn(g) {
  const xs = g.punten.map((p) => p[0]), ys = g.punten.map((p) => p[1]);
  if (Math.max(...xs) - Math.min(...xs) < 1e-6) return { as: 'x', c: xs[0], a: Math.min(...ys), b: Math.max(...ys) };
  return { as: 'y', c: ys[0], a: Math.min(...xs), b: Math.max(...xs) };
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Lengte van de unie van intervallen [a, b] binnen [lo, hi]. */
function bedekt(intervallen, lo, hi) {
  const iv = intervallen.map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let som = 0, eind = -Infinity;
  for (const [a, b] of iv) {
    if (b <= eind) continue;
    som += b - Math.max(a, eind);
    eind = b;
  }
  return som;
}

/** Sluit een ander dak aan op deze rand (regel a)? */
function dakSluitAan(model, dak, rust, L, binnen) {
  for (const d of model.daken || []) {
    if (d.id === dak.id || !hellend(d) || !Array.isArray(d.contour) || d.contour.length < 3) continue;
    if (Math.abs(niveauBovenkant(model, d.niveau) - rust) > 1) continue;
    if (!(d.status !== 'afbraak' || dak.status === 'afbraak')) continue;
    const b = begrenzing(d.contour);
    // het andere dak moet aan de buitenkant van deze rand liggen (tegen `binnen` in)
    const kant = L.as === 'x' ? -binnen[0] : -binnen[1];
    const rand = L.as === 'x' ? (kant > 0 ? b.minX : b.maxX) : (kant > 0 ? b.minY : b.maxY);
    if (Math.abs(rand - L.c) > 1) continue;
    const [p0, p1] = L.as === 'x' ? [b.minY, b.maxY] : [b.minX, b.maxX];
    if (overlap(L.a, L.b, p0, p1) >= 0.5 * (L.b - L.a)) return true;
  }
  return false;
}

/** Vormen muren op het niveau onder het dak deze gevel al (regel b)? */
function murenVormenGevel(model, rust, L) {
  const niveaus = new Set((model.niveaus || []).filter((n) => isGetal(n.peil) && Math.abs(n.peil - rust) <= 1).map((n) => n.id));
  if (!niveaus.size) return false;
  const iv = [];
  for (const m of model.muren || []) {
    if (!niveaus.has(m.niveau) || m.status === 'afbraak' || !isGetal(m.dikte)) continue;
    const [sx, sy] = m.start, [ex, ey] = m.eind;
    const evenwijdig = L.as === 'x' ? Math.abs(sx - ex) < 1 : Math.abs(sy - ey) < 1;
    if (!evenwijdig) continue;
    const as = L.as === 'x' ? (sx + ex) / 2 : (sy + ey) / 2;
    if (Math.abs(as - L.c) > m.dikte / 2 + 20) continue;
    const [a, b] = L.as === 'x' ? [Math.min(sy, ey), Math.max(sy, ey)] : [Math.min(sx, ex), Math.max(sx, ex)];
    iv.push([a - m.dikte / 2, b + m.dikte / 2]);
  }
  return iv.length > 0 && bedekt(iv, L.a, L.b) >= 0.9 * (L.b - L.a);
}

/**
 * dakGevels(dak, dv) zonder de vlakken waar een ander dak aansluit of waar muren de gevel al vormen.
 * @returns {{ punten: number[][], binnen: number[] }[]}
 */
export function zichtbareDakGevels(model, dak, dv = 0) {
  const rust = niveauBovenkant(model, dak.niveau);
  return dakGevels(dak, dv).filter((g) => {
    const L = gevelLijn(g);
    if (!(L.b - L.a > 1)) return true;
    return !dakSluitAan(model, dak, rust, L, g.binnen) && !murenVormenGevel(model, rust, L);
  });
}
