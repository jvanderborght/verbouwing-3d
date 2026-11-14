// Dialogen van het tekengereedschap: ruimte benoemen, niveau toevoegen, dak instellen.
// Ze geven enkel de ingevulde waarden terug (of null bij annuleren); het model wijzigen gebeurt elders.

import { FUNCTIES, DAK_TYPES, NOKRICHTINGEN, STATUSSEN } from '../model/index.js';
import { dialoog } from './dialogen.js';
import { leesGetal } from './eigenschappen.js';
import { h } from './dom.js';

const veld = (id, label, invoer, uitleg = '') => h('div', { class: 'dlg-veld' },
  h('label', { class: 'veld-label', for: id }, label), invoer, uitleg ? h('div', { class: 'veld-uitleg' }, uitleg) : null);

const keuze = (id, opties, waarde, labels = {}) => h('select', { id },
  ...opties.map((o) => h('option', { value: o, selected: o === waarde }, labels[o] || o)));

const getalInvoer = (id, waarde) => h('input', { id, type: 'text', inputmode: 'decimal', value: String(waarde ?? ''), autocomplete: 'off' });

const foutRegel = () => h('p', { class: 'dlg-fout', role: 'alert', hidden: true });

/** Controleert getalvelden: [{ inp, naam, min, max }] → waarden of toont de fout en geeft null. */
function leesGetallen(velden, fout) {
  const uit = {};
  for (const v of velden) {
    const g = leesGetal(v.inp.value);
    if (!Number.isFinite(g) || g < v.min || g > v.max) {
      fout.textContent = `${v.naam}: geef een getal tussen ${v.min.toLocaleString('nl-BE')} en ${v.max.toLocaleString('nl-BE')}.`;
      fout.hidden = false;
      v.inp.focus();
      return null;
    }
    uit[v.sleutel] = g;
  }
  fout.hidden = true;
  return uit;
}

/**
 * Naam + functie van een ruimte.
 * @returns {Promise<{ naam: string, functie: string }|null>}
 */
export async function ruimteDialoog({ titel = 'Ruimte benoemen', naam = '', functie = 'overig', uitleg = '', ok = 'Bewaren' } = {}) {
  const inpNaam = h('input', { id: 'dlg-ruimte-naam', type: 'text', value: naam, autocomplete: 'off', placeholder: 'bv. Keuken' });
  const selFunctie = keuze('dlg-ruimte-functie', FUNCTIES, FUNCTIES.includes(functie) ? functie : 'overig');
  const fout = foutRegel();
  // naam volgt de functie zolang de gebruiker zelf niets typte
  let zelfGetypt = !!naam;
  inpNaam.addEventListener('input', () => { zelfGetypt = !!inpNaam.value.trim(); });
  selFunctie.addEventListener('change', () => { if (!zelfGetypt) inpNaam.value = hoofdletter(selFunctie.value); });
  const r = await dialoog({
    titel,
    inhoud: [uitleg ? h('p', {}, uitleg) : null, veld('dlg-ruimte-functie', 'Functie', selFunctie), veld('dlg-ruimte-naam', 'Naam', inpNaam), fout],
    knoppen: [{ label: 'Annuleren', waarde: null }, {
      label: ok, waarde: 'ok', soort: 'primair',
      controle: () => {
        if (inpNaam.value.trim()) return true;
        fout.textContent = 'Geef een naam.'; fout.hidden = false; inpNaam.focus(); return false;
      },
    }],
    bijOpenen: () => { inpNaam.focus(); inpNaam.select(); },
  });
  return r === 'ok' ? { naam: inpNaam.value.trim(), functie: selFunctie.value } : null;
}

const hoofdletter = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Nieuw niveau.
 * @returns {Promise<{ naam, hoogte, kopieerMuren }|null>}
 */
