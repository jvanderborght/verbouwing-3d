// Kleine DOM-hulpjes (geen framework).

/**
 * h('button', { class: 'knop', onclick: fn, disabled: true }, 'tekst', kindNode, null)
 * Booleans → attribuut aan/uit; on* → event listener; null/false-kinderen worden overgeslagen.
 */
export function h(tag, attrs = {}, ...kinderen) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && tag === 'input') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kind of kinderen.flat()) {
    if (kind == null || kind === false) continue;
    el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return el;
}

export function leeg(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const $ = (sel, root = document) => root.querySelector(sel);
