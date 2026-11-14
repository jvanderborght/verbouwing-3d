// Tekengereedschap in de plattegrond: vertaalt aanwijzergebeurtenissen (plan2d.opPointer) naar bewerkingen
// (js/model/bewerkingen.js) en toont live voorbeelden via plan2d.toonHulp. Past niets zelf toe: elke actie
// gaat via `voerUit(resultaat, label)` van de app (één undo-stap per actie).

import {
  opsMuurTekenen, opsMuurVerplaatsen, opsMuurEindpunt, opsOpeningPlaatsen, ruimteContourBijPunt,
  opsRuimteBenoemen, opsRuimteRechthoek, puntInPolygoon, opsTrapPlaatsen, opsInrichtingPlaatsen, opsAfbraakZone,
} from '../model/index.js';
import { snap, snapDelta } from './snap.js';
import {
  MuurTekenaar, tolerantieMm, hulpMuur, hulpSlepen, openingContour, deltaTekst, mmTekst, isTekengereedschap,
  gereedschapInfo, niveauErboven, richtingUitSleep, trapParameters, hulpTrap, inrichtingParameters, hulpInrichting,
  ruimteOpPunt, afbraakVoorbeeld, wisselZone,
} from './gereedschap.js';
import { zoekElement } from './eigenschappen.js';
import { ruimteDialoog, afbraakDialoog } from './tekendialogen.js';
import { bevestig, meld } from './dialogen.js';

const SLEEP_PX = 6;

/**
 * Na een tik op een touchscreen stuurt de browser nog een (synthetische) 'click' naar de plek van de tik.
 * Opent die tik een dialoog, dan zou die klik op een knop van de dialoog kunnen landen. Daarom: de eerstvolgende
 * klik binnen `ms` opslokken voor de dialoog opent.
 */
function slikVolgendeKlik(ms = 450) {
  return new Promise((klaar) => {
    let gedaan = false;
    const stop = () => { if (gedaan) return; gedaan = true; document.removeEventListener('click', slik, true); klaar(); };
    const slik = (e) => { e.preventDefault(); e.stopPropagation(); stop(); };
    document.addEventListener('click', slik, true);
    setTimeout(stop, ms);
  });
}

export class Tekenen {
  /**
   * @param {{ plan: () => any, model: () => object, niveau: () => string, selectie: () => string|null,
   *           selecteer: (id) => void, voerUit: (r, label) => boolean, opties: () => object,
   *           opToestand?: () => void }} o
   */
  constructor(o) {
    this.o = o;
    this.gereedschap = 'selecteren';
    this.tekenaar = new MuurTekenaar();
    this.druk = null;        // lopende druk in gereedschapsmodus: { punt, gesleept }
    this.sleep = null;       // selecteren: lopend slepen van muur of greep
    this.rechthoek = null;   // ruimte-rechthoek: null | { fase: 1 } | { fase: 2, p1 }
    this.laatsteHover = null;
    this.bezig = false;      // dialoog open ⇒ aanwijzer negeren
    this._ruimteCache = { sleutel: '', contour: null, traag: false };
    this.zone = [];          // afbraakzone: ruimte-id's
    this.trapDruk = null;    // trap: { oorsprong, richting|null } tijdens slepen
    this._voorbeeldCache = { sleutel: '', model: null, r: null };
  }

  get plan() { return this.o.plan(); }
  get model() { return this.o.model(); }
  get niveau() { return this.o.niveau(); }

  /** Kiest een gereedschap (geen actie-gereedschappen zoals niveau/dak: die regelt de app). */
  kies(id) {
    if (!gereedschapInfo(id) || gereedschapInfo(id).actie) return;
    this.annuleer({ stil: true });
    this.zone = [];
    this.gereedschap = id;
    // afbraakzone: een geselecteerde ruimte meteen in de zone
    if (id === 'afbraak') {
      const z = zoekElement(this.model, this.o.selectie());
      if (z?.collectie === 'ruimtes') this.zone = [z.item.id];
    }
    this.plan?.zetModus(isTekengereedschap(id) ? 'gereedschap' : 'navigeren');
    this.vernieuw();
  }

