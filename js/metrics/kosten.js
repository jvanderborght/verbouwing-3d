// Kostenraming. Pure functies (geen DOM). Definities: docs/FASE3.md.
// Prijzen komen UITSLUITEND uit designs/prijzen.json van de gebruiker. Er worden nooit prijzen verzonnen:
// ontbreekt een prijs (null, leeg of ongeldig), dan heeft die post geen bedrag en is de raming onvolledig
// (het totaal is dan de som van de gekende posten = "minstens").

import { kerncijfers as berekenKerncijfers } from './kerncijfers.js';

export const DISCLAIMER = 'Indicatief — geen offerte; stabiliteit, EPB en vergunning niet inbegrepen.';

/** Posten in vaste volgorde: sleutel in prijzen.json, standaardomschrijving/-eenheid en hoeveelheid uit de kerncijfers. */
export const POSTEN = [
  { sleutel: 'muur_nieuw_buiten', omschrijving: 'Nieuwe buitenmuur', eenheid: 'm²', hoeveelheid: (k) => k.muren.nieuwBuiten },
  { sleutel: 'muur_nieuw_binnen', omschrijving: 'Nieuwe binnenmuur', eenheid: 'm²', hoeveelheid: (k) => k.muren.nieuwBinnen },
  { sleutel: 'muur_afbraak', omschrijving: 'Afbraak muur + doorbraken', eenheid: 'm²', hoeveelheid: (k) => k.muren.afbraak + k.muren.doorbraken },
  { sleutel: 'raam_nieuw', omschrijving: 'Nieuwe ramen', eenheid: 'm²', hoeveelheid: (k) => k.ramen.nieuw.m2 },
  { sleutel: 'deur_nieuw', omschrijving: 'Nieuwe deuren', eenheid: 'stuk', hoeveelheid: (k) => k.deuren.nieuw },
  { sleutel: 'vloer_nieuw', omschrijving: 'Nieuwe vloer', eenheid: 'm²', hoeveelheid: (k) => k.vloerNieuw },
  { sleutel: 'dak_plat_nieuw', omschrijving: 'Nieuw plat dak', eenheid: 'm²', hoeveelheid: (k) => k.dak.platNieuw },
  { sleutel: 'dak_hellend_nieuw', omschrijving: 'Nieuw hellend dak', eenheid: 'm²', hoeveelheid: (k) => k.dak.hellendNieuw },
  { sleutel: 'afwerking_nieuw_vloeroppervlak', omschrijving: 'Afwerking nieuw vloeroppervlak', eenheid: 'm²', hoeveelheid: (k) => k.vloerNieuw },
];
export const POST_SLEUTELS = POSTEN.map((p) => p.sleutel);

const geldigePrijs = (p) => typeof p === 'number' && Number.isFinite(p) && p >= 0;
const geldigBereik = (b) => Array.isArray(b) && b.length === 2 && geldigePrijs(b[0]) && geldigePrijs(b[1]) && b[0] <= b[1];
const isUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u);
const tekstOfNull = (t) => (typeof t === 'string' && t.trim() ? t.trim() : null);

/**
 * Leest prijzen.json (object, mag null zijn als het bestand niet geladen kon worden) zonder iets aan te vullen.
 * Optionele velden per post: `bereik: [min, max]`, `bron: [url, …]`, `opmerking`. Top-level: `btw` (incl/excl of vrije tekst),
 * `_bijgewerkt`, `_controle`, `_uitleg`.
 * @returns {{ valuta: string, btw: string|null, bijgewerkt: string|null, controle: string|null, uitleg: string|null,
 *             prijzen: Map<string, {prijs: number|null, bereik: [number, number]|null, bron: string[], opmerking: string|null, eenheid?, omschrijving?}>,
 *             waarschuwingen: string[] }}
 */
