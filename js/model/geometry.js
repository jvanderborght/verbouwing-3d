// Pure geometrie-hulpfuncties (mm). Geen DOM, geen Three.js.

export const lengte = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export const muurLengte = (muur) => lengte(muur.start, muur.eind);

/** Eenheidsvector langs de muur en normaal (links van de looprichting). */
export function muurRichting(muur) {
  const L = muurLengte(muur) || 1;
  const ux = (muur.eind[0] - muur.start[0]) / L;
  const uy = (muur.eind[1] - muur.start[1]) / L;
  return { ux, uy, nx: -uy, ny: ux, L };
}

/** Effectieve hoogte van een muur (eigen hoogte of verdiepingshoogte). */
export function muurHoogte(model, muur) {
  if (typeof muur.hoogte === 'number') return muur.hoogte;
  const n = model.niveaus.find((x) => x.id === muur.niveau);
  return n ? n.hoogte : 0;
}

/** Vier hoekpunten van de muur in plan (rechthoek rond de as). */
export function muurRechthoek(muur) {
  const { nx, ny } = muurRichting(muur);
  const h = muur.dikte / 2;
  const [sx, sy] = muur.start;
  const [ex, ey] = muur.eind;
  return [
    [sx + nx * h, sy + ny * h],
    [ex + nx * h, ey + ny * h],
    [ex - nx * h, ey - ny * h],
    [sx - nx * h, sy - ny * h],
  ];
}

/** Punt op de muuras op afstand t (mm) van start. */
export function puntOpMuur(muur, t) {
  const { ux, uy } = muurRichting(muur);
  return [muur.start[0] + ux * t, muur.start[1] + uy * t];
}

