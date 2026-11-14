// Kerncijfers en raming in de app: prijzen laden (designs/prijzen.json), cache per model,
// compact overzicht in het eigenschappenpaneel en de uitklapbare prijsdetails (ook gebruikt in Vergelijken).

import { kerncijfers, raming, btwTekst, DISCLAIMER, fmtM2, fmtM3, fmtBedrag, fmtGetal, fmtEenheidsprijs } from '../metrics/index.js';
import { h } from './dom.js';

// ---------------------------------------------------------------- prijzen

/** { status: 'laden'|'ok'|'fout', json: object|null, melding?: string, versie: number } */
export const prijzen = { status: 'laden', json: null, melding: '', versie: 0 };

/** Laadt designs/prijzen.json (relatief, werkt op GitHub Pages). Faalt nooit: bij een fout blijven alle prijzen onbekend. */
export async function laadPrijzen(fetchFn = globalThis.fetch?.bind(globalThis), url = 'designs/prijzen.json') {
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    prijzen.json = JSON.parse(await res.text());
    prijzen.status = 'ok';
    prijzen.melding = '';
  } catch (e) {
    prijzen.json = null;
    prijzen.status = 'fout';
    prijzen.melding = `designs/prijzen.json kon niet geladen worden (${e.message}); de raming toont geen bedragen.`;
  }
  prijzen.versie++;
  return prijzen;
}

// ---------------------------------------------------------------- cache

// Modellen in de geschiedenis zijn onveranderlijke momentopnames ⇒ cache per modelobject.
const cache = new WeakMap();

/** { kerncijfers, raming } voor een model, herberekend enkel als model of prijzen wijzigen. */
export function cijfersVoor(model) {
  const c = cache.get(model);
  if (c && c.versie === prijzen.versie) return c;
  const k = c?.kerncijfers || kerncijfers(model);
  const nieuw = { kerncijfers: k, raming: raming(model, prijzen.json, { kerncijfers: k }), versie: prijzen.versie };
  cache.set(model, nieuw);
  return nieuw;
}

// ---------------------------------------------------------------- weergave

const LABEL_POST = {
  muur_nieuw_buiten: 'Nieuwe buitenmuur', muur_nieuw_binnen: 'Nieuwe binnenmuur', muur_afbraak: 'Afbraak muur + doorbraken',
  raam_nieuw: 'Nieuwe ramen', deur_nieuw: 'Nieuwe deuren', vloer_nieuw: 'Nieuwe vloer', dak_plat_nieuw: 'Nieuw plat dak',
  dak_hellend_nieuw: 'Nieuw hellend dak', afwerking_nieuw_vloeroppervlak: 'Afwerking nieuw vloeroppervlak',
};
export const postLabel = (s) => LABEL_POST[s] || s;

/** Tekst van het totaal: "€ 22.263", "minstens € 3.070" of "—" (niets gekend). */
export function totaalTekst(r) {
  if (r.volledig) return fmtBedrag(r.totaal, r.valuta);
  return r.totaal > 0 ? `minstens ${fmtBedrag(r.totaal, r.valuta)}` : '—';
}

export function bandbreedteTekst(r) {
  if (!r.bandbreedte) return null;
  const t = `${fmtBedrag(r.bandbreedte.min, r.valuta)} – ${fmtBedrag(r.bandbreedte.max, r.valuta)}`;
  return r.volledig ? t : `minstens ${t}`;
}

/** Uitleg bij ontbrekende prijzen (of null als niets ontbreekt). */
export function ontbrekendUitleg(r) {
  if (prijzen.status === 'fout') return h('p', { class: 'kc-let-op' }, prijzen.melding);
  if (!r.zonderPrijs.length) return null;
  return h('p', { class: r.ontbrekend.length ? 'kc-let-op' : 'kc-zacht' },
    r.ontbrekend.length ? 'Raming onvolledig: ' : '',
    `geen prijs voor ${r.zonderPrijs.map(postLabel).join(', ')}. `,
    'Vul ze in in designs/prijzen.json (via GitHub of Claude Code); de app verzint geen prijzen.');
}

/** Vermelding btw + datum prijzen + disclaimer. */
export function prijsVoetnoot(r) {
  return h('div', { class: 'kc-voetnoot' },
    r.herkomst ? h('p', { class: 'kc-let-op kc-herkomst' }, h('strong', {}, r.herkomst)) : null,
    h('p', {}, r.btw === 'incl' || r.btw === 'excl' ? `Bedragen ${btwTekst(r.btw)}.` : `${btwTekst(r.btw).replace(/^btw/, 'Btw')}.`, r.bijgewerkt ? ` Prijzen bijgewerkt: ${r.bijgewerkt}.` : ''),
    h('p', {}, h('strong', {}, DISCLAIMER)));
}

/** Uitklapbare prijsdetails per post: hoeveelheid, eenheidsprijs, bereik, bedrag, opmerking en bronnen. */
const OPEN = new Map(); // open/dicht van de uitklapbare details blijft behouden tussen hertekeningen

