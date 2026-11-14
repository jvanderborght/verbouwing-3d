// Pure hulpfuncties voor de views (geen DOM, geen Three.js) — getest in tests/views.test.js.
// Eenheden: mm in het model. "svg"-coördinaten = [x, -y] (y-as omgekeerd zodat de straat onderaan ligt).

import { lengte, muurRichting, puntOpMuur, begrenzing } from '../model/geometry.js';

/** 26432000 mm² → "26,4 m²" (Vlaamse notatie, komma als decimaalteken). */
export function formatteerOppervlakte(mm2) {
  return `${(mm2 / 1e6).toFixed(1).replace('.', ',')} m²`;
}

/** Maat in mm, afgerond, zonder eenheid (zoals op Belgische plannen): 6700 → "6700". */
export function formatteerMaat(mm) {
  return String(Math.round(mm));
}

/**
 * Normaal van de muur die wegwijst van `centrum` (typisch het midden van het niveau).
 * Bij twijfel (muur door het centrum) de linkernormaal van de looprichting.
 */
export function buitenNormaal(muur, centrum) {
  const { nx, ny } = muurRichting(muur);
  const mx = (muur.start[0] + muur.eind[0]) / 2, my = (muur.start[1] + muur.eind[1]) / 2;
  const d = (mx - centrum[0]) * nx + (my - centrum[1]) * ny;
  return d < -1e-6 ? [-nx, -ny] : [nx, ny];
}

/**
 * Maatlijn tussen a en b (referentiepunten op het gemeten object), evenwijdig verschoven over
 * `afstand` in richting n (eenheidsvector). Hulplijnen lopen van net naast het object tot net voorbij de maatlijn.
 */
export function maatlijn(a, b, n, afstand, { tekst, tussenruimte = 80, overschot = 120 } = {}) {
  const verschuif = (p, d) => [p[0] + n[0] * d, p[1] + n[1] * d];
  const van = verschuif(a, afstand), tot = verschuif(b, afstand);
  const teken = Math.sign(afstand) || 1;
  return {
    van, tot,
    hulplijnen: [
      [verschuif(a, teken * tussenruimte), verschuif(a, afstand + teken * overschot)],
      [verschuif(b, teken * tussenruimte), verschuif(b, afstand + teken * overschot)],
    ],
    midden: [(van[0] + tot[0]) / 2, (van[1] + tot[1]) / 2],
    tekst: tekst ?? formatteerMaat(lengte(a, b)),
    n,
  };
}

/** Ligt de buitenzijde van de muur (richting n) op de rand van de begrenzing b? */
export function isBuitenmuur(muur, n, b, tol = 2) {
  const mx = (muur.start[0] + muur.eind[0]) / 2 + (n[0] * muur.dikte) / 2;
  const my = (muur.start[1] + muur.eind[1]) / 2 + (n[1] * muur.dikte) / 2;
  return (Math.abs(n[0]) > 0.5 && (Math.abs(mx - b.minX) < tol || Math.abs(mx - b.maxX) < tol))
    || (Math.abs(n[1]) > 0.5 && (Math.abs(my - b.minY) < tol || Math.abs(my - b.maxY) < tol));
}

/**
 * Maatlijnen voor één muur.
 * Buitenmuur: kettingmaat met de openingen (indien aanwezig) op `stap`, daarna de aslengte op 2·stap.
 * Binnenmuur: enkel de aslengte, vlak naast de muur.
 * @param {object} muur
 * @param {object[]} openingen openingen in deze muur (afbraak-openingen worden genegeerd)
 * @param {number[]} n buitennormaal (zie buitenNormaal)
 * @param {boolean} buiten
 */
export function muurMaten(muur, openingen, n, buiten, { stap = 550 } = {}) {
  const L = lengte(muur.start, muur.eind);
  const vlak = (t) => {
    const p = puntOpMuur(muur, t);
    return [p[0] + (n[0] * muur.dikte) / 2, p[1] + (n[1] * muur.dikte) / 2];
  };
  const uit = [];
  if (!buiten) {
    uit.push({ ...maatlijn(vlak(0), vlak(L), n, 450), soort: 'muur' });
    return uit;
  }
  const ts = new Set([0, L]);
  for (const o of openingen) {
    if (o.status === 'afbraak') continue;
    for (const t of [o.positie, o.positie + o.breedte]) if (t > 0 && t < L) ts.add(t);
  }
  const ketting = [...ts].sort((a, b) => a - b);
  let afstand = stap;
  if (ketting.length > 2) {
    for (let i = 0; i < ketting.length - 1; i++)
      uit.push({ ...maatlijn(vlak(ketting[i]), vlak(ketting[i + 1]), n, afstand), soort: 'ketting' });
    afstand += stap;
  }
  uit.push({ ...maatlijn(vlak(0), vlak(L), n, afstand), soort: 'muur' });
  return uit;
}

