import { recordSeeds, refreshSeeded } from './seedMigration';
import { Sheet, MAX_COLS } from './sheet/Sheet';
import type { GameView } from './game/GameView';
import { SheetPane, type Tone } from './ui/SheetPane';
import { helpButton } from './ui/help';
import { restoreCells, type SavedCell } from './storage';
import type { Mode } from './sheet/Sheet';
import { installGrabGesture, installPinchZoom } from './ui/touch';
import { installMouseGestures } from './ui/MouseGestures';

export interface SheetTab {
  id: string;
  title: string;
  /** The tab panel to hand to the tab strip. */
  root: HTMLElement;
  sheet: Sheet;
  pane: SheetPane;
  /** The tab is shown (true) or hidden (false). */
  setActive(active: boolean): void;
  /** Puts the starting cells back as written (cells of your own are left alone). Returns how many. */
  restoreSeed(): number;
  /** Closes the tab for good: stops its cells and takes the page apart. */
  destroy(): void;
}

export interface SheetTabOptions {
  /** Short lowercase id used in cell paths ('lab', 'monitor', 'plots'). */
  id: string;
  title: string;
  icon: string;
  /** The line under the title until something else is said. */
  intro: string;
  /** Cells the tab starts with (address, code): put back by the restore button when there are some. */
  seed?: ReadonlyArray<readonly [string, string]>;
  /** Fingerprints of earlier shipped versions of seeded cells (see seedMigration.ts): a saved copy that still is one of them gets the new version. */
  olderVersions?: Readonly<Record<string, readonly string[]>>;
  restoreLabel?: string;
  restoreHint?: string;
  /** id of the element holding the sheet (the Lab keeps `lab`); default `<id>-sheet`. */
  containerId?: string;
  panelId?: string;
  /** What this browser remembered about the tab, or null on the first visit. */
  load: () => { rows: number; cols?: number; cells: SavedCell[]; mode: Mode } | null;
  /** Starts keeping the tab's cells in this browser. */
  startSave: (sheet: Sheet) => (() => void) | void;
  /** After the tab is first made without anything remembered (before it is saved the first time). */
  onFresh?: (tab: SheetTab) => void;
}

/**
 * A tab that holds a sheet of its own, with the same abilities as the one under the game board: cell addresses, TypeScript
 * in cells and cell-blocks, editors, menus. The Lab, the Monitor and every tab somebody adds are made here. There is no game
 * board in it: `game` in its code is the one game on the first tab.
 */
export function createSheetTab(view: GameView, smallScreen: boolean, opts: SheetTabOptions): SheetTab {
  const { id, title: name, icon } = opts;
  const root = document.createElement('section');
  root.id = opts.panelId ?? `${id}-panel`;
  root.className = 'sheet-tab-panel';
  root.setAttribute('role', 'tabpanel');
  root.setAttribute('aria-labelledby', `tab-${id}`);
  root.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'lab-bar';
  const heading = document.createElement('strong');
  heading.textContent = `${icon} ${name}`;
  const say = document.createElement('span');
  say.className = 'lab-say';
  say.setAttribute('aria-live', 'polite');
  say.textContent = opts.intro;
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.textContent = 'Show code';
  modeBtn.title = 'Switch every block between what it prints and its TypeScript';
  bar.append(heading, say, modeBtn);
  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.textContent = opts.restoreLabel ?? '↺ Restore';
  restoreBtn.title = opts.restoreHint ?? 'Put the starting cells back as they were written (your own cells stay)';
  if (opts.seed?.length) bar.append(restoreBtn);
  bar.append(helpButton('start'));

  const container = document.createElement('div');
  container.id = opts.containerId ?? `${id}-sheet`;
  container.className = 'sheet-pane sheet-tab-sheet';
  root.append(bar, container);
  document.getElementById('app')!.after(root);

  const sheet = new Sheet(container, { board: false, id });
  let sayTimer = 0;
  const speak = (text: string, tone: Tone = 'info'): void => {
    say.textContent = text;
    say.dataset.tone = tone;
    window.clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => {
      say.dataset.tone = 'info';
    }, 5000);
  };

  const pane = new SheetPane(
    sheet,
    view,
    {
      say: speak,
      hasBoard: false,
      firstFreeRow: 0,
      onCorner: () => {
        sheet.container.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
        speak('Back at the top-left corner.', 'info');
      },
    },
    'A1',
  );

  const setMode = (mode: 'run' | 'view'): void => {
    sheet.setMode(mode);
    modeBtn.textContent = mode === 'run' ? 'Show code' : 'Show output';
    speak(mode === 'view' ? 'Code view: every block shows its TypeScript 👁' : 'Output view: every block shows what it prints ▶', 'info');
  };
  modeBtn.addEventListener('click', () => setMode(sheet.mode === 'run' ? 'view' : 'run'));

  const restoreSeed = (): number => {
    const seed = opts.seed ?? [];
    // Seeds near the bottom need rows below them for their blocks.
    const lastRow = seed.reduce((m, [a]) => Math.max(m, Number(/\d+/.exec(a)?.[0] ?? 1)), 0);
    while (sheet.rowCount < lastRow + 8 && sheet.rowCount < 200) sheet.insertRow(sheet.rowCount - 1);
    for (const [address, code] of seed) sheet.setCode(address, code);
    recordSeeds(id, seed);
    return seed.length;
  };
  restoreBtn.addEventListener('click', () => speak(`Restored ${restoreSeed()} cells ✓`, 'good'));

  const setActive = (active: boolean): void => {
    sheet.setSuspended(!active);
    pane.navigator.root.hidden = !active;
    if (active) {
      sheet.updateStickyHeaders();
      sheet.graph.refresh();
      pane.editor.isOpen && pane.editor.refreshFromSheet();
    } else {
      pane.cellMenu.closeMenu();
      pane.popups.closeAll();
    }
  };
  pane.navigator.root.style.top = 'calc(var(--tabs-h, 0px) + 76px)';
  setActive(false);

  let stopSave: (() => void) | void;
  const tab: SheetTab = {
    id,
    title: name,
    root,
    sheet,
    pane,
    setActive,
    restoreSeed,
    destroy: () => {
      if (stopSave) stopSave();
      if (pane.editor.isOpen) pane.editor.close(false);
      pane.cellMenu.closeMenu();
      pane.popups.closeAll();
      pane.navigator.root.remove();
      sheet.destroy();
      root.remove();
    },
  };

  const saved = opts.load();
  if (saved) {
    while (sheet.rowCount < saved.rows && sheet.rowCount < 500) sheet.insertRow(sheet.rowCount - 1);
    if (saved.cols && saved.cols > sheet.colCount) sheet.addColumns(Math.min(saved.cols, MAX_COLS) - sheet.colCount);
    restoreCells(sheet, saved.cells);
    if (opts.seed?.length) refreshSeeded(sheet, id, opts.seed, opts.olderVersions);
    if (saved.mode === 'view') setMode('view');
  } else {
    if (opts.seed?.length) restoreSeed();
    opts.onFresh?.(tab);
  }
  stopSave = opts.startSave(sheet);

  installMouseGestures(sheet);
  if (smallScreen) {
    installPinchZoom(sheet);
    installGrabGesture(sheet);
  }

  return tab;
}
