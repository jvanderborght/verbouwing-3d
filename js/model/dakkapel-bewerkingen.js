// Bewerking: dakkapel plaatsen (geeft een operatielijst, past niets toe). Zie docs/DATAMODEL.md "Dakkapellen".

import { STATUSSEN, DAKKAPEL_TYPES } from './schema.js';
import { metInstellingen, instelling } from './instellingen.js';
import { volgendId } from './operations.js';
import { dakvlakAssen, dakkapelReferentie, dakkapelGeometrie, ZIJDEN_PER_NOK } from './dakkapellen.js';
import { valideerDakkapellen } from './dakkapel-regels.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const fout = (melding) => ({ ops: [], fout: melding });
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };

/**
 * Dakkapel plaatsen in een dakvlak.
 * p = { dak, zijde?, positieX?, positieZ?, punt?, breedte?, hoogte?, diepte?, dakdikte?, zijwangDikte?, raam?, type?, status = 'nieuw', instellingen? }
 *  - zijde leeg ⇒ de zijde van `punt` (dichtst bij welke goot), anders de eerste zijde van de nokrichting (voor / links).
 *  - positieX leeg ⇒ u van `punt`, anders het midden van het dak langs de nok.
 *  - positieZ leeg ⇒ de hoogte van de onderkant van het dak boven de zoldervloer in `punt` (het voorvlak komt op het tikpunt),
 *    anders de werkwaarde dakkapel.voorstelPositieZ.
 *  - breedte/hoogte leeg ⇒ werkwaarden dakkapel.voorstelBreedte/voorstelHoogte (vertrekmaat, GEEN norm).
 * Fout als de dakkapel niet in het dakvlak past (goot, nok, rand, hoekkeper) of een andere dakkapel in hetzelfde dakvlak overlapt.
 * info: { id, dVoor, diepte, plafond (boven de zoldervloer), vrijeHoogte (= positieZ + hoogte), standaard: [velden met werkwaarde] }
 */
export function opsDakkapelPlaatsen(model, p = {}) {
  const dak = (model.daken || []).find((d) => d.id === p.dak);
  if (!dak) return fout(`Dak "${p.dak}" niet gevonden.`);
  const status = p.status ?? 'nieuw';
  if (!STATUSSEN.includes(status)) return fout(`Status "${status}" is ongeldig.`);
  if (p.type != null && !DAKKAPEL_TYPES.includes(p.type)) return fout(`Dakkapeltype "${p.type}" is ongeldig; kies uit: ${DAKKAPEL_TYPES.join(', ')}.`);
  const inst = metInstellingen(p.instellingen);
  const r = dak.nokrichting || 'x';
  const punt = Array.isArray(p.punt) && p.punt.length === 2 && p.punt.every(isGetal) ? p.punt : null;
  let zijde = p.zijde;
  if (zijde == null) {
    zijde = ZIJDEN_PER_NOK[r]?.[0];
    if (punt) {
      const [a, b] = ZIJDEN_PER_NOK[r];
      const A = dakvlakAssen(dak, a);
      if (!A.fout) zijde = Math.abs((r === 'x' ? punt[1] : punt[0]) - A.goot) <= A.D / 2 ? a : b;
    }
  }
  const A = dakvlakAssen(dak, zijde);
  if (A.fout) return fout(A.fout);
  const standaard = [];
  const werk = (veld, sleutel) => { standaard.push(veld); return instelling(inst, `dakkapel.${sleutel}`); };
  const uPunt = punt ? (r === 'x' ? punt[0] : punt[1]) : null;
  const positieX = isGetal(p.positieX) ? p.positieX : (uPunt ?? (A.ulo + A.uhi) / 2);
  let positieZ = p.positieZ;
  if (!isGetal(positieZ)) {
    if (punt) {
      const ref = dakkapelReferentie(model, dak);
      const d = Math.abs((r === 'x' ? punt[1] : punt[0]) - A.goot);
      positieZ = Math.max(0, Math.round(A.h(positieX, d) + ref.rust - ref.peil));
    } else positieZ = werk('positieZ', 'voorstelPositieZ');
  }
  const breedte = isGetal(p.breedte) ? p.breedte : werk('breedte', 'voorstelBreedte');
  const hoogte = isGetal(p.hoogte) ? p.hoogte : werk('hoogte', 'voorstelHoogte');
  const id = volgendId(model, 'dakkapellen');
  const item = { id, dak: dak.id, zijde, positieX: r1(positieX), positieZ: r1(positieZ), breedte, hoogte };
  if (p.type != null) item.type = p.type;
  for (const k of ['diepte', 'dakdikte', 'zijwangDikte']) if (isGetal(p[k])) item[k] = p[k];
  if (p.raam != null) item.raam = { ...p.raam };
  item.status = status;
  const g = dakkapelGeometrie(model, item, { instellingen: inst });
  if (g.fout) return fout(g.fout);
  const proef = { ...model, dakkapellen: [...(model.dakkapellen || []), item] };
  const f = valideerDakkapellen(proef, { instellingen: inst }).find((m) => m.ernst === 'fout' && m.pad.startsWith(`dakkapellen[${proef.dakkapellen.length - 1}]`));
  if (f) return fout(f.melding);
  return {
    ops: [{ op: 'toevoegen', collectie: 'dakkapellen', item }],
    info: {
      id, dVoor: g.dVoor, diepte: g.diepte, plafond: g.plafond - g.referentie.peil, vrijeHoogte: item.positieZ + item.hoogte,
      niveau: g.referentie.niveau, standaard,
    },
  };
}