/** Totale buitenmaten van een niveau (begrenzing b): onderaan (breedte) en links (diepte). */
export function totaleMaten(b, afstand) {
  return [
    { ...maatlijn([b.minX, b.minY], [b.maxX, b.minY], [0, -1], afstand), soort: 'totaal' },
    { ...maatlijn([b.minX, b.minY], [b.minX, b.maxY], [-1, 0], afstand), soort: 'totaal' },
  ];
}

/** Draaihoek (graden) voor tekst langs een lijn in svg-coördinaten, altijd leesbaar [−90°, 90°): verticaal leest van onder naar boven. */
export function leesbareHoek(dx, dy) {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a >= 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}

// ── Zichtvenster (pan/zoom) ─────────────────────────────────────────────────
// view = { cx, cy, schaal }: midden in svg-coördinaten (mm) en schaal in px per mm.

/** View die begrenzing b (model-mm) passend toont in een venster van W×H px, met marge (px). */
export function passendeView(b, W, H, marge = 24) {
  const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const schaal = Math.max(1e-4, Math.min((W - 2 * marge) / bw, (H - 2 * marge) / bh));
  return { cx: (b.minX + b.maxX) / 2, cy: -(b.minY + b.maxY) / 2, schaal };
}

/** viewBox-waarden [x, y, w, h] voor een venster van W×H px. */
export function viewBoxVan(view, W, H) {
  const w = W / view.schaal, h = H / view.schaal;
  return [view.cx - w / 2, view.cy - h / 2, w, h];
}

/** Schermpunt (px t.o.v. linkerbovenhoek van het venster) → model [x, y] in mm. */
export function schermNaarModelV(view, W, H, sx, sy) {
  const X = view.cx + (sx - W / 2) / view.schaal;
  const Y = view.cy + (sy - H / 2) / view.schaal;
  return [X, -Y];
}

/** Model [x, y] in mm → schermpunt [px, py] t.o.v. linkerbovenhoek van het venster. */
export function modelNaarSchermV(view, W, H, x, y) {
  return [(x - view.cx) * view.schaal + W / 2, (-y - view.cy) * view.schaal + H / 2];
}

/** Zoom met factor rond schermpunt (sx, sy): het modelpunt onder dat schermpunt blijft staan. */
export function zoomRond(view, W, H, sx, sy, factor, { min = 0.002, max = 5 } = {}) {
  const schaal = Math.min(max, Math.max(min, view.schaal * factor));
  const X = view.cx + (sx - W / 2) / view.schaal;
  const Y = view.cy + (sy - H / 2) / view.schaal;
  return { cx: X - (sx - W / 2) / schaal, cy: Y - (sy - H / 2) / schaal, schaal };
}

/** Verschuif het beeld met (dx, dy) schermpixels. */
export function verschuif(view, dx, dy) {
  return { ...view, cx: view.cx - dx / view.schaal, cy: view.cy - dy / view.schaal };
}

/** Begrenzing van een lijst polygonen (lege lijst → null). */
export function begrenzingVan(polygonen) {
  const pts = polygonen.flat();
  return pts.length ? begrenzing(pts) : null;
}

/** Niveau direct onder het gegeven niveau (hoogste peil lager dan dat van niveauId), of null. */
export function niveauEronder(niveaus, niveauId) {
  const n = niveaus.find((x) => x.id === niveauId);
  if (!n) return null;
  return niveaus.filter((x) => x.peil < n.peil).sort((a, b) => b.peil - a.peil)[0] || null;
}

/** Ids van elementen die verborgen zijn wanneer de gegeven niveaus verborgen worden. */
export function verborgenIds(model, verborgenNiveaus = []) {
  const v = new Set(verborgenNiveaus);
  const ids = new Set();
  for (const k of ['muren', 'ruimtes', 'vloeren', 'daken']) for (const e of model[k] || []) if (v.has(e.niveau)) ids.add(e.id);
  for (const o of model.openingen || []) if (ids.has(o.muur)) ids.add(o.id);
  return ids;
}