/** Oppervlakte van een polygoon (absolute waarde, shoelace). */
export function polygoonOppervlakte(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function polygoonOmtrek(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += lengte(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export function polygoonZwaartepunt(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function begrenzing(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, breedte: maxX - minX, diepte: maxY - minY };
}

export function puntInPolygoon([px, py], pts) {
  let binnen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}

/** Kortste afstand van punt p tot segment ab, plus het projectiepunt en parameter t∈[0,1]. */
export function afstandTotSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { afstand: lengte(p, q), punt: q, t };
}

/** Peil (z) van de bovenkant van een niveau = rustvlak voor daken. */
export function niveauBovenkant(model, niveauId) {
  const n = model.niveaus.find((x) => x.id === niveauId);
  return n ? n.peil + n.hoogte : 0;
}

/**
 * Dakhoogte boven het rustvlak in punt (x, y), voor een dak met rechthoekig grondvlak
 * (begrenzing van de contour). plat → 0.
 * zadel: nok evenwijdig aan nokrichting, in het midden. schild: zadel + afgeschuinde kopse kanten.
 * lessenaar: stijgt loodrecht op nokrichting; hoge rand aan de max-zijde (of aan de min-zijde met `hogeZijde: 'min'`).
 * Optioneel `basisHoogte` (hellende daken): de hele onderkant ligt zoveel hoger (knieschot), zie dakBasisHoogte().
 */
export function dakHoogteIn(dak, x, y) {
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  if (dak.type === 'plat' || dak.helling === 0) return 0;
  const B = dakBasisHoogte(dak);
  if (B > 0) return B + dakHoogteIn({ ...dak, basisHoogte: 0 }, x, y);
  // afstand loodrecht op de nok
  const lo = r === 'x' ? b.minY : b.minX;
  const hi = r === 'x' ? b.maxY : b.maxX;
  const v = r === 'x' ? y : x;
  if (dak.type === 'lessenaar') return Math.max(0, (hogeZijdeMin(dak) ? hi - v : v - lo) * tan);
  const dwars = Math.max(0, Math.min(v - lo, hi - v));
  if (dak.type === 'zadel') return dwars * tan;
  // schild: ook langs de nok afschuinen met dezelfde helling
  const lo2 = r === 'x' ? b.minX : b.minY;
  const hi2 = r === 'x' ? b.maxX : b.maxY;
  const w = r === 'x' ? x : y;
  const langs = Math.max(0, Math.min(w - lo2, hi2 - w));
  return Math.min(dwars, langs) * tan;
}

/**
 * Basishoogte (mm) van een dak: de onderkant aan de lage rand(en) ligt zoveel boven het rustvlak (bv. een knieschot
 * of verhoogde gevel). Enkel voor hellende daken; plat of zonder veld: 0.
 */
export function dakBasisHoogte(dak) {
  if (!dak || dak.type === 'plat' || !dak.helling) return 0;
  const B = dak.basisHoogte;
  return typeof B === 'number' && Number.isFinite(B) && B > 0 ? B : 0;
}

/** Lessenaar met de hoge rand aan de min-zijde (`hogeZijde: 'min'`)? Standaard ligt de hoge rand aan de max-zijde. */
export const hogeZijdeMin = (dak) => dak?.type === 'lessenaar' && dak.hogeZijde === 'min';

/** Maximale dakhoogte (nok) boven het rustvlak (incl. basisHoogte). */
export function dakNokHoogte(dak) {
  if (dak.type === 'plat' || dak.helling === 0) return 0;
  const B = dakBasisHoogte(dak);
  if (B > 0) return B + dakNokHoogte({ ...dak, basisHoogte: 0 });
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  const dwars = r === 'x' ? b.diepte : b.breedte;
  if (dak.type === 'lessenaar') return dwars * tan;
  if (dak.type === 'zadel') return (dwars / 2) * tan;
  const langs = r === 'x' ? b.breedte : b.diepte;
  return (Math.min(dwars, langs) / 2) * tan;
}

/** Volume onder het dak boven het rustvlak, in mm³. Analytisch voor een rechthoekig grondvlak (basisHoogte: + grondvlak × basis). */
export function dakVolume(dak) {
  if (dak.type === 'plat' || dak.helling === 0) return 0;
  const b = begrenzing(dak.contour);
  const A = b.breedte * b.diepte;
  const B = dakBasisHoogte(dak);
  if (B > 0) return A * B + dakVolume({ ...dak, basisHoogte: 0 });
  const H = dakNokHoogte(dak);
  if (dak.type === 'lessenaar' || dak.type === 'zadel') return (A * H) / 2;
  // schild: prisma minus twee piramidehoeken
  const r = dak.nokrichting || 'x';
  const dwars = r === 'x' ? b.diepte : b.breedte;
  const langs = r === 'x' ? b.breedte : b.diepte;
  // prisma over de noklengte (langs − dwars) + één piramide dwars²·H/3
  const kort = Math.min(dwars, langs), lang = Math.max(dwars, langs);
  return (H * kort * (3 * lang - kort)) / 6;
}

export const mm2_naar_m2 = (v) => v / 1e6;
export const mm3_naar_m3 = (v) => v / 1e9;

// ─────────────────────────────────────────────────────────────────────────────
// Bouwstenen voor de weergave (3D en 2D). Pure functies, getest in tests/views.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const EVENWIJDIG = 0.02; // |kruisproduct| van eenheidsvectoren waaronder twee muren evenwijdig heten

/**
 * Hoeveel een muur aan start en eind verlengd (+) of ingekort (−) wordt (mm, langs de as),
 * zodat aansluitende muren van hetzelfde niveau netjes sluiten zonder te overlappen.
 * - L-hoek: één muur loopt door tot de buitenzijde van de andere, de andere stopt ertegen.
 *   Voorrang: niet-afbraak vóór afbraak, daarna volgorde in de lijst.
 * - T-aansluiting (einde op het midden van een andere muur, of op twee collineaire muren): inkorten tot het muurvlak.
 * - Collineair verlengstuk: geen correctie.
 * @returns {{ start: number, eind: number }}
 */
export function muurAansluiting(muren, muur, tol = 5) {
  const volgorde = new Map(muren.map((m, i) => [m.id, i]));
  const sleutel = (m) => (m.status === 'afbraak' ? 1e9 : 0) + (volgorde.get(m.id) ?? 0);
  const r = muurRichting(muur);
  const kruis = (a, b) => Math.abs(a.ux * b.uy - a.uy * b.ux);
  const andere = muren.filter((m) => m.id !== muur.id && m.niveau === muur.niveau);
  const uit = { start: 0, eind: 0 };
  for (const [naam, P] of [['start', muur.start], ['eind', muur.eind]]) {
    const partners = [];
    let collineair = false;
    for (const B of andere) {
      if (afstandTotSegment(P, B.start, B.eind).afstand > tol) continue;
      const rb = muurRichting(B);
      const opEinde = lengte(P, B.start) <= tol || lengte(P, B.eind) <= tol;
      if (kruis(r, rb) < EVENWIJDIG) { if (opEinde) collineair = true; continue; }
      partners.push({ B, rb, opEinde });
    }
    if (collineair || partners.length === 0) continue;
    const half = Math.max(...partners.map((p) => p.B.dikte)) / 2;
    const doorlopend = partners.some((p) => !p.opEinde)
      || partners.some((p, i) => partners.some((q, j) => j > i && kruis(p.rb, q.rb) < EVENWIJDIG));
    if (doorlopend) uit[naam] = -half;
    else uit[naam] = partners.every((p) => sleutel(muur) < sleutel(p.B)) ? half : -half;
  }
  return uit;
}

/**
 * Deelt een muur (in het vlak t = langs de as, z = hoogte boven vloerpeil) op in volle rechthoeken
 * rond de gaten (openingen). Aangrenzende stukken met dezelfde hoogte worden samengevoegd.
 * @param {number} t0 begin langs de as (mag negatief zijn bij verlenging)
 * @param {number} t1 einde langs de as
 * @param {number} H muurhoogte
 * @param {{positie:number, breedte:number, borstwering:number, hoogte:number}[]} gaten
 * @returns {{t0:number, t1:number, z0:number, z1:number}[]}
 */
export function muurSegmenten(t0, t1, H, gaten = []) {
  const eps = 0.5;
  const ts = new Set([t0, t1]);
  for (const g of gaten) for (const t of [g.positie, g.positie + g.breedte]) if (t > t0 && t < t1) ts.add(t);
  const grenzen = [...ts].sort((a, b) => a - b);
  const uit = [];
  for (let i = 0; i < grenzen.length - 1; i++) {
    const a = grenzen[i], b = grenzen[i + 1];
    if (b - a < eps) continue;
    const open = gaten
      .filter((g) => g.positie <= a + eps && g.positie + g.breedte >= b - eps)
      .map((g) => [Math.max(0, g.borstwering), Math.min(H, g.borstwering + g.hoogte)])
      .filter(([p, q]) => q > p)
      .sort((p, q) => p[0] - q[0]);
    const vol = [];
    let z = 0;
    for (const [p, q] of open) { if (p > z + eps) vol.push([z, p]); z = Math.max(z, q); }
    if (H > z + eps) vol.push([z, H]);
    for (const [z0, z1] of vol) {
      const vorige = uit.find((s) => Math.abs(s.t1 - a) < eps && Math.abs(s.z0 - z0) < eps && Math.abs(s.z1 - z1) < eps);
      if (vorige) vorige.t1 = b; else uit.push({ t0: a, t1: b, z0, z1 });
    }
  }
  return uit;
}

/** Rechthoek (4 hoekpunten in plan) van het muurdeel tussen t0 en t1 langs de as. */
export function muurDeelRechthoek(muur, t0, t1) {
  const { ux, uy, nx, ny } = muurRichting(muur);
  const h = muur.dikte / 2;
  const [sx, sy] = muur.start;
  const p = (t, s) => [sx + ux * t + nx * h * s, sy + uy * t + ny * h * s];
  return [p(t0, 1), p(t1, 1), p(t1, -1), p(t0, -1)];
}

/** Polygoon evenwijdig verschoven over d (mm) naar buiten (d < 0: naar binnen). Hoekpunten via snijpunten (verstek). */
export function polygoonOffset(pts, d) {
  if (!d) return pts.map((p) => [p[0], p[1]]);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  const tegenwijzers = s > 0;
  const lijnen = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const L = lengte(a, b) || 1;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const nx = tegenwijzers ? uy : -uy, ny = tegenwijzers ? -ux : ux; // buitennormaal
    return { p: [a[0] + nx * d, a[1] + ny * d], u: [ux, uy] };
  });
  return lijnen.map((l2, i) => {
    const l1 = lijnen[(i - 1 + lijnen.length) % lijnen.length];
    const k = l1.u[0] * l2.u[1] - l1.u[1] * l2.u[0];
    if (Math.abs(k) < 1e-9) return [...l2.p];
    const dx = l2.p[0] - l1.p[0], dy = l2.p[1] - l1.p[1];
    const t = (dx * l2.u[1] - dy * l2.u[0]) / k;
    return [l1.p[0] + l1.u[0] * t, l1.p[1] + l1.u[1] * t];
  });
}

