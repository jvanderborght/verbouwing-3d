// Pure hulpfuncties voor de views (geen DOM, geen Three.js) — getest in tests/views.test.js.
// Eenheden: mm in het model. "svg"-coördinaten = [x, -y] (y-as omgekeerd zodat de straat onderaan ligt).

import { lengte, muurLengte, muurRichting, puntOpMuur, begrenzing, puntInPolygoon, polygoonOppervlakte } from '../model/geometry.js';
import { trapGeometrie } from '../model/trappen.js';
import { inrichtingContour } from '../model/vormen.js';

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
  for (const i of model.inrichting || []) if (v.has(i.niveau)) ids.add(i.id);
  for (const t of model.trappen || []) if (v.has(t.vanNiveau)) ids.add(t.id); // een trap hoort bij zijn vertrekniveau
  return ids;
}

// ── Interactie (plattegrond): gebaren en hittests ──────────────────────────
// Afstanden in schermpixels worden met `schaal` (px per mm) omgerekend naar mm.

/** Drempels voor aanwijzergebaren (px en ms). */
export const GEBAAR = Object.freeze({
  sleepDrempel: 6,     // px: verder bewogen ⇒ slepen i.p.v. tik
  tikDuur: 350,        // ms: korter ingedrukt ⇒ tik (gereedschapsmodus)
  dubbelDuur: 350,     // ms: tussen loslaten van de eerste tik en indrukken van de tweede
  dubbelAfstand: 20,   // px: max. afstand tussen beide tikken
  tolMuur: 10,         // px: hittest-tolerantie voor muren en openingen
  tolGreepMuis: 10,    // px: hitzone grepen met muis
  tolGreepTouch: 22,   // px: hitzone grepen met vinger/pen
});

/** Is de aanwijzer (dx, dy px t.o.v. het neerzetpunt) ver genoeg bewogen om te slepen? */
export function isSleep(dx, dy, drempel = GEBAAR.sleepDrempel) {
  return Math.hypot(dx, dy) > drempel;
}

/** Tik = niet gesleept en kort genoeg ingedrukt. @param {{ dx, dy, duur }} g (px, ms) */
export function isTik({ dx, dy, duur }, { drempel = GEBAAR.sleepDrempel, tikDuur = GEBAAR.tikDuur } = {}) {
  return !isSleep(dx, dy, drempel) && duur < tikDuur;
}

/**
 * Vormt tik `nu` samen met de vorige tik een dubbeltik?
 * @param {{ t, x, y }|null} vorige loslaatmoment (ms) en schermpositie (px) van de vorige tik
 * @param {{ t, x, y }} nu neerzetmoment en schermpositie van de huidige tik
 */
export function isDubbeltik(vorige, nu, { dubbelDuur = GEBAAR.dubbelDuur, dubbelAfstand = GEBAAR.dubbelAfstand } = {}) {
  if (!vorige) return false;
  const dt = nu.t - vorige.t;
  return dt >= 0 && dt < dubbelDuur && Math.hypot(nu.x - vorige.x, nu.y - vorige.y) < dubbelAfstand;
}

/**
 * Afstand (mm) van punt p tot het vak van een muur tussen t0 en t1 langs de as (breedte = dikte).
 * 0 als het punt erin ligt.
 */
export function afstandTotMuurvak(muur, p, t0, t1) {
  const { ux, uy, nx, ny } = muurRichting(muur);
  const rx = p[0] - muur.start[0], ry = p[1] - muur.start[1];
  const t = rx * ux + ry * uy;
  const d = Math.abs(rx * nx + ry * ny);
  const buitenT = t < t0 ? t0 - t : t > t1 ? t - t1 : 0;
  const buitenD = Math.max(0, d - muur.dikte / 2);
  return Math.hypot(buitenT, buitenD);
}

/**
 * Element onder punt p (mm) op `niveau`, met voorkeur opening > muur > inrichting > trap > ruimte.
 * Muren en openingen krijgen een tolerantie van `tolPx` schermpixels; inrichting, trappen en ruimtes moeten het
 * punt bevatten. Openingen en muren binnen de tolerantie: de dichtste wint, bij gelijke afstand de opening
 * (een punt in een opening ligt ook in haar muur). Ligt het punt niet ín de muur/opening maar wel in een
 * inrichtingselement of trap, dan wint dat element (sanitair staat vaak tegen een muur).
 * Trappen: op hun vanNiveau (voetafdruk) en op hun naarNiveau (trapgat). Inrichting/ruimte: kleinste wint.
 * @returns {string|null}
 */
