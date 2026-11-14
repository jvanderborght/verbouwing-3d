// 2D-plattegrond (SVG) van één niveau. y-as naar boven (straat onderaan): svg-coördinaten = [x, −y].
//
// Publieke interface (zie ook docs/FASE2.md, deel C):
//   render(model, { niveau, selectie?, toonMaten? })  volledige herbouw van de tekening (niet van de hulplaag)
//   opSelectie(fn(id|null))                            tik/klik in modus 'navigeren'
//   schermNaarModel(clientX, clientY) → [x, y] mm      modelNaarScherm(x, y) → [px, py] t.o.v. de container
//   zoomAlles()   dispose()
//   zetModus('navigeren' | 'gereedschap')
//     navigeren (standaard): slepen = pannen, tik = opSelectie. Slepen dat start op een element uit
//       zetSleepbaar() of op een greep (toonHulp-punt soort 'greep') pant niet maar gaat naar opPointer:
//       'neer' (pas zodra de sleepdrempel overschreden is, met het punt waar ingedrukt werd), 'beweeg'…, 'op'.
//       Een tik op zo'n element blijft gewoon een selectie (geen neer/op).
//     gereedschap: één vinger / linkermuis → opPointer: 'neer' meteen, 'beweeg'…, 'op', daarna 'tik' als
//       het een tik was (< 6 px, < 350 ms). Een tweede tik binnen 350 ms en 20 px geeft 'dubbeltik' i.p.v. 'tik'.
//       Pannen: twee vingers, middelste muisknop of spatie + slepen. Geen contextmenu (lange druk).
//     Beide modi: wiel/knijpen = zoom; twee vingers = pannen/knijpen en een lopende één-vinger-actie krijgt
//       'annuleer' (ook bij pointercancel of zetModus tijdens een actie). Muis/pen zonder knop → 'beweeg'
//       (hover). Alle 'beweeg' worden gebundeld per animatieframe.
//   opPointer(fn({ soort, punt: [x, y] mm, doel: id|'greep:<i>'|null, pointerType, shift, ctrl, schaal }))
//       doel: greep (i = index in toonHulp().punten; hitzone 22 px touch/pen, 10 px muis) > opening > muur
//       > ruimte op het actieve niveau (tolerantie 10 px). ctrl = ctrlKey of metaKey. schaal = px per mm.
//   zetSleepbaar(ids: string[])
//   toonHulp({ lijnen, punten, labels, polygonen } | null)  overlay in mm boven de tekening; overleeft render().
//       lijnen: { van, naar, stijl: 'voorbeeld'|'hulplijn'|'maat', dikte?, tekst? } (maat: tekst standaard = lengte)
//       punten: { p, soort: 'snap'|'greep' }   labels: { p, tekst }   polygonen: { contour, stijl: 'voorbeeld'|'markering'|'nieuw'|'afbraak' }
//       Punten, labels en lijndiktes op vaste schermgrootte.
//   schaal() → px per mm (1 zolang er nog geen zicht is)
//   markeer(id | null)  subtiele hover-markering; overleeft render().

import {
  muurLengte, muurAansluiting, muurSegmenten, muurDeelRechthoek, muurRichting, puntOpMuur,
  polygoonOppervlakte, polygoonZwaartepunt, begrenzing,
} from '../model/geometry.js';
import {
  formatteerOppervlakte, buitenNormaal, isBuitenmuur, muurMaten, totaleMaten, leesbareHoek,
  passendeView, viewBoxVan, schermNaarModelV, modelNaarSchermV, zoomRond, verschuif, niveauEronder,
  formatteerMaat, GEBAAR, isSleep, isTik, isDubbeltik, raakDoel, raakGreep, strookPolygoon,
} from './bouwstenen.js';

const NS = 'http://www.w3.org/2000/svg';
const KLEUR = { bestaand: '#6f6b66', nieuw: '#3b7fd9', afbraak: 'url(#p2d-afbraak)' };
let volgnummer = 0; // uniek patroon-id per plattegrond (meerdere plattegronden in één document, bv. vergelijken)
const RAND = { bestaand: '#3f3c39', nieuw: '#1f5aa8', afbraak: '#d83a33' };
const MAAT_MARGE = 2600; // ruimte rond het niveau voor maatlijnen bij zoomAlles (mm)
const MAAT_STAP = 550; // afstand tussen maatlijnrijen (mm), zoals standaard in muurMaten()