  /** Lopende actie afbreken (Esc, undo, ander niveau, ander ontwerp). */
  annuleer({ stil = false } = {}) {
    const wasIets = this.tekenaar.actief || this.sleep || this.rechthoek || this.druk || this.trapDruk || this.zone.length;
    this.tekenaar.stop();
    this.druk = null;
    this.sleep = null;
    this.rechthoek = null;
    this.trapDruk = null;
    this.zone = [];
    this.laatsteHover = null;
    this.vernieuw();
    if (!stil) this.o.opToestand?.();
    return !!wasIets;
  }

  /** Toestand voor de optiebalk. */
  toestand() {
    const naar = this.model && this.gereedschap === 'trap' ? niveauErboven(this.model, this.niveau) : null;
    const trapNaar = naar ? (this.model.niveaus.find((n) => n.id === naar)?.naam ?? naar) : null;
    return { gereedschap: this.gereedschap, keten: this.tekenaar.actief, rechthoek: this.rechthoek?.fase ?? 0, zone: this.zone.length, trapNaar };
  }

  /** Hulplaag opnieuw opbouwen na een wijziging van model, selectie of niveau. */
  vernieuw() {
    const plan = this.plan;
    if (!plan) return;
    const model = this.model;
    if (this.gereedschap === 'selecteren') {
      const mu = this._geselecteerdeMuur();
      plan.zetSleepbaar(mu ? [mu.id] : []);
      if (!this.sleep) plan.toonHulp(mu ? { punten: this._grepen(mu) } : null);
      return;
    }
    plan.zetSleepbaar([]);
    if (this.gereedschap === 'muur' && this.tekenaar.actief && model) {
      const p = this.tekenaar.aanwijzer;
      plan.toonHulp(hulpMuur({ start: this.tekenaar.start, punt: p, dikte: this.o.opties().muur.dikte, schaal: plan.schaal() }));
      return;
    }
    if (this.rechthoek?.fase === 2) { plan.toonHulp({ punten: [{ p: this.rechthoek.p1, soort: 'snap' }] }); return; }
    if (this.gereedschap === 'afbraak' && model) {
      // zone opschonen (undo, ander niveau) en het voorbeeld opnieuw opbouwen
      this.zone = this.zone.filter((id) => model.ruimtes.some((r) => r.id === id && r.niveau === this.niveau));
      plan.toonHulp(this.zone.length ? { polygonen: this._afbraak().voorbeeld.polygonen } : null);
      return;
    }
    plan.toonHulp(null);
  }

  _geselecteerdeMuur() {
    const z = zoekElement(this.model, this.o.selectie());
    return z && z.collectie === 'muren' && z.item.niveau === this.niveau ? z.item : null;
  }

  _grepen(mu) { return [{ p: mu.start, soort: 'greep' }, { p: mu.eind, soort: 'greep' }]; }

  _snap(punt, schaal, extra = {}) {
    return snap(punt, { model: this.model, niveau: this.niveau, raster: 50, tolerantie: tolerantieMm(schaal), ...extra });
  }

  /** Aanwijzer verlaat de plattegrond. */
  verlaat() {
    this.plan?.markeer(null);
    this.laatsteHover = null;
    if (!this.druk && !this.sleep && !this.trapDruk && ['deur', 'raam', 'ruimte', 'trap', 'inrichting'].includes(this.gereedschap)) this.plan?.toonHulp(null);
  }

  /** Ingang voor plan2d.opPointer. */
  pointer(e) {
    if (this.bezig || !this.model || !this.plan) return;
    if (this.gereedschap === 'selecteren') return this._selecteren(e);
    switch (this.gereedschap) {
      case 'muur': return this._muur(e);
      case 'deur': case 'raam': return this._opening(e);
      case 'ruimte': return this._ruimte(e);
      case 'verwijderen': return this._verwijderen(e);
      case 'trap': return this._trap(e);
      case 'inrichting': return this._inrichting(e);
      case 'afbraak': return this._afbraakPointer(e);
    }
  }

