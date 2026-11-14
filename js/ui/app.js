// App-schil: koppelt variantbeheer, views (3D/2D), bedieningsbalk, eigenschappenpaneel en GitHub-opslag.
// Alle modelwijzigingen lopen via operaties op de Geschiedenis van het actieve ontwerp.

import { validate, formatteerFouten } from '../model/index.js';
import { VariantBeheer, TOESTAND_LABELS } from './varianten.js';
import { LokaleOpslag } from './opslag.js';
import { tekenEigenschappen, elementUitPad, niveauVanElement, zoekElement } from './eigenschappen.js';
import { dialoog, bevestig, vraagTekst, meld } from './dialogen.js';
import { h, leeg, $ } from './dom.js';

const opslag = new LokaleOpslag();
const beheer = new VariantBeheer({ opslag });

const toestand = {
  selectie: null,
  planNiveau: null,
  verborgen: new Set(),
  doorsnede: null,          // null = uit, anders z in mm
  doorsnedeZ: 1200,
  toonWaarschuwingen: false,
  niveauSleutel: '',
};

const el = {
  kiezer: $('#variant-kiezer'), sync: $('#sync-status'), menuKnop: $('#knop-menu'), menu: $('#variant-menu'),
  opslaanKop: $('#knop-opslaan-gh'), undo: $('#knop-undo'), redo: $('#knop-redo'), zoom: $('#knop-zoom'),
  planNiveau: $('#plan-niveau'), vinkjes: $('#niveau-vinkjes'), dsAan: $('#doorsnede-aan'), dsZ: $('#doorsnede-z'),
  dsWaarde: $('#doorsnede-waarde'), weergave: $('#knop-weergave'), balkExtra: $('#balk-extra'),
  waarschKnop: $('#knop-waarschuwingen'), waarsch: $('#waarschuwingen'), eig: $('#eigenschappen'),
  werkvlak: $('#werkvlak'), splitter: $('#splitter'), importBestand: $('#import-bestand'),
  view3d: $('#view-3d'), view2d: $('#view-2d'),
};

// ---------------------------------------------------------------- views

const views = { v3d: null, v2d: null };

async function maakViews() {
  // Dynamisch importeren: als Three.js of WebGL faalt, blijft de rest van de app werken.
  try {
    const { Viewer3D } = await import('../views/viewer3d.js');
    views.v3d = new Viewer3D(el.view3d);
    views.v3d.opSelectie((id) => selecteer(id));
  } catch (e) {
    console.error('3D-weergave niet beschikbaar:', e);
    el.view3d.append(h('p', { class: 'view-fout' }, '3D-weergave kon niet gestart worden op dit toestel.'));
  }
  try {
    const { Plattegrond } = await import('../views/plan2d.js');
    views.v2d = new Plattegrond(el.view2d);
    views.v2d.opSelectie((id) => selecteer(id));
  } catch (e) {
    console.error('Plattegrond niet beschikbaar:', e);
    el.view2d.append(h('p', { class: 'view-fout' }, 'Plattegrond kon niet gestart worden.'));
  }
}

function renderViews() {
  const model = beheer.model;
  if (!model) return;
  try { views.v3d?.render(model, { verborgenNiveaus: [...toestand.verborgen], doorsnede: toestand.doorsnede, selectie: toestand.selectie }); }
  catch (e) { console.error('Fout bij 3D-weergave:', e); }
  try { if (toestand.planNiveau) views.v2d?.render(model, { niveau: toestand.planNiveau, selectie: toestand.selectie, toonMaten: true }); }
  catch (e) { console.error('Fout bij plattegrond:', e); }
}

// ---------------------------------------------------------------- weergave

function renderAlles() {
  const model = beheer.model;
  if (!model) return;
  if (toestand.selectie && !zoekElement(model, toestand.selectie)) toestand.selectie = null;
  bouwNiveauBediening(model);
  renderViews();
  renderEigenschappen();
  renderUndo();
  renderWaarschuwingen(model);
  renderKiezer();
}

function renderEigenschappen() {
  tekenEigenschappen(el.eig, { model: beheer.model, selectie: toestand.selectie, opWijzig: wijzig, opSelecteer: selecteer });
}

