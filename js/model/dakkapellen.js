// Dakkapellen: afgeleide geometrie (puur, geen DOM, geen Three.js). Zie docs/DATAMODEL.md "Dakkapellen".
//
// Een dakkapel staat in één DAKVLAK van een hellend dak (`dak` + `zijde`). Lokaal assenstelsel van dat dakvlak:
//   u = langs de nok (x bij nokrichting x, y bij nokrichting y);
//   d = horizontale afstand vanaf de GOOT (rand van de dakcontour aan `zijde`) naar binnen, richting nok.
// h(d) = hoogte van de onderkant van het hoofddak boven het rustvlak (dakHoogteIn). Ze moet vanaf de goot stijgen tot de nok;
// de nok wordt numeriek gezocht (zo werkt het ook voor dakvormen waar de nok niet in het midden ligt).
//
// Velden → geometrie:
//   positieX  = u van het MIDDEN; breedte = buitenmaat langs u (zijwangen inbegrepen) ⇒ u0 = positieX − breedte/2 … u1.
//   positieZ  = onderkant van het voorvlak boven het VLOERPEIL van het niveau in het dak (zoldervloer; zonder zolder: het rustvlak).
//               Het voorvlak (buitenvlak) staat waar de onderkant van het hoofddak die hoogte heeft: h(dVoor) = positieZ + peil − rust.
//   hoogte    = voorvlak van die onderkant tot de onderkant van het (platte) dakje ⇒ plafond = peil + positieZ + hoogte.
//   diepte    = horizontaal vanaf het voorvlak; leeg ⇒ tot waar het dakje het hoofddak snijdt (h(dAchter) = plafond − rust).
//               Korter ⇒ er komt een achterwand. Langer ⇒ fout (het dakje zou onder het hoofddak in de zolder hangen).
//   zijwangDikte (voorvlak, zijwangen, achterwand) en dakdikte: leeg ⇒ werkwaarde uit de instellingen (geen norm).
//   raam      = { breedte, hoogte, borstwering? } gecentreerd in het voorvlak; borstwering = onderkant boven de zoldervloer
//               (zoals bij openingen), leeg ⇒ onderaan het voorvlak (= positieZ).
// Vrije hoogte: binnen de BINNENvoetafdruk (u0 + wang … u1 − wang, dVoor + wang … dAchter (− wang bij een achterwand)) is de
// bovengrens van dat dak max(hoofddak, plafond). Zie dakkapelVerhoging() (gebruikt door hoogte.js en muurprofiel.js).

import { begrenzing, dakHoogteIn, dakNokHoogte, niveauBovenkant, muurSegmenten } from './geometry.js';
import { INSTELLINGEN_STANDAARD, instelling } from './instellingen.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const telt = (x) => x && x.status !== 'afbraak';
const naam = (k) => (k?.id ? `Dakkapel ${k.id}` : 'Dakkapel');

/** Zijden die bij een nokrichting horen. */
export const ZIJDEN_PER_NOK = Object.freeze({ x: ['voor', 'achter'], y: ['links', 'rechts'] });

/**
 * Lokaal assenstelsel van een dakvlak. → { as, zin, goot, D, ulo, uhi, xy(u, d), h(u, d) } of { fout }.
 * as = horizontale as van d ('y' bij nokrichting x); zin = +1 als d naar hogere coördinaten loopt.
 */
export function dakvlakAssen(dak, zijde) {
  if (!dak || !Array.isArray(dak.contour) || dak.contour.length < 3) return { fout: 'Dak heeft geen contour.' };
  if (dak.type === 'plat' || !isGetal(dak.helling) || dak.helling <= 0) return { fout: `Dak ${dak.id} is plat; een dakkapel hoort in een hellend dak.` };
  const r = dak.nokrichting || 'x';
  if (!ZIJDEN_PER_NOK[r].includes(zijde)) return { fout: `Zijde "${zijde}" past niet bij nokrichting ${r} van dak ${dak.id}; kies ${ZIJDEN_PER_NOK[r].join(' of ')}.` };
  const b = begrenzing(dak.contour);
  const asD = r === 'x' ? 'y' : 'x';
  const [vlo, vhi, ulo, uhi] = r === 'x' ? [b.minY, b.maxY, b.minX, b.maxX] : [b.minX, b.maxX, b.minY, b.maxY];
  const zin = zijde === 'voor' || zijde === 'links' ? 1 : -1;
  const goot = zin > 0 ? vlo : vhi;
  const xy = (u, d) => { const v = goot + zin * d; return asD === 'y' ? [u, v] : [v, u]; };
  const h = (u, d) => { const [x, y] = xy(u, d); return dakHoogteIn(dak, x, y); };
  return { as: asD, zin, goot, D: vhi - vlo, ulo, uhi, xy, h };
}

