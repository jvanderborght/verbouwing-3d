// Vergelijkingstabel, getalnotatie (nl-BE) en CSV-export. Pure functies (geen DOM).

import { DISCLAIMER, btwTekst } from './kosten.js';

// ---------------------------------------------------------------- getalnotatie

/** Afronden zonder "-0". */
function afgerond(v, dec) {
  const f = 10 ** dec;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) || Math.abs(r) < 1 / (2 * f) ? 0 : r;
}

/** Getal in nl-BE-notatie (komma als decimaalteken, punt voor duizendtallen). */
export function fmtGetal(v, dec = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return afgerond(v, dec).toLocaleString('nl-BE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** m² met 2 decimalen, m³ met 1 decimaal (docs/FASE3.md). */
export const fmtM2 = (v) => (v == null ? '—' : `${fmtGetal(v, 2)} m²`);
export const fmtM3 = (v) => (v == null ? '—' : `${fmtGetal(v, 1)} m³`);

/** Bedrag, afgerond op de euro (indicatief). */
export function fmtBedrag(v, valuta = 'EUR') {
  if (v == null || !Number.isFinite(v)) return '—';
  try { return afgerond(v, 0).toLocaleString('nl-BE', { style: 'currency', currency: valuta, minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  catch { return `${fmtGetal(v, 0)} ${valuta}`; }
}

/** Eenheidsprijs met 2 decimalen, bv. "€ 85,00/m²". */
export function fmtEenheidsprijs(prijs, eenheid, valuta = 'EUR') {
  if (prijs == null) return '—';
  let t;
  try { t = prijs.toLocaleString('nl-BE', { style: 'currency', currency: valuta, minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { t = `${fmtGetal(prijs, 2)} ${valuta}`; }
  return `${t}/${eenheid}`;
}

/** Waarde volgens de eenheid van een rij. */
export function fmtWaarde(v, rij) {
  if (v == null) return '—';
  if (rij.soort === 'bedrag') return fmtBedrag(v, rij.valuta);
  return `${fmtGetal(v, rij.decimalen)} ${rij.eenheid}`;
}

/** Verschil met teken (+ / −), "0" bij gelijk; null ⇒ "—". */
export function fmtDelta(d, rij) {
  if (d == null) return '—';
  const r = afgerond(d, rij.decimalen);
  if (r === 0) return '=';
  const abs = rij.soort === 'bedrag' ? fmtBedrag(Math.abs(r), rij.valuta) : `${fmtGetal(Math.abs(r), rij.decimalen)} ${rij.eenheid}`;
  return `${r > 0 ? '+' : '−'}${abs}`;
}

// ---------------------------------------------------------------- tabel

const POST_LABEL = {
  muur_nieuw_buiten: 'Nieuwe buitenmuur', muur_nieuw_binnen: 'Nieuwe binnenmuur', muur_afbraak: 'Afbraak muur + doorbraken',
  raam_nieuw: 'Nieuwe ramen', deur_nieuw: 'Nieuwe deuren', vloer_nieuw: 'Nieuwe vloer', dak_plat_nieuw: 'Nieuw plat dak',
  dak_hellend_nieuw: 'Nieuw hellend dak', afwerking_nieuw_vloeroppervlak: 'Afwerking nieuw vloeroppervlak',
};

/**
 * Rijen van de vergelijkingstabel.
 * @param {Array<{ naam: string, kerncijfers: object, raming: object }>} varianten  eerste = referentie
 * @returns {Array<{ sleutel, groep, label, eenheid, decimalen, soort: 'getal'|'aantal'|'bedrag', valuta?,
 *                   kleur: boolean, nadruk?: boolean, waarden: (number|null)[], deltas: (number|null)[], minstens?: boolean[] }>}
 *   kleur = true ⇒ Δ positief groen / negatief rood (meer oppervlakte/volume/licht). deltas[0] = null (referentie).
 */
export function vergelijkingsRijen(varianten) {
  const rijen = [];
  const rij = (r, f) => {
    const waarden = varianten.map((v) => f(v));
    rijen.push({ decimalen: 2, soort: 'getal', kleur: false, ...r, waarden });
  };

  // niveaus: unie op id, gesorteerd op peil (eerste voorkomen)
  const niveauMap = new Map();
  for (const v of varianten) for (const n of v.kerncijfers.niveaus) if (!niveauMap.has(n.id)) niveauMap.set(n.id, n);
  const niveaus = [...niveauMap.values()].sort((a, b) => a.peil - b.peil);
  const niv = (v, id) => v.kerncijfers.niveaus.find((n) => n.id === id);

  for (const n of niveaus) rij({ sleutel: `bruto-${n.id}`, groep: 'Oppervlakte', label: `Bruto · ${n.naam}`, eenheid: 'm²', kleur: true }, (v) => niv(v, n.id)?.bruto ?? null);
  rij({ sleutel: 'bruto', groep: 'Oppervlakte', label: 'Bruto totaal', eenheid: 'm²', kleur: true, nadruk: true }, (v) => v.kerncijfers.bruto);
  for (const n of niveaus) rij({ sleutel: `netto-${n.id}`, groep: 'Oppervlakte', label: `Netto · ${n.naam}`, eenheid: 'm²', kleur: true }, (v) => niv(v, n.id)?.netto ?? null);
  rij({ sleutel: 'netto', groep: 'Oppervlakte', label: 'Netto totaal', eenheid: 'm²', kleur: true, nadruk: true }, (v) => v.kerncijfers.netto);

  rij({ sleutel: 'volume', groep: 'Volume', label: 'Bruto volume', eenheid: 'm³', decimalen: 1, kleur: true, nadruk: true }, (v) => v.kerncijfers.volume.totaal);
  rij({ sleutel: 'volume-daken', groep: 'Volume', label: 'waarvan dakvolume (niet bij een zolder)', eenheid: 'm³', decimalen: 1 }, (v) => v.kerncijfers.volume.daken);

  rij({ sleutel: 'muur-nieuw-buiten', groep: 'Muren', label: 'Nieuwe buitenmuur', eenheid: 'm²' }, (v) => v.kerncijfers.muren.nieuwBuiten);
  rij({ sleutel: 'muur-nieuw-binnen', groep: 'Muren', label: 'Nieuwe binnenmuur', eenheid: 'm²' }, (v) => v.kerncijfers.muren.nieuwBinnen);
  rij({ sleutel: 'muur-afbraak', groep: 'Muren', label: 'Af te breken muur', eenheid: 'm²' }, (v) => v.kerncijfers.muren.afbraak);
  rij({ sleutel: 'doorbraken', groep: 'Muren', label: 'Doorbraken (nieuwe openingen in bestaande muren)', eenheid: 'm²' }, (v) => v.kerncijfers.muren.doorbraken);

  for (const [s, lbl] of [['bestaand', 'bestaand'], ['nieuw', 'nieuw'], ['afbraak', 'af te breken']]) {
    rij({ sleutel: `ramen-${s}-aantal`, groep: 'Ramen en deuren', label: `Ramen ${lbl}`, eenheid: 'st.', decimalen: 0, soort: 'aantal' }, (v) => v.kerncijfers.ramen[s].aantal);
    rij({ sleutel: `ramen-${s}-m2`, groep: 'Ramen en deuren', label: `Ramen ${lbl} (oppervlakte)`, eenheid: 'm²', kleur: s !== 'afbraak' }, (v) => v.kerncijfers.ramen[s].m2);
  }
  for (const [s, lbl] of [['bestaand', 'bestaand'], ['nieuw', 'nieuw'], ['afbraak', 'af te breken']]) {
    rij({ sleutel: `deuren-${s}`, groep: 'Ramen en deuren', label: `Deuren ${lbl}`, eenheid: 'st.', decimalen: 0, soort: 'aantal' }, (v) => v.kerncijfers.deuren[s]);
  }

  rij({ sleutel: 'dak-plat-bestaand', groep: 'Dak', label: 'Plat dak bestaand', eenheid: 'm²' }, (v) => v.kerncijfers.dak.platBestaand);
  rij({ sleutel: 'dak-plat-nieuw', groep: 'Dak', label: 'Plat dak nieuw', eenheid: 'm²' }, (v) => v.kerncijfers.dak.platNieuw);
  rij({ sleutel: 'dak-hellend-bestaand', groep: 'Dak', label: 'Hellend dak bestaand', eenheid: 'm²' }, (v) => v.kerncijfers.dak.hellendBestaand);
  rij({ sleutel: 'dak-hellend-nieuw', groep: 'Dak', label: 'Hellend dak nieuw', eenheid: 'm²' }, (v) => v.kerncijfers.dak.hellendNieuw);
  rij({ sleutel: 'dak-totaal', groep: 'Dak', label: 'Dakoppervlak totaal', eenheid: 'm²', nadruk: true }, (v) => v.kerncijfers.dak.totaal);

  rij({ sleutel: 'vloer-nieuw', groep: 'Vloer', label: 'Nieuw vloeroppervlak', eenheid: 'm²' }, (v) => v.kerncijfers.vloerNieuw);

  // v2: hoogtebanden (som over ruimtes met hoogtegrenzen), trappen, inrichting — enkel als een variant ze heeft
  const bandMap = new Map();
  for (const v of varianten) for (const b of v.kerncijfers.hoogtebanden || []) { const k = `${b.van}-${b.tot ?? ''}`; if (!bandMap.has(k)) bandMap.set(k, b); }
  const mStr = (mm) => fmtGetal(mm / 1000, 2);
  for (const [k, b] of [...bandMap.entries()].sort((x, y) => x[1].van - y[1].van || (x[1].tot ?? Infinity) - (y[1].tot ?? Infinity))) {
    const label = b.tot == null ? `Vrije hoogte ≥ ${mStr(b.van)} m` : `Vrije hoogte ${mStr(b.van)}–${mStr(b.tot)} m`;
    rij({ sleutel: `hoogteband-${k}`, groep: 'Hoogtebanden', label: `${label} (ruimtes met hoogtegrenzen)`, eenheid: 'm²', kleur: b.tot == null && b.van > 0 },
      (v) => (v.kerncijfers.hoogtebanden ? (v.kerncijfers.hoogtebanden.find((x) => `${x.van}-${x.tot ?? ''}` === k)?.m2 ?? 0) : null));
  }
  if (varianten.some((v) => (v.kerncijfers.trappen?.aantal ?? 0) > 0))
    rij({ sleutel: 'trappen', groep: 'Programma', label: 'Trappen', eenheid: 'st.', decimalen: 0, soort: 'aantal' }, (v) => v.kerncijfers.trappen?.aantal ?? null);
  const soorten = [...new Set(varianten.flatMap((v) => Object.keys(v.kerncijfers.inrichting || {})))].sort();
  for (const s of soorten)
    rij({ sleutel: `inrichting-${s}`, groep: 'Programma', label: `Inrichting: ${s}`, eenheid: 'st.', decimalen: 0, soort: 'aantal' }, (v) => (v.kerncijfers.inrichting ? (v.kerncijfers.inrichting[s] ?? 0) : null));

  // raming: de prijzen zijn voor alle varianten dezelfde (één prijzen.json)
  const r0 = varianten[0]?.raming;
  const valuta = r0?.valuta || 'EUR';
  const groep = 'Raming'; // btw-vermelding staat apart (kan een lange tekst zijn)
  for (const [i, p] of (r0?.posten || []).entries()) {
    rij({ sleutel: `post-${p.sleutel}`, groep, label: POST_LABEL[p.sleutel] || p.sleutel, eenheid: valuta, decimalen: 0, soort: 'bedrag', valuta,
      prijs: p.prijs, bereik: p.bereik, prijsEenheid: p.eenheid, postSleutel: p.sleutel }, (v) => v.raming.posten[i]?.bedrag ?? null);
  }
  rij({ sleutel: 'raming-totaal', groep, label: 'Totaal raming', eenheid: valuta, decimalen: 0, soort: 'bedrag', valuta, nadruk: true }, (v) => v.raming.totaal);
  rijen.at(-1).minstens = varianten.map((v) => !v.raming.volledig);
  if (varianten.some((v) => v.raming.bandbreedte)) {
    rij({ sleutel: 'raming-min', groep, label: 'Bandbreedte: laag (Σ hoeveelheid × min)', eenheid: valuta, decimalen: 0, soort: 'bedrag', valuta }, (v) => v.raming.bandbreedte?.min ?? null);
    rijen.at(-1).minstens = varianten.map((v) => !v.raming.volledig);
    rij({ sleutel: 'raming-max', groep, label: 'Bandbreedte: hoog (Σ hoeveelheid × max)', eenheid: valuta, decimalen: 0, soort: 'bedrag', valuta }, (v) => v.raming.bandbreedte?.max ?? null);
    rijen.at(-1).minstens = varianten.map((v) => !v.raming.volledig);
  }

  for (const r of rijen) {
    r.deltas = r.waarden.map((w, i) => {
      if (i === 0 || w == null || r.waarden[0] == null) return null;
      if (r.minstens && (r.minstens[i] || r.minstens[0])) return null; // verschil tussen onvolledige totalen zegt niets
      return w - r.waarden[0];
    });
  }
  return rijen;
}

// ---------------------------------------------------------------- CSV (Excel, Belgische landinstelling)

/** Getal voor CSV: komma als decimaalteken, geen duizendtalscheiding, "-" als minteken. */
export function csvGetal(v, dec) {
  if (v == null || !Number.isFinite(v)) return '';
  return afgerond(v, dec).toFixed(dec).replace('.', ',');
}

function csvVeld(t) {
  let s = String(t ?? '');
  // bescherming tegen formule-injectie in Excel (tekst die met = + @ of - begint, behalve getallen)
  if (/^[=+@\t]/.test(s) || (/^-/.test(s) && !/^-[\d.,]+$/.test(s))) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV-tekst met ";" als scheidingsteken en komma als decimaalteken (Excel BE). Begint met een UTF-8-BOM
 * zodat Excel "m²" en "—" correct toont. Regeleinde CRLF.
 * @param {string[]} namen kolomnamen (variantnamen; eerste = referentie)
 * @param {ReturnType<typeof vergelijkingsRijen>} rijen
 */
export function naarCsv(namen, rijen, { datum, btw, bijgewerkt, herkomst } = {}) {
  const regels = [];
  const kop = ['Groep', 'Kerncijfer', 'Eenheid', `${namen[0]} (referentie)`];
  for (const n of namen.slice(1)) kop.push(n, `Δ ${n}`);
  regels.push(kop);
  for (const r of rijen) {
    const eenheid = r.soort === 'bedrag' ? r.valuta : r.eenheid;
    const bereik = r.bereik ? `; bereik ${csvGetal(r.bereik[0], 2)}–${csvGetal(r.bereik[1], 2)}` : '';
    const lbl = r.soort === 'bedrag' && r.postSleutel ? `${r.label} (${r.prijs == null ? 'prijs ontbreekt' : `${csvGetal(r.prijs, 2)} ${r.valuta}/${r.prijsEenheid}`}${bereik})` : r.label;
    const minst = (i) => (r.minstens?.[i] ? 'minstens ' : '');
    const cel = (i) => (r.waarden[i] == null ? '—' : `${minst(i)}${csvGetal(r.waarden[i], r.decimalen)}`);
    const rij = [r.groep, lbl, eenheid, cel(0)];
    for (let i = 1; i < namen.length; i++) rij.push(cel(i), r.deltas[i] == null ? '' : csvGetal(r.deltas[i], r.decimalen));
    regels.push(rij);
  }
  regels.push([]);
  if (herkomst) regels.push([herkomst]);
  regels.push([DISCLAIMER]);
  regels.push(['Prijzen enkel uit designs/prijzen.json; "—" = prijs ontbreekt, "minstens" = raming onvolledig.']);
  regels.push([`Btw: ${btwTekst(btw)}`]);
  if (bijgewerkt) regels.push([`Prijzen bijgewerkt: ${bijgewerkt}`]);
  if (datum) regels.push([`Export: ${datum}`]);
  return '﻿' + regels.map((r) => r.map(csvVeld).join(';')).join('\r\n') + '\r\n';
}
