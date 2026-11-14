// 3D-weergave van het model met Three.js (gevendored, via importmap).
// Model in mm, z omhoog → scène in meter, y omhoog. De modelgroep krijgt schaal 0,001 en een rotatie
// van −90° rond x: (x, y, z)model → (x, z, −y)scène. Dat is een echte rotatie (geen spiegeling):
// de straatgevel (y = 0) kijkt naar +z in de scène, links blijft links.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  muurRichting, muurLengte, muurHoogte, muurAansluiting, muurSegmenten,
  dakVlakken, niveauBovenkant, polygoonOffset, puntInPolygoon,
} from '../model/geometry.js';
import { inrichtingContour } from '../model/vormen.js';
import { zichtbareDakGevels } from '../model/dakgevels.js';
import { verborgenIds } from './bouwstenen.js';
import { muurProfielen, knipStuk, stukVlakken } from './muurprofiel.js';
import { trapBlokken, trapgatenOp, inrichtingHoogte } from './symbolen.js';

// Kleurcode: bestaand grijs, nieuw blauw, afbraak rood transparant.
const KLEUR = {
  muur: { bestaand: 0xc9c4bc, nieuw: 0x4a8fe0, afbraak: 0xe0403a },
  vloer: { bestaand: 0xa9a49c, nieuw: 0x3a78c4, afbraak: 0xe0403a },
  dak: { bestaand: 0x8a7f78, nieuw: 0x2f67ad, afbraak: 0xe0403a },
  kader: { bestaand: 0x4d4d4d, nieuw: 0x1d4f8f, afbraak: 0xe0403a },
  deur: { bestaand: 0x8b6b4a, nieuw: 0x2a64a8, afbraak: 0xe0403a },
  glas: { bestaand: 0xbfe0f5, nieuw: 0x8cc4ff, afbraak: 0xe0403a },
  trap: { bestaand: 0xb5aca2, nieuw: 0x5b9be6, afbraak: 0xe0403a },
  inrichting: { bestaand: 0xe4e0da, nieuw: 0x9cc3f2, afbraak: 0xe0403a },
};
const SELECTIE = 0xff8a00;
const AFBRAAK_OPACITEIT = 0.35;
const KADER = 60; // breedte raamkader (mm)