  /** Houdt bij of een druk in gereedschapsmodus een sleep werd (in schermpixels). */
  _volgDruk(e) {
    if (e.soort === 'neer') this.druk = { punt: e.punt, gesleept: false };
    else if (e.soort === 'beweeg' && this.druk && !this.druk.gesleept) {
      const d = Math.hypot(e.punt[0] - this.druk.punt[0], e.punt[1] - this.druk.punt[1]) * e.schaal;
      if (d > SLEEP_PX) this.druk.gesleept = true;
    }
  }

  // ---------------------------------------------------------------- selecteren (navigeren-modus)

  _selecteren(e) {
    const plan = this.plan;
    if (e.soort === 'beweeg' && !this.sleep) {
      plan.markeer(e.doel && !e.doel.startsWith('greep:') ? e.doel : null);
      return;
    }
    const mu = this._geselecteerdeMuur();
    if (e.soort === 'neer') {
      if (!mu) return;
      plan.markeer(null);
      const greep = e.doel?.startsWith('greep:') ? Number(e.doel.slice(6)) : -1;
      if (greep === 0 || greep === 1) this.sleep = { soort: 'greep', welk: greep === 0 ? 'start' : 'eind', muur: mu, van: e.punt, r: null };
      else if (e.doel === mu.id) this.sleep = { soort: 'muur', muur: mu, van: e.punt, r: null };
      return;
    }
    const s = this.sleep;
    if (!s) return;
    if (e.soort === 'beweeg') {
      if (s.soort === 'muur') {
        const d = snapDelta(e.punt[0] - s.van[0], e.punt[1] - s.van[1], 50);
        s.r = opsMuurVerplaatsen(this.model, s.muur.id, d[0], d[1]);
        const midden = [(s.muur.start[0] + s.muur.eind[0]) / 2 + d[0], (s.muur.start[1] + s.muur.eind[1]) / 2 + d[1]];
        const label = { p: [midden[0], midden[1] + s.muur.dikte / 2 + 50 / e.schaal], tekst: s.r.fout ? 'kan niet' : deltaTekst(d[0], d[1]) };
        plan.toonHulp(hulpSlepen(this.model, s.r.ops, { id: s.muur.id, schaal: e.schaal, label }));
      } else {
        const ander = s.welk === 'start' ? s.muur.eind : s.muur.start;
        // negeer ook muren die aan dit eindpunt aansluiten: die schuiven mee, hun oude ligging is geen geldig snapdoel
        s.negeer ||= [s.muur.id, ...this.model.muren
          .filter((B) => B.id !== s.muur.id && B.niveau === s.muur.niveau
            && [B.start, B.eind].some((p) => Math.hypot(p[0] - s.muur[s.welk][0], p[1] - s.muur[s.welk][1]) <= 1))
          .map((B) => B.id)];
        const sn = this._snap(e.punt, e.schaal, { vanaf: ander, negeer: s.negeer });
        s.r = opsMuurEindpunt(this.model, s.muur.id, s.welk, sn.punt);
        const label = s.r.fout ? { p: sn.punt, tekst: 'kan niet' } : null;
        plan.toonHulp(hulpSlepen(this.model, s.r.ops, { id: s.muur.id, snap: sn, schaal: e.schaal, label }));
      }
      return;
    }
    if (e.soort === 'op') {
      this.sleep = null;
      if (s.r?.fout) meld(s.r.fout, 'fout');
      else if (s.r?.ops?.length) this.o.voerUit(s.r, s.soort === 'muur' ? 'Muur verplaatsen' : 'Muureindpunt verplaatsen');
      this.vernieuw();
      return;
    }
    if (e.soort === 'annuleer') { this.sleep = null; this.vernieuw(); }
  }

  // ---------------------------------------------------------------- muur