export function raakDoel(model, niveau, p, schaal, { tolPx = GEBAAR.tolMuur } = {}) {
  if (!model || !p) return null;
  const tol = tolPx / (schaal > 0 ? schaal : 1);
  const muren = (model.muren || []).filter((m) => m.niveau === niveau && muurLengte(m) >= 1);
  const opMuur = new Map(muren.map((m) => [m.id, m]));
  let beste = null, besteAfst = Infinity;
  for (const o of model.openingen || []) {
    const mu = opMuur.get(o.muur);
    if (!mu) continue;
    const a = afstandTotMuurvak(mu, p, o.positie, o.positie + o.breedte);
    if (a <= tol && a < besteAfst) { beste = o.id; besteAfst = a; }
  }
  // een muur wint enkel als ze strikt dichter ligt (een opening ligt in haar muur ⇒ in de opening wint de opening)
  for (const mu of muren) {
    // de getekende muur loopt in hoeken tot een halve dikte voorbij het eindpunt
    const a = afstandTotMuurvak(mu, p, -mu.dikte / 2, muurLengte(mu) + mu.dikte / 2);
    if (a <= tol && a < besteAfst) { beste = mu.id; besteAfst = a; }
  }
  if (beste && besteAfst <= 1e-9) return beste;
  const element = raakElement(model, niveau, p);
  if (element) return element;
  if (beste) return beste;
  let besteOpp = Infinity;
  for (const r of model.ruimtes || []) {
    if (r.niveau !== niveau || !(r.contour?.length >= 3) || !puntInPolygoon(p, r.contour)) continue;
    const opp = polygoonOppervlakte(r.contour);
    if (opp < besteOpp) { beste = r.id; besteOpp = opp; }
  }
  return beste;
}

/** Inrichtingselement (kleinste) of trap (voetafdruk/trapgat) op `niveau` dat punt p bevat, of null. */
export function raakElement(model, niveau, p) {
  let beste = null, besteOpp = Infinity;
  for (const i of model.inrichting || []) {
    if (i.niveau !== niveau || !Array.isArray(i.positie) || !(i.breedte > 0) || !(i.diepte > 0)) continue;
    const c = inrichtingContour(i);
    if (!puntInPolygoon(p, c)) continue;
    const opp = i.breedte * i.diepte;
    if (opp < besteOpp) { beste = i.id; besteOpp = opp; }
  }
  if (beste) return beste;
  for (const t of model.trappen || []) {
    if (t.vanNiveau !== niveau && t.naarNiveau !== niveau) continue;
    const g = trapGeometrie(model, t);
    if (!g?.voetafdruk || !puntInPolygoon(p, g.voetafdruk)) continue;
    const opp = polygoonOppervlakte(g.voetafdruk);
    if (opp < besteOpp) { beste = t.id; besteOpp = opp; }
  }
  return beste;
}

/**
 * Index (in `punten`) van de dichtste greep (soort 'greep') binnen `tolPx` schermpixels van p, of −1.
 * @param {{ p: number[], soort: string }[]} punten
 */
export function raakGreep(punten, p, schaal, tolPx = GEBAAR.tolGreepTouch) {
  if (!punten || !p) return -1;
  const tol = tolPx / (schaal > 0 ? schaal : 1);
  let beste = -1, besteAfst = Infinity;
  punten.forEach((q, i) => {
    if (q?.soort !== 'greep' || !q.p) return;
    const a = Math.hypot(q.p[0] - p[0], q.p[1] - p[1]);
    if (a <= tol && a < besteAfst) { beste = i; besteAfst = a; }
  });
  return beste;
}

/** Hoekpunten van een voorbeeldmuur (as van → naar, totale dikte) als polygoon in mm. */
export function strookPolygoon(van, naar, dikte) {
  const L = lengte(van, naar);
  if (L < 1e-9) return [];
  const nx = -(naar[1] - van[1]) / L, ny = (naar[0] - van[0]) / L, h = dikte / 2;
  return [
    [van[0] + nx * h, van[1] + ny * h], [naar[0] + nx * h, naar[1] + ny * h],
    [naar[0] - nx * h, naar[1] - ny * h], [van[0] - nx * h, van[1] - ny * h],
  ];
}