function renderUndo() {
  const g = beheer.geschiedenis;
  el.undo.disabled = !g?.kanUndo;
  el.redo.disabled = !g?.kanRedo;
  const lbl = (stap) => (stap?.label ? ` – ${stap.label}` : '');
  el.undo.title = `Ongedaan maken${lbl(g?.verleden.at(-1))} (Ctrl+Z)`;
  el.redo.title = `Opnieuw${lbl(g?.toekomst.at(-1))} (Ctrl+Shift+Z)`;
}

const KORT = { gewijzigd: 'lokaal gewijzigd', 'enkel-lokaal': 'enkel lokaal', conflict: 'conflict', 'github-nieuwer': 'nieuwer op GitHub' };

function renderKiezer() {
  const lijst = beheer.lijst();
  leeg(el.kiezer);
  for (const o of lijst) {
    el.kiezer.append(h('option', { value: o.id, selected: o.id === beheer.actiefId }, KORT[o.toestand] ? `${o.naam} (${KORT[o.toestand]})` : o.naam));
  }
  el.kiezer.disabled = lijst.length === 0;
  if (beheer.actiefId) el.kiezer.value = beheer.actiefId;
  const t = beheer.actiefId ? beheer.toestand(beheer.actiefId) : 'enkel-lokaal';
  el.sync.dataset.toestand = t;
  el.sync.title = TOESTAND_LABELS[t];
  $('.sync-tekst', el.sync).textContent = TOESTAND_LABELS[t];
  $('#menu-status').textContent = TOESTAND_LABELS[t];
  $('#menu-status').dataset.toestand = t;
}

function bouwNiveauBediening(model) {
  const niveaus = [...model.niveaus].sort((a, b) => a.peil - b.peil);
  const sleutel = niveaus.map((n) => `${n.id}:${n.naam}:${n.peil}:${n.hoogte}`).join('|');
  if (!niveaus.some((n) => n.id === toestand.planNiveau)) toestand.planNiveau = niveaus[0]?.id ?? null;
  for (const id of [...toestand.verborgen]) if (!niveaus.some((n) => n.id === id)) toestand.verborgen.delete(id);
  if (sleutel !== toestand.niveauSleutel) {
    toestand.niveauSleutel = sleutel;
    leeg(el.planNiveau);
    for (const n of niveaus) el.planNiveau.append(h('option', { value: n.id }, n.naam));
    leeg(el.vinkjes);
    for (const n of niveaus) {
      const cb = h('input', { type: 'checkbox', value: n.id, checked: !toestand.verborgen.has(n.id) });
      cb.addEventListener('change', () => { if (cb.checked) toestand.verborgen.delete(n.id); else toestand.verborgen.add(n.id); renderViews(); });
      el.vinkjes.append(h('label', { class: 'vinkje' }, cb, h('span', {}, n.naam)));
    }
    const laag = Math.min(...niveaus.map((n) => n.peil));
    const hoog = Math.max(...niveaus.map((n) => n.peil + n.hoogte));
    el.dsZ.min = String(Math.floor(laag / 50) * 50);
    el.dsZ.max = String(Math.ceil((hoog + 2500) / 50) * 50);
  }
  el.planNiveau.value = toestand.planNiveau ?? '';
  zetPlanTitel(model);
  for (const cb of el.vinkjes.querySelectorAll('input')) cb.checked = !toestand.verborgen.has(cb.value);
  zetDoorsnedeTekst();
}

function zetPlanTitel(model) {
  const n = model.niveaus.find((x) => x.id === toestand.planNiveau);
  $('#plan-titel-niveau').textContent = n ? `· ${n.naam}` : '';
}

function zetDoorsnedeTekst() {
  el.dsZ.value = String(toestand.doorsnedeZ);
  el.dsZ.disabled = toestand.doorsnede == null;
  el.dsAan.checked = toestand.doorsnede != null;
  el.dsWaarde.textContent = toestand.doorsnede == null ? 'uit' : `z = ${toestand.doorsnede.toLocaleString('nl-BE')} mm`;
}