const STIJL = `
  .p2d * { vector-effect: non-scaling-stroke; }
  .p2d text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; vector-effect: none; }
  .p2d .ruimte polygon { fill: #fbf8f1; stroke: none; }
  .p2d .ruimte.gesel polygon { fill: #ffe7c7; }
  .p2d .label { text-anchor: middle; fill: #2c2a28; paint-order: stroke; stroke: #fbf8f1; stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
  .p2d .label .opp { fill: #6a655f; }
  .p2d .muur polygon { stroke-width: 0.75px; }
  .p2d .gesel.muur polygon, .p2d .gesel .accent { stroke: #ff8a00 !important; stroke-width: 2.5px; }
  .p2d .opening .lijn { stroke: #2c2a28; stroke-width: 1px; fill: none; }
  .p2d .opening.nieuw .lijn { stroke: #1f5aa8; }
  .p2d .opening.gesel .lijn { stroke: #ff8a00; stroke-width: 2px; }
  .p2d .opening .raak { fill: rgba(0,0,0,0); stroke: none; }
  .p2d .opening.gesel .raak { fill: rgba(255,138,0,0.25); }
  .p2d .onder { fill: rgba(60,60,60,0.07); stroke: #b9b4ad; stroke-width: 0.75px; stroke-dasharray: 4 3; pointer-events: none; }
  .p2d .perceel { fill: none; stroke: #5d8a3e; stroke-width: 1.25px; stroke-dasharray: 8 5; pointer-events: none; }
  .p2d .maat line { stroke: #5a5550; stroke-width: 0.75px; }
  .p2d .maat .tick { stroke-width: 1.25px; }
  .p2d .maat text { fill: #3a3633; text-anchor: middle; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
  .p2d .maat.totaal line { stroke: #2c2a28; }
  .p2d .maat.totaal text { font-weight: 600; }
  .p2d .maten { pointer-events: none; }
  .p2d .mark.muur polygon { stroke: #ff8a00; stroke-width: 1.5px; }
  .p2d .ruimte.mark polygon { fill: #fff1de; }
  .p2d .opening.mark .raak { fill: rgba(255,138,0,0.14); }
  .p2d .opening.mark .lijn { stroke: #e07a00; }
  .p2d .hulp { pointer-events: none; }
  .p2d .hulp .h-voorbeeld { stroke: #3b7fd9; stroke-width: 3px; stroke-opacity: 0.7; stroke-linecap: round; fill: none; }
  .p2d .hulp .h-voorbeeld-dik { fill: rgba(59,127,217,0.38); stroke: #1f5aa8; stroke-width: 1.25px; stroke-opacity: 0.85; }
  .p2d .hulp .h-hulplijn { stroke: #0d9488; stroke-width: 1px; stroke-dasharray: 5 4; fill: none; }
  .p2d .hulp .h-maat line { stroke: #1f5aa8; stroke-width: 1px; }
  .p2d .hulp .h-maat .tick { stroke-width: 1.5px; }
  .p2d .hulp text { font-size: 12px; text-anchor: middle; dominant-baseline: central; fill: #12355f; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
  .p2d .hulp .h-maat text { font-weight: 600; }
  .p2d .hulp .h-label text { font-weight: 600; fill: #0b2747; }
  .p2d .hulp .h-snap { fill: #0d9488; stroke: #fff; stroke-width: 1.5px; }
  .p2d .hulp .h-greep { fill: #fff; stroke: #1f5aa8; stroke-width: 2px; }
  .p2d .hulp .h-poly-voorbeeld { fill: rgba(59,127,217,0.18); stroke: #3b7fd9; stroke-width: 1.5px; stroke-dasharray: 6 4; }
  .p2d .hulp .h-poly-markering { fill: rgba(255,138,0,0.14); stroke: #ff8a00; stroke-width: 1.5px; }
  .p2d .hulp .h-poly-nieuw { fill: rgba(47,111,219,0.22); stroke: #2f6fdb; stroke-width: 2px; }
  .p2d .hulp .h-poly-afbraak { fill: rgba(220,38,38,0.18); stroke: #dc2626; stroke-width: 2px; stroke-dasharray: 5 3; }
`;

export class Plattegrond {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this._sel = () => {};
    this._model = null;
    this._opties = {};
    this._view = null;
    this._wijzers = new Map();
    this._gebaar = null; // lopend één-aanwijzergebaar (zie interactie)
    this._modus = 'navigeren';
    this._ptr = null;
    this._sleepbaar = new Set();
    this._hulp = null;
    this._vast = []; // hulpelementen op vaste schermgrootte: { el, x, y (svg-mm), hoek }
    this._markering = null;
    this._vorigeTik = null;
    this._spatie = false;
    this._beweegWacht = null;
    this._raf = 0;

    this._patroonId = `p2d-afbraak-${++volgnummer}`;
    const svg = (this.svg = el('svg', { class: 'p2d', width: '100%', height: '100%' }));
    svg.style.display = 'block';
    svg.style.touchAction = 'none';
    svg.style.userSelect = 'none';
    svg.style.background = '#ffffff';
    svg.innerHTML = `<style>${STIJL}</style><defs>
      <pattern id="${this._patroonId}" patternUnits="userSpaceOnUse" width="160" height="160" patternTransform="rotate(45)">
        <rect width="160" height="160" fill="rgba(224,64,58,0.12)"/>
        <rect x="0" y="0" width="45" height="160" fill="#e0403a"/>
      </pattern></defs>`;
    svg.style.webkitTouchCallout = 'none';
    svg.style.webkitUserSelect = 'none';
    this.inhoud = el('g');
    this.hulpLaag = el('g', { class: 'hulp' });
    svg.append(this.inhoud, this.hulpLaag);
    container.appendChild(svg);

