// Eigenschappenpaneel: onderdelen voor dakkapellen (raam als drie getallen, afgeleide maten, knoppen bij een hellend dak).
// Wijzigingen lopen via de callbacks van eigenschappen.js (wijzigen-operatie of bewerking ⇒ undo-baar, gevalideerd).

import { dakkapelGeometrie, ZIJDEN_PER_NOK } from '../model/dakkapellen.js';
import { opsDakkapelPlaatsen } from '../model/dakkapel-bewerkingen.js';
import { h } from './dom.js';

const fmt = (v, dec = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('nl-BE', { maximumFractionDigits: dec, minimumFractionDigits: dec }) : '—');

/**
 * Raam van een dakkapel: breedte, hoogte, borstwering (leeg = onderaan het voorvlak). Breedte leeg ⇒ raam weg.
 * wijzig(waarde | null) → { ok }. Geweigerd ⇒ oude waarden terug.
 */
export function raamInvoer(rij, wijzig, { leesGetal }) {
  const r = rij.waarde && typeof rij.waarde === 'object' ? rij.waarde : {};
  const velden = [['breedte', 'B'], ['hoogte', 'H'], ['borstwering', 'borstw.']];
  const inp = Object.fromEntries(velden.map(([k]) => [k, h('input', {
    id: `veld-raam-${k}`, type: 'text', inputmode: 'decimal', value: r[k] ?? '', 'data-veld': `raam.${k}`, autocomplete: 'off',
    placeholder: k === 'borstwering' ? 'onderaan' : '—', 'aria-label': `Raam ${k}`,
  })]));
  const terug = () => { for (const [k] of velden) inp[k].value = r[k] ?? ''; };
  const opWijziging = () => {
    const b = inp.breedte.value.trim(), hh = inp.hoogte.value.trim(), bw = inp.borstwering.value.trim();
    if (b === '' && hh === '') { if (rij.waarde == null || !wijzig(null).ok) terug(); return; }
    const nieuw = { breedte: leesGetal(b), hoogte: leesGetal(hh) };
    if (bw !== '') nieuw.borstwering = leesGetal(bw);
    if (!Object.values(nieuw).every(Number.isFinite)) { if (b !== '' && hh !== '') terug(); return; } // wacht tot beide ingevuld zijn
    if (JSON.stringify(nieuw) === JSON.stringify(rij.waarde) || !wijzig(nieuw).ok) terug();
  };
  for (const [k] of velden) inp[k].addEventListener('change', opWijziging);
  return h('div', { class: 'raam-invoer' },
    ...velden.flatMap(([k, lbl]) => [h('span', { class: 'as' }, lbl), inp[k]]), h('span', { class: 'eenheid' }, 'mm'));
}

/** Afgeleide maten (alleen-lezen): diepte, vrije hoogte eronder, voorvlak, raam, volumetoename. */
export function dakkapelInfoTekst(model, k) {
  const g = dakkapelGeometrie(model, k);
  if (g.fout) return g.fout;
  const d = [
    `diepte ${fmt(g.diepte)} mm${g.achterwand ? ' (met achterwand)' : ' (tot het hoofddak)'}`,
    `vrije hoogte eronder ${fmt(k.positieZ + k.hoogte)} mm`,
    `voorvlak op ${fmt(g.dVoor)} mm van de goot`,
    `voorvlak ${fmt(g.voorvlakM2, 2)} m²`,
  ];
  if (g.raam) d.push(`raam ${fmt(g.raamM2, 2)} m²`);
  d.push(`volume +${fmt(g.volume / 1e9, 2)} m³`);
  return d.join(' · ');
}

export function dakkapelInfo(model, k) {
  return h('p', { class: 'eig-info', id: 'dakkapel-info' }, dakkapelInfoTekst(model, k),
    h('br'), h('span', { class: 'veld-uitleg' }, 'Positie x = midden langs de nok. Positie z = onderkant van het voorvlak boven de zoldervloer; het voorvlak staat waar het dak die hoogte heeft. Maten zijn een schets, geen norm.'));
}

/**
 * Bij een hellend dak: knoppen "Dakkapel toevoegen (<zijde>)" — midden van het dak, vertrekmaten uit de instellingen
 * (werkwaarden, geen norm). opBewerk(r, label, nieuwId) → { ok }.
 */
export function dakkapelKnoppen(model, dak, opBewerk) {
  if (!dak || dak.type === 'plat' || !(dak.helling > 0)) return null;
  const zijden = ZIJDEN_PER_NOK[dak.nokrichting || 'x'] || [];
  const knoppen = zijden.map((z) => h('button', {
    type: 'button', class: 'knop klein', 'data-dakkapel-zijde': z,
    onclick: () => { const r = opsDakkapelPlaatsen(model, { dak: dak.id, zijde: z }); opBewerk(r, `Dakkapel (${z}) toevoegen`, r.info?.id); },
  }, `Dakkapel ${z}`));
  return h('div', { class: 'eig-acties dakkapel-acties' }, h('span', { class: 'veld-uitleg' }, 'Dakkapel toevoegen:'), ...knoppen);
}
