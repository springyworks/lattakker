import type { Sheet } from '../sheet/Sheet';
import { CH, ORIGIN_Y } from '../sheet/Sheet';

export interface NavigatorHooks {
  /** Draw the line under the game board's rows (only the board's sheet has one). */
  hasBoard?: boolean;
  /** The player typed a cell address ("Q120") or a row number ("120") and it was revealed. */
  onJump(target: { address?: string; row: number }): void;
  onBadInput(text: string): void;
}

/**
 * A slim strip on the right edge for long sheets: a "Go to" box, plus a miniature of the whole sheet with
 * a tick for every row that holds code (red when it has an error) and a window showing what is on screen.
 * Click or drag on the strip to scroll there.
 */
export class Navigator {
  readonly root = document.createElement('div');
  private readonly input = document.createElement('input');
  private readonly track = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly windowBox = document.createElement('div');
  private drawQueued = false;

  constructor(
    private readonly sheet: Sheet,
    private readonly hooks: NavigatorHooks,
  ) {
    this.root.className = 'sheet-nav';
    this.input.type = 'text';
    this.input.placeholder = 'Go to';
    this.input.title = 'Type a cell (Q120) or a row number, then press Enter';
    this.input.setAttribute('aria-label', 'Go to cell or row');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.track.className = 'sheet-nav-track';
    this.windowBox.className = 'sheet-nav-window';
    this.track.append(this.canvas, this.windowBox);
    this.root.append(this.input, this.track);
    document.body.append(this.root);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.go(this.input.value);
      if (e.key === 'Escape') this.input.blur();
    });

    let dragging = false;
    const scrollTo = (e: PointerEvent): void => {
      const rect = this.track.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      const c = this.sheet.container;
      c.scrollTop = fraction * c.scrollHeight - c.clientHeight / 2;
    };
    this.track.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.track.setPointerCapture(e.pointerId);
      scrollTo(e);
      e.preventDefault();
    });
    this.track.addEventListener('pointermove', (e) => {
      if (dragging) scrollTo(e);
      else this.track.title = this.describeRowAt(e.clientY);
    });
    const stop = (): void => {
      dragging = false;
    };
    this.track.addEventListener('pointerup', stop);
    this.track.addEventListener('pointercancel', stop);

    sheet.container.addEventListener('scroll', () => this.placeWindow());
    sheet.onCodeChanged(() => this.queueDraw());
    sheet.onRowsInserted(() => this.queueDraw());
    sheet.onColumnsInserted(() => this.queueDraw());
    sheet.onAfterRun(() => this.queueDraw());
    new ResizeObserver(() => this.queueDraw()).observe(this.track);
    window.addEventListener('resize', () => this.queueDraw());
    this.queueDraw();
  }

  private go(text: string): void {
    const t = text.trim().toUpperCase();
    if (!t) return;
    if (/^\d+$/.test(t)) {
      const row = Number(t) - 1;
      if (row < 0 || row >= this.sheet.rowCount) return this.reject(text);
      this.hooks.onJump({ row });
    } else {
      const address = this.sheet.resolve(t);
      const data = address ? this.sheet.dataAt(address) : undefined;
      if (!address || !data) return this.reject(text);
      this.hooks.onJump({ address, row: data.row });
    }
    this.input.value = '';
    this.input.blur();
  }

  private reject(text: string): void {
    this.input.classList.add('bad');
    window.setTimeout(() => this.input.classList.remove('bad'), 600);
    this.hooks.onBadInput(text);
  }

  private describeRowAt(clientY: number): string {
    const rect = this.track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const { scale, top } = this.metrics();
    const row = Math.floor(((fraction * this.sheet.container.scrollHeight) / scale - top) / CH) + 1;
    return `Row ${Math.min(this.sheet.rowCount, Math.max(1, row))}`;
  }

  private metrics(): { scale: number; top: number } {
    const view = this.sheet.graph.getView();
    return { scale: view.getScale(), top: ORIGIN_Y + view.getTranslate().y };
  }

  private queueDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  private draw(): void {
    const height = this.track.clientHeight;
    const width = this.track.clientWidth;
    if (height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const total = this.sheet.container.scrollHeight;
    const { scale, top } = this.metrics();
    const rowY = (row: number): number => (((top + row * CH) * scale) / total) * height;
    ctx.fillStyle = '#d7dbe0';
    if (this.hooks.hasBoard) ctx.fillRect(0, rowY(10), width, 1);
    const rows = new Map<number, boolean>();
    for (const d of this.sheet.codeCells()) rows.set(d.row, (rows.get(d.row) ?? false) || d.error !== null);
    for (const [row, hasError] of rows) {
      ctx.fillStyle = hasError ? '#a8433e' : '#6c88a3';
      ctx.fillRect(2, Math.round(rowY(row)), width - 4, Math.max(2, rowY(row + 1) - rowY(row) - 0.5));
    }
    this.placeWindow();
  }

  private placeWindow(): void {
    const c = this.sheet.container;
    const height = this.track.clientHeight;
    const total = c.scrollHeight || 1;
    this.windowBox.style.top = `${(c.scrollTop / total) * height}px`;
    this.windowBox.style.height = `${Math.max(6, (c.clientHeight / total) * height)}px`;
  }
}
