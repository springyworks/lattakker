import { InternalEvent } from '@maxgraph/core';
import type { Sheet } from '../sheet/Sheet';
import { workspace } from '../workspace';

const STEP = 1.15;

/**
 * Zooms the sheet (the game board and every cell with it) on its own, without zooming the whole browser page:
 * Ctrl + mouse wheel (or a trackpad pinch), Ctrl + "+", Ctrl + "-" and Ctrl + 0 (back to 100%), and a small − 100% + control
 * at the bottom right of the sheet. The browser's own page zoom is kept out of the way for as long as the sheet is on screen.
 */
export class ZoomControls {
  private readonly box = document.createElement('div');
  private readonly label = document.createElement('button');

  constructor(private readonly sheet: Sheet) {
    this.box.className = 'zoom-controls';
    this.box.append(this.button('−', 'Zoom out (Ctrl and −)', () => this.step(1 / STEP)), this.label, this.button('+', 'Zoom in (Ctrl and +)', () => this.step(STEP)));
    this.label.type = 'button';
    this.label.className = 'zoom-level';
    this.label.title = 'Back to 100% (Ctrl and 0)';
    this.label.addEventListener('click', () => this.reset());
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'wheel']) this.box.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(this.box);

    // Trackpad pinch and Ctrl + mouse wheel arrive as wheel events with ctrlKey set.
    sheet.container.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        sheet.zoomAround(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      },
      { passive: false },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || workspace.current !== sheet.id) return;
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

  private step(factor: number): void {
    this.sheet.zoomAround(factor, ...this.centre());
  }

  private reset(): void {
    this.step(1 / this.sheet.graph.getView().getScale());
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
