// Snappen van aanwijzerpunten in de plattegrond (fase 2). Puur: geen DOM, getest in tests/snap.test.js.
// Zie docs/FASE2.md (deel B).
//
// Prioriteit: eindpunt > midden van muur > op muuras > uitlijning (x/y van bestaande eindpunten)
//             > ortho t.o.v. `vanaf` > raster > geen.

import { lengte, muurLengte, muurRichting, afstandTotSegment, puntOpMuur } from '../model/geometry.js';

const ORTHO_HOEK = 7; // graden
const nul = (v) => (v === 0 ? 0 : v); // geen -0
const rondR = (v, r) => (r > 0 ? nul(Math.round(v / r) * r) : v);

/**
 * @param {number[]} punt [x, y] in mm
 * @param {{ model: object, niveau: string, raster?: number, tolerantie?: number, vanaf?: number[]|null,
 *           ortho?: boolean, negeer?: string[] }} opties
 * @returns {{ punt: number[], soort: 'eindpunt'|'midden'|'muur'|'uitlijning'|'ortho'|'raster'|'geen',
 *             doel?: string, hulplijnen?: {van:number[], naar:number[]}[] }}
 */
export function snap(punt, { model, niveau, raster = 50, tolerantie = 200, vanaf = null, ortho = true, negeer = [] } = {}) {
  const p = [punt[0], punt[1]];
  const weg = new Set(negeer);
  const muren = (model?.muren || []).filter((m) => m.niveau === niveau && !weg.has(m.id) && muurLengte(m) > 0);

  // 1. eindpunt
  let best = null;
  for (const m of muren) for (const q of [m.start, m.eind]) {
    const d = lengte(p, q);
    if (d <= tolerantie && (!best || d < best.d)) best = { d, q, id: m.id };
  }
  if (best) return { punt: [best.q[0], best.q[1]], soort: 'eindpunt', doel: best.id, hulplijnen: [] };

  // 2. midden van een muur
  for (const m of muren) {
    const q = [(m.start[0] + m.eind[0]) / 2, (m.start[1] + m.eind[1]) / 2];
    const d = lengte(p, q);
    if (d <= tolerantie && (!best || d < best.d)) best = { d, q, id: m.id };
  }
  if (best) return { punt: best.q, soort: 'midden', doel: best.id, hulplijnen: [] };

  // 3. op de muuras
  const orthoRichting = vanaf && ortho ? orthoAs(vanaf, p) : null;
  for (const m of muren) {
    const proj = afstandTotSegment(p, m.start, m.eind);
    if (proj.afstand <= tolerantie && (!best || proj.afstand < best.d)) best = { d: proj.afstand, m, proj };
  }
  if (best) {
    const { m, proj } = best;
    const L = muurLengte(m);
    const kandidaten = [];
    if (vanaf) {
      // ortho-lijn vanuit `vanaf` snijdt de muuras
      if (orthoRichting) {
        const s = snijOrthoMetMuur(vanaf, orthoRichting, m);
        if (s) kandidaten.push(s);
      }
      // loodrechte voet van `vanaf` op de muuras
      const voet = afstandTotSegment(vanaf, m.start, m.eind);
      if (voet.t > 0 && voet.t < 1) kandidaten.push(voet.punt);
    }
    const goed = kandidaten.find((k) => lengte(k, p) <= tolerantie);
    const q = goed || puntOpMuur(m, Math.max(0, Math.min(L, rondR(proj.t * L, raster))));
    const hulplijnen = vanaf ? [{ van: [vanaf[0], vanaf[1]], naar: q }] : [];
    return { punt: [nul(q[0]), nul(q[1])], soort: 'muur', doel: m.id, hulplijnen };
  }

  // 4./5. uitlijning en ortho
  const eindpunten = muren.flatMap((m) => [m.start, m.eind]);
  const lijnX = (x) => naast(eindpunten, 0, x, tolerantie); // eindpunt met ongeveer dezelfde x
  const lijnY = (y) => naast(eindpunten, 1, y, tolerantie);

  if (orthoRichting) {
    // één coördinaat vast op die van `vanaf`, de andere vrij: lengte op raster of uitgelijnd
    const vrij = orthoRichting === 'x' ? 0 : 1;
    const q = [vanaf[0], vanaf[1]];
    const bron = vrij === 0 ? lijnX(p[0]) : lijnY(p[1]);
    if (bron) {
      q[vrij] = bron[vrij];
      if (lengte(q, vanaf) > 0) {
        return { punt: q, soort: 'uitlijning', hulplijnen: [{ van: [bron[0], bron[1]], naar: [q[0], q[1]] }, { van: [vanaf[0], vanaf[1]], naar: [q[0], q[1]] }] };
      }
    }
    q[vrij] = nul(vanaf[vrij] + rondR(p[vrij] - vanaf[vrij], raster));
    return { punt: q, soort: 'ortho', hulplijnen: [{ van: [vanaf[0], vanaf[1]], naar: [q[0], q[1]] }] };
  }

  const bx = lijnX(p[0]), by = lijnY(p[1]);
  if (bx || by) {
    const q = [bx ? bx[0] : rondR(p[0], raster), by ? by[1] : rondR(p[1], raster)];
    const hulplijnen = [];
    if (bx) hulplijnen.push({ van: [bx[0], bx[1]], naar: [q[0], q[1]] });
    if (by) hulplijnen.push({ van: [by[0], by[1]], naar: [q[0], q[1]] });
    return { punt: q, soort: 'uitlijning', hulplijnen };
  }

  if (raster > 0) return { punt: [rondR(p[0], raster), rondR(p[1], raster)], soort: 'raster', hulplijnen: [] };
  return { punt: p, soort: 'geen', hulplijnen: [] };
}

/** 'x' als vanaf→p binnen 7° horizontaal ligt, 'y' als binnen 7° verticaal, anders null. */
function orthoAs(vanaf, p) {
  const dx = p[0] - vanaf[0], dy = p[1] - vanaf[1];
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const hoek = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0..90
  if (hoek <= ORTHO_HOEK) return 'x';
  if (hoek >= 90 - ORTHO_HOEK) return 'y';
  return null;
}

/** Snijpunt van de horizontale ('x') of verticale ('y') lijn door `vanaf` met de muuras (binnen het segment). */
function snijOrthoMetMuur(vanaf, as, m) {
  const { ux, uy, L } = muurRichting(m);
  if (as === 'x') {
    if (Math.abs(uy) < 1e-9) return null;
    const t = (vanaf[1] - m.start[1]) / uy;
    return t >= 0 && t <= L ? [m.start[0] + ux * t, vanaf[1]] : null;
  }
  if (Math.abs(ux) < 1e-9) return null;
  const t = (vanaf[0] - m.start[0]) / ux;
  return t >= 0 && t <= L ? [vanaf[0], m.start[1] + uy * t] : null;
}

/** Eindpunt waarvan coördinaat k het dichtst bij v ligt (binnen tol), of null. */
function naast(punten, k, v, tol) {
  let best = null, bd = Infinity;
  for (const q of punten) {
    const d = Math.abs(q[k] - v);
    if (d <= tol && d < bd) { bd = d; best = q; }
  }
  return best;
}

/**
 * Verplaatsing afronden op het raster. Geeft [dx, dy] terug met ook eigenschappen .dx en .dy,
 * zodat zowel `const [dx, dy] = snapDelta(…)` als `const { dx, dy } = snapDelta(…)` werkt.
 */
export function snapDelta(dx, dy, raster = 50) {
  const r = [rondR(dx, raster), rondR(dy, raster)];
  r.dx = r[0];
  r.dy = r[1];
  return r;
}