export async function niveauDialoog(model) {
  const top = model.niveaus.reduce((a, b) => (b.peil > a.peil ? b : a), model.niveaus[0]);
  const inpNaam = h('input', { id: 'dlg-niv-naam', type: 'text', value: `Verdieping ${model.niveaus.length}`, autocomplete: 'off' });
  const inpHoogte = getalInvoer('dlg-niv-hoogte', 2700);
  const selKopie = keuze('dlg-niv-kopie', ['buiten', 'alle', 'geen'], 'buiten', { buiten: 'Buitenmuren', alle: 'Alle muren', geen: 'Geen muren' });
  const fout = foutRegel();
  let waarden = null;
  const r = await dialoog({
    titel: 'Niveau toevoegen',
    inhoud: [
      h('p', {}, `Het nieuwe niveau komt bovenop "${top?.naam ?? '—'}". Daken op dat niveau verhuizen mee naar boven.`),
      veld('dlg-niv-naam', 'Naam', inpNaam),
      veld('dlg-niv-hoogte', 'Verdiepingshoogte (mm)', inpHoogte),
      veld('dlg-niv-kopie', 'Muren overnemen van het niveau eronder', selKopie, 'Overgenomen muren krijgen status "nieuw" en geen openingen.'),
      fout,
    ],
    knoppen: [{ label: 'Annuleren', waarde: null }, {
      label: 'Toevoegen', waarde: 'ok', soort: 'primair',
      controle: () => {
        if (!inpNaam.value.trim()) { fout.textContent = 'Geef een naam.'; fout.hidden = false; return false; }
        waarden = leesGetallen([{ inp: inpHoogte, sleutel: 'hoogte', naam: 'Verdiepingshoogte', min: 1000, max: 10000 }], fout);
        return !!waarden;
      },
    }],
    bijOpenen: () => { inpNaam.focus(); inpNaam.select(); },
  });
  return r === 'ok' && waarden ? { naam: inpNaam.value.trim(), hoogte: waarden.hoogte, kopieerMuren: selKopie.value } : null;
}

const DAK_LABELS = { plat: 'Plat', lessenaar: 'Lessenaar', zadel: 'Zadeldak', schild: 'Schilddak' };

/**
 * Dak op een niveau. Vooraf ingevuld met het bestaande dak (als dat er is).
 * @returns {Promise<{ niveau, type, helling, nokrichting, overstek, status }|null>}
 */
