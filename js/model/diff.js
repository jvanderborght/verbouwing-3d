// Verschil tussen twee ontwerpen, per element. Voor diff-preview (prompts) en vergelijking.

import { COLLECTIE_NAMEN } from './schema.js';

const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @returns {Array<{collectie, id, soort: 'toegevoegd'|'verwijderd'|'gewijzigd', velden?: Array<{veld, oud, nieuw}>}>}
 */
export function diff(a, b) {
  const uit = [];
  for (const k of ['naam', 'beschrijving', 'basis', 'perceel', 'programma']) {
    if (!gelijk(a[k], b[k])) uit.push({ collectie: 'ontwerp', id: b.id ?? a.id, soort: 'gewijzigd', velden: [{ veld: k, oud: a[k], nieuw: b[k] }] });
  }
  for (const c of COLLECTIE_NAMEN) {
    const A = new Map((a[c] || []).map((x) => [x.id, x]));
    const B = new Map((b[c] || []).map((x) => [x.id, x]));
    for (const [id, x] of A) if (!B.has(id)) uit.push({ collectie: c, id, soort: 'verwijderd', oud: x });
    for (const [id, y] of B) {
      if (!A.has(id)) { uit.push({ collectie: c, id, soort: 'toegevoegd', nieuw: y }); continue; }
      const x = A.get(id);
      const velden = [];
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (!gelijk(x[k], y[k])) velden.push({ veld: k, oud: x[k], nieuw: y[k] });
      if (velden.length) uit.push({ collectie: c, id, soort: 'gewijzigd', velden });
    }
  }
  return uit;
}

/** Korte Nederlandse samenvatting van een diff, één regel per wijziging. */
export function beschrijfDiff(d) {
  const fmt = (v) => (Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v));
  return d.map((r) => {
    if (r.soort === 'toegevoegd') return `+ ${r.collectie} ${r.id}`;
    if (r.soort === 'verwijderd') return `− ${r.collectie} ${r.id}`;
    return `~ ${r.collectie} ${r.id}: ${r.velden.map((v) => `${v.veld} ${fmt(v.oud)} → ${fmt(v.nieuw)}`).join('; ')}`;
  });
}