function renderWaarschuwingen(model) {
  const w = validate(model).waarschuwingen;
  el.waarschKnop.hidden = w.length === 0;
  el.waarschKnop.textContent = w.length === 1 ? '1 aandachtspunt' : `${w.length} aandachtspunten`;
  el.waarschKnop.setAttribute('aria-expanded', String(toestand.toonWaarschuwingen && w.length > 0));
  el.waarsch.hidden = !(toestand.toonWaarschuwingen && w.length);
  leeg(el.waarsch);
  if (!w.length) return;
  el.waarsch.append(h('div', { class: 'waarsch-kop' }, h('strong', {}, 'Aandachtspunten'),
    h('button', { type: 'button', class: 'knop klein', onclick: () => { toestand.toonWaarschuwingen = false; renderWaarschuwingen(beheer.model); } }, 'Verbergen')));
  el.waarsch.append(h('ul', {}, ...w.map((x) => {
    const id = elementUitPad(model, x.pad);
    return h('li', {}, id
      ? h('button', { type: 'button', class: 'link', onclick: () => selecteer(id) }, `${id}: ${x.melding}`)
      : `${x.pad || 'ontwerp'}: ${x.melding}`);
  })));
}

// ---------------------------------------------------------------- acties op het model

/** Past operaties toe op het actieve ontwerp (undo-baar). Bij een fout: leesbare melding, niets gewijzigd. */
function wijzig(ops, label) {
  const g = beheer.geschiedenis;
  if (!g) return { ok: false };
  const r = g.toepassen(ops, label);
  if (!r.ok) meld(`Niet toegepast:\n${formatteerFouten({ fouten: r.fouten, waarschuwingen: [] })}`, 'fout');
  return r;
}

function selecteer(id) {
  const model = beheer.model;
  toestand.selectie = id && zoekElement(model, id) ? id : null;
  // Element op een ander niveau? Dan de plattegrond meenemen.
  const nv = toestand.selectie ? niveauVanElement(model, toestand.selectie) : null;
  if (nv && nv !== toestand.planNiveau) { toestand.planNiveau = nv; el.planNiveau.value = nv; zetPlanTitel(model); }
  renderViews();
  renderEigenschappen();
}

function undo() { const g = beheer.geschiedenis; if (g?.kanUndo) { const lbl = g.verleden.at(-1)?.label; g.undo(); if (lbl) meld(`Ongedaan: ${lbl}`, 'info', { duur: 1800 }); } }
function redo() { const g = beheer.geschiedenis; if (g?.kanRedo) { const lbl = g.toekomst.at(-1)?.label; g.redo(); if (lbl) meld(`Opnieuw: ${lbl}`, 'info', { duur: 1800 }); } }

// ---------------------------------------------------------------- variantbeheer

async function openOntwerp(id) {
  const r = await beheer.open(id);
  if (!r.ok) { meld(r.melding, 'fout'); renderKiezer(); return false; }
  if (r.melding) meld(r.melding, 'info', { duur: 9000 });
  return true;
}

async function actie(naam) {
  sluitMenu();
  const model = beheer.model;
  switch (naam) {
    case 'nieuw': {
      const n = await vraagTekst('Nieuw leeg ontwerp', 'Naam', 'Nieuw ontwerp', { ok: 'Aanmaken', uitleg: 'Een leeg ontwerp met één niveau. Het id (bestandsnaam) wordt uit de naam afgeleid.' });
      if (n == null) return;
      const r = beheer.nieuw(n);
      if (!r.ok) meld(r.melding, 'fout'); else meld(`"${n}" aangemaakt (id: ${r.id}).`, 'ok');
      return;
    }
    case 'dupliceren': {
      if (!model) return;
      const n = await vraagTekst('Dupliceren', 'Naam van de nieuwe variant', `${model.naam} (kopie)`, { ok: 'Dupliceren', uitleg: `Maakt een kopie van "${model.naam}" als nieuwe variant.` });
      if (n == null) return;
      const r = beheer.dupliceer(n);
      if (!r.ok) meld(r.melding, 'fout'); else meld(`Variant "${n}" aangemaakt (id: ${r.id}). Ze staat nog niet op GitHub.`, 'ok');
      return;
    }
    case 'hernoemen': {
      if (!model) return;
      const n = await vraagTekst('Hernoemen', 'Nieuwe naam', model.naam, { ok: 'Hernoemen', uitleg: `Het id "${model.id}" (bestandsnaam) blijft hetzelfde.` });
      if (n == null) return;
      const r = beheer.hernoem(n);
      if (!r.ok) meld(r.melding, 'fout');
      return;
    }
    case 'verwijderen': {
      if (!model) return;
      const opGithub = beheer.index.some((o) => o.id === model.id);
      const ok = await bevestig(`"${model.naam}" verwijderen?`, opGithub
        ? 'Dit verwijdert enkel de kopie en de lokale wijzigingen op dit toestel. De versie op GitHub blijft bestaan en verschijnt opnieuw in de lijst.'
        : 'Dit ontwerp staat niet op GitHub. Het wordt definitief verwijderd van dit toestel (exporteer het eerst als je het wil bewaren).', { ja: 'Verwijderen', gevaar: true });
      if (!ok) return;
      beheer.verwijder(model.id);
      const volgende = beheer.lijst()[0];
      if (volgende) await openOntwerp(volgende.id); else beheer.nieuw('Nieuw ontwerp');
      meld('Verwijderd.', 'ok');
      return;
    }
    case 'exporteren': return exporteer();
    case 'importeren': el.importBestand.value = ''; el.importBestand.click(); return;
    case 'opslaan-gh': return opslaanNaarGithub();
    case 'ophalen-gh': return ophalenVanGithub();
    case 'instellingen': return toonInstellingen();
  }
}

