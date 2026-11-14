// Kerncijfers van een variant. Pure functies op het model (geen DOM). Definities: docs/FASE3.md.
// Invoer in mm; uitvoer in m², m³ en stuks, NIET afgerond (afronden pas bij weergave).
// Elementen met status `afbraak` tellen niet mee voor de toestand na verbouwing (tenzij anders vermeld).

import {
  polygoonOppervlakte, polygoonOffset, begrenzing, muurLengte, muurHoogte, dakVolume,
} from '../model/geometry.js';
import { buitenMuren, buitenContour } from '../model/bewerkingen.js';

const M2 = 1e6; // mm² per m²
const M3 = 1e9; // mm³ per m³
const STATUSSEN = ['bestaand', 'nieuw', 'afbraak'];

const telt = (x) => x.status !== 'afbraak';
const som = (lijst, f) => lijst.reduce((s, x) => s + f(x), 0);
const perStatus = (maak) => Object.fromEntries(STATUSSEN.map((s) => [s, maak()]));

/** Oppervlakte van een opening in m² (breedte × hoogte). */
export const openingM2 = (o) => (o.breedte * o.hoogte) / M2;

/** Is het dak plat voor de kerncijfers (type plat of helling 0)? */
export const isPlatDak = (dak) => dak.type === 'plat' || !dak.helling;

/**
 * Dakoppervlak (m²) van één dak: plat = grondvlak incl. overstek (contour evenwijdig verschoven);
 * hellend = rechthoekige begrenzing incl. overstek / cos(helling).
 */
export function dakOppervlak(dak) {
  const o = dak.overstek || 0;
  if (isPlatDak(dak)) return polygoonOppervlakte(polygoonOffset(dak.contour, o)) / M2;
  const b = begrenzing(dak.contour);
  const grond = (b.breedte + 2 * o) * (b.diepte + 2 * o);
  return grond / Math.cos((dak.helling * Math.PI) / 180) / M2;
}

/** Bruto m² van een niveau: vloeren (status ≠ afbraak), anders de buitencontour van de muren. */
export function brutoNiveau(model, niveauId) {
  const vloeren = (model.vloeren || []).filter((v) => v.niveau === niveauId && telt(v));
  if (vloeren.length) return { m2: som(vloeren, (v) => polygoonOppervlakte(v.contour)) / M2, bron: 'vloeren' };
  const c = buitenContour(model, niveauId);
  if (c) return { m2: polygoonOppervlakte(c) / M2, bron: 'buitencontour' };
  return { m2: 0, bron: 'geen' };
}

/**
 * Alle kerncijfers van een ontwerp.
 * @returns {{
 *   niveaus: Array<{ id, naam, peil, hoogte, bruto, brutoBron: 'vloeren'|'buitencontour'|'geen', netto, volume }>,
 *   bruto: number, netto: number,
 *   volume: { niveaus: number, daken: number, totaal: number },
 *   muren: { nieuwBuiten: number, nieuwBinnen: number, afbraak: number, doorbraken: number },
 *   ramen: { bestaand: {aantal, m2}, nieuw: {aantal, m2}, afbraak: {aantal, m2} },
 *   deuren: { bestaand: number, nieuw: number, afbraak: number },
 *   dak: { platNieuw, platBestaand, hellendNieuw, hellendBestaand, nieuw, bestaand, totaal,
 *          perDak: Array<{ id, type, status, plat: boolean, m2 }> },
 *   vloerNieuw: number,
 * }}
 */
export function kerncijfers(model) {
  const niveausGesorteerd = [...(model.niveaus || [])].sort((a, b) => a.peil - b.peil);
  const muren = model.muren || [];
  const openingen = model.openingen || [];
  const muurVan = new Map(muren.map((m) => [m.id, m]));

  // per niveau: bruto, netto, volume
  const niveaus = niveausGesorteerd.map((n) => {
    const b = brutoNiveau(model, n.id);
    const netto = som((model.ruimtes || []).filter((r) => r.niveau === n.id), (r) => polygoonOppervlakte(r.contour)) / M2;
    return { id: n.id, naam: n.naam, peil: n.peil, hoogte: n.hoogte, bruto: b.m2, brutoBron: b.bron, netto, volume: (b.m2 * n.hoogte) / 1000 };
  });

  const dakenTellen = (model.daken || []).filter(telt);
  const volumeDaken = som(dakenTellen, (d) => dakVolume(d)) / M3;
  const volumeNiveaus = som(niveaus, (n) => n.volume);

  // muren
  const openingenVan = new Map();
  for (const o of openingen) {
    if (!openingenVan.has(o.muur)) openingenVan.set(o.muur, []);
    openingenVan.get(o.muur).push(o);
  }
  const muurBruto = (m) => (muurLengte(m) * muurHoogte(model, m)) / M2;
  const nieuweMuren = muren.filter((m) => m.status === 'nieuw');
  const buiten = new Set();
  for (const nv of new Set(nieuweMuren.map((m) => m.niveau))) for (const id of buitenMuren(model, nv)) buiten.add(id);
  let nieuwBuiten = 0, nieuwBinnen = 0;
  for (const m of nieuweMuren) {
    // openingen in een nieuwe muur: afbraak-openingen zijn er niet (meer), die tellen niet als gat
    const gaten = som((openingenVan.get(m.id) || []).filter(telt), openingM2);
    const netto = Math.max(0, muurBruto(m) - gaten);
    if (buiten.has(m.id)) nieuwBuiten += netto; else nieuwBinnen += netto;
  }
  const afbraak = som(muren.filter((m) => m.status === 'afbraak'), muurBruto);
  const doorbraken = som(openingen.filter((o) => o.status === 'nieuw' && muurVan.get(o.muur)?.status === 'bestaand'), openingM2);

  // ramen en deuren per status (status van de opening zelf)
  const ramen = perStatus(() => ({ aantal: 0, m2: 0 }));
  const deuren = perStatus(() => 0);
  for (const o of openingen) {
    if (!STATUSSEN.includes(o.status)) continue;
    if (o.type === 'raam') { ramen[o.status].aantal++; ramen[o.status].m2 += openingM2(o); }
    else if (o.type === 'deur') deuren[o.status]++;
  }

  // daken
  const perDak = dakenTellen.map((d) => ({ id: d.id, type: d.type, status: d.status, plat: isPlatDak(d), m2: dakOppervlak(d) }));
  const dakSom = (plat, status) => som(perDak.filter((d) => d.plat === plat && d.status === status), (d) => d.m2);
  const dak = {
    platNieuw: dakSom(true, 'nieuw'), platBestaand: dakSom(true, 'bestaand'),
    hellendNieuw: dakSom(false, 'nieuw'), hellendBestaand: dakSom(false, 'bestaand'),
    perDak,
  };
  dak.nieuw = dak.platNieuw + dak.hellendNieuw;
  dak.bestaand = dak.platBestaand + dak.hellendBestaand;
  dak.totaal = dak.nieuw + dak.bestaand;

  return {
    niveaus,
    bruto: som(niveaus, (n) => n.bruto),
    netto: som(niveaus, (n) => n.netto),
    volume: { niveaus: volumeNiveaus, daken: volumeDaken, totaal: volumeNiveaus + volumeDaken },
    muren: { nieuwBuiten, nieuwBinnen, afbraak, doorbraken },
    ramen,
    deuren,
    dak,
    vloerNieuw: som((model.vloeren || []).filter((v) => v.status === 'nieuw'), (v) => polygoonOppervlakte(v.contour)) / M2,
  };
}