function zonderDubbels(pts) {
  return pts.filter((p, i) => lengte(p, pts[(i + 1) % pts.length]) > 1e-6);
}

/**
 * Dakvlakken (bovenkant) als 3D-polygonen [[x, y, h], …], h = hoogte boven het rustvlak.
 * Hellende daken op de rechthoekige begrenzing van de contour, met overstek
 * (de helling loopt door in de overstek, dus de dakrand ligt lager dan het rustvlak).
 * Binnen de contour komt h overeen met dakHoogteIn() (ook basisHoogte en hogeZijde).
 * plat: één vlak op h = 0 (contour verschoven met de overstek).
 */
export function dakVlakken(dak) {
  const o = dak.overstek || 0;
  if (dak.type === 'plat' || !dak.helling) return [polygoonOffset(dak.contour, o).map(([x, y]) => [x, y, 0])];
  const B = dakBasisHoogte(dak);
  if (B > 0) return dakVlakken({ ...dak, basisHoogte: 0 }).map((v) => v.map(([x, y, h]) => [x, y, h + B]));
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  const X0 = b.minX - o, X1 = b.maxX + o, Y0 = b.minY - o, Y1 = b.maxY + o;
  const xm = (X0 + X1) / 2, ym = (Y0 + Y1) / 2;
  const e = -o * tan;
  let vlakken, hoogte;
  if (dak.type === 'lessenaar') {
    vlakken = [[[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]]];
    hoogte = hogeZijdeMin(dak)
      ? (x, y) => e + (r === 'x' ? Y1 - y : X1 - x) * tan
      : (x, y) => e + (r === 'x' ? y - Y0 : x - X0) * tan;
  } else if (dak.type === 'zadel') {
    vlakken = r === 'x'
      ? [[[X0, Y0], [X1, Y0], [X1, ym], [X0, ym]], [[X0, ym], [X1, ym], [X1, Y1], [X0, Y1]]]
      : [[[X0, Y0], [xm, Y0], [xm, Y1], [X0, Y1]], [[xm, Y0], [X1, Y0], [X1, Y1], [xm, Y1]]];
    hoogte = (x, y) => e + (r === 'x' ? Math.min(y - Y0, Y1 - y) : Math.min(x - X0, X1 - x)) * tan;
  } else {
    // schild: nok langs de langste zijde
    const W = X1 - X0, D = Y1 - Y0;
    if (W >= D) {
      const h = D / 2;
      vlakken = [
        [[X0, Y0], [X1, Y0], [X1 - h, ym], [X0 + h, ym]],
        [[X1, Y1], [X0, Y1], [X0 + h, ym], [X1 - h, ym]],
        [[X0, Y1], [X0, Y0], [X0 + h, ym]],
        [[X1, Y0], [X1, Y1], [X1 - h, ym]],
      ];
    } else {
      const h = W / 2;
      vlakken = [
        [[X1, Y0], [X1, Y1], [xm, Y1 - h], [xm, Y0 + h]],
        [[X0, Y1], [X0, Y0], [xm, Y0 + h], [xm, Y1 - h]],
        [[X0, Y0], [X1, Y0], [xm, Y0 + h]],
        [[X1, Y1], [X0, Y1], [xm, Y1 - h]],
      ];
    }
    hoogte = (x, y) => e + Math.min(x - X0, X1 - x, y - Y0, Y1 - y) * tan;
  }
  return vlakken.map((v) => zonderDubbels(v).map(([x, y]) => [x, y, hoogte(x, y)]));
}

