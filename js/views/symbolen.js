// Symbolen en hulpgeometrie voor trappen, inrichting en hoogtelijnen (2D en 3D). Pure functies, geen DOM —
// getest in tests/views-fase5.test.js. Coördinaten in mm (model), y naar achter.

import { dakkapelNiveau, dakkapelGeometrie } from '../model/dakkapellen.js';
import { maatlijn } from './bouwstenen.js';
import { inrichtingContour } from '../model/vormen.js';
import { trapGeometrie } from '../model/trappen.js';
import { lengte, dakNokHoogte, niveauBovenkant } from '../model/geometry.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

// ── Inrichting ──────────────────────────────────────────────────────────────

/**
 * Hoogte (mm) waarmee een inrichtingselement zonder eigen `hoogte` als blok in 3D getekend wordt.
 * ENKEL WEERGAVE — geen norm en geen toetswaarde (de validator gebruikt enkel `hoogte` van het element).
 */
export const WEERGAVE_HOOGTE = Object.freeze({
  douche: 100, lavabo: 850, wc: 800, bad: 550, keuken: 900, bed: 500, kast: 2000, wasmachine: 850,
  droogkast: 850, bureau: 750, tafel: 750, zetel: 800, overig: 800,
});

/** Blokhoogte in 3D: eigen `hoogte` van het element, anders de weergavewaarde per soort. */
export function inrichtingHoogte(item) {
  if (isGetal(item?.hoogte) && item.hoogte > 0) return item.hoogte;
  return WEERGAVE_HOOGTE[item?.soort] ?? WEERGAVE_HOOGTE.overig;
}

/** Ellips (gesloten polygoon, lokaal) rond (cu, cv) met halve assen ru, rv. */
function ellips(cu, cv, ru, rv, n = 24) {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [cu + ru * Math.cos(a), cv + rv * Math.sin(a)];
  });
}

const rechth = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

/** Rechthoek met afgeronde hoeken (straal r), lokaal. */
function afgerond(u0, v0, u1, v1, r, n = 5) {
  r = Math.max(0, Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2));
  const pts = [];
  const hoek = (cu, cv, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * (i / n); pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); } };
  hoek(u1 - r, v0 + r, -Math.PI / 2);
  hoek(u1 - r, v1 - r, 0);
  hoek(u0 + r, v1 - r, Math.PI / 2);
  hoek(u0 + r, v0 + r, Math.PI);
  return pts;
}

/**
 * 2D-symbool van een inrichtingselement, in wereldcoördinaten (mm).
 * Lokaal: u langs `breedte`, v langs `diepte`, rugzijde aan −v (tegen de muur), voorzijde +v; daarna `rotatie`
 * rond `positie` (zoals inrichtingContour).
 * @returns {{ contour:number[][], vormen:number[][][], lijnen:number[][][], label:{p:number[], tekst:string}|null }}
 *   vormen = gesloten polygonen (ovalen, kussens …), lijnen = open polylijnen.
 */