function exporteer() {
  const e = beheer.exporteer();
  if (!e) return;
  const url = URL.createObjectURL(new Blob([e.tekst], { type: 'application/json' }));
  const a = h('a', { href: url, download: e.bestandsnaam, hidden: true });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  meld(`${e.bestandsnaam} gedownload.`, 'ok');
}

async function importeer(bestand) {
  let tekst;
  try { tekst = await bestand.text(); }
  catch { meld('Het bestand kon niet gelezen worden.', 'fout'); return; }
  const r = beheer.controleerImport(tekst);
  if (!r.ok) {
    await dialoog({
      titel: 'Import geweigerd',
      inhoud: [h('p', {}, `"${bestand.name}" is geen geldig ontwerp. Er werd niets gewijzigd.`), h('ul', { class: 'foutlijst' }, ...r.fouten.slice(0, 20).map((f) => h('li', {}, f)))],
      knoppen: [{ label: 'Sluiten', waarde: true, soort: 'primair' }],
    });
    return;
  }
  let res;
  if (r.conflict) {
    const keuze = await dialoog({
      titel: 'Ontwerp bestaat al',
      inhoud: h('p', {}, `Er bestaat al een ontwerp met id "${r.model.id}". Importeer je dit bestand als nieuw ontwerp (id "${r.voorstelId}"), of vervang je het bestaande? Vervangen kan je ongedaan maken.`),
      knoppen: [{ label: 'Annuleren', waarde: null }, { label: 'Bestaande vervangen', waarde: 'vervang', soort: 'gevaar' }, { label: 'Als nieuw ontwerp', waarde: 'nieuw', soort: 'primair' }],
    });
    if (!keuze) return;
    if (keuze === 'vervang' && ['index', 'prijzen'].includes(r.model.id)) { meld('Dit id is gereserveerd; importeer als nieuw ontwerp.', 'fout'); return; }
    res = await beheer.importeer(r.model, keuze === 'vervang' ? { wijze: 'vervang' } : { wijze: 'nieuw', nieuwId: r.voorstelId });
  } else {
    res = await beheer.importeer(r.model, { wijze: 'nieuw', nieuwId: r.model.id });
  }
  if (!res.ok) meld(res.melding, 'fout');
  else meld(`"${beheer.model.naam}" geïmporteerd${r.waarschuwingen.length ? ` (${r.waarschuwingen.length} aandachtspunten)` : ''}.`, 'ok');
}

async function metBezig(knoppen, fn) {
  for (const k of knoppen) k.disabled = true;
  document.body.classList.add('bezig');
  try { return await fn(); }
  finally { for (const k of knoppen) k.disabled = false; document.body.classList.remove('bezig'); }
}

