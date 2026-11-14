// Afgeleide trapgeometrie (schemaVersie 2). Pure functies, geen DOM. Zie docs/DATAMODEL.md "Trappen".
//
// Lokaal assenstelsel van een trap: u = looprichting bij vertrek (hoek `richting`), v = links daarvan.
// draairichting "rechts" spiegelt v. `oorsprong` = midden van de voorrand van de onderste trede
// (recht/kwart/halfdraai) of het middelpunt (spiraal).
//
// Aantallen: `aantalTreden` = aantal OPTREDEN (n). In plan liggen n − 1 treden; de n-de "trede" is de vloer
// van naarNiveau. Geometrie per type (vereenvoudigd, zie DATAMODEL):
//  - recht:     rechthoek breedte × (n − 1)·aantrede.
//  - kwart:     L-vorm: vlucht 1 + hoekvierkant breedte × breedte + vlucht 2 (90° gedraaid).
//               In het hoekvierkant liggen k draaitreden (instelling trap.draaitredenPerKwart; 1 = bordes),
//               als waaier vanuit de binnenhoek. De overige n − 1 − k treden worden verdeeld over de vluchten
//               (vlucht 1 krijgt de eventuele extra trede).
//  - halfdraai: U-vorm: vlucht 1 + draaizone (2·breedte breed, breedte diep) met 2k draaitreden + vlucht 2
//               evenwijdig terug, naast vlucht 1 (geen trapoog/spil tussen de vluchten).
//  - spiraal:   cirkel met `diameter` (leeg: 2 × breedte). Treden = sectoren; hoek per trede = aantrede
//               op een looplijn op de halve straal.
// Trapgat = de voetafdruk, in de vloer van naarNiveau (vereenvoudiging: in werkelijkheid hoeft het gat enkel
// zo groot te zijn als nodig voor de loophoogte).

import { INSTELLINGEN_STANDAARD, instelling } from './instellingen.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const rond = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const CIRKEL_SEGMENTEN = 48;

function niveauVan(model, id) { return (model?.niveaus || []).find((n) => n.id === id); }

/** Hoogteverschil (mm) tussen vanNiveau en naarNiveau, of null. */
export function trapHoogteverschil(model, trap) {
  const a = niveauVan(model, trap.vanNiveau), b = niveauVan(model, trap.naarNiveau);
  if (!a || !b || !isGetal(a.peil) || !isGetal(b.peil)) return null;
  return b.peil - a.peil;
}

/**
 * Berekende maten van een trap.
 * @returns {{ hoogteverschil:number|null, aantalTreden:number, optrede:number, aantrede:number, treden:number,
 *   draaitreden:number, vluchten:number[], diameter:number|null, berekend:{aantalTreden:boolean, optrede:boolean, aantrede:boolean},
 *   fout?:string }}
 *   treden = aantal treden in plan (n − 1).
 */
export function trapMaten(model, trap, { instellingen = INSTELLINGEN_STANDAARD } = {}) {
  const H = model ? trapHoogteverschil(model, trap) : null;
  const berekend = { aantalTreden: false, optrede: false, aantrede: false };
  let n = isGetal(trap.aantalTreden) ? Math.round(trap.aantalTreden) : null;
  let optrede = isGetal(trap.optrede) ? trap.optrede : null;
  const uit = (extra) => ({ hoogteverschil: H, aantalTreden: n, optrede, aantrede, treden: n ? n - 1 : 0, draaitreden: 0, vluchten: [], diameter: null, berekend, ...extra });
  let aantrede = isGetal(trap.aantrede) ? trap.aantrede : null;
  if (aantrede == null) { aantrede = instelling(instellingen, 'trap.aantrede'); berekend.aantrede = true; }
  if (n == null) {
    const doel = optrede ?? instelling(instellingen, 'trap.doelOptrede');
    if (!isGetal(H) || H <= 0 || !isGetal(doel) || doel <= 0) return uit({ fout: 'Aantal treden kan niet berekend worden (hoogteverschil of optrede ontbreekt).' });
    n = Math.max(2, Math.round(H / doel));
    berekend.aantalTreden = true;
  }
  if (isGetal(H) && H > 0 && (optrede == null || berekend.aantalTreden)) { optrede = H / n; berekend.optrede = trap.optrede == null || berekend.aantalTreden; }
  if (optrede == null) optrede = 0;
  if (n < 2) return uit({ fout: 'Een trap heeft minstens 2 optreden.' });
  if (!isGetal(aantrede) || aantrede <= 0) return uit({ fout: 'Aantrede moet > 0 mm zijn.' });
  const treden = n - 1;
  const k = Math.max(1, Math.round(instelling(instellingen, 'trap.draaitredenPerKwart') ?? 1));
  if (trap.type === 'kwart' || trap.type === 'halfdraai') {
    const draai = trap.type === 'kwart' ? k : 2 * k;
    const rest = treden - draai;
    if (rest < 0) return uit({ draaitreden: draai, fout: `Te weinig treden (${treden}) voor ${draai} draaitreden.` });
    const c1 = Math.ceil(rest / 2);
    return uit({ draaitreden: draai, vluchten: [c1, rest - c1] });
  }
  if (trap.type === 'spiraal') {
    const D = isGetal(trap.diameter) ? trap.diameter : 2 * trap.breedte;
    return uit({ vluchten: [treden], diameter: D });
  }
  return uit({ vluchten: [treden] });
}

