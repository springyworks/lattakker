import { CH, CW, ORIGIN_X, ORIGIN_Y, type Sheet, type SheetView } from '../sheet/Sheet';
import { HUD_W, HUD_X } from './Hud';

/** How large the splash shows its square: one square fills much of the window. */
const SPLASH_SCALE = 2.5;
const GLIDE_MS = 1900;

/** The view in which the game is played: the board and the panel beside it (on a small screen, the board) fit the window. */
export function gameViewFor(sheet: Sheet, smallScreen: boolean): SheetView {
  const c = sheet.container;
  const needed = smallScreen ? ORIGIN_X + 10 * CW + 12 : HUD_X + HUD_W + 12;
  let scale = c.clientWidth / needed;
  if (!smallScreen) scale = Math.min(scale, c.clientHeight / (ORIGIN_Y + 10 * CH + 16));
  return { scale: Math.min(1.25, Math.max(0.4, scale)), left: 0, top: 0 };
}

/**
 * What a visitor sees first: the sheet zoomed in on one square (the red flag), waiting. A click (or any key) glides the
 * view out to the place where the game is played. Leaving the tab ends it at once.
 */
export class Splash {
  private readonly root = document.createElement('div');
  private open = true;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], .monaco-editor')) return;
    e.preventDefault();
    void this.dismiss(true);
  };

  constructor(
    private readonly sheet: Sheet,
    private readonly square: { col: number; row: number },
    private readonly home: () => SheetView,
    private readonly arrived: () => void,
  ) {
    this.root.className = 'splash';
    this.root.setAttribute('role', 'button');
    this.root.tabIndex = 0;
    this.root.setAttribute('aria-label', 'Lattakker. Click to start playing.');
    const title = document.createElement('div');
    title.className = 'splash-title';
    title.textContent = 'Lattakker';
    const hint = document.createElement('div');
    hint.className = 'splash-hint';
    hint.textContent = 'Click anywhere to play';
    this.root.append(title, hint);
    document.body.append(this.root);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('click', () => void this.dismiss(true));
    this.root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', this.onKey, true);
    new ResizeObserver(() => this.place()).observe(sheet.container);
    window.addEventListener('resize', () => this.place());
    sheet.jumpTo(sheet.viewAround(square.col, square.row, SPLASH_SCALE));
    this.place();
  }

  private place(): void {
    if (!this.open) return;
    const r = this.sheet.container.getBoundingClientRect();
    Object.assign(this.root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    // The window changed size: keep the square in the middle.
    this.sheet.jumpTo(this.sheet.viewAround(this.square.col, this.square.row, SPLASH_SCALE));
  }

  /** Ends the splash: gliding out to the game, or (leaving the tab) at once. */
  async dismiss(glide: boolean): Promise<void> {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    if (glide) await this.sheet.flyTo(this.home(), GLIDE_MS);
    else this.sheet.jumpTo(this.home());
    this.arrived();
  }
}
