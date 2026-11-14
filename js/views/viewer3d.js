// STUB — wordt door viewer-3d ingevuld. Interface ligt vast (zie docs/DATAMODEL.md en CLAUDE.md).
export class Viewer3D {
  /** @param {HTMLElement} container */
  constructor(container) { this.container = container; this._sel = () => {}; }
  /**
   * @param {object} model
   * @param {{ verborgenNiveaus?: string[], doorsnede?: number|null, selectie?: string|null }} opties
   *   doorsnede = z (mm) waarboven alles weggesneden wordt; null = geen doorsnede
   */
  render(model, opties = {}) { this.container.textContent = `3D (stub): ${model.muren.length} muren`; }
  /** @param {(id: string|null) => void} fn — opgeroepen wanneer de gebruiker een element aanklikt/-tikt */
  opSelectie(fn) { this._sel = fn; }
  zoomAlles() {}
  dispose() { this.container.textContent = ''; }
}
