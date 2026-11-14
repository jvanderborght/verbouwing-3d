// Dialoogvensters (native <dialog>) en meldingen. Geen window.confirm/prompt: die zijn op telefoons onhandig.

import { h, leeg } from './dom.js';

/**
 * Toont een modaal venster en wacht op een keuze.
 * @param {{ titel: string, inhoud?: Node|string|Array, knoppen: Array<{ label: string, waarde: any, soort?: 'primair'|'gevaar'|'' }>, klasse?: string }} o
 * @returns {Promise<any>} waarde van de gekozen knop; null bij Escape/annuleren.
 */
export function dialoog({ titel, inhoud = null, knoppen, klasse = '', bijOpenen }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `dialoog ${klasse}`, 'aria-labelledby': 'dlg-titel' });
    const form = h('form', { method: 'dialog' });
    let waarde = null;
    form.append(
      h('h2', { id: 'dlg-titel', class: 'dlg-titel' }, titel),
      h('div', { class: 'dlg-inhoud' }, ...(Array.isArray(inhoud) ? inhoud : [inhoud])),
      h('div', { class: 'dlg-knoppen' }, ...knoppen.map((k) => h('button', {
        type: k.waarde === null ? 'button' : 'submit',
        class: `knop ${k.soort || ''}`,
        value: '',
        'data-waarde': String(k.waarde),
        onclick: (e) => {
          if (typeof k.controle === 'function' && !k.controle()) { e.preventDefault(); return; }
          waarde = k.waarde;
          if (k.waarde === null) dlg.close();
        },
      }, k.label))),
    );
    dlg.append(form);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(waarde); });
    document.body.append(dlg);
    dlg.showModal();
    bijOpenen?.(dlg);
  });
}

export async function bevestig(titel, tekst, { ja = 'OK', nee = 'Annuleren', gevaar = false } = {}) {
  const r = await dialoog({ titel, inhoud: h('p', {}, tekst), knoppen: [{ label: nee, waarde: null }, { label: ja, waarde: true, soort: gevaar ? 'gevaar' : 'primair' }] });
  return r === true;
}

/** Vraagt één tekstwaarde. → string of null */
export async function vraagTekst(titel, label, standaard = '', { ok = 'OK', uitleg = '' } = {}) {
  const inp = h('input', { type: 'text', value: standaard, autocomplete: 'off', required: true, id: 'dlg-invoer' });
  const r = await dialoog({
    titel,
    inhoud: [uitleg ? h('p', {}, uitleg) : null, h('label', { class: 'veld-label', for: 'dlg-invoer' }, label), inp],
    knoppen: [{ label: 'Annuleren', waarde: null }, { label: ok, waarde: 'ok', soort: 'primair', controle: () => !!inp.value.trim() }],
    bijOpenen: () => { inp.focus(); inp.select(); },
  });
  return r === 'ok' ? inp.value.trim() : null;
}

// ---------------------------------------------------------------- meldingen (toasts)

let houder;
/** Korte melding onderaan. soort: 'info' | 'ok' | 'fout'. Fouten blijven staan tot ze gesloten worden. */
export function meld(tekst, soort = 'info', { duur } = {}) {
  houder ||= document.getElementById('meldingen');
  if (!houder) return;
  const sluit = () => { el.classList.add('weg'); setTimeout(() => el.remove(), 200); };
  const el = h('div', { class: `melding melding-${soort}`, role: soort === 'fout' ? 'alert' : 'status' },
    h('div', { class: 'melding-tekst' }, ...String(tekst).split('\n').flatMap((r, i) => (i ? [h('br'), r] : [r]))),
    h('button', { type: 'button', class: 'melding-sluit', 'aria-label': 'Melding sluiten', onclick: sluit }, '×'));
  houder.append(el);
  while (houder.children.length > 4) houder.firstChild.remove();
  const d = duur ?? (soort === 'fout' ? 0 : 4500);
  if (d) setTimeout(sluit, d);
  return el;
}

export function wisMeldingen() { if (houder) leeg(houder); }