/**
 * Gevelvullingen onder een hellend dak (zadel: driehoeken op de kopse kanten; lessenaar: driehoeken
 * op de kopse kanten + rechthoek onder de hoge rand). Polygonen [[x, y, h], …] in het buitenvlak van de
 * contourbegrenzing; de bovenkant volgt de onderkant van het dak (dakvlak − dv, dv = verticale dakdikte).
 * `binnen` = horizontale eenheidsvector naar binnen (richting waarin de gevel dikte krijgt).
 * Met basisHoogte of hogeZijde 'min': zie dakGevelsAlgemeen().
 * @returns {{ punten: number[][], binnen: number[] }[]}
 */
export function dakGevels(dak, dv = 0) {
  if (dak.type !== 'zadel' && dak.type !== 'lessenaar') return [];
  if (!dak.helling) return [];
  if (dakBasisHoogte(dak) > 0 || hogeZijdeMin(dak)) return dakGevelsAlgemeen(dak, dv);
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  // u = langs de nok, v = dwars
  const [u0, u1, v0, v1] = r === 'x' ? [b.minX, b.maxX, b.minY, b.maxY] : [b.minY, b.maxY, b.minX, b.maxX];
  const naarXY = (u, v, h) => (r === 'x' ? [u, v, h] : [v, u, h]);
  const richting = (du, dw) => (r === 'x' ? [du, dw] : [dw, du]);
  const inzet = dv / tan;
  const uit = [];
  if (dak.type === 'zadel') {
    const H = ((v1 - v0) / 2) * tan - dv;
    if (H <= 0) return [];
    const vm = (v0 + v1) / 2;
    for (const [u, du] of [[u0, 1], [u1, -1]])
      uit.push({ punten: [naarXY(u, v0 + inzet, 0), naarXY(u, v1 - inzet, 0), naarXY(u, vm, H)], binnen: richting(du, 0) });
  } else {
    const H = (v1 - v0) * tan - dv;
    if (H <= 0) return [];
    for (const [u, du] of [[u0, 1], [u1, -1]])
      uit.push({ punten: [naarXY(u, v0 + inzet, 0), naarXY(u, v1, 0), naarXY(u, v1, H)], binnen: richting(du, 0) });
    uit.push({ punten: [naarXY(u0, v1, 0), naarXY(u1, v1, 0), naarXY(u1, v1, H), naarXY(u0, v1, H)], binnen: richting(0, -1) });
  }
  return uit;
}