/** Lokale (u, v) → wereld (x, y). */
function transformator(trap) {
  const a = ((trap.richting || 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const sp = trap.draairichting === 'rechts' ? -1 : 1;
  const [ox, oy] = trap.oorsprong;
  return ([u, v]) => [rond(ox + u * c - sp * v * s), rond(oy + u * s + sp * v * c)];
}

function zonderDubbelEnCollineair(pts) {
  let p = pts.slice();
  let veranderd = true;
  while (veranderd && p.length > 3) {
    veranderd = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const kruis = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(kruis) < 1e-6 || (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6)) { p.splice(i, 1); veranderd = true; break; }
    }
  }
  return p;
}

/** Tegenwijzerzin maken (positieve oppervlakte). */
function ccw(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s < 0 ? pts.slice().reverse() : pts;
}

/** Waaier van `aantal` delen vanuit `binnen` langs het open pad `pad` (gelijke lengtes). → polygonen (lokaal). */
function waaier(binnen, pad, aantal) {
  const seg = [];
  let totaal = 0;
  for (let i = 0; i < pad.length - 1; i++) { const L = Math.hypot(pad[i + 1][0] - pad[i][0], pad[i + 1][1] - pad[i][1]); seg.push(L); totaal += L; }
  const puntOp = (s) => {
    let r = s;
    for (let i = 0; i < seg.length; i++) {
      if (r <= seg[i] + 1e-9 || i === seg.length - 1) {
        const t = seg[i] ? Math.min(1, r / seg[i]) : 0;
        return { p: [pad[i][0] + (pad[i + 1][0] - pad[i][0]) * t, pad[i][1] + (pad[i + 1][1] - pad[i][1]) * t], i };
      }
      r -= seg[i];
    }
    return { p: pad[pad.length - 1], i: seg.length - 1 };
  };
  const uit = [];
  for (let j = 0; j < aantal; j++) {
    const a = puntOp((totaal * j) / aantal), b = puntOp((totaal * (j + 1)) / aantal);
    const pts = [binnen, a.p];
    for (let i = a.i; i < b.i; i++) pts.push(pad[i + 1]); // hoekpunten van het pad tussen a en b
    pts.push(b.p);
    uit.push(zonderDubbelEnCollineair(pts));
  }
  return uit;
}

/**
 * Volledige afgeleide geometrie van een trap.
 * @returns {null | { maten, voetafdruk:number[][], looplijn:number[][], treden:Array<{nummer:number, contour:number[][], z:number}>, fout?:string }}
 *   z = bovenkant trede boven het peil van vanNiveau. null als de basisvelden ontbreken.
 */