async function opslaanNaarGithub() {
  if (!beheer.model) return;
  if (!opslag.token()) {
    const k = await dialoog({
      titel: 'Geen GitHub-token',
      inhoud: h('p', {}, 'Om rechtstreeks naar GitHub op te slaan heeft deze browser een eigen GitHub-token nodig (eenmalig instellen per toestel). Zonder token kan je het ontwerp exporteren als JSON-bestand.'),
      knoppen: [{ label: 'Annuleren', waarde: null }, { label: 'Exporteer JSON', waarde: 'export' }, { label: 'Token instellen', waarde: 'inst', soort: 'primair' }],
    });
    if (k === 'export') exporteer();
    if (k === 'inst') await toonInstellingen();
    return;
  }
  const r = await metBezig([el.opslaanKop], () => beheer.opslaanNaarGithub({
    bevestigOverschrijven: ({ naam, zonderBasis }) => bevestig('GitHub-versie is anders', zonderBasis
      ? `Op GitHub staat al een ontwerp met dit id, met andere inhoud dan "${naam}" hier. Wil je het overschrijven?`
      : `"${naam}" werd intussen ook op GitHub gewijzigd (bv. vanaf een ander toestel). Overschrijven met jouw versie? Kies anders Annuleren en daarna "Ophalen van GitHub".`,
    { ja: 'Overschrijven', gevaar: true }),
  }));
  meld(r.melding, r.ok ? 'ok' : (r.soort === 'geannuleerd' ? 'info' : 'fout'));
  if (!r.ok && r.soort === 'auth') toonInstellingen();
  renderKiezer();
}

async function ophalenVanGithub() {
  const r = await metBezig([], () => beheer.ophalenVanGithub({
    kiesBijConflict: ({ naam }) => dialoog({
      titel: 'Conflict met GitHub',
      inhoud: h('p', {}, `"${naam}" is zowel hier als op GitHub gewijzigd. Welke versie wil je houden? (De andere is daarna niet meer zichtbaar in de app; een GitHub-versie blijft wel in de git-geschiedenis.)`),
      knoppen: [{ label: 'Annuleren', waarde: null }, { label: 'Lokale behouden', waarde: 'lokaal' }, { label: 'GitHub-versie nemen', waarde: 'github', soort: 'primair' }],
    }),
  }));
  meld(r.melding, r.ok ? 'ok' : (r.soort === 'geannuleerd' ? 'info' : 'fout'));
  renderAlles();
}