export function leesPrijzen(prijzenJson) {
  const waarschuwingen = [];
  const prijzen = new Map();
  if (!prijzenJson || typeof prijzenJson !== 'object') {
    waarschuwingen.push('designs/prijzen.json kon niet gelezen worden: alle prijzen ontbreken.');
    return { valuta: 'EUR', btw: null, bijgewerkt: null, controle: null, uitleg: null, prijzen, waarschuwingen };
  }
  const valuta = typeof prijzenJson.valuta === 'string' && /^[A-Z]{3}$/.test(prijzenJson.valuta) ? prijzenJson.valuta : 'EUR';
  const btw = tekstOfNull(prijzenJson.btw);
  if (prijzenJson.btw != null && btw == null) waarschuwingen.push('Ongeldige btw-waarde in prijzen.json (verwacht "incl", "excl", een tekst of null).');
  const ep = prijzenJson.eenheidsprijzen && typeof prijzenJson.eenheidsprijzen === 'object' ? prijzenJson.eenheidsprijzen : {};
  for (const [sleutel, v] of Object.entries(ep)) {
    if (!POST_SLEUTELS.includes(sleutel)) { waarschuwingen.push(`Onbekende sleutel "${sleutel}" in prijzen.json wordt genegeerd.`); continue; }
    const ruw = v && typeof v === 'object' ? v.prijs : undefined;
    if (ruw != null && !geldigePrijs(ruw)) waarschuwingen.push(`Ongeldige prijs voor "${sleutel}" (${JSON.stringify(ruw)}): behandeld als ontbrekend.`);
    const prijs = geldigePrijs(ruw) ? ruw : null;
    const ruwBereik = v && typeof v === 'object' ? v.bereik : undefined;
    const bereik = geldigBereik(ruwBereik) ? [ruwBereik[0], ruwBereik[1]] : null;
    if (ruwBereik != null && !bereik) waarschuwingen.push(`Ongeldig bereik voor "${sleutel}" (verwacht [min, max] met 0 ≤ min ≤ max): genegeerd.`);
    if (bereik && prijs != null && (prijs < bereik[0] || prijs > bereik[1])) waarschuwingen.push(`Prijs van "${sleutel}" ligt buiten het opgegeven bereik.`);
    const bronnen = Array.isArray(v?.bron) ? v.bron : (v?.bron != null ? [v.bron] : []);
    if (bronnen.some((u) => !isUrl(u))) waarschuwingen.push(`Bron van "${sleutel}" bevat iets anders dan een http(s)-link: genegeerd.`);
    prijzen.set(sleutel, {
      prijs,
      bereik,
      bron: bronnen.filter(isUrl),
      opmerking: tekstOfNull(v?.opmerking),
      eenheid: typeof v?.eenheid === 'string' ? v.eenheid : undefined,
      omschrijving: typeof v?.omschrijving === 'string' ? v.omschrijving : undefined,
    });
  }
  for (const p of POSTEN) {
    if (!prijzen.has(p.sleutel)) waarschuwingen.push(`Sleutel "${p.sleutel}" ontbreekt in prijzen.json: prijs onbekend.`);
    else {
      const e = prijzen.get(p.sleutel).eenheid;
      if (e && e !== p.eenheid) waarschuwingen.push(`Eenheid van "${p.sleutel}" is "${e}" in prijzen.json; de raming rekent per ${p.eenheid}.`);
    }
  }
  return {
    valuta, btw, prijzen, waarschuwingen,
    bijgewerkt: tekstOfNull(prijzenJson._bijgewerkt), controle: tekstOfNull(prijzenJson._controle), uitleg: tekstOfNull(prijzenJson._uitleg),
  };
}

/**
 * Kostenraming van een ontwerp.
 * @param {object} model
 * @param {object|null} prijzenJson inhoud van designs/prijzen.json
 * @param {{ kerncijfers?: object }} [o] reeds berekende kerncijfers (vermijdt dubbel rekenwerk)
 * @returns {{
 *   valuta: string, btw: string|null, bijgewerkt: string|null, controle: string|null,
 *   posten: Array<{ sleutel, omschrijving, eenheid, hoeveelheid: number, prijs: number|null, bedrag: number|null,
 *                   bereik: [min, max]|null, bedragMin: number|null, bedragMax: number|null, bron: string[], opmerking: string|null }>,
 *   totaal: number,          // som van de gekende bedragen
 *   bandbreedte: { min: number, max: number } | null,  // Σ hoeveelheid × bereik (post zonder bereik: × prijs); null als geen enkele post een bereik heeft
 *   volledig: boolean,       // false ⇒ totaal is "minstens"
 *   ontbrekend: string[],    // sleutels zonder prijs waarvoor de hoeveelheid > 0 (maken de raming onvolledig)
 *   zonderPrijs: string[],   // alle sleutels zonder prijs (ook met hoeveelheid 0)
 *   waarschuwingen: string[],
 * }}
 * Een post met hoeveelheid 0 kost 0, ook zonder prijs; hij maakt de raming dus niet onvolledig (toont wel "—" als prijs).
 */
export function raming(model, prijzenJson, { kerncijfers } = {}) {
  const k = kerncijfers || berekenKerncijfers(model);
  const { valuta, btw, bijgewerkt, controle, prijzen, waarschuwingen } = leesPrijzen(prijzenJson);
  const posten = POSTEN.map((p) => {
    const info = prijzen.get(p.sleutel);
    const prijs = info?.prijs ?? null;
    const hoeveelheid = p.hoeveelheid(k);
    const bereik = info?.bereik ?? null;
    const bedrag = hoeveelheid === 0 ? 0 : (prijs == null ? null : hoeveelheid * prijs);
    const grens = (j) => (hoeveelheid === 0 ? 0 : bereik ? hoeveelheid * bereik[j] : bedrag);
    return {
      sleutel: p.sleutel, omschrijving: info?.omschrijving || p.omschrijving, eenheid: p.eenheid, hoeveelheid, prijs, bedrag,
      bereik, bedragMin: grens(0), bedragMax: grens(1), bron: info?.bron ?? [], opmerking: info?.opmerking ?? null,
    };
  });
  const heeftBereik = posten.some((p) => p.bereik);
  const ontbrekend = posten.filter((p) => p.bedrag == null).map((p) => p.sleutel);
  return {
    valuta, btw, bijgewerkt, controle, posten,
    totaal: posten.reduce((s, p) => s + (p.bedrag ?? 0), 0),
    bandbreedte: heeftBereik
      ? { min: posten.reduce((s, p) => s + (p.bedragMin ?? 0), 0), max: posten.reduce((s, p) => s + (p.bedragMax ?? 0), 0) }
      : null,
    volledig: ontbrekend.length === 0,
    ontbrekend,
    zonderPrijs: posten.filter((p) => p.prijs == null).map((p) => p.sleutel),
    waarschuwingen,
  };
}

/** Tekst over de btw zoals de gebruiker ze in prijzen.json aangeeft ("incl", "excl" of vrije tekst). */
export function btwTekst(btw) {
  if (btw === 'incl') return 'incl. btw';
  if (btw === 'excl') return 'excl. btw';
  if (typeof btw === 'string' && btw.trim()) return `btw: ${btw.trim()}`;
  return 'btw niet opgegeven in prijzen.json';
}
