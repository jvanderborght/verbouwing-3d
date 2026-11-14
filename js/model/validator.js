// Validatie van een ontwerp. Geeft { geldig, fouten, waarschuwingen } terug.
// fouten blokkeren toepassen/opslaan; waarschuwingen niet.

import { SCHEMA_VERSIE, VELDEN, ENUMS, COLLECTIE_NAMEN, MODEL_VELDEN } from './schema.js';
import { muurLengte, muurHoogte, polygoonOppervlakte } from './geometry.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isPunt = (v) => Array.isArray(v) && v.length === 2 && v.every(isGetal);
const MAX_MAAT = 1_000_000; // 1 km: alles daarboven is zeker een eenheidsfout

export function validate(model) {
  const fouten = [];
  const waarschuwingen = [];
  const fout = (pad, melding) => fouten.push({ pad, melding });
  const let_op = (pad, melding) => waarschuwingen.push({ pad, melding });

  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    fout('', 'Ontwerp moet een JSON-object zijn.');
    return { geldig: false, fouten, waarschuwingen };
  }
  if (model.schemaVersie !== SCHEMA_VERSIE) fout('schemaVersie', `Verwacht schemaVersie ${SCHEMA_VERSIE}, kreeg ${model.schemaVersie}.`);
  if (typeof model.id !== 'string' || !/^[a-z0-9][a-z0-9-_]*$/.test(model.id)) fout('id', 'id moet bestaan uit kleine letters, cijfers, - of _ (wordt bestandsnaam).');
  if (typeof model.naam !== 'string' || !model.naam.trim()) fout('naam', 'naam is verplicht.');
  if (model.beschrijving !== undefined && typeof model.beschrijving !== 'string') fout('beschrijving', 'beschrijving moet tekst zijn.');
  if (model.basis !== undefined && model.basis !== null && typeof model.basis !== 'string') fout('basis', 'basis moet een ontwerp-id of null zijn.');
  if (model.perceel !== undefined && model.perceel !== null) {
    const c = model.perceel.contour;
    if (!Array.isArray(c) || c.length < 3 || !c.every(isPunt) || polygoonOppervlakte(c) < 1) fout('perceel.contour', 'perceel.contour moet minstens 3 punten [x, y] met oppervlakte bevatten.');
  }
  for (const k of Object.keys(model)) if (!MODEL_VELDEN.includes(k)) let_op(k, `Onbekend veld "${k}" wordt genegeerd.`);

  const ids = {};
  for (const c of COLLECTIE_NAMEN) {
    if (!Array.isArray(model[c])) { fout(c, `${c} moet een lijst zijn.`); ids[c] = new Map(); continue; }
    ids[c] = new Map();
    model[c].forEach((item, i) => {
      const pad = `${c}[${i}]`;
      if (!item || typeof item !== 'object') { fout(pad, 'Element moet een object zijn.'); return; }
      if (typeof item.id === 'string') {
        if (ids[c].has(item.id)) fout(`${pad}.id`, `Dubbel id "${item.id}" in ${c}.`);
        ids[c].set(item.id, item);
      }
    });
  }
  // id's moeten globaal uniek zijn (operaties en diff verwijzen naar id)
  const alle = new Map();
  for (const c of COLLECTIE_NAMEN) for (const id of ids[c].keys()) {
    if (alle.has(id)) fout(c, `id "${id}" komt voor in ${alle.get(id)} én ${c}; id's moeten uniek zijn.`);
    else alle.set(id, c);
  }

  for (const c of COLLECTIE_NAMEN) {
    if (!Array.isArray(model[c])) continue;
    const velden = VELDEN[c];
    model[c].forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const pad = `${c}[${i}]`;
      for (const [naam, type, verplicht] of velden) {
        const v = item[naam];
        const vp = `${pad}.${naam}`;
        if (v === undefined || v === null) { if (verplicht) fout(vp, `${naam} is verplicht.`); continue; }
        if (type === 'string') { if (typeof v !== 'string' || (verplicht && !v.trim())) fout(vp, `${naam} moet niet-lege tekst zijn.`); }
        else if (type === 'number') {
          if (!isGetal(v)) fout(vp, `${naam} moet een getal (mm) zijn.`);
          else if (Math.abs(v) > MAX_MAAT) fout(vp, `${naam} = ${v} mm is onrealistisch groot (eenheid mm?).`);
        } else if (type === 'punt') { if (!isPunt(v)) fout(vp, `${naam} moet [x, y] in mm zijn.`); else if (v.some((x) => Math.abs(x) > MAX_MAAT)) fout(vp, `${naam} ligt onrealistisch ver.`); }
        else if (type === 'contour') {
          if (!Array.isArray(v) || v.length < 3 || !v.every(isPunt)) fout(vp, `${naam} moet minstens 3 punten [x, y] bevatten.`);
          else if (polygoonOppervlakte(v) < 1) fout(vp, `${naam} heeft geen oppervlakte.`);
        } else if (type.startsWith('enum:')) {
          const lijst = ENUMS[type.slice(5)];
          if (!lijst.includes(v)) fout(vp, `${naam} "${v}" is ongeldig; kies uit: ${lijst.join(', ')}.`);
        } else if (type.startsWith('ref:')) {
          const doel = type.slice(4);
          if (typeof v !== 'string' || !ids[doel]?.has(v)) fout(vp, `${naam} verwijst naar onbekend ${doel.replace(/s$|en$/, '')} "${v}".`);
        }
      }
      for (const k of Object.keys(item)) if (!velden.some(([n]) => n === k)) let_op(`${pad}.${k}`, `Onbekend veld "${k}".`);
    });
  }

  // Inhoudelijke regels
  const arr = (c) => (Array.isArray(model[c]) ? model[c] : []);
  arr('niveaus').forEach((n, i) => {
    if (isGetal(n.hoogte) && n.hoogte <= 0) fout(`niveaus[${i}].hoogte`, 'hoogte moet > 0 zijn.');
    if (isGetal(n.vloerdikte) && n.vloerdikte < 0) fout(`niveaus[${i}].vloerdikte`, 'vloerdikte mag niet negatief zijn.');
  });
  if (arr('niveaus').length === 0) fout('niveaus', 'Er moet minstens één niveau zijn.');
  const gesorteerd = [...arr('niveaus')].filter((n) => isGetal(n.peil) && isGetal(n.hoogte)).sort((a, b) => a.peil - b.peil);
  for (let i = 1; i < gesorteerd.length; i++) {
    const a = gesorteerd[i - 1], b = gesorteerd[i];
    if (a.peil + a.hoogte > b.peil + 1) let_op('niveaus', `Niveau "${a.id}" overlapt met "${b.id}" (peil + hoogte > volgend peil).`);
  }

  arr('muren').forEach((m, i) => {
    const pad = `muren[${i}]`;
    if (isPunt(m.start) && isPunt(m.eind) && muurLengte(m) < 1) fout(pad, 'Muur heeft lengte 0.');
    if (isGetal(m.dikte) && m.dikte <= 0) fout(`${pad}.dikte`, 'dikte moet > 0 zijn.');
    if (isGetal(m.dikte) && m.dikte > 1500) let_op(`${pad}.dikte`, `dikte ${m.dikte} mm is ongewoon groot.`);
    if (isGetal(m.hoogte) && m.hoogte <= 0) fout(`${pad}.hoogte`, 'hoogte moet > 0 zijn.');
  });

  arr('openingen').forEach((o, i) => {
    const pad = `openingen[${i}]`;
    for (const k of ['breedte', 'hoogte']) if (isGetal(o[k]) && o[k] <= 0) fout(`${pad}.${k}`, `${k} moet > 0 zijn.`);
    if (isGetal(o.borstwering) && o.borstwering < 0) fout(`${pad}.borstwering`, 'borstwering mag niet negatief zijn.');
    if (isGetal(o.positie) && o.positie < 0) fout(`${pad}.positie`, 'positie mag niet negatief zijn.');
    const m = ids.muren?.get(o.muur);
    if (!m || !isPunt(m.start) || !isPunt(m.eind)) return;
    const L = muurLengte(m);
    if (isGetal(o.positie) && isGetal(o.breedte) && o.positie + o.breedte > L + 0.5)
      fout(pad, `Opening valt buiten de muur (positie ${o.positie} + breedte ${o.breedte} > muurlengte ${Math.round(L)} mm).`);
    const H = muurHoogte(model, m);
    if (isGetal(o.borstwering) && isGetal(o.hoogte) && H > 0 && o.borstwering + o.hoogte > H + 0.5)
      fout(pad, `Opening is hoger dan de muur (borstwering ${o.borstwering} + hoogte ${o.hoogte} > ${H} mm).`);
    if (o.type === 'deur' && isGetal(o.borstwering) && o.borstwering > 0) let_op(`${pad}.borstwering`, 'Deur met borstwering > 0.');
    if (m.status === 'afbraak' && o.status === 'nieuw') let_op(pad, 'Nieuwe opening in een af te breken muur.');
  });
  // overlappende openingen in dezelfde muur
  const perMuur = new Map();
  arr('openingen').forEach((o, i) => { if (!perMuur.has(o.muur)) perMuur.set(o.muur, []); perMuur.get(o.muur).push([o, i]); });
  for (const lijst of perMuur.values()) {
    const actief = lijst.filter(([o]) => o.status !== 'afbraak' && isGetal(o.positie) && isGetal(o.breedte)).sort((a, b) => a[0].positie - b[0].positie);
    for (let k = 1; k < actief.length; k++) {
      const [a] = actief[k - 1]; const [b, j] = actief[k];
      if (a.positie + a.breedte > b.positie + 0.5) fout(`openingen[${j}]`, `Opening "${b.id}" overlapt met "${a.id}" in dezelfde muur.`);
    }
  }

  arr('vloeren').forEach((v, i) => { if (isGetal(v.dikte) && v.dikte <= 0) fout(`vloeren[${i}].dikte`, 'dikte moet > 0 zijn.'); });
  arr('daken').forEach((d, i) => {
    const pad = `daken[${i}]`;
    if (isGetal(d.helling)) {
      if (d.helling < 0 || d.helling > 75) fout(`${pad}.helling`, 'helling moet tussen 0 en 75° liggen.');
      if (d.type === 'plat' && d.helling > 5) let_op(`${pad}.helling`, 'Plat dak met helling > 5°.');
      if (d.type !== 'plat' && d.helling < 5) let_op(`${pad}.helling`, `Hellend dak (${d.type}) met helling < 5°.`);
    }
    if (d.type !== 'plat' && Array.isArray(d.contour) && d.contour.length !== 4) let_op(`${pad}.contour`, 'Hellende daken worden berekend op de rechthoekige begrenzing van de contour.');
    if (isGetal(d.overstek) && d.overstek < 0) fout(`${pad}.overstek`, 'overstek mag niet negatief zijn.');
  });

  return { geldig: fouten.length === 0, fouten, waarschuwingen };
}

/** Leesbare samenvatting voor CLI/meldingen. */
export function formatteerFouten(resultaat) {
  return [
    ...resultaat.fouten.map((f) => `FOUT  ${f.pad || '(ontwerp)'}: ${f.melding}`),
    ...resultaat.waarschuwingen.map((f) => `LET OP ${f.pad || '(ontwerp)'}: ${f.melding}`),
  ].join('\n');
}