async function toonInstellingen() {
  const inst = opslag.instellingen();
  const heeftToken = !!opslag.token();
  const veld = (id, label, waarde, extra = {}) => [h('label', { class: 'veld-label', for: id }, label), h('input', { id, type: 'text', value: waarde, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', ...extra })];
  const tokenStatus = h('p', { class: 'token-status' }, heeftToken ? 'Er is een token ingesteld op dit toestel.' : 'Nog geen token ingesteld op dit toestel.');
  const wisKnop = h('button', { type: 'button', class: 'knop gevaar klein', disabled: !heeftToken, onclick: () => { opslag.wisToken(); tokenStatus.textContent = 'Token gewist van dit toestel.'; wisKnop.disabled = true; meld('GitHub-token gewist.', 'ok'); } }, 'Token wissen');
  const inhoud = [
    h('div', { class: 'raster-2' }, h('div', {}, ...veld('inst-owner', 'Eigenaar (owner)', inst.owner)), h('div', {}, ...veld('inst-repo', 'Repository', inst.repo))),
    ...veld('inst-branch', 'Branch', inst.branch),
    h('label', { class: 'veld-label', for: 'inst-token' }, 'GitHub-token'),
    h('input', { id: 'inst-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: heeftToken ? 'ingesteld – laat leeg om te behouden' : 'github_pat_…' }),
    h('div', { class: 'token-rij' }, tokenStatus, wisKnop),
    h('details', { class: 'uitleg' }, h('summary', {}, 'Hoe maak ik een token?'),
      h('ol', {},
        h('li', {}, 'Ga op github.com naar Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
        h('li', {}, `Repository access: "Only select repositories" → kies enkel ${inst.owner}/${inst.repo}.`),
        h('li', {}, 'Permissions → Repository permissions → Contents: "Read and write". Niets anders.'),
        h('li', {}, 'Kies een vervaldatum, maak het token aan en plak het hierboven.')),
      h('p', {}, 'Het token wordt enkel in deze browser bewaard (localStorage), nooit in git en nooit naar een andere server dan api.github.com gestuurd. Op een gedeeld toestel: wis het token na gebruik.')),
  ];
  const r = await dialoog({ titel: 'Instellingen', inhoud, klasse: 'breed', knoppen: [{ label: 'Annuleren', waarde: null }, { label: 'Bewaren', waarde: 'ok', soort: 'primair' }] });
  if (r !== 'ok') return;
  // De dialoog is na het sluiten uit het document verwijderd: lees de velden via de bewaarde nodes.
  const waarden = {};
  for (const n of inhoud.flat(Infinity)) {
    if (!(n instanceof HTMLElement)) continue;
    for (const i of [n, ...n.querySelectorAll('input')]) if (i.tagName === 'INPUT' && i.id) waarden[i.id] = i.value;
  }
  const ok1 = opslag.bewaarInstellingen({ owner: waarden['inst-owner'], repo: waarden['inst-repo'], branch: waarden['inst-branch'] });
  const token = (waarden['inst-token'] || '').trim();
  const ok2 = token ? opslag.bewaarToken(token) : true;
  meld(ok1 && ok2 ? 'Instellingen bewaard.' : 'Kon niet bewaren: lokale opslag is niet beschikbaar in deze browser (privévenster?).', ok1 && ok2 ? 'ok' : 'fout');
}

// ---------------------------------------------------------------- menu, tabs, splitter, sneltoetsen

function sluitMenu() { el.menu.hidden = true; el.menuKnop.setAttribute('aria-expanded', 'false'); }
function openMenu() {
  el.menu.hidden = false;
  el.menuKnop.setAttribute('aria-expanded', 'true');
  el.menu.querySelector('button')?.focus();
}

function zetTab(naam) {
  el.werkvlak.dataset.actief = naam;
  for (const t of document.querySelectorAll('.tabs [role=tab]')) t.setAttribute('aria-selected', String(t.dataset.paneel === naam));
  opslag.bewaarUi({ tab: naam });
  // Een view die net zichtbaar wordt, moet zijn afmetingen opnieuw bepalen.
  requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); renderViews(); });
}

function zetSplitsing(pct) {
  pct = Math.min(80, Math.max(20, pct));
  el.werkvlak.style.setProperty('--kol3d', `${pct}fr`);
  el.werkvlak.style.setProperty('--kol2d', `${100 - pct}fr`);
  el.splitter.setAttribute('aria-valuenow', String(Math.round(pct)));
  return pct;
}

function koppelSplitter() {
  let actief = false, pct = opslag.ui().splitsing ?? 55;
  zetSplitsing(pct);
  el.splitter.addEventListener('pointerdown', (e) => { actief = true; el.splitter.setPointerCapture(e.pointerId); document.body.classList.add('slepen'); });
  el.splitter.addEventListener('pointermove', (e) => {
    if (!actief) return;
    const a = $('#paneel-3d').getBoundingClientRect(), b = $('#paneel-2d').getBoundingClientRect();
    pct = zetSplitsing(((e.clientX - a.left) / (b.right - a.left)) * 100);
  });
  const stop = () => { if (!actief) return; actief = false; document.body.classList.remove('slepen'); opslag.bewaarUi({ splitsing: pct }); window.dispatchEvent(new Event('resize')); };
  el.splitter.addEventListener('pointerup', stop);
  el.splitter.addEventListener('pointercancel', stop);
  el.splitter.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    pct = zetSplitsing(pct + (e.key === 'ArrowLeft' ? -5 : 5));
    opslag.bewaarUi({ splitsing: pct });
    window.dispatchEvent(new Event('resize'));
  });
  el.splitter.addEventListener('dblclick', () => { pct = zetSplitsing(55); opslag.bewaarUi({ splitsing: pct }); window.dispatchEvent(new Event('resize')); });
}

function isInvoer(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

function koppelBediening() {
  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  el.zoom.addEventListener('click', () => { try { views.v3d?.zoomAlles(); } catch (e) { console.error(e); } try { views.v2d?.zoomAlles(); } catch (e) { console.error(e); } });
  el.planNiveau.addEventListener('change', () => { toestand.planNiveau = el.planNiveau.value; zetPlanTitel(beheer.model); renderViews(); });
  el.dsAan.addEventListener('change', () => { toestand.doorsnede = el.dsAan.checked ? toestand.doorsnedeZ : null; zetDoorsnedeTekst(); renderViews(); });
  el.dsZ.addEventListener('input', () => { toestand.doorsnedeZ = Number(el.dsZ.value); if (toestand.doorsnede != null) toestand.doorsnede = toestand.doorsnedeZ; zetDoorsnedeTekst(); renderViews(); });
  el.weergave.addEventListener('click', () => {
    const open = el.balkExtra.classList.toggle('open');
    el.weergave.setAttribute('aria-expanded', String(open));
  });
  el.waarschKnop.addEventListener('click', () => {
    toestand.toonWaarschuwingen = !toestand.toonWaarschuwingen;
    renderWaarschuwingen(beheer.model);
    if (toestand.toonWaarschuwingen && el.werkvlak.dataset.actief !== 'eig' && matchMedia('(max-width: 799.98px)').matches) zetTab('eig');
  });

  el.kiezer.addEventListener('change', async () => {
    const id = el.kiezer.value;
    if (id && id !== beheer.actiefId) await openOntwerp(id);
  });
  el.opslaanKop.addEventListener('click', opslaanNaarGithub);
  el.menuKnop.addEventListener('click', (e) => { e.stopPropagation(); if (el.menu.hidden) openMenu(); else sluitMenu(); });
  el.menu.addEventListener('click', (e) => { const b = e.target.closest('[data-actie]'); if (b) actie(b.dataset.actie); });
  document.addEventListener('pointerdown', (e) => { if (!el.menu.hidden && !e.target.closest('.menu-houder')) sluitMenu(); });
  el.importBestand.addEventListener('change', () => { const f = el.importBestand.files?.[0]; if (f) importeer(f); });

  for (const t of document.querySelectorAll('.tabs [role=tab]')) t.addEventListener('click', () => zetTab(t.dataset.paneel));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.menu.hidden) { sluitMenu(); el.menuKnop.focus(); return; }
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey || isInvoer(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) { e.preventDefault(); redo(); }
  });
  koppelSplitter();
}