export async function dakDialoog(model, niveauId) {
  const niveaus = [...model.niveaus].sort((a, b) => a.peil - b.peil);
  const selNiveau = h('select', { id: 'dlg-dak-niveau' }, ...niveaus.map((n) => h('option', { value: n.id, selected: n.id === niveauId }, n.naam)));
  const selType = keuze('dlg-dak-type', DAK_TYPES, 'zadel', DAK_LABELS);
  const inpHelling = getalInvoer('dlg-dak-helling', 35);
  const selNok = keuze('dlg-dak-nok', NOKRICHTINGEN, 'x', { x: 'x (evenwijdig met de straatgevel)', y: 'y (loodrecht op de straatgevel)' });
  const inpOverstek = getalInvoer('dlg-dak-overstek', 300);
  const selStatus = keuze('dlg-dak-status', STATUSSEN, 'nieuw');
  const info = h('p', { class: 'dlg-info' });
  const fout = foutRegel();

  const vul = () => {
    const d = model.daken.find((x) => x.niveau === selNiveau.value);
    const n = niveaus.find((x) => x.id === selNiveau.value);
    if (d) {
      selType.value = d.type;
      inpHelling.value = String(d.helling);
      selNok.value = d.nokrichting || 'x';
      inpOverstek.value = String(d.overstek ?? 0);
      selStatus.value = d.status;
      info.textContent = `Wijzigt dak ${d.id} op "${n?.naam}".`;
    } else {
      info.textContent = `"${n?.naam}" heeft nog geen dak: er komt een nieuw dak over de buitenzijde van de muren van dit niveau.`;
    }
    pasHellingAan();
  };
  const pasHellingAan = () => {
    const plat = selType.value === 'plat';
    inpHelling.disabled = plat;
    selNok.disabled = plat;
    if (plat) inpHelling.value = '0';
    else if (leesGetal(inpHelling.value) === 0) inpHelling.value = '35';
  };
  selNiveau.addEventListener('change', vul);
  selType.addEventListener('change', pasHellingAan);
  vul();

  let waarden = null;
  const r = await dialoog({
    titel: 'Dak instellen',
    klasse: 'breed',
    inhoud: [
      veld('dlg-dak-niveau', 'Dak bovenop niveau', selNiveau), info,
      h('div', { class: 'raster-2' },
        veld('dlg-dak-type', 'Type', selType),
        veld('dlg-dak-helling', 'Helling (°)', inpHelling),
        veld('dlg-dak-nok', 'Nokrichting', selNok),
        veld('dlg-dak-overstek', 'Overstek (mm)', inpOverstek),
        veld('dlg-dak-status', 'Status', selStatus)),
      fout,
    ],
    knoppen: [{ label: 'Annuleren', waarde: null }, {
      label: 'Toepassen', waarde: 'ok', soort: 'primair',
      controle: () => {
        waarden = leesGetallen([
          { inp: inpHelling, sleutel: 'helling', naam: 'Helling', min: 0, max: 75 },
          { inp: inpOverstek, sleutel: 'overstek', naam: 'Overstek', min: 0, max: 3000 },
        ], fout);
        return !!waarden;
      },
    }],
  });
  if (r !== 'ok' || !waarden) return null;
  return {
    niveau: selNiveau.value, type: selType.value, helling: selType.value === 'plat' ? 0 : waarden.helling,
    nokrichting: selNok.value, overstek: waarden.overstek, status: selStatus.value,
  };
}

/** Niveaus met een hellend dak (status ≠ afbraak), van laag naar hoog: kandidaten om een zolder onder te maken. */
export function zolderKandidaten(model) {
  return [...model.niveaus].sort((a, b) => a.peil - b.peil)
    .filter((n) => model.daken.some((d) => d.niveau === n.id && d.status !== 'afbraak' && d.type !== 'plat' && d.helling > 0));
}

/**
 * Zolder toevoegen onder het hellende dak van een niveau (fase 5).
 * @returns {Promise<{ onderNiveau, naam, vloerdikte?, status }|null>}
 */
