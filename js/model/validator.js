// Validatie van een ontwerp. Geeft { geldig, fouten, waarschuwingen } terug.
// fouten blokkeren toepassen/opslaan; waarschuwingen niet.

import { SCHEMA_VERSIE, VELDEN, ENUMS, COLLECTIES, COLLECTIE_NAMEN, MODEL_VELDEN } from './schema.js';
import { muurLengte, muurHoogte, polygoonOppervlakte, muurRechthoek } from './geometry.js';
import { INSTELLINGEN_STANDAARD, metInstellingen, instelling } from './instellingen.js';
import { trapGeometrie } from './trappen.js';
import { niveauBegrenzing, inEenVan, minVrijeHoogte, trapLoophoogte } from './hoogte.js';
import { inrichtingContour, polygonenOverlappen } from './vormen.js';
import { valideerProgramma } from './programma.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isPunt = (v) => Array.isArray(v) && v.length === 2 && v.every(isGetal);
const MAX_MAAT = 1_000_000; // 1 km: alles daarboven is zeker een eenheidsfout

/**
 * @param {object} model
 * @param {{ instellingen?: object }} [opties] gebruikersinstellingen (grenzen voor trappen e.d.; standaard: geen grenzen)
 */
export function validate(model, opties = {}) {
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
  if (model.idTeller !== undefined) {
    const t = model.idTeller;
    if (!t || typeof t !== 'object' || Array.isArray(t)) fout('idTeller', 'idTeller moet een object {voorvoegsel: nummer} zijn.');
    else for (const [k, v] of Object.entries(t)) {
      if (!Object.values(COLLECTIES).includes(k)) fout(`idTeller.${k}`, `Onbekend id-voorvoegsel "${k}"; kies uit: ${Object.values(COLLECTIES).join(', ')}.`);
      else if (!Number.isInteger(v) || v < 0) fout(`idTeller.${k}`, 'Teller moet een geheel getal ≥ 0 zijn.');
    }
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
        if (type === 'getallen') {
          if (!Array.isArray(v) || !v.every(isGetal)) fout(vp, `${naam} moet een lijst getallen (mm) zijn.`);
          else if (v.some((x) => x <= 0 || x > MAX_MAAT)) fout(vp, `${naam}: elke waarde moet > 0 mm zijn.`);
        } else if (type === 'string') { if (typeof v !== 'string' || (verplicht && !v.trim())) fout(vp, `${naam} moet niet-lege tekst zijn.`); }
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
    valideerDakVorm(d, pad, fout, let_op);
  });

  // ── schemaVersie 2 ─────────────────────────────────────────────────────────
  const inst = opties.instellingen ? metInstellingen(opties.instellingen) : INSTELLINGEN_STANDAARD;
  const niveauVan = (id) => ids.niveaus?.get(id);
  const actieveMuren = (niveau) => arr('muren').filter((m) => m.niveau === niveau && m.status !== 'afbraak' && isPunt(m.start) && isPunt(m.eind) && isGetal(m.dikte) && muurLengte(m) >= 1);

  arr('trappen').forEach((t, i) => {
    const pad = `trappen[${i}]`;
    if (!t || typeof t !== 'object') return;
    for (const k of ['breedte', 'aantrede', 'optrede', 'diameter']) if (isGetal(t[k]) && t[k] <= 0) fout(`${pad}.${k}`, `${k} moet > 0 zijn.`);
    if (isGetal(t.aantalTreden) && (!Number.isInteger(t.aantalTreden) || t.aantalTreden < 2)) fout(`${pad}.aantalTreden`, 'aantalTreden moet een geheel getal ≥ 2 zijn (aantal optreden).');
    if (isGetal(t.diameter) && t.type !== 'spiraal') let_op(`${pad}.diameter`, 'diameter wordt enkel gebruikt bij een spiraaltrap.');
    const a = niveauVan(t.vanNiveau), b = niveauVan(t.naarNiveau);
    if (!a || !b || !isGetal(a.peil) || !isGetal(b.peil)) return;
    if (t.vanNiveau === t.naarNiveau) { fout(pad, 'vanNiveau en naarNiveau moeten verschillen.'); return; }
    if (b.peil <= a.peil) { fout(pad, `naarNiveau "${b.id}" moet boven vanNiveau "${a.id}" liggen.`); return; }
    if (!isPunt(t.oorsprong) || !isGetal(t.breedte) || t.breedte <= 0 || !isGetal(t.richting)) return;
    const g = trapGeometrie(model, t, { instellingen: inst });
    if (!g) return;
    if (g.fout) { fout(pad, g.fout); return; }
    const H = b.peil - a.peil, m = g.maten;
    if (isGetal(t.aantalTreden) && isGetal(t.optrede) && Math.abs(t.aantalTreden * t.optrede - H) > 5)
      let_op(pad, `aantalTreden × optrede (${t.aantalTreden} × ${t.optrede}) wijkt af van het hoogteverschil ${H} mm.`);
    // grenzen uit de instellingen (standaard leeg ⇒ niet getoetst)
    const grensRegel = (sleutel, waarde, groter, tekst) => {
      const gw = instelling(inst, `trap.${sleutel}`);
      if (!isGetal(gw) || !isGetal(waarde)) return;
      if (groter ? waarde > gw + 0.5 : waarde < gw - 0.5) let_op(pad, `${tekst} ${Math.round(waarde)} mm ${groter ? '>' : '<'} ingestelde grens ${gw} mm${inst.trap[sleutel]?.bron ? ` (${inst.trap[sleutel].bron})` : ''}.`);
    };
    grensRegel('maxOptrede', m.optrede, true, 'Optrede');
    grensRegel('minOptrede', m.optrede, false, 'Optrede');
    grensRegel('maxAantrede', m.aantrede, true, 'Aantrede');
    grensRegel('minAantrede', m.aantrede, false, 'Aantrede');
    grensRegel('minBreedte', t.breedte, false, 'Breedte');
    if (isGetal(instelling(inst, 'trap.minLoophoogte'))) {
      const lh = trapLoophoogte(model, t, { instellingen: inst });
      if (lh?.min != null) grensRegel('minLoophoogte', lh.min, false, 'Loophoogte');
    }
    // binnen de begrenzing van beide niveaus (vloeren; niveau zonder vloeren ⇒ niet getoetst)
    for (const [nid, rol] of [[t.vanNiveau, 'vanNiveau'], [t.naarNiveau, 'naarNiveau']]) {
      const grens = niveauBegrenzing(model, nid);
      if (!grens.length) continue;
      if (!g.voetafdruk.every((p) => inEenVan(p, grens, 2)))
        fout(pad, `Trap ${t.id} valt buiten de vloer(en) van ${rol} "${nid}"${rol === 'naarNiveau' ? ' (trapgat)' : ''}.`);
    }
    for (const nid of [t.vanNiveau, t.naarNiveau]) {
      const botsing = actieveMuren(nid).find((mu) => polygonenOverlappen(g.voetafdruk, muurRechthoek(mu), 2));
      if (botsing) let_op(pad, `Trap ${t.id} overlapt met muur ${botsing.id} op niveau ${nid}.`);
    }
  });

  arr('inrichting').forEach((x, i) => {
    const pad = `inrichting[${i}]`;
    if (!x || typeof x !== 'object') return;
    for (const k of ['breedte', 'diepte', 'hoogte']) if (isGetal(x[k]) && x[k] <= 0) fout(`${pad}.${k}`, `${k} moet > 0 zijn.`);
    const r = typeof x.ruimte === 'string' ? ids.ruimtes?.get(x.ruimte) : null;
    if (r && r.niveau !== x.niveau) fout(`${pad}.ruimte`, `Ruimte "${r.id}" ligt op niveau ${r.niveau}, niet op ${x.niveau}.`);
    if (!niveauVan(x.niveau) || !isPunt(x.positie) || !isGetal(x.breedte) || !isGetal(x.diepte) || x.breedte <= 0 || x.diepte <= 0) return;
    const c = inrichtingContour(x);
    const grens = niveauBegrenzing(model, x.niveau);
    if (grens.length && !c.every((p) => inEenVan(p, grens, 2))) fout(pad, `${x.soort} ${x.id} valt buiten de vloer(en) van niveau ${x.niveau}.`);
    if (r && Array.isArray(r.contour) && r.contour.length >= 3 && !c.every((p) => inEenVan(p, [r.contour], 2)))
      let_op(pad, `${x.soort} ${x.id} ligt (deels) buiten ruimte ${r.id}.`);
    if (isGetal(x.hoogte) && x.status !== 'afbraak') {
      const vh = minVrijeHoogte(model, x.niveau, c, { instellingen: inst });
      if (vh != null && vh < x.hoogte - 0.5) let_op(pad, `${x.soort} ${x.id}: vrije hoogte ${Math.round(vh)} mm is lager dan het element (${x.hoogte} mm).`);
    }
  });

  if (model.programma !== undefined && model.programma !== null) {
    for (const p of valideerProgramma(model.programma)) (p.ernst === 'fout' ? fout : let_op)(p.pad, p.melding);
  }

  return { geldig: fouten.length === 0, fouten, waarschuwingen };
}

/** Leesbare samenvatting voor CLI/meldingen. */
export function formatteerFouten(resultaat) {
  return [
    ...resultaat.fouten.map((f) => `FOUT  ${f.pad || '(ontwerp)'}: ${f.melding}`),
    ...resultaat.waarschuwingen.map((f) => `LET OP ${f.pad || '(ontwerp)'}: ${f.melding}`),
  ].join('\n');
}

/** basisHoogte / hogeZijde van een dak (optioneel, zonder nieuwe schemaVersie). Het type zelf toetst de generieke veldcontrole. */
function valideerDakVorm(d, pad, fout, let_op) {
  if (isGetal(d.basisHoogte)) {
    if (d.basisHoogte < 0) fout(`${pad}.basisHoogte`, 'basisHoogte mag niet negatief zijn.');
    else if (d.basisHoogte > 0 && (d.type === 'plat' || !d.helling)) let_op(`${pad}.basisHoogte`, 'basisHoogte geldt enkel voor hellende daken en wordt hier genegeerd.');
  }
  if (d.hogeZijde !== undefined && d.type !== 'lessenaar') let_op(`${pad}.hogeZijde`, 'hogeZijde geldt enkel voor een lessenaarsdak en wordt hier genegeerd.');
}