// ---------------------------------------------------------------- opstart

async function start() {
  koppelBediening();
  const ui = opslag.ui();
  zetTab(['3d', '2d', 'eig'].includes(ui.tab) ? ui.tab : '3d');
  if (!opslag.beschikbaar) meld('Lokale opslag is niet beschikbaar (privévenster?). Wijzigingen gaan verloren bij herladen: exporteer of sla op naar GitHub.', 'fout');

  let opslagFoutGemeld = false;
  beheer.opWijziging((soort) => {
    if (soort === 'model' || soort === 'actief') {
      if (soort === 'actief') { toestand.selectie = null; toestand.niveauSleutel = ''; toestand.verborgen.clear(); }
      renderAlles();
    } else if (soort === 'toestand' || soort === 'lijst') renderKiezer();
    else if (soort === 'opslag-fout' && !opslagFoutGemeld) {
      opslagFoutGemeld = true;
      meld('Kon de werkkopie niet lokaal bewaren (opslag vol of geblokkeerd). Exporteer of sla op naar GitHub.', 'fout');
    }
  });

  await maakViews();
  const idx = await beheer.laadIndex();
  if (!idx.ok) meld(idx.melding, 'fout');

  const kandidaten = [new URLSearchParams(location.search).get('ontwerp'), beheer.laatsteId(), ...beheer.lijst().map((o) => o.id)].filter(Boolean);
  let geopend = false;
  for (const id of [...new Set(kandidaten)]) {
    if (!beheer.bestaat(id)) continue;
    const r = await beheer.open(id);
    if (r.ok) { if (r.melding) meld(r.melding, 'info', { duur: 9000 }); geopend = true; break; }
    meld(r.melding, 'fout');
  }
  if (!geopend) beheer.nieuw('Nieuw ontwerp');
  document.body.classList.add('klaar');
}

window.addEventListener('beforeunload', (e) => {
  if (!opslag.beschikbaar && beheer.geschiedenis?.kanUndo) { e.preventDefault(); e.returnValue = ''; }
});

start().catch((e) => { console.error(e); meld(`De app kon niet starten: ${e.message}`, 'fout'); });