  _muur(e) {
    const plan = this.plan;
    const t = this.tekenaar;
    this._volgDruk(e);
    if (e.soort === 'annuleer') { this.druk = null; this.vernieuw(); return; }
    const vanaf = t.start || (this.druk?.gesleept ? this._snap(this.druk.punt, e.schaal).punt : null);
    const sn = this._snap(e.punt, e.schaal, { vanaf });

    if (e.soort === 'beweeg' || e.soort === 'neer') {
      t.zetAanwijzer(t.actief ? sn.punt : null);
      plan.toonHulp(hulpMuur({ start: vanaf, punt: sn.punt, dikte: this.o.opties().muur.dikte, snap: sn, schaal: e.schaal }));
      return;
    }
    if (e.soort === 'op') {
      const d = this.druk;
      this.druk = null;
      if (!d?.gesleept) return; // een tik volgt als 'tik'/'dubbeltik'
      if (!t.actief) t.plaats(this._snap(d.punt, e.schaal).punt);
      this._plaatsMuurpunt(sn.punt);
      return;
    }
    if (e.soort === 'tik') { this._plaatsMuurpunt(sn.punt); return; }
    if (e.soort === 'dubbeltik') {
      // tweede tik op (bijna) hetzelfde punt: de eerste tik plaatste het punt al ⇒ enkel stoppen
      // (een dubbeltik ver van het laatste punt plaatst nog een laatste muur)
      if (t.actief && Math.hypot(sn.punt[0] - t.start[0], sn.punt[1] - t.start[1]) * e.schaal > 20) this._plaatsMuurpunt(sn.punt);
      this.klaar();
    }
  }

  _plaatsMuurpunt(p) {
    const t = this.tekenaar;
    const a = t.plaats(p);
    if (a.soort === 'muur') this._muurToepassen(a);
    this.vernieuw();
    this.o.opToestand?.();
  }

  _muurToepassen(a) {
    const opt = this.o.opties().muur;
    const r = opsMuurTekenen(this.model, { niveau: this.niveau, start: a.start, eind: a.eind, dikte: opt.dikte, status: opt.status });
    if (this.o.voerUit(r, 'Muur tekenen')) { this.tekenaar.bevestig(a.eind); return true; }
    return false;
  }

  /** Lengte uit de optiebalk: muur van die lengte in de huidige (of opgegeven) richting. */
  muurMetLengte(lengte, richting = null) {
    const a = this.tekenaar.metLengte(lengte, richting);
    if (a.soort === 'fout') { meld(a.melding, 'info'); return false; }
    const ok = this._muurToepassen(a);
    if (ok) this.tekenaar.zetAanwijzer(null); // richting = die van deze muur tot de aanwijzer opnieuw beweegt
    this.vernieuw();
    this.o.opToestand?.();
    return ok;
  }

  /** "Klaar": keten stoppen. */
  klaar() {
    const n = this.tekenaar.aantal;
    this.tekenaar.stop();
    this.vernieuw();
    this.o.opToestand?.();
    if (n) meld(n === 1 ? '1 muur getekend.' : `${n} muren getekend.`, 'ok', { duur: 1800 });
  }

  // ---------------------------------------------------------------- deur/raam

  _muurVanDoel(doel) {
    const z = zoekElement(this.model, doel);
    if (!z) return null;
    if (z.collectie === 'muren') return z.item;
    if (z.collectie === 'openingen') return this.model.muren.find((m) => m.id === z.item.muur) || null;
    return null;
  }

  _openingOps(e) {
    const mu = this._muurVanDoel(e.doel);
    if (!mu || mu.niveau !== this.niveau) return null;
    const opt = this.o.opties()[this.gereedschap];
    return { mu, r: opsOpeningPlaatsen(this.model, mu.id, e.punt, { type: this.gereedschap, ...opt }) };
  }