    this._bindInteractie();
    this._ro = new ResizeObserver(() => this._pasViewToe());
    this._ro.observe(container);
  }

  /** @param {object} model @param {{ niveau: string, selectie?: string|null, toonMaten?: boolean }} opties */
  render(model, opties) {
    this._model = model;
    this._opties = opties || {};
    this._teken();
    if (!this._view) this.zoomAlles();
    else this._pasViewToe();
  }

  /** @param {(id: string|null) => void} fn */
  opSelectie(fn) { this._sel = typeof fn === 'function' ? fn : () => {}; }

  /** Schermcoördinaten → modelcoördinaten [x, y] in mm (voor tekengereedschap in fase 2). */
  schermNaarModel(clientX, clientY) {
    const r = this.container.getBoundingClientRect();
    if (!this._view) return [0, 0];
    return schermNaarModelV(this._view, r.width, r.height, clientX - r.left, clientY - r.top);
  }

  /** Modelcoördinaten → schermcoördinaten [px, py] relatief t.o.v. de container. */
  modelNaarScherm(x, y) {
    const r = this.container.getBoundingClientRect();
    if (!this._view) return [0, 0];
    return modelNaarSchermV(this._view, r.width, r.height, x, y);
  }

  zoomAlles() {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const b = this._inhoudBegrenzing();
    if (!W || !H) { this._view = null; return; }
    this._view = passendeView(b, W, H, 12);
    this._pasViewToe();
  }

  /** @param {'navigeren'|'gereedschap'} modus */
  zetModus(modus) {
    const m = modus === 'gereedschap' ? 'gereedschap' : 'navigeren';
    // ook bij dezelfde modus een lopend gebaar afbreken (bv. wissel Muur → Deur tijdens indrukken)
    this._annuleerActie();
    if (m === this._modus) return;
    this._modus = m;
    this._vorigeTik = null;
    this._zetCursor();
  }

  /** @param {(e: { soort: string, punt: number[], doel: string|null, pointerType: string, shift: boolean, ctrl: boolean, schaal: number }) => void} fn */
  opPointer(fn) { this._ptr = typeof fn === 'function' ? fn : null; }

  /** Elementen die in navigeren-modus versleept kunnen worden (slepen erop ⇒ opPointer i.p.v. pannen). */
  zetSleepbaar(ids) { this._sleepbaar = new Set(Array.isArray(ids) ? ids : []); }

  /** Huidige schaal in px per mm. */
  schaal() { return this._view ? this._view.schaal : 1; }

  /** Hover-markering van één element (of null). Blijft staan na render(). */
  markeer(id) {
    const nieuw = id ?? null;
    if (nieuw === this._markering) return;
    this._markering = nieuw;
    this._pasMarkeringToe();
  }

  /** Overlay (voorbeeld, hulplijnen, maten, snap-punten, grepen, labels) in modelcoördinaten; null wist ze. */
  toonHulp(hulp) {
    this._hulp = hulp || null;
    this._tekenHulp();
  }

  dispose() {
    this._annuleerActie();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    window.removeEventListener('keydown', this._toetsNeer);
    window.removeEventListener('keyup', this._toetsOp);
    window.removeEventListener('blur', this._toetsOp);
    this._ro.disconnect();
    this.svg.remove();
    this.container.textContent = '';
  }

  // ── intern ────────────────────────────────────────────────────────────────

  _inhoudBegrenzing() {
    const m = this._model;
    const niv = this._opties.niveau;
    const pts = [];
    if (m) {
      for (const muur of m.muren) if (muur.niveau === niv) pts.push(...muurDeelRechthoek(muur, 0, muurLengte(muur)));
      for (const r of m.ruimtes) if (r.niveau === niv) pts.push(...r.contour);
      if (!pts.length) for (const muur of m.muren) pts.push(muur.start, muur.eind);
      if (!pts.length && m.perceel?.contour) pts.push(...m.perceel.contour);
    }
    if (!pts.length) return { minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 };
    const b = begrenzing(pts);
    const marge = this._opties.toonMaten !== false ? MAAT_MARGE : 600;
    return { minX: b.minX - marge, minY: b.minY - marge, maxX: b.maxX + marge, maxY: b.maxY + marge };
  }

  _pasViewToe() {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (!W || !H) return;
    if (!this._view) { if (this._model) this.zoomAlles(); return; }
    this.svg.setAttribute('viewBox', viewBoxVan(this._view, W, H).join(' '));
    this.svg.setAttribute('preserveAspectRatio', 'none');
    // tekst op vaste schermgrootte
    const s = this._view.schaal;
    this.inhoud.style.fontSize = `${12 / s}px`;
    for (const t of this.inhoud.querySelectorAll('.maat text')) {
      t.style.fontSize = `${11 / s}px`;
      // tekst verbergen als ze niet tussen de streepjes past (ver uitgezoomd)
      const past = Number(t.dataset.mm) * s >= Number(t.dataset.tekens) * 6.6 + 4;
      t.style.display = past ? '' : 'none';
    }
    // te weinig plaats tussen de maatlijnrijen → kettingmaten weglaten (inzoomen toont ze terug)
    const krap = MAAT_STAP * s < 15;
    for (const k of this.inhoud.querySelectorAll('.maat.ketting')) k.style.display = krap ? 'none' : '';
    this._schaalHulp();
  }

  _pasMarkeringToe() {
    for (const e of this.inhoud.querySelectorAll('.mark')) e.classList.remove('mark');
    const id = this._markering;
    if (id == null) return;
    for (const e of this.inhoud.querySelectorAll('[data-id]')) if (e.getAttribute('data-id') === id) e.classList.add('mark');
  }

  // ── hulplaag ──────────────────────────────────────────────────────────────

  _tekenHulp() {
    const g = this.hulpLaag;
    g.textContent = '';
    this._vast = [];
    const h = this._hulp;
    if (!h) return;
    const vast = (x, y, hoek = 0, klasse) => {
      const v = el('g', klasse ? { class: klasse } : {});
      this._vast.push({ el: v, x, y: -y, hoek });
      return v;
    };
    for (const pg of h.polygonen || []) {
      if (!(pg?.contour?.length >= 3)) continue;
      const kl = { markering: 'h-poly-markering', nieuw: 'h-poly-nieuw', afbraak: 'h-poly-afbraak' }[pg.stijl] || 'h-poly-voorbeeld';
      g.appendChild(el('polygon', { class: kl, points: pts(pg.contour) }));
    }
    for (const l of h.lijnen || []) {
      if (!l?.van || !l?.naar) continue;
      if (l.stijl === 'maat') {
        const mg = el('g', { class: 'h-maat' });
        mg.appendChild(lijn(l.van, l.naar, { class: '' }));
        const dx = l.naar[0] - l.van[0], dy = -(l.naar[1] - l.van[1]);
        const hoekLijn = (Math.atan2(dy, dx) * 180) / Math.PI;
        for (const q of [l.van, l.naar]) {
          const t = vast(q[0], q[1], hoekLijn);
          t.appendChild(el('line', { class: 'tick', x1: -5, y1: 5, x2: 5, y2: -5 }));
          mg.appendChild(t);
        }
        const midden = vast((l.van[0] + l.naar[0]) / 2, (l.van[1] + l.naar[1]) / 2, leesbareHoek(dx, dy));
        const t = el('text', { x: 0, y: -10 });
        t.textContent = l.tekst ?? formatteerMaat(Math.hypot(dx, dy));
        midden.appendChild(t);
        mg.appendChild(midden);
        g.appendChild(mg);
      } else if (l.stijl === 'voorbeeld' && l.dikte > 0 && strookPolygoon(l.van, l.naar, l.dikte).length) {
        g.appendChild(el('polygon', { class: 'h-voorbeeld-dik', points: pts(strookPolygoon(l.van, l.naar, l.dikte)) }));
      } else {
        g.appendChild(lijn(l.van, l.naar, { class: l.stijl === 'hulplijn' ? 'h-hulplijn' : 'h-voorbeeld' }));
      }
    }
    for (const p of h.punten || []) {
      if (!p?.p) continue;
      const v = vast(p.p[0], p.p[1]);
      if (p.soort === 'greep') v.appendChild(el('circle', { class: 'h-greep', r: 7 }));
      else v.appendChild(el('polygon', { class: 'h-snap', points: '0,-6 6,0 0,6 -6,0' }));
      g.appendChild(v);
    }
    for (const lb of h.labels || []) {
      if (!lb?.p || lb.tekst == null) continue;
      const v = vast(lb.p[0], lb.p[1], 0, 'h-label');
      const t = el('text', { x: 0, y: 0 });
      t.textContent = String(lb.tekst);
      v.appendChild(t);
      g.appendChild(v);
    }
    this._schaalHulp();
  }

  /** Vaste-schermgrootte-elementen van de hulplaag herschalen (goedkoop: enkel transform-attributen). */
  _schaalHulp() {
    if (!this._view || !this._vast.length) return;
    const k = 1 / this._view.schaal;
    for (const v of this._vast)
      v.el.setAttribute('transform', `translate(${r2(v.x)} ${r2(v.y)})${v.hoek ? ` rotate(${r2(v.hoek)})` : ''} scale(${k})`);
  }

  _teken() {
    const m = this._model;
    const o = this._opties;
    const niv = o.niveau;
    const sel = o.selectie ?? null;
    const g = this.inhoud;
    g.textContent = '';
    if (!m) return;

    const muren = m.muren.filter((x) => x.niveau === niv);
    const ruimtes = m.ruimtes.filter((x) => x.niveau === niv);

    // Perceel
    if (m.perceel?.contour?.length >= 3) g.appendChild(el('polygon', { class: 'perceel', points: pts(m.perceel.contour) }));

    // Ruimtes
    const gR = el('g');
    for (const r of ruimtes) {
      const rg = el('g', { class: `ruimte${r.id === sel ? ' gesel' : ''}`, 'data-id': r.id });
      rg.appendChild(el('polygon', { points: pts(r.contour) }));
      gR.appendChild(rg);
    }
    g.appendChild(gR);

    // Niveau eronder als referentie
    const onder = niveauEronder(m.niveaus, niv);
    if (onder) {
      const gO = el('g');
      for (const mu of m.muren.filter((x) => x.niveau === onder.id)) {
        const a = muurAansluiting(m.muren, mu);
        gO.appendChild(el('polygon', { class: 'onder', points: pts(muurDeelRechthoek(mu, -a.start, muurLengte(mu) + a.eind)) }));
      }
      g.appendChild(gO);
    }

    // Muren
    const alleRechth = [];
    const gM = el('g');
    const gOp = el('g');
    for (const mu of muren) {
      const L = muurLengte(mu);
      if (L < 1) continue;
      const a = muurAansluiting(m.muren, mu);
      const ops = m.openingen.filter((x) => x.muur === mu.id);
      const gaten = ops.filter((x) => x.status !== 'afbraak').map((x) => ({ positie: x.positie, breedte: x.breedte, borstwering: 0, hoogte: 1 }));
      const mg = el('g', { class: `muur ${mu.status}${mu.id === sel ? ' gesel' : ''}`, 'data-id': mu.id });
      for (const s of muurSegmenten(-a.start, L + a.eind, 1, gaten)) {
        const r = muurDeelRechthoek(mu, s.t0, s.t1);
        mg.appendChild(el('polygon', { points: pts(r), fill: mu.status === 'afbraak' ? `url(#${this._patroonId})` : (KLEUR[mu.status] || KLEUR.bestaand), stroke: RAND[mu.status] || RAND.bestaand }));
      }
      alleRechth.push(muurDeelRechthoek(mu, -a.start, L + a.eind));
      gM.appendChild(mg);
      for (const op of ops) gOp.appendChild(this._opening(mu, op, sel));
    }
    g.appendChild(gM);
    g.appendChild(gOp);

    // Maatlijnen
    if (o.toonMaten !== false && alleRechth.length) {
      const b = begrenzing(alleRechth.flat());
      const centrum = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      const gMa = el('g', { class: 'maten' });
      const labelPunten = ruimtes.map((r) => polygoonZwaartepunt(r.contour));
      let maxBuiten = 0;
      for (const mu of muren) {
        if (muurLengte(mu) < 1) continue;
        const n = buitenNormaal(mu, centrum);
        const buiten = isBuitenmuur(mu, n, b);
        const lijnen = muurMaten(mu, m.openingen.filter((x) => x.muur === mu.id), n, buiten);
        for (const l of lijnen) {
          if (!buiten) l.midden = vrijePlek(l, labelPunten);
          gMa.appendChild(maatEl(l));
        }
        // aantal maatlijnrijen buiten deze muur (ketting + muurlengte = 2)
        if (buiten) maxBuiten = Math.max(maxBuiten, lijnen.length > 1 ? 2 : 1);
      }
      for (const l of totaleMaten(b, 550 * (maxBuiten + 1))) gMa.appendChild(maatEl(l));
      g.appendChild(gMa);
    }

    // Ruimtelabels (naam + netto oppervlakte)
    const gL = el('g');
    for (const r of ruimtes) {
      const [cx, cy] = polygoonZwaartepunt(r.contour);
      const t = el('text', { class: 'label', x: cx, y: -cy });
      const t1 = el('tspan', { x: cx, dy: '-0.2em', 'font-weight': '600' });
      t1.textContent = r.naam;
      const t2 = el('tspan', { x: cx, dy: '1.25em', class: 'opp' });
      t2.textContent = formatteerOppervlakte(polygoonOppervlakte(r.contour));
      t.append(t1, t2);
      gL.appendChild(t);
    }
    g.appendChild(gL);
    if (this._markering != null) this._pasMarkeringToe();
  }

  _opening(mu, op, sel) {
    const { ux, uy } = muurRichting(mu);
    const t0 = op.positie, t1 = op.positie + op.breedte;
    const og = el('g', { class: `opening ${op.status}${op.id === sel ? ' gesel' : ''}`, 'data-id': op.id });
    const d = mu.dikte;
    const vak = muurDeelRechthoek(mu, t0, t1);
    if (op.status === 'afbraak') {
      // opening verdwijnt → dichtmaken (nieuw metselwerk), oude opening rood gestreept
      og.appendChild(el('polygon', { points: pts(vak), fill: KLEUR.nieuw, stroke: RAND.nieuw, 'stroke-width': 0.75 }));
      og.appendChild(el('polygon', { class: 'accent', points: pts(vak), fill: 'none', stroke: RAND.afbraak, 'stroke-width': 1.25, 'stroke-dasharray': '4 3' }));
      return og;
    }
    og.appendChild(el('polygon', { class: 'raak', points: pts(vak) }));
    const vlakPt = (t, s) => { const p = puntOpMuur(mu, t); const { nx, ny } = muurRichting(mu); return [p[0] + nx * s, p[1] + ny * s]; };
    // dagkanten
    og.appendChild(lijn(vlakPt(t0, d / 2), vlakPt(t0, -d / 2)));
    og.appendChild(lijn(vlakPt(t1, d / 2), vlakPt(t1, -d / 2)));
    if (op.type === 'raam') {
      og.appendChild(lijn(vlakPt(t0, d / 7), vlakPt(t1, d / 7)));
      og.appendChild(lijn(vlakPt(t0, -d / 7), vlakPt(t1, -d / 7)));
    } else {
      // deurzwaai naar de binnenkant (weg van de buitennormaal t.o.v. het niveaumidden)
      const muren = this._model.muren.filter((x) => x.niveau === mu.niveau);
      const b = begrenzing(muren.flatMap((x) => [x.start, x.eind]));
      const n = buitenNormaal(mu, [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
      const s = [-n[0], -n[1]];
      const p = puntOpMuur(mu, t0);
      const scharnier = [p[0] + (s[0] * d) / 2, p[1] + (s[1] * d) / 2];
      const r = op.breedte;
      const boog = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * (Math.PI / 2);
        boog.push([scharnier[0] + r * (Math.cos(a) * s[0] + Math.sin(a) * ux), scharnier[1] + r * (Math.cos(a) * s[1] + Math.sin(a) * uy)]);
      }
      og.appendChild(lijn(scharnier, boog[0], { 'stroke-width': 1.5 }));
      og.appendChild(el('polyline', { class: 'lijn', points: pts(boog), 'stroke-dasharray': '3 2' }));
    }
    return og;
  }

  // ── interactie ────────────────────────────────────────────────────────────
  // Eén-aanwijzergebaar this._gebaar.soort:
  //   'pan'            slepen = pannen (navigeren: met tikSelectie → tik = opSelectie)
  //   'sleepKandidaat' navigeren, gestart op sleepbaar element/greep: wordt 'sleep' na de drempel
  //   'sleep'          navigeren: neer/beweeg/op naar opPointer
  //   'actie'          gereedschap: neer/beweeg/op/tik/dubbeltik naar opPointer
  //   'knijp'          twee (of meer) aanwijzers: pannen + zoomen
  //   'genegeerd'      geannuleerd; niets meer tot alle aanwijzers los zijn

  /** Punt (mm) en doel onder een schermpositie. */
  _info(clientX, clientY, pointerType) {
    const punt = this.schermNaarModel(clientX, clientY);
    const s = this.schaal();
    let doel = null;
    const tolGreep = pointerType === 'mouse' ? GEBAAR.tolGreepMuis : GEBAAR.tolGreepTouch;
    const gi = raakGreep(this._hulp?.punten, punt, s, tolGreep);
    if (gi >= 0) doel = `greep:${gi}`;
    else doel = raakDoel(this._model, this._opties.niveau, punt, s);
    return { punt, doel };
  }

  _stuur(soort, info, mods, pointerType) {
    if (!this._ptr) return;
    try {
      this._ptr({
        soort, punt: info.punt, doel: info.doel, pointerType: pointerType || 'mouse',
        shift: !!mods?.shiftKey, ctrl: !!(mods?.ctrlKey || mods?.metaKey), schaal: this.schaal(),
      });
    } catch (err) {
      console.error('Fout in opPointer-afhandeling:', err);
    }
  }

  /** 'beweeg' bundelen per animatieframe (enkel de laatste positie telt). */
  _planBeweeg(e) {
    if (!this._ptr) return;
    this._beweegWacht = {
      x: e.clientX, y: e.clientY, pointerType: e.pointerType || 'mouse',
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    };
    if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this._spoelBeweeg(); });
  }

  /** Wachtende 'beweeg' meteen versturen (vóór neer/op/tik, zodat de volgorde klopt). */
  _spoelBeweeg() {
    const w = this._beweegWacht;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (!w) return;
    this._beweegWacht = null;
    const info = this._info(w.x, w.y, w.pointerType);
    const g = this._gebaar;
    if (g && (g.soort === 'actie' || g.soort === 'sleep')) g.laatste = info;
    this._stuur('beweeg', info, w, w.pointerType);
  }

  /** Lopende één-aanwijzeractie (neer al verstuurd) afbreken met 'annuleer'. */
  _annuleerActie() {
    const g = this._gebaar;
    if (!g || (g.soort !== 'actie' && g.soort !== 'sleep')) return;
    this._beweegWacht = null;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    this._gebaar = { soort: 'genegeerd', bewogen: true };
    this._vorigeTik = null;
    this._stuur('annuleer', g.laatste || g.info0, null, g.pointerType);
  }

  _zetCursor() {
    this.svg.style.cursor = this._modus === 'gereedschap' ? (this._spatie ? 'grab' : 'crosshair') : '';
  }

  _startGebaar(e) {
    const pointerType = e.pointerType || 'mouse';
    const g = { x0: e.clientX, y0: e.clientY, t0: performance.now(), bewogen: false, pointerType };
    const pan = (pointerType === 'mouse' && e.button === 1) || this._spatie;
    if (pan) { this._gebaar = { ...g, soort: 'pan', tikSelectie: false }; return; }
    if (this._modus === 'gereedschap') {
      this._spoelBeweeg();
      g.info0 = this._info(e.clientX, e.clientY, pointerType);
      this._gebaar = { ...g, soort: 'actie' };
      this._stuur('neer', g.info0, e, pointerType);
      return;
    }
    // navigeren
    if (this._ptr && (this._sleepbaar.size || this._hulp?.punten?.length)) {
      const info = this._info(e.clientX, e.clientY, pointerType);
      if (info.doel && (info.doel.startsWith('greep:') || this._sleepbaar.has(info.doel))) {
        this._gebaar = { ...g, soort: 'sleepKandidaat', info0: info, mods: { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey } };
        return;
      }
    }
    this._gebaar = { ...g, soort: 'pan', tikSelectie: true };
  }

  _bindInteractie() {
    const svg = this.svg;
    const rect = () => this.container.getBoundingClientRect();
    const midDist = () => {
      const p = [...this._wijzers.values()];
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 };
    };

    // spatie ingedrukt ⇒ pannen in gereedschapsmodus (niet als er in een invoerveld getypt wordt)
    const isInvoer = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    this._toetsNeer = (e) => {
      if (e.code !== 'Space' || isInvoer(e.target) || this._spatie) return;
      this._spatie = true;
      this._zetCursor();
    };
    this._toetsOp = (e) => {
      if (e.type === 'keyup' && e.code !== 'Space') return;
      if (!this._spatie) return;
      this._spatie = false;
      this._zetCursor();
    };
    window.addEventListener('keydown', this._toetsNeer);
    window.addEventListener('keyup', this._toetsOp);
    window.addEventListener('blur', this._toetsOp);

    // geen contextmenu (lange druk op touch, rechtsklik) in gereedschapsmodus
    svg.addEventListener('contextmenu', (e) => { if (this._modus === 'gereedschap') e.preventDefault(); });
    // middelste muisknop: geen autoscroll
    svg.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return; // rechtermuisknop: niets
      svg.setPointerCapture?.(e.pointerId);
      this._wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._wijzers.size === 1) this._startGebaar(e);
      else {
        // tweede vinger = altijd pannen/knijpen; lopende actie annuleren, geen tik/selectie meer
        this._annuleerActie();
        this._gebaar = { soort: 'knijp', bewogen: true };
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!this._wijzers.has(e.pointerId)) {
        // hover (muis/pen zonder ingedrukte knop)
        if (e.pointerType !== 'touch' && this._wijzers.size === 0 && !e.buttons) this._planBeweeg(e);
        return;
      }
      if (!this._view) return;
      const r = rect();
      if (this._wijzers.size === 1) {
        const vorig = this._wijzers.get(e.pointerId);
        this._wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = this._gebaar;
        if (!g || g.soort === 'genegeerd') return;
        if (!g.bewogen && isSleep(e.clientX - g.x0, e.clientY - g.y0)) {
          g.bewogen = true;
          if (g.soort === 'sleepKandidaat') {
            g.soort = 'sleep';
            g.laatste = g.info0;
            this._stuur('neer', g.info0, g.mods, g.pointerType);
          }
        }
        if (g.soort === 'actie' || (g.soort === 'sleep' && g.bewogen)) this._planBeweeg(e);
        else if ((g.soort === 'pan' || g.soort === 'knijp') && g.bewogen) {
          this._view = verschuif(this._view, e.clientX - vorig.x, e.clientY - vorig.y);
          this._pasViewToe();
        }
      } else if (this._wijzers.size === 2) {
        const voor = midDist();
        this._wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const na = midDist();
        let v = verschuif(this._view, na.x - voor.x, na.y - voor.y);
        v = zoomRond(v, r.width, r.height, na.x - r.left, na.y - r.top, na.d / voor.d);
        this._view = v;
        this._pasViewToe();
      } else {
        this._wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
    });

    const einde = (e) => {
      if (!this._wijzers.has(e.pointerId)) return;
      this._wijzers.delete(e.pointerId);
      const g = this._gebaar;
      if (this._wijzers.size > 0) return; // knijpen → één vinger over: die pant verder ('knijp')
      this._gebaar = null;
      if (!g) return;
      const pointerType = g.pointerType || e.pointerType || 'mouse';
      if (g.soort === 'actie' || g.soort === 'sleep') {
        if (e.type === 'pointercancel') {
          this._gebaar = g;
          this._annuleerActie();
          this._gebaar = null;
          return;
        }
        this._spoelBeweeg();
        const info = this._info(e.clientX, e.clientY, pointerType);
        this._stuur('op', info, e, pointerType);
        if (g.soort !== 'actie') return;
        const nu = performance.now();
        if (isTik({ dx: e.clientX - g.x0, dy: e.clientY - g.y0, duur: nu - g.t0 })) {
          if (isDubbeltik(this._vorigeTik, { t: g.t0, x: g.x0, y: g.y0 })) {
            this._vorigeTik = null;
            this._stuur('dubbeltik', info, e, pointerType);
          } else {
            this._vorigeTik = { t: nu, x: e.clientX, y: e.clientY };
            this._stuur('tik', info, e, pointerType);
          }
        } else this._vorigeTik = null;
        return;
      }
      // navigeren: tik = selectie (zoals voorheen, via het element onder de aanwijzer)
      const tikSelectie = g.soort === 'sleepKandidaat' || (g.soort === 'pan' && g.tikSelectie);
      if (tikSelectie && !g.bewogen && e.type === 'pointerup') {
        const doel = document.elementFromPoint(e.clientX, e.clientY);
        const hit = doel && this.svg.contains(doel) ? doel.closest('[data-id]') : null;
        this._sel(hit ? hit.getAttribute('data-id') : null);
      }
    };
    svg.addEventListener('pointerup', einde);
    svg.addEventListener('pointercancel', einde);
    svg.addEventListener('wheel', (e) => {
      if (!this._view) return;
      e.preventDefault();
      const r = rect();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this._view = zoomRond(this._view, r.width, r.height, e.clientX - r.left, e.clientY - r.top, f);
      this._pasViewToe();
    }, { passive: false });
  }
}

