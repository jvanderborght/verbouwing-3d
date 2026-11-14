// Validatieregels voor dakkapellen (optionele collectie). Apart bestand om validator.js klein te houden.
// Geeft meldingen terug: { pad, melding, ernst: 'fout' | 'waarschuwing' }. Zie docs/DATAMODEL.md "Dakkapellen".

import { dakkapelGeometrie } from './dakkapellen.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const RAAM_VELDEN = ['breedte', 'hoogte', 'borstwering'];

/** Vorm van het veld `raam`. → [{ sub?, melding, ernst }] */
export function valideerRaamVeld(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [{ melding: 'raam moet een object { breedte, hoogte, borstwering? } zijn.', ernst: 'fout' }];
  const uit = [];
  for (const k of ['breedte', 'hoogte']) if (!isGetal(r[k]) || r[k] <= 0) uit.push({ sub: k, melding: `${k} van het raam moet een getal > 0 mm zijn.`, ernst: 'fout' });
  if (r.borstwering !== undefined && r.borstwering !== null && (!isGetal(r.borstwering) || r.borstwering < 0)) uit.push({ sub: 'borstwering', melding: 'borstwering van het raam moet een getal ≥ 0 mm zijn.', ernst: 'fout' });
  for (const k of Object.keys(r)) if (!RAAM_VELDEN.includes(k)) uit.push({ sub: k, melding: `Onbekend veld "${k}" in raam.`, ernst: 'waarschuwing' });
  return uit;
}

/** Overlappen twee intervallen meer dan `tol` mm? */
const overlap = (a0, a1, b0, b1, tol = 1) => Math.min(a1, b1) - Math.max(a0, b0) > tol;

/**
 * Regels: dakkapel past in het dakvlak (niet over goot, nok of rand; zie dakkapelGeometrie), maten > 0, raam in het voorvlak,
 * geen overlap met een andere dakkapel (status ≠ afbraak) in hetzelfde dakvlak. Waarschuwing: dakkapel op een af te breken dak,
 * geen niveau in het dak (positie z geldt dan t.o.v. het rustvlak).
 */
export function valideerDakkapellen(model, opties = {}) {
  const lijst = Array.isArray(model?.dakkapellen) ? model.dakkapellen : [];
  const uit = [];
  const geldig = [];
  lijst.forEach((k, i) => {
    const pad = `dakkapellen[${i}]`;
    if (!k || typeof k !== 'object') return;
    for (const v of ['breedte', 'hoogte', 'diepte', 'dakdikte', 'zijwangDikte']) if (isGetal(k[v]) && k[v] <= 0) uit.push({ pad: `${pad}.${v}`, melding: `${v} moet > 0 zijn.`, ernst: 'fout' });
    const dak = (model.daken || []).find((d) => d.id === k.dak);
    if (!dak) return; // verwijzing: al gemeld door de veldcontrole
    if (!isGetal(k.positieX) || !isGetal(k.positieZ) || !isGetal(k.breedte) || !isGetal(k.hoogte) || k.breedte <= 0 || k.hoogte <= 0) return;
    const g = dakkapelGeometrie(model, k, opties);
    if (g.fout) { uit.push({ pad, melding: g.fout, ernst: 'fout' }); return; }
    if (dak.status === 'afbraak' && k.status !== 'afbraak') uit.push({ pad, melding: `Dakkapel ${k.id} staat in dak ${dak.id} dat afgebroken wordt.`, ernst: 'waarschuwing' });
    if (!g.referentie.niveau) uit.push({ pad, melding: `Er ligt geen niveau (zolder) in dak ${dak.id}; positie z geldt t.o.v. het rustvlak van het dak.`, ernst: 'waarschuwing' });
    if (k.status !== 'afbraak') geldig.push({ k, g, i });
  });
  for (let a = 0; a < geldig.length; a++) for (let b = a + 1; b < geldig.length; b++) {
    const A = geldig[a], B = geldig[b];
    if (A.k.dak !== B.k.dak || A.k.zijde !== B.k.zijde) continue;
    if (overlap(A.g.u0, A.g.u1, B.g.u0, B.g.u1) && overlap(A.g.dVoor, A.g.dAchter, B.g.dVoor, B.g.dAchter))
      uit.push({ pad: `dakkapellen[${B.i}]`, melding: `Dakkapel ${B.k.id} overlapt met ${A.k.id} in hetzelfde dakvlak.`, ernst: 'fout' });
  }
  return uit;
}
