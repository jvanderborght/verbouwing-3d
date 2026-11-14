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
 * lessenaar: stijgt loodrecht op nokrichting; hoge rand aan de max-zijde.
 */
export function dakHoogteIn(dak, x, y) {
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  if (dak.type === 'plat' || dak.helling === 0) return 0;
  // afstand loodrecht op de nok
  const lo = r === 'x' ? b.minY : b.minX;
  const hi = r === 'x' ? b.maxY : b.maxX;
  const v = r === 'x' ? y : x;
  if (dak.type === 'lessenaar') return Math.max(0, (v - lo) * tan);
  const dwars = Math.max(0, Math.min(v - lo, hi - v));
  if (dak.type === 'zadel') return dwars * tan;
  // schild: ook langs de nok afschuinen met dezelfde helling
  const lo2 = r === 'x' ? b.minX : b.minY;
  const hi2 = r === 'x' ? b.maxX : b.maxY;
  const w = r === 'x' ? x : y;
  const langs = Math.max(0, Math.min(w - lo2, hi2 - w));
  return Math.min(dwars, langs) * tan;
}

/** Maximale dakhoogte (nok) boven het rustvlak. */
export function dakNokHoogte(dak) {
  if (dak.type === 'plat' || dak.helling === 0) return 0;
  const b = begrenzing(dak.contour);
  const tan = Math.tan((dak.helling * Math.PI) / 180);
  const r = dak.nokrichting || 'x';
  const dwars = r === 'x' ? b.diepte : b.breedte;
  if (dak.type === 'lessenaar') return dwars * tan;
  if (dak.type === 'zadel') return (dwars / 2) * tan;
  const langs = r === 'x' ? b.breedte : b.diepte;
  return (Math.min(dwars, langs) / 2) * tan;
}

/** Volume onder het dak boven het rustvlak, in mm³. Analytisch voor een rechthoekig grondvlak. */
export function dakVolume(dak) {
  if (dak.type === 'plat' || dak.helling === 0) return 0;
  const b = begrenzing(dak.contour);
  const A = b.breedte * b.diepte;
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
