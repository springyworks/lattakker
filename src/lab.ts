import { Sheet, MAX_COLS } from './sheet/Sheet';
import type { GameView } from './game/GameView';
import { SheetPane, type Tone } from './ui/SheetPane';
import { helpButton } from './ui/help';
import { LAB_DEMOS } from './labDemos';
import { loadLabSaved, startLabAutoSave } from './storage';
import { installGrabGesture, installPinchZoom } from './ui/touch';

export interface Lab {
  /** The tab panel to hand to the tab strip. */
  root: HTMLElement;
  sheet: Sheet;
  pane: SheetPane;
  /** The tab is shown (true) or hidden (false). */
  setActive(active: boolean): void;
  /** Puts every demo back as written (cells of your own are left alone). */
  restoreDemos(): number;
}

/**
 * The Lab tab: a second sheet with the same abilities as the one under the game board (cell addresses,
 * TypeScript in cells and cell-blocks, editors, menus), filled with live demos. It has no game board of
 * its own: `game` in its code is the one game on the first tab.
 */
export function createLab(view: GameView, smallScreen: boolean): Lab {
  const root = document.createElement('section');
  root.id = 'lab-panel';
  root.setAttribute('role', 'tabpanel');
  root.setAttribute('aria-labelledby', 'tab-lab');
  root.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'lab-bar';
  const title = document.createElement('strong');
  title.textContent = '🧪 Lab';
  const say = document.createElement('span');
  say.className = 'lab-say';
  say.setAttribute('aria-live', 'polite');
  say.textContent = 'Live demos. Double-click a block to change it, hover its ⋮ for a menu.';
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.textContent = 'Show code';
  modeBtn.title = 'Switch every block between what it prints and its TypeScript';
  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.textContent = '↺ Restore demos';
  restoreBtn.title = 'Put every demo back as it was written (your own cells stay)';
  bar.append(title, say, modeBtn, restoreBtn, helpButton('start'));

  const container = document.createElement('div');
  container.id = 'lab';
  container.className = 'sheet-pane';
  root.append(bar, container);
  document.getElementById('app')!.after(root);

  const sheet = new Sheet(container, { board: false, id: 'lab' });
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

  const restoreDemos = (): number => {
    for (const [address, code] of LAB_DEMOS) sheet.setCode(address, code);
    return LAB_DEMOS.length;
  };
  restoreBtn.addEventListener('click', () => speak(`Restored ${restoreDemos()} demos ✓`, 'good'));

  const saved = loadLabSaved();
  if (saved) {
    while (sheet.rowCount < saved.rows && sheet.rowCount < 500) sheet.insertRow(sheet.rowCount - 1);
    if (saved.cols && saved.cols > sheet.colCount) sheet.addColumns(Math.min(saved.cols, MAX_COLS) - sheet.colCount);
    for (const [address, code, uid] of saved.cells) sheet.setCode(address, code, uid);
    if (saved.mode === 'view') setMode('view');
  } else {
    restoreDemos();
  }
  startLabAutoSave(sheet);

  if (smallScreen) {
    installPinchZoom(sheet);
    installGrabGesture(sheet);
  }

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

  return { root, sheet, pane, setActive, restoreDemos };
}
