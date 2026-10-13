import type { Sheet } from '../sheet/Sheet';

/**
 * "🔍 Zoom back out", top right of the sheet, for as long as the sheet is zoomed in on a cell (the 🔍 of a cell, the cell menu,
 * a link). The cell's own icon only shows while the pointer is on that cell, so it is no way back once the pointer has moved on.
 */
export class ZoomBack {
  private readonly button = document.createElement('button');

  constructor(private readonly sheet: Sheet) {
    this.button.type = 'button';
    this.button.className = 'zoom-back';
    this.button.textContent = '🔍 Zoom back out';
    this.button.title = 'Back to the zoom and place from before';
    this.button.hidden = true;
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.button.addEventListener('click', () => void sheet.zoomOut());
    document.body.append(this.button);
    sheet.onZoomState(() => this.place());
    // A hidden tab has no size: the button goes with it, and comes back when the tab does.
    new ResizeObserver(() => this.place()).observe(sheet.container);
    window.addEventListener('resize', () => this.place());
  }

  private place(): void {
    const rect = this.sheet.container.getBoundingClientRect();
    const show = this.sheet.isZoomed() && rect.width > 0 && rect.height > 0;
    this.button.hidden = !show;
    if (!show) return;
    // Left of the "Go to" box of the navigator, level with it.
    this.button.style.top = `${Math.round(rect.top + 34)}px`;
    this.button.style.right = `${Math.round(window.innerWidth - rect.right + 96)}px`;
  }
}