/** Plaats van de nok (d) en zijn hoogte op lijn u: grootste h op [0, D] (bemonsteren + gulden snede). */
function zoekNok(A, u) {
  const N = 400;
  let best = 0, hb = -Infinity;
  for (let i = 0; i <= N; i++) { const d = (A.D * i) / N; const hv = A.h(u, d); if (hv > hb + 1e-9) { hb = hv; best = i; } }
  let a = (A.D * Math.max(0, best - 1)) / N, b = (A.D * Math.min(N, best + 1)) / N;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 60 && b - a > 1e-4; k++) {
    const c = b - g * (b - a), e = a + g * (b - a);
    if (A.h(u, c) >= A.h(u, e)) b = e; else a = c;
  }
  const d = (a + b) / 2;
  return { d, h: Math.max(hb, A.h(u, d)) };
}

/** d op [0, dMax] waar h(u, d) = doel (h stijgend). */
function zoekD(A, u, doel, dMax) {
  let a = 0, b = dMax;
  for (let k = 0; k < 80 && b - a > 1e-5; k++) { const m = (a + b) / 2; if (A.h(u, m) < doel) a = m; else b = m; }
  return (a + b) / 2;
}

/**
 * Niveau "in" het dak: laagste niveau met peil tussen het rustvlak (−1 mm) en de nok. positieZ is relatief t.o.v. zijn peil.
 * → { niveau: id|null, peil, rust }
 */
export function dakkapelReferentie(model, dak) {
  const rust = niveauBovenkant(model, dak.niveau);
  const nok = rust + dakNokHoogte(dak);
  const kand = (model.niveaus || []).filter((n) => isGetal(n.peil) && n.peil >= rust - 1 && n.peil < nok - 1).sort((a, b) => a.peil - b.peil);
  return kand.length ? { niveau: kand[0].id, peil: kand[0].peil, rust } : { niveau: null, peil: rust, rust };
}

/** Niveau-id waarop de dakkapel in de plattegrond getoond wordt (zolder; zonder zolder het niveau van het dak). */
export function dakkapelNiveau(model, k) {
  const dak = (model.daken || []).find((d) => d.id === k?.dak);
  if (!dak) return null;
  return dakkapelReferentie(model, dak).niveau ?? dak.niveau;
}

/** Dikte van wangen en dakje (eigen veld of werkwaarde). */
export function dakkapelDiktes(k, opties = {}) {
  const inst = opties.instellingen || INSTELLINGEN_STANDAARD;
  return {
    wang: isGetal(k.zijwangDikte) ? k.zijwangDikte : (instelling(inst, 'dakkapel.zijwangDikte') ?? 120),
    dak: isGetal(k.dakdikte) ? k.dakdikte : (instelling(inst, 'dakkapel.dakdikte') ?? 200),
  };
}

/**
 * Afgeleide geometrie van een dakkapel. → object met `fout` (Nederlandse melding) als de dakkapel niet in het dakvlak past.
 * Absolute z (mm). Plan: [x, y]. Velden:
 *   dak, zijde, as, zin, referentie { niveau, peil, rust }, u0, u1, uMidden, dVoor, dAchter, diepte, diepteAfgeleid, achterwand,
 *   zOnder (onderkant voorvlak), plafond (onderkant dakje), zTop, wang, dakdikte,
 *   voetafdruk (plan, buitenmaat), binnen (plan, zone met verhoogd plafond), uitsparing { minX, maxX, minY, maxY },
 *   raam { u0, u1, z0, z1, breedte, hoogte, borstwering } | null, voorvlakM2, raamM2, volume (mm³, toename t.o.v. het hoofddak)
 */
