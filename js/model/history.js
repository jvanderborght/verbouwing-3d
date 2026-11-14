// Modelgeschiedenis voor undo/redo. Elke stap is een volledige momentopname (modellen zijn klein).

import { applyOps } from './operations.js';

export class Geschiedenis {
  constructor(model, { max = 200 } = {}) {
    this.max = max;
    this.reset(model);
  }

  reset(model) {
    this.verleden = [];
    this.toekomst = [];
    this.huidig = model;
    this.#melden();
  }

  /** Past operaties toe; bij succes wordt het een nieuwe undo-stap. Geeft het applyOps-resultaat terug. */
  toepassen(ops, label = '') {
    const r = applyOps(this.huidig, ops);
    if (r.ok) this.vastleggen(r.model, label);
    return r;
  }

  /** Legt een (al gevalideerd) nieuw model vast als stap, bv. na import. */
  vastleggen(model, label = '') {
    this.verleden.push({ model: this.huidig, label });
    if (this.verleden.length > this.max) this.verleden.shift();
    this.toekomst = [];
    this.huidig = model;
    this.#melden();
  }

  get kanUndo() { return this.verleden.length > 0; }
  get kanRedo() { return this.toekomst.length > 0; }

  undo() {
    if (!this.kanUndo) return false;
    const stap = this.verleden.pop();
    this.toekomst.push({ model: this.huidig, label: stap.label });
    this.huidig = stap.model;
    this.#melden();
    return true;
  }

  redo() {
    if (!this.kanRedo) return false;
    const stap = this.toekomst.pop();
    this.verleden.push({ model: this.huidig, label: stap.label });
    this.huidig = stap.model;
    this.#melden();
    return true;
  }

  /** Luisteraar wordt opgeroepen met het huidige model na elke wijziging. Geeft afmeldfunctie terug. */
  opWijziging(fn) {
    (this.luisteraars ||= new Set()).add(fn);
    return () => this.luisteraars.delete(fn);
  }

  #melden() {
    if (this.luisteraars) for (const fn of this.luisteraars) fn(this.huidig, this);
  }
}