// ── SVG-hulpjes ─────────────────────────────────────────────────────────────

function el(naam, attrs = {}) {
  const e = document.createElementNS(NS, naam);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const pts = (lijst) => lijst.map(([x, y]) => `${r2(x)},${r2(-y)}`).join(' ');
const r2 = (v) => Math.round(v * 100) / 100;

function lijn(a, b, extra = {}) {
  return el('line', { class: 'lijn', x1: r2(a[0]), y1: r2(-a[1]), x2: r2(b[0]), y2: r2(-b[1]), ...extra });
}

/** Tekstpositie voor een maatlijn binnenin: midden, of op ¼/¾ als het midden op een ruimtelabel valt. */
function vrijePlek(l, labels, minAfstand = 1100) {
  const op = (f) => [l.van[0] + (l.tot[0] - l.van[0]) * f, l.van[1] + (l.tot[1] - l.van[1]) * f];
  const vrij = (p) => Math.min(Infinity, ...labels.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  if (vrij(l.midden) >= minAfstand) return l.midden;
  return [op(0.25), op(0.75)].sort((a, b) => vrij(b) - vrij(a))[0];
}

function maatEl(m) {
  const g = el('g', { class: `maat ${m.soort || ''}` });
  const [x1, y1] = [m.van[0], -m.van[1]];
  const [x2, y2] = [m.tot[0], -m.tot[1]];
  g.appendChild(el('line', { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2) }));
  for (const [a, b] of m.hulplijnen) g.appendChild(el('line', { x1: r2(a[0]), y1: r2(-a[1]), x2: r2(b[0]), y2: r2(-b[1]) }));
  // schuine streepjes (architectenstijl)
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  const nx = -uy, ny = ux;
  const k = 90;
  for (const [px, py] of [[x1, y1], [x2, y2]]) {
    const dx = (ux + nx) * k * 0.7071, dy = (uy + ny) * k * 0.7071;
    g.appendChild(el('line', { class: 'tick', x1: r2(px - dx), y1: r2(py - dy), x2: r2(px + dx), y2: r2(py + dy) }));
  }
  const hoek = leesbareHoek(x2 - x1, y2 - y1);
  const [mx, my] = [m.midden[0], -m.midden[1]];
  const t = el('text', { x: r2(mx), y: r2(my), dy: '-0.35em', transform: `rotate(${r2(hoek)} ${r2(mx)} ${r2(my)})` });
  t.textContent = m.tekst;
  t.dataset.mm = String(Math.round(L));
  t.dataset.tekens = String(m.tekst.length);
  g.appendChild(t);
  return g;
}