export function prijsDetails(r, { open = false, titel = 'Prijsdetails', sleutel = 'paneel' } = {}) {
  const lijst = h('ul', { class: 'kc-posten' }, ...r.posten.map((p) => {
    const bereik = p.bereik ? `bereik ${fmtEenheidsprijs(p.bereik[0], p.eenheid, r.valuta)} – ${fmtEenheidsprijs(p.bereik[1], p.eenheid, r.valuta)}` : null;
    const hv = p.eenheid === 'stuk' ? `${fmtGetal(p.hoeveelheid, 0)} st.` : `${fmtGetal(p.hoeveelheid, 2)} ${p.eenheid}`;
    return h('li', { class: 'kc-post', 'data-post': p.sleutel },
      h('div', { class: 'kc-post-kop' },
        h('span', { class: 'kc-post-naam' }, postLabel(p.sleutel)),
        h('span', { class: `kc-post-bedrag${p.bedrag == null ? ' ontbreekt' : ''}` }, p.bedrag == null ? '—' : fmtBedrag(p.bedrag, r.valuta))),
      h('div', { class: 'kc-post-reken' }, `${hv} × ${p.prijs == null ? 'prijs ontbreekt' : fmtEenheidsprijs(p.prijs, p.eenheid, r.valuta)}`,
        bereik ? ` (${bereik})` : ''),
      p.omschrijving ? h('div', { class: 'kc-post-omschr' }, p.omschrijving) : null,
      p.opmerking ? h('div', { class: 'kc-post-opm' }, p.opmerking) : null,
      p.bron.length ? h('div', { class: 'kc-bronnen' }, 'Bron: ', ...p.bron.flatMap((u, i) => [i ? ', ' : '',
        h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, bronNaam(u))])) : null);
  }));
  const r2 = r.controle ? h('p', { class: 'kc-zacht' }, r.controle) : null;
  const w = r.waarschuwingen.length ? h('ul', { class: 'kc-waarsch' }, ...r.waarschuwingen.map((x) => h('li', {}, x))) : null;
  const d = h('details', { class: 'kc-details', open: OPEN.get(sleutel) ?? open, 'data-sleutel': sleutel }, h('summary', {}, titel), lijst, r2, w);
  d.addEventListener('toggle', () => OPEN.set(sleutel, d.open));
  return d;
}

/** Leesbare naam van een bronlink: domein zonder www. */
function bronNaam(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/**
 * Compact overzicht in het eigenschappenpaneel (zonder selectie).
 * @param {object} model
 * @param {{ opVergelijk?: () => void }} o
 */
export function kerncijfersBlok(model, { opVergelijk } = {}) {
  const { kerncijfers: k, raming: r } = cijfersVoor(model);
  const tabel = h('table', { class: 'kc-tabel' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Niveau'), h('th', { scope: 'col' }, 'Bruto'), h('th', { scope: 'col' }, 'Netto'))),
    h('tbody', {}, ...k.niveaus.map((n) => h('tr', {},
      h('th', { scope: 'row' }, n.naam, n.brutoBron === 'buitencontour' ? h('span', { class: 'kc-voetteken', title: 'Geen vloer: bruto = buitencontour van de muren' }, ' *') : ''),
      h('td', {}, fmtM2(n.bruto)), h('td', {}, fmtM2(n.netto)))),
    h('tr', { class: 'kc-totaal' }, h('th', { scope: 'row' }, 'Totaal'), h('td', {}, fmtM2(k.bruto)), h('td', {}, fmtM2(k.netto)))));
  const band = bandbreedteTekst(r);
  const rij = (label, waarde, extra = {}) => [h('dt', {}, label), h('dd', extra, waarde)];
  return h('section', { class: 'kerncijfers', 'aria-labelledby': 'kc-titel', id: 'kerncijfers' },
    h('div', { class: 'kc-kop' }, h('h3', { id: 'kc-titel' }, 'Kerncijfers'),
      opVergelijk ? h('button', { type: 'button', class: 'knop klein', id: 'kc-vergelijk', onclick: opVergelijk }, 'Vergelijken…') : null),
    tabel,
    k.niveaus.some((n) => n.brutoBron === 'buitencontour') ? h('p', { class: 'kc-zacht' }, '* geen vloer getekend: bruto = buitencontour van de muren') : null,
    h('dl', { class: 'kc-lijst' },
      ...rij('Bruto volume', fmtM3(k.volume.totaal)),
      ...(k.muren.nieuwBuiten || k.muren.nieuwBinnen ? rij('Nieuwe muur', `${fmtM2(k.muren.nieuwBuiten + k.muren.nieuwBinnen)}`) : []),
      ...(k.muren.afbraak || k.muren.doorbraken ? rij('Afbraak + doorbraken', fmtM2(k.muren.afbraak + k.muren.doorbraken)) : []),
      ...rij('Raming', h('span', { class: 'kc-raming' }, totaalTekst(r),
        !r.volledig ? h('span', { class: 'kc-badge' }, 'onvolledig') : null), { id: 'kc-raming' }),
      ...(band ? rij('Bandbreedte', band, { id: 'kc-band' }) : [])),
    ontbrekendUitleg(r),
    prijsDetails(r),
    prijsVoetnoot(r));
}
