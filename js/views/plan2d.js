// STUB — wordt door viewer-3d ingevuld. Interface ligt vast.
export class Plattegrond {
  /** @param {HTMLElement} container */
  constructor(container) { this.container = container; this._sel = () => {}; }
  /** @param {object} model @param {{ niveau: string, selectie?: string|null, toonMaten?: boolean }} opties */
  render(model, opties) { this.container.textContent = `2D (stub): niveau ${opties?.niveau}`; }
  /** @param {(id: string|null) => void} fn */
  opSelectie(fn) { this._sel = fn; }
  /** Schermcoördinaten → modelcoördinaten [x, y] in mm (voor tekengereedschap in fase 2). */
  schermNaarModel(clientX, clientY) { return [0, 0]; }
  /** Modelcoördinaten → schermcoördinaten [px, py] relatief t.o.v. de container. */
  modelNaarScherm(x, y) { return [0, 0]; }
  zoomAlles() {}
  dispose() { this.container.textContent = ''; }
}