export class Viewer3D {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this._sel = () => {};
    this._opties = {};
    this._model = null;
    this._clip = [];
    this._materialen = new Map();
    this._moetKaderen = true;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.localClippingEnabled = true;
    r.setClearColor(0xe9eef2);
    Object.assign(r.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this.camera.position.set(12, 10, 18);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9080, 1.9));
    const zon = new THREE.DirectionalLight(0xffffff, 1.7);
    zon.position.set(-6, 14, 9); // linksvoor, hoog
    this.scene.add(zon);

    this.groep = new THREE.Group();
    this.groep.rotation.x = -Math.PI / 2;
    this.groep.scale.setScalar(0.001);
    this.scene.add(this.groep);

    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.screenSpacePanning = true;
    c.maxPolarAngle = Math.PI * 0.495;
    c.minDistance = 1;
    c.maxDistance = 300;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.addEventListener('change', () => this._vraagRender());

    // Klik/tik zonder slepen → selectie
    this._raycaster = new THREE.Raycaster();
    this._neer = null;
    this._opNeer = (e) => { if (e.isPrimary) this._neer = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    this._opOp = (e) => {
      const n = this._neer;
      this._neer = null;
      if (!n || !e.isPrimary) return;
      if (Math.hypot(e.clientX - n.x, e.clientY - n.y) > 6 || performance.now() - n.t > 700) return;
      this._sel(this._kies(e.clientX, e.clientY));
    };
    r.domElement.addEventListener('pointerdown', this._opNeer);
    r.domElement.addEventListener('pointerup', this._opOp);

    this._ro = new ResizeObserver(() => this._pasGrootteAan());
    this._ro.observe(container);
    this._pasGrootteAan();
  }

  /**
   * @param {object} model
   * @param {{ verborgenNiveaus?: string[], doorsnede?: number|null, selectie?: string|null, instellingen?: object }} opties
   *   doorsnede = z (mm) waarboven alles weggesneden wordt; null = geen doorsnede
   *   instellingen = (gedeeltelijke) instellingen voor de trapgeometrie (werkwaarden aantrede/draaitreden), zie js/model/instellingen.js
   * Trappen worden als treden getekend (op hun vanNiveau), inrichting als blokken; het trapgat is een uitsparing in de
   * vloer van naarNiveau. Muren onder een dak volgen de onderkant van het dak (zie muurprofiel.js).
   */
  render(model, opties = {}) {
    this._model = model;
    this._opties = opties || {};
    const d = this._opties.doorsnede;
    this._clip = typeof d === 'number' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), d / 1000)] : [];
    this._leegGroep();
    this._bouw(model);
    if (this._moetKaderen && this._heeftGrootte()) this.zoomAlles();
    this._vraagRender();
  }

  /** @param {(id: string|null) => void} fn — opgeroepen wanneer de gebruiker een element aanklikt/-tikt */
  opSelectie(fn) { this._sel = typeof fn === 'function' ? fn : () => {}; }

  /** Kadert alle zichtbare bouwdelen (zonder perceel). */
  zoomAlles() {
    const box = new THREE.Box3();
    this.groep.updateMatrixWorld(true);
    for (const o of this.groep.children) if (o.userData.id) box.expandByObject(o);
    if (box.isEmpty()) for (const o of this.groep.children) box.expandByObject(o);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    if (!this._heeftGrootte()) { this._moetKaderen = true; return; }
    this._moetKaderen = false;
    const midden = box.getCenter(new THREE.Vector3());
    const straal = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const cam = this.camera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const afstand = (straal / Math.sin(Math.min(vfov, hfov) / 2)) * 1.02;
    const richting = new THREE.Vector3(0.75, 0.6, 1).normalize(); // rechtsvoor, schuin van boven
    cam.position.copy(midden).addScaledVector(richting, afstand);
    cam.near = Math.max(0.05, afstand / 200);
    cam.far = afstand * 20;
    cam.updateProjectionMatrix();
    this.controls.target.copy(midden);
    this.controls.update();
    this._vraagRender();
  }

  dispose() {
    this._ro.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this._opNeer);
    this.renderer.domElement.removeEventListener('pointerup', this._opOp);
    this.controls.dispose();
    this._leegGroep();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.textContent = '';
  }

  // ── intern ────────────────────────────────────────────────────────────────

  _heeftGrootte() { return this.container.clientWidth > 0 && this.container.clientHeight > 0; }

  _pasGrootteAan() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._moetKaderen && this._model) this.zoomAlles();
    this._vraagRender();
  }

  _vraagRender() {
    if (this._gepland) return;
    this._gepland = true;
    requestAnimationFrame(() => {
      this._gepland = false;
      this.renderer.render(this.scene, this.camera);
    });
  }

  _kies(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    const clipY = this._clip.length ? this._clip[0].constant : Infinity;
    const treffers = this._raycaster.intersectObjects(this.groep.children, false);
    const t = treffers.find((h) => h.object.isMesh && h.object.userData.id && h.point.y <= clipY + 1e-6);
    return t ? t.object.userData.id : null;
  }

  _leegGroep() {
    for (const o of [...this.groep.children]) {
      o.geometry?.dispose();
      this.groep.remove(o);
    }
    for (const m of this._materialen.values()) m.dispose();
    this._materialen.clear();
  }

  /** Materiaal volgens soort + status (+ selectie). Gecachet per render. */
  _mat(soort, status, id) {
    const geselecteerd = id != null && id === this._opties.selectie;
    const sleutel = `${soort}|${status}|${geselecteerd}`;
    let m = this._materialen.get(sleutel);
    if (m) return m;
    const afbraak = status === 'afbraak';
    const glas = soort === 'glas';
    m = new THREE.MeshLambertMaterial({
      color: (KLEUR[soort] || KLEUR.muur)[status] ?? KLEUR.muur.bestaand,
      side: THREE.DoubleSide,
      transparent: afbraak || glas,
      opacity: afbraak ? AFBRAAK_OPACITEIT : glas ? 0.4 : 1,
      depthWrite: !(afbraak || glas),
      clippingPlanes: this._clip,
    });
    if (geselecteerd) {
      m.emissive.setHex(SELECTIE);
      m.emissiveIntensity = 0.65;
      if (afbraak || glas) m.opacity = Math.max(m.opacity, 0.6);
    }
    this._materialen.set(sleutel, m);
    return m;
  }

  _voegToe(geo, mat, id) {
    const mesh = new THREE.Mesh(geo, mat);
    if (id) mesh.userData.id = id;
    if (mat.transparent) mesh.renderOrder = 1;
    this.groep.add(mesh);
    return mesh;
  }

  /** Balk langs een muur: t0..t1 langs de as, z0..z1 absoluut, dikte d, verschoven over s loodrecht op de as. */
  _balk(muur, t0, t1, z0, z1, d, mat, id, s = 0) {
    const { ux, uy, nx, ny } = muurRichting(muur);
    const geo = new THREE.BoxGeometry(t1 - t0, d, z1 - z0);
    const mesh = this._voegToe(geo, mat, id);
    const tm = (t0 + t1) / 2;
    mesh.position.set(muur.start[0] + ux * tm + nx * s, muur.start[1] + uy * tm + ny * s, (z0 + z1) / 2);
    mesh.rotation.z = Math.atan2(uy, ux);
    return mesh;
  }

  /** Muurstuk met afgeknipte bovenkant (uit knipStuk): lokale [t, s, z] → model. z0 = vloerpeil. */
  _wandStuk(muur, geknipt, z0, mat, id) {
    const { ux, uy, nx, ny } = muurRichting(muur);
    const [sx, sy] = muur.start;
    const pos = [];
    const P = ([t, s, z]) => [sx + ux * t + nx * s, sy + uy * t + ny * s, z0 + z];
    for (const q of stukVlakken(geknipt, muur.dikte)) {
      const [a, b, c, d] = q.map(P);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return this._voegToe(geo, mat, id);
  }

  _bouw(model) {
    const verborgen = verborgenIds(model, this._opties.verborgenNiveaus || []);
    const niveau = new Map(model.niveaus.map((n) => [n.id, n]));

    // Perceel
    const perceel = model.perceel?.contour;
    if (perceel && perceel.length >= 3) {
      const vorm = new THREE.Shape(perceel.map(([x, y]) => new THREE.Vector2(x, y)));
      const gras = new THREE.MeshLambertMaterial({ color: 0x9cc77a, side: THREE.DoubleSide });
      this._materialen.set('perceel', gras);
      const vlak = this._voegToe(new THREE.ShapeGeometry(vorm), gras, null);
      vlak.position.z = -20;
      const lijnMat = new THREE.LineBasicMaterial({ color: 0x4f7a35 });
      this._materialen.set('perceelLijn', lijnMat);
      const lijn = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(perceel.map(([x, y]) => new THREE.Vector3(x, y, -10))), lijnMat);
      this.groep.add(lijn);
    }

    // Vloeren: extrusie van de contour, dikte onder het peil; trapgaten (naarNiveau) als uitsparing
    const instOpties = this._opties.instellingen ? { instellingen: this._opties.instellingen } : {};
    const gatenPerNiveau = new Map();
    for (const v of model.vloeren) {
      if (verborgen.has(v.id)) continue;
      const n = niveau.get(v.niveau);
      if (!n || v.contour.length < 3) continue;
      // 3 mm naar binnen: voorkomt z-fighting met het buitenvlak van de muren
      const vorm = new THREE.Shape(polygoonOffset(v.contour, -3).map(([x, y]) => new THREE.Vector2(x, y)));
      if (!gatenPerNiveau.has(v.niveau)) gatenPerNiveau.set(v.niveau, trapgatenOp(model, v.niveau, instOpties));
      for (const gat of gatenPerNiveau.get(v.niveau)) {
        // enkel gaten die volledig binnen deze vloer liggen (anders faalt de triangulatie)
        const rand = polygoonOffset(v.contour, -10);
        if (!gat.contour.every((p) => puntInPolygoon(p, rand))) continue;
        vorm.holes.push(new THREE.Path(gat.contour.map(([x, y]) => new THREE.Vector2(x, y))));
      }
      const geo = new THREE.ExtrudeGeometry(vorm, { depth: v.dikte, bevelEnabled: false });
      const mesh = this._voegToe(geo, this._mat('vloer', v.status, v.id), v.id);
      mesh.position.z = n.peil - v.dikte;
    }

    // Muren met uitsparingen + openingen
    for (const muur of model.muren) {
      if (verborgen.has(muur.id)) continue;
      const n = niveau.get(muur.niveau);
      if (!n) continue;
      const L = muurLengte(muur);
      if (L < 1) continue;
      const H = muurHoogte(model, muur);
      const z0 = n.peil;
      const ops = model.openingen.filter((o) => o.muur === muur.id);
      const gaten = ops.filter((o) => o.status !== 'afbraak');
      const a = muurAansluiting(model.muren, muur);
      const mat = this._mat('muur', muur.status, muur.id);
      // bovenkant onder een dak: profiel per zijvlak (anders gewone balken)
      const prof = muurProfielen(model, muur, -a.start, L + a.eind);
      for (const s of muurSegmenten(-a.start, L + a.eind, H, gaten)) {
        if (prof.vrij) { this._balk(muur, s.t0, s.t1, z0 + s.z0, z0 + s.z1, muur.dikte, mat, muur.id); continue; }
        const k = knipStuk(s, prof.links, prof.rechts);
        if (k) this._wandStuk(muur, k, z0, mat, muur.id);
      }

      for (const o of ops) {
        const t0 = o.positie, t1 = o.positie + o.breedte;
        const b0 = z0 + o.borstwering, b1 = Math.min(z0 + H, z0 + o.borstwering + o.hoogte);
        if (o.status === 'afbraak') {
          // opening verdwijnt: dichtmaken = nieuw metselwerk (tenzij de hele muur afgebroken wordt)
          if (muur.status !== 'afbraak') this._balk(muur, t0, t1, b0, b1, muur.dikte, this._mat('muur', 'nieuw', o.id), o.id);
          continue;
        }
        const kader = this._mat('kader', o.status, o.id);
        const diepte = Math.min(90, muur.dikte * 0.6);
        if (o.type === 'raam') {
          this._balk(muur, t0, t1, b0, b0 + KADER, diepte, kader, o.id);
          this._balk(muur, t0, t1, b1 - KADER, b1, diepte, kader, o.id);
          this._balk(muur, t0, t0 + KADER, b0 + KADER, b1 - KADER, diepte, kader, o.id);
          this._balk(muur, t1 - KADER, t1, b0 + KADER, b1 - KADER, diepte, kader, o.id);
          if (o.breedte > 2400) {
            const tm = (t0 + t1) / 2;
            this._balk(muur, tm - KADER / 2, tm + KADER / 2, b0 + KADER, b1 - KADER, diepte, kader, o.id);
          }
          this._balk(muur, t0 + KADER, t1 - KADER, b0 + KADER, b1 - KADER, 12, this._mat('glas', o.status, o.id), o.id);
        } else {
          this._balk(muur, t0, t0 + KADER, b0, b1, diepte, kader, o.id);
          this._balk(muur, t1 - KADER, t1, b0, b1, diepte, kader, o.id);
          this._balk(muur, t0, t1, b1 - KADER, b1, diepte, kader, o.id);
          this._balk(muur, t0 + KADER, t1 - KADER, b0, b1 - KADER, 45, this._mat('deur', o.status, o.id), o.id);
        }
      }
    }

    // Trappen: treden als blokken (spiraal: dunne treden + kolom)
    for (const t of model.trappen || []) {
      if (verborgen.has(t.id)) continue;
      const { treden, kolom } = trapBlokken(model, t, instOpties);
      const mat = this._mat('trap', t.status, t.id);
      for (const tr of treden) {
        if (!(tr.z1 - tr.z0 > 0.5) || tr.contour.length < 3) continue;
        const vorm = new THREE.Shape(tr.contour.map(([x, y]) => new THREE.Vector2(x, y)));
        const mesh = this._voegToe(new THREE.ExtrudeGeometry(vorm, { depth: tr.z1 - tr.z0, bevelEnabled: false }), mat, t.id);
        mesh.position.z = tr.z0;
      }
      if (kolom) {
        const geo = new THREE.CylinderGeometry(kolom.straal, kolom.straal, kolom.z1 - kolom.z0, 16);
        geo.rotateX(Math.PI / 2); // cilinderas langs z (model)
        const mesh = this._voegToe(geo, mat, t.id);
        mesh.position.set(kolom.midden[0], kolom.midden[1], (kolom.z0 + kolom.z1) / 2);
      }
    }

    // Inrichting: eenvoudige blokken (hoogte uit het element of weergavewaarde per soort)
    for (const i of model.inrichting || []) {
      if (verborgen.has(i.id)) continue;
      const n = niveau.get(i.niveau);
      if (!n || !Array.isArray(i.positie) || !(i.breedte > 0) || !(i.diepte > 0)) continue;
      const vorm = new THREE.Shape(inrichtingContour(i).map(([x, y]) => new THREE.Vector2(x, y)));
      const h = inrichtingHoogte(i);
      const mesh = this._voegToe(new THREE.ExtrudeGeometry(vorm, { depth: h, bevelEnabled: false }), this._mat('inrichting', i.status, i.id), i.id);
      mesh.position.z = n.peil + 1; // 1 mm boven de vloer: geen z-fighting
    }

    // Daken (+ gevelvullingen)
    for (const dak of model.daken) {
      if (verborgen.has(dak.id) || dak.contour.length < 3) continue;
      const rust = niveauBovenkant(model, dak.niveau);
      const dikte = dak.dikte ?? 300;
      const mat = this._mat('dak', dak.status, dak.id);
      if (dak.type === 'plat' || !dak.helling) {
        const [vlak] = dakVlakken(dak);
        this._voegToe(prisma(vlak.map(([x, y]) => [x, y, rust + dikte]), [0, 0, -dikte]), mat, dak.id);
        continue;
      }
      // Onderkant dak ligt op het rustvlak aan de contourrand; bovenkant = onderkant + verticale dikte.
      const dv = dikte / Math.cos((dak.helling * Math.PI) / 180);
      for (const vlak of dakVlakken(dak))
        this._voegToe(prisma(vlak.map(([x, y, h]) => [x, y, rust + h + dv]), [0, 0, -dv]), mat, dak.id);
      const murenNiveau = model.muren.filter((m) => m.niveau === dak.niveau);
      const dg = murenNiveau.length ? Math.max(...murenNiveau.map((m) => m.dikte)) : 300;
      const gevelMat = this._mat('muur', dak.status, dak.id);
      // gevelvullingen; vervallen waar een ander dak aansluit of muren de gevel vormen (js/model/dakgevels.js)
      for (const g of zichtbareDakGevels(model, dak, 5))
        this._voegToe(prisma(g.punten.map(([x, y, h]) => [x, y, rust + h]), [g.binnen[0] * dg, g.binnen[1] * dg, 0]), gevelMat, dak.id);
    }
  }
}