export function trapGeometrie(model, trap, opties = {}) {
  if (!trap || !Array.isArray(trap.oorsprong) || !isGetal(trap.breedte) || trap.breedte <= 0) return null;
  const maten = trapMaten(model, trap, opties);
  if (maten.fout) return { maten, voetafdruk: null, looplijn: [], treden: [], fout: maten.fout };
  const T = transformator(trap);
  const b = trap.breedte, a = maten.aantrede, o = maten.optrede, h = b / 2;
  const treden = [];
  let nr = 0;
  const trede = (lokaal) => { nr++; treden.push({ nummer: nr, contour: ccw(lokaal.map(T)), z: rond(nr * o) }); };
  const rh = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  let voet, loop;

  if (trap.type === 'spiraal') {
    const R = maten.diameter / 2;
    const rl = R / 2;
    const dphi = a / rl; // rad per trede op de looplijn
    const sp = trap.draairichting === 'rechts' ? -1 : 1;
    const a0 = ((trap.richting || 0) * Math.PI) / 180;
    const [cx, cy] = trap.oorsprong;
    const P = (r, phi) => [rond(cx + r * Math.cos(phi)), rond(cy + r * Math.sin(phi))];
    voet = Array.from({ length: CIRKEL_SEGMENTEN }, (_, i) => P(R, (2 * Math.PI * i) / CIRKEL_SEGMENTEN));
    loop = [];
    for (let i = 0; i < maten.treden; i++) {
      const f0 = a0 + sp * dphi * i, f1 = a0 + sp * dphi * (i + 1);
      const stappen = Math.max(2, Math.ceil(Math.abs(f1 - f0) / (Math.PI / 24)));
      const boog = Array.from({ length: stappen + 1 }, (_, j) => P(R, f0 + ((f1 - f0) * j) / stappen));
      nr++;
      treden.push({ nummer: nr, contour: ccw([[cx, cy], ...boog]), z: rond(nr * o) });
      loop.push(P(rl, f0));
    }
    loop.push(P(rl, a0 + sp * dphi * maten.treden));
    return { maten, voetafdruk: ccw(voet), looplijn: loop, treden };
  }

  if (trap.type === 'recht') {
    const L = maten.treden * a;
    for (let i = 0; i < maten.treden; i++) trede(rh(i * a, -h, (i + 1) * a, h));
    voet = rh(0, -h, L, h);
    loop = [[0, 0], [L, 0]];
  } else if (trap.type === 'kwart') {
    const [c1, c2] = maten.vluchten;
    const L1 = c1 * a, L2 = c2 * a;
    for (let i = 0; i < c1; i++) trede(rh(i * a, -h, (i + 1) * a, h));
    for (const w of waaier([L1, h], [[L1, -h], [L1 + b, -h], [L1 + b, h]], maten.draaitreden)) trede(w);
    for (let j = 0; j < c2; j++) trede(rh(L1, h + j * a, L1 + b, h + (j + 1) * a));
    voet = [[0, -h], [L1 + b, -h], [L1 + b, h + L2], [L1, h + L2], [L1, h], [0, h]];
    loop = [[0, 0], [L1 + h, 0], [L1 + h, h + L2]];
  } else if (trap.type === 'halfdraai') {
    const [c1, c2] = maten.vluchten;
    const L1 = c1 * a, L2 = c2 * a;
    for (let i = 0; i < c1; i++) trede(rh(i * a, -h, (i + 1) * a, h));
    for (const w of waaier([L1, h], [[L1, -h], [L1 + b, -h], [L1 + b, 3 * h], [L1, 3 * h]], maten.draaitreden)) trede(w);
    for (let j = 0; j < c2; j++) trede(rh(L1 - (j + 1) * a, h, L1 - j * a, 3 * h));
    voet = [[0, -h], [L1 + b, -h], [L1 + b, 3 * h], [L1 - L2, 3 * h], [L1 - L2, h], [0, h]];
    loop = [[0, 0], [L1 + h, 0], [L1 + h, b], [L1 - L2, b]];
  } else return null;

  return { maten, voetafdruk: ccw(zonderDubbelEnCollineair(voet.map(T))), looplijn: loop.map(T), treden };
}

/**
 * Voetafdruk (polygoon in plan, tegenwijzerzin) van een trap, of null.
 * `model` is nodig als aantalTreden niet op de trap staat (dan wordt het berekend uit het hoogteverschil).
 */
export function trapVoetafdruk(trap, { model = null, instellingen } = {}) {
  const g = trapGeometrie(model, trap, { instellingen });
  return g?.voetafdruk ?? null;
}

/** Trapgat in de vloer van naarNiveau: { niveau, contour } of null. Vereenvoudiging: gat = voetafdruk. */
export function trapgat(model, trap, opties = {}) {
  const contour = trapVoetafdruk(trap, { model, ...opties });
  return contour ? { niveau: trap.naarNiveau, contour } : null;
}