  _opening(e) {
    const plan = this.plan;
    if (e.soort === 'beweeg' || e.soort === 'neer') {
      const x = this._openingOps(e);
      plan.markeer(x?.mu.id ?? null);
      if (!x) { plan.toonHulp(null); return; }
      if (x.r.fout) { plan.toonHulp({ labels: [{ p: [e.punt[0], e.punt[1] + x.mu.dikte / 2 + 30 / e.schaal], tekst: 'past hier niet' }] }); return; }
      const item = x.r.ops[0].item;
      const contour = openingContour(this.model, item);
      plan.toonHulp({ polygonen: contour ? [{ contour, stijl: 'voorbeeld' }] : [], labels: [{ p: [e.punt[0], e.punt[1] + x.mu.dikte / 2 + 30 / e.schaal], tekst: `${this.gereedschap} ${item.breedte}` }] });
      return;
    }
    if (e.soort === 'annuleer') { plan.toonHulp(null); return; }
    if (e.soort !== 'tik' && e.soort !== 'dubbeltik') return;
    const x = this._openingOps(e);
    if (!x) { meld(`Tik op een muur van dit niveau om een ${this.gereedschap} te plaatsen.`, 'info', { duur: 2500 }); return; }
    if (this.o.voerUit(x.r, this.gereedschap === 'deur' ? 'Deur plaatsen' : 'Raam plaatsen')) plan.toonHulp(null);
  }

  // ---------------------------------------------------------------- ruimte

  /** Contour voor het hover-voorbeeld (gecachet per 100 mm; uitgeschakeld als de detectie traag blijkt). */
  _ruimteVoorbeeld(punt) {
    const c = this._ruimteCache;
    if (c.traag) return null;
    const sleutel = `${this.niveau}|${Math.round(punt[0] / 100)}|${Math.round(punt[1] / 100)}`;
    if (c.model === this.model && c.sleutel === sleutel) return c.contour;
    const t0 = performance.now();
    let contour = null;
    try { contour = ruimteContourBijPunt(this.model, this.niveau, punt); } catch (err) { console.error(err); }
    if (performance.now() - t0 > 60) c.traag = true;
    Object.assign(c, { model: this.model, sleutel, contour });
    return contour;
  }

  _bestaandeRuimte(punt) {
    return this.model.ruimtes.find((r) => r.niveau === this.niveau && puntInPolygoon(punt, r.contour)) || null;
  }

  _ruimte(e) {
    const plan = this.plan;
    if (this.rechthoek) return this._rechthoek(e);
    if (e.soort === 'beweeg') {
      const best = this._bestaandeRuimte(e.punt);
      plan.markeer(best?.id ?? null);
      if (best) { plan.toonHulp(null); return; }
      if (e.pointerType === 'mouse') {
        const c = this._ruimteVoorbeeld(e.punt);
        plan.toonHulp(c ? { polygonen: [{ contour: c, stijl: 'voorbeeld' }] } : null);
      }
      return;
    }
    if (e.soort === 'tik' || e.soort === 'dubbeltik') this._ruimteTik(e.punt);
  }

  async _ruimteTik(punt) {
    const plan = this.plan;
    const niveau = this.niveau;
    const best = this._bestaandeRuimte(punt);
    this.bezig = true;
    try {
      if (best) {
        plan.toonHulp({ polygonen: [{ contour: best.contour, stijl: 'markering' }] });
        await slikVolgendeKlik();
        const w = await ruimteDialoog({ titel: `Ruimte ${best.id} wijzigen`, naam: best.naam, functie: best.functie });
        if (w) this.o.voerUit(opsRuimteBenoemen(this.model, niveau, punt, w), 'Ruimte benoemen');
        return;
      }
      const contour = ruimteContourBijPunt(this.model, niveau, punt);
      if (!contour) {
        plan.toonHulp(null);
        await slikVolgendeKlik();
        const ja = await bevestig('Geen gesloten ruimte',
          'Hier is geen gesloten ruimte gevonden: het gebied is open (een muur ontbreekt), te groot, of je tikte in een muur. Wil je de ruimte als rechthoek tekenen (twee hoeken aantikken)?',
          { ja: 'Rechthoek tekenen', nee: 'Annuleren' });
        if (ja) this.startRechthoek();
        return;
      }
      plan.toonHulp({ polygonen: [{ contour, stijl: 'voorbeeld' }] });
      await slikVolgendeKlik();
      const w = await ruimteDialoog({ titel: 'Nieuwe ruimte', naam: '', functie: 'overig', ok: 'Aanmaken' });
      if (w) this.o.voerUit(opsRuimteBenoemen(this.model, niveau, punt, w), 'Ruimte benoemen');
    } finally {
      this.bezig = false;
      if (!this.rechthoek) this.vernieuw();
    }
  }