export function dakkapelGeometrie(model, k, opties = {}) {
  const dak = (model.daken || []).find((d) => d.id === k?.dak);
  if (!dak) return { fout: `Dak "${k?.dak}" niet gevonden.` };
  if (k.type != null && k.type !== 'plat') return { fout: `Dakkapeltype "${k.type}" wordt (nog) niet ondersteund; enkel plat.` };
  for (const v of ['positieX', 'positieZ', 'breedte', 'hoogte']) if (!isGetal(k[v])) return { fout: `${v} moet een getal (mm) zijn.` };
  if (k.breedte <= 0 || k.hoogte <= 0) return { fout: 'Breedte en hoogte moeten > 0 mm zijn.' };
  const A = dakvlakAssen(dak, k.zijde);
  if (A.fout) return { fout: A.fout };
  const { wang, dak: dd } = dakkapelDiktes(k, opties);
  if (!(wang > 0) || !(dd > 0)) return { fout: 'zijwangDikte en dakdikte moeten > 0 mm zijn.' };
  if (k.breedte <= 2 * wang + 1) return { fout: `Breedte ${k.breedte} mm is te smal voor twee zijwangen van ${wang} mm.` };
  const u0 = k.positieX - k.breedte / 2, u1 = k.positieX + k.breedte / 2, um = k.positieX;
  if (u0 < A.ulo - 0.5 || u1 > A.uhi + 0.5)
    return { fout: `${naam(k)} valt buiten het dakvlak langs de nok (${Math.round(u0)}…${Math.round(u1)} ligt niet binnen ${Math.round(A.ulo)}…${Math.round(A.uhi)}).` };
  const ref = dakkapelReferentie(model, dak);
  const nok = zoekNok(A, um);
  const h0 = A.h(um, 0);
  if (!(A.h(um, Math.min(50, nok.d / 2 || 1)) > h0 + 1e-6)) return { fout: `Het dakvlak aan zijde ${k.zijde} van dak ${dak.id} stijgt niet vanaf de goot; kies de andere zijde.` };
  const onder = k.positieZ + ref.peil - ref.rust; // h van de onderkant van het voorvlak
  if (onder < h0 - 0.5) return { fout: `Positie z ${k.positieZ} mm ligt onder de goot (minimum ${Math.round(h0 + ref.rust - ref.peil)} mm).` };
  const boven = onder + k.hoogte;
  if (boven > nok.h + 0.5)
    return { fout: `Dakkapel steekt boven de nok uit: onderkant dakje op ${Math.round(boven + ref.rust - ref.peil)} mm boven de zoldervloer, nok op ${Math.round(nok.h + ref.rust - ref.peil)} mm (max. hoogte bij deze positie z: ${Math.max(0, Math.floor(nok.h - onder + 1e-3))} mm).` };
  const dVoor = zoekD(A, um, onder, nok.d);
  const dSnij = zoekD(A, um, boven, nok.d);
  const diepteAfgeleid = dSnij - dVoor;
  let diepte = diepteAfgeleid, achterwand = false;
  if (isGetal(k.diepte)) {
    if (k.diepte > diepteAfgeleid + 1) return { fout: `Diepte ${k.diepte} mm is groter dan tot waar het dakje het hoofddak snijdt (${Math.round(diepteAfgeleid)} mm).` };
    if (k.diepte <= 2 * wang + 1) return { fout: `Diepte ${k.diepte} mm is te klein voor voorvlak en achterwand (${wang} mm).` };
    if (k.diepte < diepteAfgeleid - 1) { diepte = k.diepte; achterwand = true; }
  }
  const dAchter = dVoor + diepte;
  // het dakvlak moet over de hele breedte hetzelfde zijn (geen hoekkeper van een schilddak, geen rand)
  for (const u of [u0, u1]) for (const d of [dVoor, dAchter]) {
    if (Math.abs(A.h(u, d) - A.h(um, d)) > 1) return { fout: `${naam(k)} raakt een hoekkeper of de rand van het dakvlak; verschuif of versmal ze.` };
  }
  // raam
  let raam = null;
  if (k.raam != null) {
    const r = k.raam;
    if (!r || typeof r !== 'object' || !isGetal(r.breedte) || !isGetal(r.hoogte) || r.breedte <= 0 || r.hoogte <= 0) return { fout: 'raam moet { breedte, hoogte, borstwering? } met breedte en hoogte > 0 mm zijn.' };
    const bw = isGetal(r.borstwering) ? r.borstwering : k.positieZ;
    if (r.breedte > k.breedte - 2 * wang + 0.5) return { fout: `Raam (${r.breedte} mm) is breder dan het voorvlak tussen de zijwangen (${k.breedte - 2 * wang} mm).` };
    if (bw < k.positieZ - 0.5) return { fout: `Borstwering van het raam (${bw} mm) ligt onder de onderkant van het voorvlak (positie z ${k.positieZ} mm).` };
    if (bw + r.hoogte > k.positieZ + k.hoogte + 0.5) return { fout: `Raam steekt boven het voorvlak uit (borstwering ${bw} + hoogte ${r.hoogte} > ${k.positieZ + k.hoogte} mm).` };
    raam = { u0: um - r.breedte / 2, u1: um + r.breedte / 2, z0: ref.peil + bw, z1: ref.peil + bw + r.hoogte, breedte: r.breedte, hoogte: r.hoogte, borstwering: bw };
  }
  const zOnder = ref.rust + onder, plafond = ref.rust + boven;
  const rechthoek = (ua, ub, da, db) => [A.xy(ua, da), A.xy(ub, da), A.xy(ub, db), A.xy(ua, db)];
  const tegenwijzer = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s < 0 ? p.reverse() : p; };
  const voetafdruk = tegenwijzer(rechthoek(u0, u1, dVoor, dAchter));
  const binnen = tegenwijzer(rechthoek(u0 + wang, u1 - wang, dVoor + wang, dAchter - (achterwand ? wang : 0)));
  const bv = begrenzing(voetafdruk);
  // volume tussen de onderkant van het hoofddak en het plafond van de dakkapel (buitenmaat, trapeziumregel)
  const N = 200;
  let opp = 0;
  for (let i = 0; i < N; i++) {
    const da = dVoor + (diepte * i) / N, db = dVoor + (diepte * (i + 1)) / N;
    opp += ((Math.max(0, boven - A.h(um, da)) + Math.max(0, boven - A.h(um, db))) / 2) * (db - da);
  }
  return {
    dak, zijde: k.zijde, as: A.as, zin: A.zin, assen: A, referentie: ref,
    u0, u1, uMidden: um, dVoor, dAchter, diepte, diepteAfgeleid, achterwand,
    zOnder, plafond, zTop: plafond + dd, wang, dakdikte: dd,
    voetafdruk, binnen, uitsparing: { minX: bv.minX, maxX: bv.maxX, minY: bv.minY, maxY: bv.maxY },
    raam,
    voorvlakM2: (k.breedte * k.hoogte) / 1e6,
    raamM2: raam ? (raam.breedte * raam.hoogte) / 1e6 : 0,
    volume: opp * k.breedte,
  };
}