/**
 * Gevelvullingen voor daken met basisHoogte B en/of hogeZijde 'min' (zadel/lessenaar). Zelfde vorm als dakGevels():
 *  - kopse kanten: het gebied tussen het rustvlak (h = 0) en de onderkant van het dak − dv (vijfhoek bij zadel,
 *    trapezium bij lessenaar; driehoek als B ≤ dv);
 *  - lessenaar: rechthoek onder de hoge rand (hoogte nok − dv);
 *  - rechthoek onder elke lage rand met hoogte B − dv (als B > dv): de verhoogde gevel / het knieschot.
 */
export function dakGevelsAlgemeen(dak, dv = 0) {
  if ((dak.type !== 'zadel' && dak.type !== 'lessenaar') || !dak.helling) return [];
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  const B = dakBasisHoogte(dak);
  const [u0, u1, v0, v1] = r === 'x' ? [b.minX, b.maxX, b.minY, b.maxY] : [b.minY, b.maxY, b.minX, b.maxX];
  const naarXY = (u, v, h) => (r === 'x' ? [u, v, h] : [v, u, h]);
  const richting = (du, dw) => (r === 'x' ? [du, dw] : [dw, du]);
  const min = hogeZijdeMin(dak);
  // bovenkant van de gevel (onderkant dak − dv) als functie van v, met de knikpunten
  const vm = (v0 + v1) / 2;
  const top = dak.type === 'zadel'
    ? (v) => B + Math.min(v - v0, v1 - v) * tan - dv
    : (v) => B + (min ? v1 - v : v - v0) * tan - dv;
  const knik = dak.type === 'zadel' ? [v0, vm, v1] : [v0, v1];
  // profiel afknippen op h ≥ 0 (bovenkant is concaaf of lineair ⇒ één aaneengesloten stuk)
  const prof = [];
  for (let i = 0; i < knik.length; i++) {
    const v = knik[i], h = top(v);
    if (i > 0) {
      const vp = knik[i - 1], hp = top(vp);
      if ((hp < 0) !== (h < 0)) prof.push([vp + ((0 - hp) * (v - vp)) / (h - hp), 0]);
    }
    if (h >= 0) prof.push([v, h]);
  }
  const uit = [];
  const H = Math.max(...knik.map(top));
  if (prof.length >= 2 && H > 0) {
    const va = prof[0][0], vb = prof[prof.length - 1][0];
    for (const [u, du] of [[u0, 1], [u1, -1]]) {
      const pts = [[va, 0], [vb, 0], ...prof.slice().reverse()]
        .filter((p, i, a) => { const q = a[(i + 1) % a.length]; return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6; });
      if (pts.length >= 3) uit.push({ punten: pts.map(([v, h]) => naarXY(u, v, h)), binnen: richting(du, 0) });
    }
  }
  const rechthoek = (v, h, dw) => {
    if (h > 0) uit.push({ punten: [naarXY(u0, v, 0), naarXY(u1, v, 0), naarXY(u1, v, h), naarXY(u0, v, h)], binnen: richting(0, dw) });
  };
  if (dak.type === 'lessenaar') {
    rechthoek(min ? v0 : v1, H, min ? 1 : -1); // hoge rand
    rechthoek(min ? v1 : v0, B - dv, min ? -1 : 1); // lage rand (knieschot)
  } else {
    rechthoek(v0, B - dv, 1);
    rechthoek(v1, B - dv, -1);
  }
  return uit;
}