  /** Ruimte als rechthoek tekenen (twee tikken). */
  startRechthoek() {
    if (this.gereedschap !== 'ruimte') this.kies('ruimte');
    this.rechthoek = { fase: 1 };
    this.vernieuw();
    this.o.opToestand?.();
  }

  _rechthoek(e) {
    const plan = this.plan;
    const sn = this._snap(e.punt, e.schaal, { ortho: false });
    if (e.soort === 'beweeg' || e.soort === 'neer') {
      const p1 = this.rechthoek.p1;
      if (!p1) { plan.toonHulp({ punten: [{ p: sn.punt, soort: 'snap' }] }); return; }
      const [a, b] = [p1, sn.punt];
      const contour = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      plan.toonHulp({
        polygonen: [{ contour, stijl: 'voorbeeld' }],
        punten: [{ p: a, soort: 'snap' }, { p: b, soort: 'snap' }],
        labels: [{ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tekst: `${mmTekst(Math.abs(b[0] - a[0]))} × ${mmTekst(Math.abs(b[1] - a[1]))}` }],
      });
      return;
    }
    if (e.soort !== 'tik' && e.soort !== 'dubbeltik') return;
    if (this.rechthoek.fase === 1) { this.rechthoek = { fase: 2, p1: sn.punt }; this.vernieuw(); this.o.opToestand?.(); return; }
    const p1 = this.rechthoek.p1, p2 = sn.punt;
    const niveau = this.niveau;
    this.bezig = true;
    slikVolgendeKlik().then(() => ruimteDialoog({ titel: 'Ruimte (rechthoek)', ok: 'Aanmaken' })).then((w) => {
      if (w) this.o.voerUit(opsRuimteRechthoek(this.model, niveau, p1, p2, w), 'Ruimte tekenen');
    }).finally(() => {
      this.bezig = false;
      this.rechthoek = null;
      this.vernieuw();
      this.o.opToestand?.();
    });
  }

  // ---------------------------------------------------------------- verwijderen

  _verwijderen(e) {
    const plan = this.plan;
    if (e.soort === 'beweeg') { plan.markeer(e.doel && !e.doel.startsWith('greep:') ? e.doel : null); return; }
    if (e.soort !== 'tik' && e.soort !== 'dubbeltik') return;
    const z = e.doel ? zoekElement(this.model, e.doel) : null;
    if (!z) { meld('Tik op een muur, opening of ruimte om ze te verwijderen.', 'info', { duur: 2500 }); return; }
    plan.markeer(null);
    this.o.verwijder(z.item.id);
  }

  // ---------------------------------------------------------------- trap (fase 5)

  /** Resultaat van een bewerking, gecachet per sleutel en model (hover-voorbeelden mogen niet bij elke beweging alles herrekenen). */
  _gecachet(sleutel, fn) {
    const c = this._voorbeeldCache;
    if (c.model === this.model && c.sleutel === sleutel) return c.r;
    let r;
    try { r = fn(); } catch (err) { console.error(err); r = { ops: [], fout: err.message }; }
    Object.assign(c, { model: this.model, sleutel, r });
    return r;
  }

  _trapParams(oorsprong, richting = null) {
    const naar = niveauErboven(this.model, this.niveau);
    if (!naar) return null;
    return trapParameters(this.o.opties(), { van: this.niveau, naar, oorsprong, richting: richting ?? undefined });
  }

