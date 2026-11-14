// 2D-plattegrond (SVG) van één niveau. y-as naar boven (straat onderaan): svg-coördinaten = [x, −y].
// Pan (slepen), zoom (wiel / knijpen met twee vingers) via de viewBox. Tik/klik → opSelectie(id | null).

import {
  muurLengte, muurAansluiting, muurSegmenten, muurDeelRechthoek, muurRichting, puntOpMuur,
  polygoonOppervlakte, polygoonZwaartepunt, begrenzing,
} from '../model/geometry.js';
import {
  formatteerOppervlakte, buitenNormaal, isBuitenmuur, muurMaten, totaleMaten, leesbareHoek,
  passendeView, viewBoxVan, schermNaarModelV, modelNaarSchermV, zoomRond, verschuif, niveauEronder,
} from './bouwstenen.js';

const NS = 'http://www.w3.org/2000/svg';
const KLEUR = { bestaand: '#6f6b66', nieuw: '#3b7fd9', afbraak: 'url(#p2d-afbraak)' };
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
    this._sleep = null;

    const svg = (this.svg = el('svg', { class: 'p2d', width: '100%', height: '100%' }));
    svg.style.display = 'block';
    svg.style.touchAction = 'none';
    svg.style.userSelect = 'none';
    svg.style.background = '#ffffff';
    svg.innerHTML = `<style>${STIJL}</style><defs>
      <pattern id="p2d-afbraak" patternUnits="userSpaceOnUse" width="160" height="160" patternTransform="rotate(45)">
        <rect width="160" height="160" fill="rgba(224,64,58,0.12)"/>
        <rect x="0" y="0" width="45" height="160" fill="#e0403a"/>
      </pattern></defs>`;
    this.inhoud = el('g');
    svg.appendChild(this.inhoud);
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

  dispose() {
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
        mg.appendChild(el('polygon', { points: pts(r), fill: KLEUR[mu.status] || KLEUR.bestaand, stroke: RAND[mu.status] || RAND.bestaand }));
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

  _bindInteractie() {
    const svg = this.svg;
    const rect = () => this.container.getBoundingClientRect();
    const midDist = () => {
      const p = [...this._wijzers.values()];
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 };
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
      svg.setPointerCapture?.(e.pointerId);
      this._wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._wijzers.size === 1) this._sleep = { x: e.clientX, y: e.clientY, bewogen: false };
      else if (this._sleep) this._sleep.bewogen = true; // twee vingers = geen tik
    });
    svg.addEventListener('pointermove', (e) => {
      if (!this._wijzers.has(e.pointerId) || !this._view) return;
      const r = rect();
      if (this._wijzers.size === 1) {
        const vorig = this._wijzers.get(e.pointerId);
        this._wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._sleep && !this._sleep.bewogen && Math.hypot(e.clientX - this._sleep.x, e.clientY - this._sleep.y) > 5) this._sleep.bewogen = true;
        if (this._sleep?.bewogen) {
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
      }
    });
    const einde = (e) => {
      if (!this._wijzers.has(e.pointerId)) return;
      this._wijzers.delete(e.pointerId);
      const s = this._sleep;
      if (this._wijzers.size === 0) {
        this._sleep = null;
        if (s && !s.bewogen && e.type === 'pointerup') {
          const doel = document.elementFromPoint(e.clientX, e.clientY);
          const hit = doel && this.svg.contains(doel) ? doel.closest('[data-id]') : null;
          this._sel(hit ? hit.getAttribute('data-id') : null);
        }
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