/**
 * Evaluator voor de vrije hoogte: (dak, [x, y], hDak) → hoogte boven het rustvlak van dat dak, rekening houdend met de
 * dakkapellen (status ≠ afbraak) in dat dak: binnen hun binnenvoetafdruk max(hDak, plafond − rust).
 */
export function dakkapelVerhoging(model, opties = {}) {
  const perDak = new Map();
  for (const k of model?.dakkapellen || []) {
    if (!telt(k)) continue;
    const g = dakkapelGeometrie(model, k, opties);
    if (g.fout) continue;
    const b = begrenzing(g.binnen);
    if (!perDak.has(k.dak)) perDak.set(k.dak, []);
    perDak.get(k.dak).push({ b, h: g.plafond - g.referentie.rust });
  }
  if (!perDak.size) return (dak, p, hDak) => hDak;
  return (dak, [x, y], hDak) => {
    const lijst = perDak.get(dak.id);
    if (!lijst) return hDak;
    let h = hDak;
    for (const { b, h: hk } of lijst) if (x >= b.minX - 1e-6 && x <= b.maxX + 1e-6 && y >= b.minY - 1e-6 && y <= b.maxY + 1e-6) h = Math.max(h, hk);
    return h;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weergave (3D): hoofddak met uitsparingen en de volumes van de dakkapel. Pure geometrie, getest.
// ─────────────────────────────────────────────────────────────────────────────

/** Convexe 3D-polygoon [[x, y, h]] afknippen op het halfvlak waar f(p) ≥ 0 (f lineair in x, y). */
function knip(poly, f) {
  const uit = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) uit.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      uit.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return uit;
}

const oppervlak = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };

/**
 * Convex dakvlak [[x, y, h]] min een assen-evenwijdige rechthoek (uitsparing) → tot 4 convexe stukken
 * (links, rechts, ervoor, erachter). Ligt de rechthoek er niet in, dan het vlak zelf.
 */
export function vlakMinRechthoek(vlak, r) {
  const b = begrenzing(vlak);
  if (r.maxX <= b.minX || r.minX >= b.maxX || r.maxY <= b.minY || r.minY >= b.maxY) return [vlak];
  const stukken = [
    knip(vlak, (p) => r.minX - p[0]),
    knip(vlak, (p) => p[0] - r.maxX),
    knip(knip(knip(vlak, (p) => p[0] - r.minX), (p) => r.maxX - p[0]), (p) => r.minY - p[1]),
    knip(knip(knip(vlak, (p) => p[0] - r.minX), (p) => r.maxX - p[0]), (p) => p[1] - r.maxY),
  ];
  return stukken.filter((s) => s.length >= 3 && oppervlak(s) > 1);
}