  _trapResultaat(p) {
    return this._gecachet(`trap|${JSON.stringify(p)}`, () => opsTrapPlaatsen(this.model, p));
  }

  _toonTrap(p, schaal) {
    const r = this._trapResultaat(p);
    this.plan.toonHulp(hulpTrap(this.model, p, { fout: r.fout || null, schaal }));
  }

  _trap(e) {
    const plan = this.plan;
    if (e.soort === 'annuleer') { this.trapDruk = null; plan.toonHulp(null); return; }
    const sn = this.trapDruk ? null : this._snap(e.punt, e.schaal, { ortho: false });
    if (e.soort === 'neer') {
      this.trapDruk = { oorsprong: sn.punt, richting: null, scherm: e.punt };
      const p = this._trapParams(sn.punt);
      if (p) this._toonTrap(p, e.schaal);
      return;
    }
    if (e.soort === 'beweeg') {
      if (this.trapDruk) {
        const d = this.trapDruk;
        d.richting = richtingUitSleep(d.oorsprong, e.punt, { stap: e.shift ? 15 : 90, min: Math.max(100, 12 / (e.schaal || 1)) }) ?? d.richting;
        const p = this._trapParams(d.oorsprong, d.richting);
        if (p) this._toonTrap(p, e.schaal);
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const p = this._trapParams(sn.punt);
      if (!p) { plan.toonHulp({ labels: [{ p: sn.punt, tekst: 'geen niveau erboven' }] }); return; }
      this._toonTrap(p, e.schaal);
      return;
    }
    if (e.soort === 'op') {
      const d = this.trapDruk;
      this.trapDruk = null;
      if (!d) return;
      const gesleept = Math.hypot(e.punt[0] - d.scherm[0], e.punt[1] - d.scherm[1]) * (e.schaal || 1) > 6;
      if (!gesleept) return; // een tik volgt als 'tik'
      this._trapPlaatsen(d.oorsprong, d.richting);
      return;
    }
    if (e.soort === 'tik' || e.soort === 'dubbeltik') {
      this.trapDruk = null;
      this._trapPlaatsen(this._snap(e.punt, e.schaal, { ortho: false }).punt, null);
    }
  }

  _trapPlaatsen(oorsprong, richting) {
    const p = this._trapParams(oorsprong, richting);
    if (!p) { meld('Er is geen niveau boven dit niveau. Voeg eerst een niveau of een zolder toe.', 'fout'); this.plan.toonHulp(null); return; }
    if (richting != null && richting !== this.o.opties().trap.richting) this.o.opOpties?.((o) => { o.trap.richting = richting; });
    const r = opsTrapPlaatsen(this.model, p);
    const naam = this.model.niveaus.find((n) => n.id === p.naar)?.naam ?? p.naar;
    if (this.o.voerUit(r, `Trap plaatsen naar ${naam}`)) {
      this.plan.toonHulp(null);
      meld(`Trap ${r.info.id} geplaatst: ${r.info.maten.aantalTreden} optreden van ${Math.round(r.info.maten.optrede * 10) / 10} mm naar ${naam}.`, 'ok', { duur: 3500 });
    }
  }

  /** Richtingknoppen in de optiebalk: richting wijzigen (het voorbeeld volgt bij de volgende beweging). */
  zetTrapRichting(richting) {
    this.o.opOpties?.((o) => { o.trap.richting = richting; });
  }

  // ---------------------------------------------------------------- inrichting (fase 5)

  _inrichtingResultaat(punt) {
    const p = inrichtingParameters(this.model, this.o.opties(), { niveau: this.niveau, punt });
    const sleutel = p.positie ? `inr|${JSON.stringify(p)}` : `inr|${p.soort}|${p.ruimte}|${p.status}`;
    return { p, r: this._gecachet(sleutel, () => opsInrichtingPlaatsen(this.model, p)) };
  }

  _rasterPunt(p, stap = 50) { return [Math.round(p[0] / stap) * stap, Math.round(p[1] / stap) * stap]; }

  _inrichting(e) {
    const plan = this.plan;
    if (e.soort === 'annuleer') { plan.toonHulp(null); return; }
    const punt = this._rasterPunt(e.punt);
    if (e.soort === 'beweeg') {
      if (e.pointerType !== 'mouse') return;
      const { p, r } = this._inrichtingResultaat(punt);
      plan.markeer(p.ruimte ?? null);
      plan.toonHulp(r.fout ? hulpInrichting(null, { tekst: 'past hier niet', punt }) : hulpInrichting(r.info.contour, { tekst: p.soort }));
      return;
    }
    if (e.soort !== 'tik' && e.soort !== 'dubbeltik') return;
    const { p, r } = this._inrichtingResultaat(punt);
    const waar = p.ruimte ? ` in ${this.model.ruimtes.find((x) => x.id === p.ruimte)?.naam ?? p.ruimte}` : '';
    if (this.o.voerUit(r, `${p.soort} plaatsen${waar}`)) {
      plan.toonHulp(hulpInrichting(r.info.contour, {}));
      meld(`${p.soort[0].toUpperCase()}${p.soort.slice(1)} geplaatst${waar} (${r.info.id}).`, 'ok', { duur: 2200 });
    }
  }

  // ---------------------------------------------------------------- afbraakzone (fase 5)

  /** Bewerking + voorbeeld voor de huidige zone. */
  _afbraak() {
    const r = this.zone.length ? this._gecachet(`afbraak|${this.zone.join(',')}`, () => opsAfbraakZone(this.model, { ruimte: this.zone })) : null;
    return { r, voorbeeld: afbraakVoorbeeld(this.model, r) };
  }

  _afbraakPointer(e) {
    const plan = this.plan;
    if (e.soort === 'beweeg') { plan.markeer(ruimteOpPunt(this.model, this.niveau, e.punt)?.id ?? null); return; }
    if (e.soort !== 'tik' && e.soort !== 'dubbeltik') return;
    const ru = ruimteOpPunt(this.model, this.niveau, e.punt);
    if (!ru) { meld('Tik in een benoemde ruimte (gebruik eerst het gereedschap Ruimte als het gebied nog geen ruimte is).', 'info', { duur: 3500 }); return; }
    this.zone = wisselZone(this.model, this.zone, ru.id);
    const { r } = this._afbraak();
    if (r?.fout) meld(r.fout, 'fout');
    this.vernieuw();
    this.o.opToestand?.();
  }

  /** Knop "Afbreken": bevestigen (met de randmuren als waarschuwing) en toepassen als één undo-stap. */
  async afbreken() {
    if (!this.zone.length) { meld('Tik eerst de ruimtes van het gebouwdeel aan.', 'info', { duur: 2500 }); return false; }
    const { r, voorbeeld } = this._afbraak();
    if (!r || r.fout) { meld(r?.fout || 'Afbraakzone kon niet berekend worden.', 'fout'); return false; }
    const namen = this.zone.map((id) => this.model.ruimtes.find((x) => x.id === id)?.naam ?? id);
    this.bezig = true;
    let ok = false;
    try {
      await slikVolgendeKlik(50);
      const ja = await afbraakDialoog({ namen, tellingen: voorbeeld.tellingen, randMuren: r.info.randMuren, meldingen: r.info.meldingen });
      if (!ja) return false;
      ok = this.o.voerUit(r, `Afbraakzone: ${namen.join(', ')}`);
      if (ok) {
        this.zone = [];
        meld(`Afgebroken: ${namen.join(', ')}.${r.info.randMuren.length ? ` Mogelijk dragend: ${r.info.randMuren.join(', ')}.` : ''}`, 'ok', { duur: 5000 });
      }
    } finally {
      this.bezig = false;
      this.vernieuw();
      this.o.opToestand?.();
    }
    return ok;
  }

  /** Knop "Wissen": zone leegmaken. */
  wisZone() {
    this.zone = [];
    this.vernieuw();
    this.o.opToestand?.();
  }
}
