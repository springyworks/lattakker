import { InternalEvent } from '@maxgraph/core';
import { MIN_SCALE, type Sheet } from '../sheet/Sheet';
import { workspace } from '../workspace';

const STEP = 1.15;
/** One notch of a mouse wheel: a fixed, small step (a notch reports about 100 pixels, which must not mean "zoom 2.7 times"). */
const NOTCH = 1.12;
/** A trackpad pinch reports many small deltas: each one counts a little, but never more than this. */
const PINCH_PER_PIXEL = 0.008;
const PINCH_MAX = 0.06;
/** However fast the wheel is turned, the aim is never further than this away from what is on screen: no running ahead of the picture. */
const MAX_LEAD = 1.5;
/** The glide: the picture covers 63% of the way to the aim every this many milliseconds, and never goes past it. */
const GLIDE_MS = 70;
const MAX_SCALE = 2.5;

/**
 * Zooms the sheet (the game board and every cell with it) on its own, without zooming the whole browser page:
 * Ctrl + mouse wheel (or a trackpad pinch), Ctrl + "+", Ctrl + "-" and Ctrl + 0 (back to 100%), and a small − 100% + control
 * at the bottom right of the sheet. The browser's own page zoom is kept out of the way for as long as the sheet is on screen.
 *
 * Fit to view (the ⤢ button, the F key, or Ctrl + Shift + F while typing in an editor) shows whatever the pointer is on whole:
 * the code editor window, the board or a block. Again, and the thing that holds it is shown whole, then the whole sheet, then
 * the view from before the first press.
 */
export class ZoomControls {
  private readonly box = document.createElement('div');
  private readonly label = document.createElement('button');
  private aim = 1;
  private anchor: [number, number] = [0, 0];
  private frame = 0;
  private applied = 0;
  private lastTime = 0;
  /** Where the pointer last was over the sheet: fit to view fits what is there. */
  private pointer: { x: number; y: number } | null = null;