/**
 * Gesloten prisma tussen een vlakke 3D-polygoon en dezelfde polygoon verschoven over `verschuiving`.
 * Niet-geïndexeerd → vlakke normalen per driehoek (materialen zijn dubbelzijdig).
 */
function prisma(punten, verschuiving) {
  const P = punten.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const V = new THREE.Vector3(...verschuiving);
  const Q = P.map((p) => p.clone().add(V));
  // Newell-normaal → projectievlak voor de triangulatie
  const nrm = new THREE.Vector3();
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    nrm.x += (a.y - b.y) * (a.z + b.z);
    nrm.y += (a.z - b.z) * (a.x + b.x);
    nrm.z += (a.x - b.x) * (a.y + b.y);
  }
  const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z);
  const proj = az >= ax && az >= ay ? (p) => new THREE.Vector2(p.x, p.y)
    : ax >= ay ? (p) => new THREE.Vector2(p.y, p.z) : (p) => new THREE.Vector2(p.x, p.z);
  const driehoeken = THREE.ShapeUtils.triangulateShape(P.map(proj), []);
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (const [a, b, c] of driehoeken) { tri(P[a], P[b], P[c]); tri(Q[a], Q[c], Q[b]); }
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    tri(P[i], Q[i], Q[j]);
    tri(P[i], Q[j], P[j]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