/** dakVlakken (zie geometry.js) met de uitsparingen van de dakkapellen (status ≠ afbraak) in dit dak. */
export function vlakkenMetUitsparingen(model, dak, vlakken, opties = {}) {
  const gaten = (model?.dakkapellen || []).filter((k) => telt(k) && k.dak === dak.id)
    .map((k) => dakkapelGeometrie(model, k, opties)).filter((g) => !g.fout).map((g) => g.uitsparing);
  let uit = vlakken;
  for (const r of gaten) uit = uit.flatMap((v) => vlakMinRechthoek(v, r));
  return uit;
}

/**
 * Volumes van een dakkapel als prisma's: { soort: 'wand'|'dak'|'kader'|'glas', punten: [[x, y, z]…] (absolute z), verschuiving }.
 * Voorvlak (met raamopening), twee zijwangen, dakje, eventueel achterwand, raamkader en glas.
 */
export function dakkapelDelen(model, k, { kader = 60, ...opties } = {}) {
  const g = dakkapelGeometrie(model, k, opties);
  if (g.fout) return [];
  const A = g.assen;
  const P = (u, d, z) => [...A.xy(u, d), z];
  const inwaarts = (s) => (A.as === 'y' ? [0, A.zin * s, 0] : [A.zin * s, 0, 0]);
  const langs = (s) => (A.as === 'y' ? [s, 0, 0] : [0, s, 0]);
  const delen = [];
  const { u0, u1, dVoor, dAchter, zOnder, plafond, wang } = g;
  const hA = g.referentie.rust + A.h(g.uMidden, dAchter);
  // voorvlak met opening voor het raam
  const gaten = g.raam ? [{ positie: g.raam.u0 - u0, breedte: g.raam.breedte, borstwering: g.raam.z0 - zOnder, hoogte: g.raam.hoogte }] : [];
  for (const s of muurSegmenten(0, u1 - u0, plafond - zOnder, gaten))
    delen.push({ soort: 'wand', punten: [P(u0 + s.t0, dVoor, zOnder + s.z0), P(u0 + s.t1, dVoor, zOnder + s.z0), P(u0 + s.t1, dVoor, zOnder + s.z1), P(u0 + s.t0, dVoor, zOnder + s.z1)], verschuiving: inwaarts(wang) });
  // zijwangen: onderrand volgt de onderkant van het hoofddak
  const wangVlak = (u) => (g.achterwand
    ? [P(u, dVoor, zOnder), P(u, dAchter, hA), P(u, dAchter, plafond), P(u, dVoor, plafond)]
    : [P(u, dVoor, zOnder), P(u, dAchter, plafond), P(u, dVoor, plafond)]);
  delen.push({ soort: 'wand', punten: wangVlak(u0), verschuiving: langs(wang) });
  delen.push({ soort: 'wand', punten: wangVlak(u1), verschuiving: langs(-wang) });
  if (g.achterwand)
    delen.push({ soort: 'wand', punten: [P(u0, dAchter, hA), P(u1, dAchter, hA), P(u1, dAchter, plafond), P(u0, dAchter, plafond)], verschuiving: inwaarts(-wang) });
  // dakje
  delen.push({ soort: 'dak', punten: [P(u0, dVoor, g.zTop), P(u1, dVoor, g.zTop), P(u1, dAchter, g.zTop), P(u0, dAchter, g.zTop)], verschuiving: [0, 0, -g.dakdikte] });
  // raam: kader + glas, in het midden van het voorvlak
  if (g.raam) {
    const { u0: a, u1: b, z0, z1 } = g.raam;
    const dk = Math.min(90, wang * 0.75), dm = dVoor + (wang - dk) / 2;
    const blok = (ua, ub, za, zb, soort, dikte = dk, d = dm) => delen.push({ soort, punten: [P(ua, d, za), P(ub, d, za), P(ub, d, zb), P(ua, d, zb)], verschuiving: inwaarts(dikte) });
    const kd = Math.min(kader, (b - a) / 4, (z1 - z0) / 4);
    blok(a, b, z0, z0 + kd, 'kader');
    blok(a, b, z1 - kd, z1, 'kader');
    blok(a, a + kd, z0 + kd, z1 - kd, 'kader');
    blok(b - kd, b, z0 + kd, z1 - kd, 'kader');
    blok(a + kd, b - kd, z0 + kd, z1 - kd, 'glas', 12, dVoor + wang / 2 - 6);
  }
  return delen;
}