  constructor(private readonly sheet: Sheet) {
    this.box.className = 'zoom-controls';
    this.box.append(
      this.button('−', 'Zoom out (Ctrl and −)', () => this.step(1 / STEP)),
      this.label,
      this.button('+', 'Zoom in (Ctrl and +)', () => this.step(STEP)),
      this.button('⤢', 'Fit to view: show what the pointer was on whole (key F). Press again to show what holds it, then everything, then back where you were.', () => void this.fit()),
    );
    this.label.type = 'button';
    this.label.className = 'zoom-level';
    this.label.title = 'Back to 100% (Ctrl and 0)';
    this.label.addEventListener('click', () => this.reset());
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'wheel']) this.box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(this.box);

    // Trackpad pinch and Ctrl + mouse wheel arrive as wheel events with ctrlKey set. Heard on the window, before anything else,
    // so that blocks, popups and code editors that swallow wheel events cannot take the zoom away.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey || !(e.target instanceof Node) || !(sheet.container.contains(e.target) || this.box.contains(e.target))) return;
        e.preventDefault();
        e.stopPropagation();
        this.wheel(e);
      },
      { passive: false, capture: true },
    );
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.target instanceof Node && sheet.container.contains(e.target)) this.pointer = { x: e.clientX, y: e.clientY };
      },
      true,
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (workspace.current !== sheet.id || e.altKey) return;
        if (e.key.toLowerCase() === 'f' && this.fitKey(e)) {
          e.preventDefault();
          if (!e.repeat) void this.fit();
          return;
        }
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === '+' || e.key === '=') this.step(STEP);
        else if (e.key === '-' || e.key === '_') this.step(1 / STEP);
        else if (e.key === '0') this.reset();
        else return;
        e.preventDefault();
      },
      true,
    );

    const view = sheet.graph.getView();
    view.addListener(InternalEvent.SCALE, () => this.place());
    view.addListener(InternalEvent.SCALE_AND_TRANSLATE, () => this.place());
    // A hidden tab has no size: the control goes with it, and comes back when the tab does.
    new ResizeObserver(() => this.place()).observe(sheet.container);
    window.addEventListener('resize', () => this.place());
    this.place();
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  private centre(): [number, number] {
    const rect = this.sheet.container.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  }

  /** A wheel turn becomes a small change of the aim; the glide does the rest. */
  private wheel(e: WheelEvent): void {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const pixels = e.deltaY * unit;
    if (!pixels) return;
    // A click of a mouse wheel is big and whole (100 pixels, or lines); a pinch is a stream of small fractions.
    const notch = e.deltaMode !== 0 || Math.abs(pixels) >= 40;
    const change = notch ? -Math.sign(pixels) * Math.log(NOTCH) : Math.max(-PINCH_MAX, Math.min(PINCH_MAX, -pixels * PINCH_PER_PIXEL));
    this.aimAt(change, [e.clientX, e.clientY], true);
  }

  /** Moves the aim by `change` (a logarithm: 0.1 is about 10%) around a point of the screen, and starts the glide. */
  private aimAt(change: number, around: [number, number], capped = false): void {
    const now = this.sheet.graph.getView().getScale();
    // While a glide is on, the next turn adds to its aim; otherwise it starts from what is on screen.
    const from = this.frame ? this.aim : now;
    const lead = Math.log(MAX_LEAD);
    const toward = Math.log(Math.min(MAX_SCALE, Math.max(MIN_SCALE, from * Math.exp(change))) / now);
    // Only the wheel is held back; a button, Ctrl + 0 and the like say exactly where to go.
    this.aim = now * Math.exp(capped ? Math.max(-lead, Math.min(lead, toward)) : toward);
    this.anchor = around;
    if (!this.frame) {
      this.applied = now;
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame((t) => this.glide(t));
    }
  }

  private glide(time: number): void {
    const view = this.sheet.graph.getView();
    const now = view.getScale();
    // Something else zoomed meanwhile (a flight to a cell, a touch pinch): do not fight it.
    if (Math.abs(now - this.applied) > this.applied * 1e-6) return this.stop();
    // Real time, so a slow redraw does not make the glide slower: a frame that took long just covers more of the way.
    const dt = Math.min(400, Math.max(1, time - this.lastTime));
    this.lastTime = time;
    const left = Math.log(this.aim / now);
    // Always a part of the way, never past the aim: no swing.
    const next = Math.abs(left) < 0.002 ? this.aim : now * Math.exp(left * (1 - Math.exp(-dt / GLIDE_MS)));
    this.sheet.zoomAround(next / now, ...this.anchor);
    this.applied = view.getScale();
    if (next === this.aim || this.applied === now) return this.stop();
    this.frame = requestAnimationFrame((t) => this.glide(t));
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private step(factor: number): void {
    this.aimAt(Math.log(factor), this.centre());
  }

  private reset(): void {
    this.stop();
    this.aimAt(-Math.log(this.sheet.graph.getView().getScale()), this.centre());
  }

  /** F while the pointer is on the sheet and nobody is typing; Ctrl + Shift + F also while typing in an editor. */
  private fitKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey) return e.shiftKey;
    if (e.shiftKey) return false;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable], .monaco-editor')) return false;
    const rect = this.sheet.container.getBoundingClientRect();
    const p = this.pointer;
    return !!p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
  }

  private async fit(): Promise<void> {
    this.stop();
    await this.sheet.fitToView(this.pointer);
  }

  private place(): void {
    const rect = this.sheet.container.getBoundingClientRect();
    const show = rect.width > 0 && rect.height > 0;
    this.box.hidden = !show;
    if (!show) return;
    this.label.textContent = `${Math.round(this.sheet.graph.getView().getScale() * 100)}%`;
    this.box.style.right = `${Math.round(window.innerWidth - rect.right + 90)}px`;
    this.box.style.bottom = `${Math.round(window.innerHeight - rect.bottom + 12)}px`;
  }
}