export async function zolderDialoog(model, niveauId) {
  const kandidaten = zolderKandidaten(model);
  if (!kandidaten.length) {
    await dialoog({
      titel: 'Zolder toevoegen',
      inhoud: h('p', {}, 'Geen enkel niveau heeft een hellend dak. Een zolder komt onder een hellend dak; stel eerst een dak in (knop Dak).'),
      knoppen: [{ label: 'Sluiten', waarde: null }],
    });
    return null;
  }
  const standaard = kandidaten.find((n) => n.id === niveauId) || kandidaten[kandidaten.length - 1];
  const selOnder = h('select', { id: 'dlg-zolder-onder' }, ...kandidaten.map((n) => h('option', { value: n.id, selected: n.id === standaard.id }, `${n.naam} (${n.id})`)));
  const inpNaam = h('input', { id: 'dlg-zolder-naam', type: 'text', value: 'Zolder', autocomplete: 'off' });
  const inpDikte = getalInvoer('dlg-zolder-dikte', '');
  inpDikte.placeholder = 'zoals het niveau eronder';
  const selStatus = keuze('dlg-zolder-status', STATUSSEN, 'nieuw');
  const fout = foutRegel();
  let dikte = null;
  const r = await dialoog({
    titel: 'Zolder toevoegen',
    inhoud: [
      h('p', {}, 'Nieuw niveau (soort zolder) op de bovenkant van het gekozen niveau. De vloer volgt de contour van het hellende dak; het dak blijft op het niveau eronder rusten. De verdiepingshoogte wordt de nokhoogte.'),
      veld('dlg-zolder-onder', 'Onder het dak van', selOnder),
      veld('dlg-zolder-naam', 'Naam', inpNaam),
      veld('dlg-zolder-dikte', 'Vloerdikte (mm, optioneel)', inpDikte),
      veld('dlg-zolder-status', 'Status van de vloer', selStatus),
      fout,
    ],
    knoppen: [{ label: 'Annuleren', waarde: null }, {
      label: 'Toevoegen', waarde: 'ok', soort: 'primair',
      controle: () => {
        if (!inpNaam.value.trim()) { fout.textContent = 'Geef een naam.'; fout.hidden = false; return false; }
        if (!inpDikte.value.trim()) { dikte = null; return true; }
        const w = leesGetallen([{ inp: inpDikte, sleutel: 'd', naam: 'Vloerdikte', min: 20, max: 2000 }], fout);
        dikte = w?.d ?? null;
        return !!w;
      },
    }],
    bijOpenen: () => { selOnder.focus(); },
  });
  if (r !== 'ok') return null;
  const uit = { onderNiveau: selOnder.value, naam: inpNaam.value.trim(), status: selStatus.value };
  if (dikte != null) uit.vloerdikte = dikte;
  return uit;
}

/**
 * Bevestiging van een afbraakzone met wat er gebeurt en de randmuren als waarschuwing.
 * @param {{ ruimtes: string[], tellingen: object, randMuren: string[], meldingen: string[], namen: string[] }} o
 * @returns {Promise<boolean>}
 */
export async function afbraakDialoog({ namen = [], tellingen = {}, randMuren = [], meldingen = [] }) {
  const t = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;
  const regels = [];
  if (tellingen.muren) regels.push(`${t(tellingen.muren, 'muur(stuk)', 'muurstukken')} op afbraak`);
  if (tellingen.openingen) regels.push(`${t(tellingen.openingen, 'opening', 'openingen')} op afbraak`);
  if (tellingen.vloeren) regels.push(`${t(tellingen.vloeren, 'vloer', 'vloeren')} op afbraak`);
  if (tellingen.daken) regels.push(`${t(tellingen.daken, 'dak', 'daken')} op afbraak`);
  if (tellingen.trappen) regels.push(`${t(tellingen.trappen, 'trap', 'trappen')} op afbraak`);
  if (tellingen.inrichting) regels.push(`${t(tellingen.inrichting, 'inrichtingselement', 'inrichtingselementen')} op afbraak`);
  regels.push(`${t(namen.length, 'ruimte', 'ruimtes')} verwijderd (${namen.join(', ')})`);
  const andere = meldingen.filter((m) => !/^Blijvende muren/.test(m));
  const r = await dialoog({
    titel: 'Gebouwdeel afbreken?',
    klasse: 'breed',
    inhoud: [
      h('ul', { class: 'afbraak-lijst' }, ...regels.map((x) => h('li', {}, x))),
      randMuren.length ? h('div', { class: 'dlg-waarschuwing', id: 'afbraak-randmuren' },
        h('strong', {}, 'Mogelijk dragend: '),
        `deze muren blijven staan maar liggen op de rand van de zone (worden mogelijk buitengevel): ${randMuren.join(', ')}. Laat dit nagaan door een architect of ingenieur.`) : null,
      andere.length ? h('ul', { class: 'dlg-info' }, ...andere.map((x) => h('li', {}, x))) : null,
      h('p', { class: 'veld-uitleg' }, 'Eén stap: ongedaan maken kan.'),
    ],
    knoppen: [{ label: 'Annuleren', waarde: null }, { label: 'Afbreken', waarde: true, soort: 'gevaar' }],
  });
  return r === true;
}