export function inrichtingSymbool(item) {
  const B = item.breedte, D = item.diepte;
  const a = ((item.rotatie || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const [px, py] = item.positie;
  const W = (pts) => pts.map(([u, v]) => [px + u * c - v * s, py + u * s + v * c]);
  const hb = B / 2, hd = D / 2, m = Math.min(B, D);
  const vormen = [], lijnen = [];
  let label = null;
  switch (item.soort) {
    case 'douche':
      lijnen.push([[-hb, -hd], [hb, hd]], [[-hb, hd], [hb, -hd]]);
      vormen.push(ellips(0, 0, m * 0.07, m * 0.07, 16));
      break;
    case 'lavabo':
      vormen.push(ellips(0, D * 0.08, B * 0.36, D * 0.3));
      vormen.push(ellips(0, -D * 0.34, m * 0.05, m * 0.05, 12));
      break;
    case 'wc':
      vormen.push(rechth(-B * 0.42, -hd, B * 0.42, -hd + D * 0.26));
      vormen.push(ellips(0, D * 0.12, B * 0.4, D * 0.32));
      break;
    case 'bad': {
      const r = Math.min(80, m * 0.1);
      vormen.push(afgerond(-hb + r, -hd + r, hb - r, hd - r, m * 0.25));
      vormen.push(ellips(-hb + B * 0.15, 0, m * 0.05, m * 0.05, 12));
      break;
    }
    case 'bed': {
      const kv0 = -hd + Math.min(60, D * 0.04), kv1 = kv0 + Math.min(380, D * 0.2);
      const marge = Math.min(80, B * 0.06);
      if (B >= 1200) {
        vormen.push(afgerond(-hb + marge, kv0, -marge / 2, kv1, 60), afgerond(marge / 2, kv0, hb - marge, kv1, 60));
      } else vormen.push(afgerond(-hb + marge, kv0, hb - marge, kv1, 60));
      const dv = -hd + D * 0.3;
      lijnen.push([[-hb, dv], [hb, dv]]);
      lijnen.push([[-hb, dv], [-hb + B * 0.25, dv + D * 0.12], [hb, dv + D * 0.12]]);
      break;
    }
    case 'kast':
      lijnen.push([[-hb, -hd], [hb, hd]]);
      lijnen.push([[-hb, hd - Math.min(40, D * 0.08)], [hb, hd - Math.min(40, D * 0.08)]]);
      break;
    case 'keuken': {
      const sb = Math.min(800, B * 0.3), sd = D * 0.6;
      const su = B >= 1200 ? -B / 4 : -B * 0.22;
      vormen.push(afgerond(su - sb / 2, -sd / 2, su + sb / 2, sd / 2, 40));
      const ku = B >= 1200 ? B / 4 : B * 0.25, r = Math.min(D * 0.13, B * 0.06), dk = r * 1.25;
      for (const [du, dv] of [[-dk, -dk], [dk, -dk], [-dk, dk], [dk, dk]]) vormen.push(ellips(ku + du, dv, r, r, 16));
      break;
    }
    case 'wasmachine':
      vormen.push(ellips(0, 0, m * 0.34, m * 0.34));
      break;
    case 'droogkast':
      vormen.push(ellips(0, 0, m * 0.34, m * 0.34), ellips(0, 0, m * 0.16, m * 0.16, 16));
      break;
    case 'zetel': {
      const rug = Math.min(220, D * 0.25), arm = Math.min(200, B * 0.12);
      vormen.push(rechth(-hb, -hd, hb, -hd + rug));
      vormen.push(rechth(-hb, -hd + rug, -hb + arm, hd), rechth(hb - arm, -hd + rug, hb, hd));
      break;
    }
    case 'bureau':
      lijnen.push([[-hb, hd - Math.min(60, D * 0.1)], [hb, hd - Math.min(60, D * 0.1)]]);
      label = 'bureau';
      break;
    case 'tafel':
      vormen.push(afgerond(-hb + m * 0.08, -hd + m * 0.08, hb - m * 0.08, hd - m * 0.08, m * 0.1));
      label = 'tafel';
      break;
    default:
      label = item.soort ? String(item.soort) : '?';
  }
  return {
    contour: inrichtingContour(item),
    vormen: vormen.map(W),
    lijnen: lijnen.map(W),
    label: label ? { p: [px, py], tekst: label } : null,
  };
}

// ── Trappen ─────────────────────────────────────────────────────────────────

/** Pijlpunt (open polylijn [vleugel, punt, vleugel]) aan het einde van een polylijn. */
export function pijlpunt(lijn, grootte) {
  if (!lijn || lijn.length < 2) return null;
  const tip = lijn[lijn.length - 1];
  let i = lijn.length - 2;
  while (i > 0 && lengte(lijn[i], tip) < 1e-6) i--;
  const L = lengte(lijn[i], tip);
  if (L < 1e-6) return null;
  const ux = (tip[0] - lijn[i][0]) / L, uy = (tip[1] - lijn[i][1]) / L;
  const g = Math.min(grootte, L * 0.9);
  const b = [tip[0] - ux * g, tip[1] - uy * g];
  return [[b[0] - uy * g * 0.5, b[1] + ux * g * 0.5], tip, [b[0] + uy * g * 0.5, b[1] - ux * g * 0.5]];
}

/**
 * 2D-symbool van een trap (mm, wereld). Treden = contouren uit trapGeometrie; looplijn met beginbolletje en
 * pijl naar boven (aan het einde). Spiraal: looplijn als boog, kolom in het midden.
 * @returns {null | { voetafdruk, treden:number[][][], looplijn:number[][], pijl:number[][]|null, begin:number[],
 *   kolom:number[][]|null, fout?:string }}
 */
export function trapSymbool(model, trap, opties = {}) {
  const g = trapGeometrie(model, trap, opties);
  if (!g || !g.voetafdruk) return g ? { voetafdruk: null, treden: [], looplijn: [], pijl: null, begin: null, kolom: null, fout: g.fout } : null;
  let loop = g.looplijn;
  let kolom = null;
  if (trap.type === 'spiraal') {
    const [cx, cy] = trap.oorsprong;
    const R = (g.maten.diameter || 2 * trap.breedte) / 2;
    kolom = ellips(cx, cy, Math.min(80, R * 0.12), Math.min(80, R * 0.12), 16);
    // boog verfijnen: tussen opeenvolgende punten op de looplijn de hoek interpoleren
    const fijn = [];
    for (let i = 0; i < loop.length - 1; i++) {
      const p = loop[i], q = loop[i + 1];
      const a0 = Math.atan2(p[1] - cy, p[0] - cx);
      let da = Math.atan2(q[1] - cy, q[0] - cx) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const r = Math.hypot(p[0] - cx, p[1] - cy);
      for (let k = 0; k < 4; k++) fijn.push([cx + r * Math.cos(a0 + (da * k) / 4), cy + r * Math.sin(a0 + (da * k) / 4)]);
    }
    if (loop.length) fijn.push(loop[loop.length - 1]);
    loop = fijn;
  }
  return {
    voetafdruk: g.voetafdruk,
    treden: g.treden.map((t) => t.contour),
    looplijn: loop,
    pijl: pijlpunt(loop, Math.min(250, trap.breedte * 0.35)),
    begin: loop[0] || null,
    kolom,
    maten: g.maten,
  };
}

/**
 * Treden van een trap als blokken voor 3D: per trede contour + onder- en bovenkant (absolute z, mm).
 * Recht/kwart/halfdraai: blok van één optrede hoog (zaagtand, goed leesbaar); spiraal: dunne treden (`tredeDikte`)
 * met een kolom. Leeg als de trap niet berekend kan worden.
 * @returns {{ treden: Array<{ contour, z0, z1 }>, kolom: null | { midden:number[], straal:number, z0:number, z1:number } }}
 */
export function trapBlokken(model, trap, { tredeDikte = 50, ...opties } = {}) {
  const g = trapGeometrie(model, trap, opties);
  const van = (model?.niveaus || []).find((n) => n.id === trap.vanNiveau);
  if (!g || g.fout || !van) return { treden: [], kolom: null };
  const o = g.maten.optrede || 0;
  const spiraal = trap.type === 'spiraal';
  const treden = g.treden.map((t) => {
    const z1 = van.peil + t.z;
    return { contour: t.contour, z0: spiraal ? z1 - Math.min(tredeDikte, o) : z1 - o, z1 };
  });
  let kolom = null;
  if (spiraal) {
    const R = (g.maten.diameter || 2 * trap.breedte) / 2;
    const naar = (model.niveaus || []).find((n) => n.id === trap.naarNiveau);
    kolom = { midden: trap.oorsprong.slice(), straal: Math.min(80, R * 0.12), z0: van.peil, z1: naar ? naar.peil + 1000 : van.peil + (g.maten.aantalTreden || 0) * o };
  }
  return { treden, kolom };
}

/** Trapgaten (contouren) in de vloer van een niveau: trappen (status ≠ afbraak) met naarNiveau = niveauId. */
export function trapgatenOp(model, niveauId, opties = {}) {
  const uit = [];
  for (const t of model?.trappen || []) {
    if (t.naarNiveau !== niveauId || t.status === 'afbraak') continue;
    const g = trapGeometrie(model, t, opties);
    if (g?.voetafdruk) uit.push({ id: t.id, contour: g.voetafdruk });
  }
  return uit;
}

// ── Hoogtelijnen ────────────────────────────────────────────────────────────

/** 1500 → "1,50 m". */
export function formatteerHoogte(mm) {
  return `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
}

/**
 * Ligt (een deel van) het niveau onder een hellend dak? Waar als soort 'zolder' of als een hellend dak
 * (status ≠ afbraak) rust op of boven het vloerpeil en lager dan de bovenkant van het niveau
 * (het niveau zit "in" het dak).
 */
export function niveauOnderDak(model, niveauId) {
  const n = (model?.niveaus || []).find((x) => x.id === niveauId);
  if (!n) return false;
  if (n.soort === 'zolder') return true;
  const boven = n.peil + (n.hoogte || 0);
  return (model.daken || []).some((d) => {
    if (d.status === 'afbraak' || d.type === 'plat' || !d.helling || !(d.contour?.length >= 3)) return false;
    const rust = niveauBovenkant(model, d.niveau);
    return rust >= n.peil - 0.5 && rust < boven - 0.5 && rust + dakNokHoogte(d) > n.peil;
  });
}

/**
 * Hoogtebanden voor de vlakvulling: uit de begrenzing van het niveau (vloercontouren) en het resultaat van
 * hoogtelijnen() (gebieden waar de vrije hoogte ≥ h). Band k = gebied(h_k) zonder gebied(h_k+1), te tekenen
 * met fill-rule evenodd (de gebieden van hogere grenzen liggen binnen die van lagere).
 * @returns {Array<{ van:number, tot:number|null, lussen:number[][][] }>}
 */
export function hoogteBanden(domein, lagen) {
  const l = [...(lagen || [])].filter((x) => isGetal(x?.hoogte)).sort((a, b) => a.hoogte - b.hoogte);
  if (!l.length) return [];
  const uit = [{ van: 0, tot: l[0].hoogte, lussen: [...(domein || []), ...l[0].gebieden] }];
  for (let k = 0; k < l.length; k++)
    uit.push({ van: l[k].hoogte, tot: l[k + 1]?.hoogte ?? null, lussen: [...l[k].gebieden, ...(l[k + 1]?.gebieden || [])] });
  return uit.filter((b) => b.lussen.length);
}

/**
 * Plek en hoek voor het label van een hoogtelijn: op fractie `f` van de lengte (standaard halverwege), hoek in
 * svg-graden (y omgekeerd), altijd leesbaar (−90°..90°).
 */
export function lijnLabel(lijn, f = 0.5) {
  if (!lijn || lijn.length < 2) return null;
  let totaal = 0;
  for (let i = 0; i < lijn.length - 1; i++) totaal += lengte(lijn[i], lijn[i + 1]);
  let rest = totaal * Math.min(1, Math.max(0, f));
  for (let i = 0; i < lijn.length - 1; i++) {
    const L = lengte(lijn[i], lijn[i + 1]);
    if (rest <= L || i === lijn.length - 2) {
      const k = L ? Math.min(1, rest / L) : 0;
      const p = [lijn[i][0] + (lijn[i + 1][0] - lijn[i][0]) * k, lijn[i][1] + (lijn[i + 1][1] - lijn[i][1]) * k];
      let hoek = (Math.atan2(-(lijn[i + 1][1] - lijn[i][1]), lijn[i + 1][0] - lijn[i][0]) * 180) / Math.PI;
      if (hoek >= 90) hoek -= 180;
      if (hoek < -90) hoek += 180;
      return { p, hoek, lengte: totaal };
    }
    rest -= L;
  }
  return null;
}

/**
 * Beste labelplek op een hoogtelijn: de fractie (midden, ⅓, ⅔, …) die het verst van de gegeven punten
 * (bv. ruimtelabels) ligt. Gelijke afstand ⇒ de eerste (midden).
 */
export function vrijLijnLabel(lijn, vermijd = [], fracties = [0.5, 0.3, 0.7, 0.15, 0.85]) {
  let beste = null, besteAfst = -1;
  for (const f of fracties) {
    const l = lijnLabel(lijn, f);
    if (!l) return null;
    const a = Math.min(Infinity, ...vermijd.map((q) => lengte(l.p, q)));
    if (a > besteAfst + 1e-6) { beste = l; besteAfst = a; }
  }
  return beste;
}

/**
 * Plattegrondsymbool van een dakkapel op niveau `niveauId` (enkel op het niveau in haar dak; zie dakkapelNiveau), of null.
 * → { contour (voetafdruk), voorvlak (lijn), wangen (2 strookjes), label { p, tekst }, maat (maatlijn breedte, aan de gootzijde) }
 */
export function dakkapelSymbool(model, k, niveauId, opties = {}) {
  if (dakkapelNiveau(model, k) !== niveauId) return null;
  const g = dakkapelGeometrie(model, k, opties);
  if (g.fout) return null;
  const A = g.assen;
  const { u0, u1, dVoor, dAchter, wang } = g;
  const naarGoot = A.as === 'y' ? [0, -A.zin] : [-A.zin, 0];
  return {
    contour: g.voetafdruk,
    voorvlak: [A.xy(u0, dVoor), A.xy(u1, dVoor)],
    wangen: [
      [A.xy(u0, dVoor), A.xy(u0 + wang, dVoor), A.xy(u0 + wang, dAchter), A.xy(u0, dAchter)],
      [A.xy(u1 - wang, dVoor), A.xy(u1, dVoor), A.xy(u1, dAchter), A.xy(u1 - wang, dAchter)],
    ],
    // label net achter het voorvlak (het ruimtelabel staat meestal in het midden van de kamer)
    label: { p: A.xy(g.uMidden, dVoor + wang + Math.min(220, (dAchter - dVoor) / 4)), tekst: `Dakkapel ${k.id}` },
    maat: maatlijn(A.xy(u0, dVoor), A.xy(u1, dVoor), naarGoot, 350),
  };
}
