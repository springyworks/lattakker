import '@maxgraph/core/css/common.css';
import './style.css';
import { InternalEvent, type MaxPopupMenu, type PopupMenuHandler } from '@maxgraph/core';
import { Sheet } from './sheet/Sheet';
import { HUD_W, HUD_X, Hud } from './ui/Hud';
import { GameView } from './game/GameView';
import { CellEditor } from './editor/CellEditor';
import { CellCodeView } from './editor/CellCodeView';
import { transpile } from './editor/monaco';
import { runCell } from './sheet/runtime';
import { buildApi } from './sheet/api';
import { EXAMPLES } from './examples';
import { colToLetters, formatAddress, parseAddress } from './sheet/address';
import { COLS, CW, ORIGIN_X } from './sheet/Sheet';
import { Dock } from './ui/Dock';
import { fitBoardToWidth, installGrabGesture, installPinchZoom } from './ui/touch';
import { GAME_NODE } from './sheet/reactivity';
import { installAiSurface } from './ai/surface';
import { THEME } from './theme';
import { loadSaved, startAutoSave } from './storage';

const HELP = `How to play Lattakker
• Both armies have 40 pieces. Yours is RED. Blue's pieces are face down.
• Pick a red piece, then click a dot to move it one square. Scouts (2) can run far.
• A red cross marks a square where you can attack. Higher rank wins, equal ranks both vanish.
• Bombs (B) beat everyone except Miners (3). The Spy (S) beats the Marshal (10) only when the Spy attacks.
• Capture Blue's flag to win. "Undo my move" takes back your last move.
Sheet tricks
• Double-click any cell to write TypeScript. Ctrl+Enter runs it, Esc saves and closes.
• Cells can print, change colour, read other cells (at('A12')), paint ranges (range('A1:J10')) and even move pieces.
• Make things tick: every('1s', () => ...) or watch a square: on('E5', () => ...). Right-click a cell to see who uses it.`;

const HELP_SHORT = 'Pick a red piece, tap a dot to move it. Tap a red cross to attack. Higher rank wins. Capture the Blue flag to win.';

const smallScreen = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
const container = document.getElementById('app')!;
const sheet = new Sheet(container);
const hud = new Hud(sheet);
const view = new GameView(sheet, hud);
const saved = loadSaved();
const restored = saved ? view.game.restore(saved.game) : false;
let selectedCodeCell: string | null = null;
let lastSheetCell = 'A12';

const editor = new CellEditor(sheet, {
  onSave(address, code) {
    sheet.setCode(address, code);
    hud.say(`Saved ${address} ✓ ${code.trim() ? 'It runs now and after every move.' : 'The cell is empty again.'}`, 'good');
  },
  onRun(address, code) {
    sheet.setCode(address, code);
    hud.say(`Running ${address} ▶`, 'info');
  },
  onOpen(address) {
    hud.setButtonStatus('btn:code', `Coding in ${address}`);
  },
  onClose() {
    hud.setButtonStatus('btn:code', 'Not coding');
  },
});
new CellCodeView(sheet);

sheet.setRunner((data, ctx) => runCell(data, ctx, (d, c) => buildApi(sheet, view, hud, d, c), transpile));
sheet.raiseHeaders();

function selectCodeCell(address: string): void {
  if (selectedCodeCell) sheet.setSelectionVisual(selectedCodeCell, null);
  selectedCodeCell = address;
  lastSheetCell = address;
  sheet.setSelectionVisual(address, { stroke: THEME.select, strokeWidth: 3 });
  sheet.flash(address, THEME.flash);
  const d = sheet.dataAt(address)!;
  hud.say(
    d.code
      ? `Cell ${address} has code in it. Double-click it (or press "Code cell") to edit. ${sheet.mode === 'view' ? 'You are looking at its code.' : 'You are looking at its output.'}`
      : `Cell ${address} is empty. Double-click it (or press "Code cell") to write TypeScript there ✏️`,
    'info',
  );
}

function toggleMode(): void {
  const next = sheet.mode === 'run' ? 'view' : 'run';
  sheet.setMode(next);
  hud.setButtonLabel('btn:mode', next === 'run' ? 'Show code' : 'Show output', next === 'run' ? 'Cells show output' : 'Cells show code');
  hud.say(next === 'view' ? 'View mode: code cells show their TypeScript 👁' : 'Run mode: code cells show what they print ▶', 'info');
}

/** The corner cell is the safe beacon: one click always brings the player back to the board, at a size that fits. */
function goToGame(): void {
  const needed = smallScreen ? ORIGIN_X + 10 * CW + 12 : HUD_X + HUD_W + 12;
  const target = Math.min(1, Math.max(0.4, sheet.container.clientWidth / needed));
  sheet.zoomBy(target / sheet.graph.getView().getScale());
  sheet.container.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  hud.say('You are back at the game board.', 'info');
}

function pressButton(id: string): void {
  hud.pressButton(id);
  switch (id) {
    case 'btn:shuffle':
      view.shuffle();
      break;
    case 'btn:start':
      view.startOrPause();
      break;
    case 'btn:undo':
      view.undo();
      break;
    case 'btn:new':
      view.newGame();
      break;
    case 'btn:help':
      hud.say(smallScreen ? HELP_SHORT : HELP, 'info', true);
      break;
    case 'btn:mode':
      toggleMode();
      break;
    case 'btn:code':
      editor.open(lastSheetCell);
      hud.say(`Editing ${lastSheetCell}. Click a cell first to edit a different one.`, 'info');
      break;
  }
}

sheet.setListeners({
  onCellClick(address) {
    if (sheet.isBoardAddress(address)) {
      lastSheetCell = address;
      view.onSquareClick(address);
    } else {
      selectCodeCell(address);
    }
  },
  onCellDoubleClick(address) {
    if (sheet.isBoardAddress(address) && view.game.phase === 'play') {
      // During the battle double-clicks on the board are part of moving; use the "Code cell" button instead.
      return;
    }
    editor.open(address);
  },
  onOtherClick(id) {
    if (id.startsWith('piece:')) {
      view.onPieceClick(Number(id.slice(6)));
      return;
    }
    if (id.startsWith('ed:btn')) {
      editor.handleButton(id);
      return;
    }
    if (id.startsWith('btn:')) {
      pressButton(id);
      return;
    }
    if (id === 'hdr:corner') {
      goToGame();
      return;
    }
    if (id.startsWith('hdr:c')) {
      const col = Number(id.slice(5));
      for (let r = 0; r < sheet.rowCount; r++) sheet.flash(formatAddress(col, r), THEME.flash, 400);
      hud.say(`Column ${colToLetters(col)} — cells ${colToLetters(col)}1 to ${colToLetters(col)}${sheet.rowCount}.`, 'info');
      return;
    }
    if (id.startsWith('hdr:r')) {
      const row = Number(id.slice(5));
      for (let c = 0; c < COLS; c++) sheet.flash(formatAddress(c, row), THEME.flash, 400);
      hud.say(`Row ${row + 1} — cells A${row + 1} to ${colToLetters(COLS - 1)}${row + 1}.`, 'info');
      return;
    }
    if (id === 'hud:msg' || id === 'hud:title' || id === 'hud:turn') {
      hud.say(id === 'hud:title' ? 'That is the title 😄 The buttons below do things!' : 'This bubble tells you what is going on. Try clicking a piece!', 'info');
    }
  },
  tooltipFor(id) {
    if (id === 'hdr:corner') return 'Click here to go back to the game board';
    return hud.tooltipFor(id) ?? view.tooltipFor(id);
  },
});

const BOARD_ADDRESSES: string[] = [];
for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) BOARD_ADDRESSES.push(formatAddress(c, r));

let scheduleSave: () => void = () => {};
const boardSeen = new Map<string, string>();
/** Squares whose contents differ from the last look, so a cell reading E5 re-runs only when E5 changes. */
function changedSquares(): string[] {
  const changed: string[] = [];
  for (const address of BOARD_ADDRESSES) {
    const now = JSON.stringify(view.pieceInfoAt(address));
    if (boardSeen.get(address) !== now) {
      boardSeen.set(address, now);
      changed.push(address);
    }
  }
  return changed;
}
view.onChange = () => {
  scheduleSave();
  sheet.markDirty(changedSquares());
  sheet.markDirty([GAME_NODE]);
  sheet.requestRun();
};
view.init(restored);
changedSquares();

if (smallScreen) {
  installPinchZoom(sheet);
  installGrabGesture(sheet);
  fitBoardToWidth(sheet, ORIGIN_X + 10 * CW + 12);
  const dock = new Dock(pressButton, () => sheet.updateStickyHeaders());
  hud.onUpdate((snap) => dock.update(snap));
  dock.update(hud.snapshot());
}

sheet.onRowsInserted((afterRowIndex) => {
  const remap = (addr: string): string => {
    const p = parseAddress(addr);
    if (!p || p.row <= afterRowIndex) return addr;
    return formatAddress(p.col, p.row + 1);
  };
  if (selectedCodeCell) {
    const next = remap(selectedCodeCell);
    if (next !== selectedCodeCell) {
      sheet.setSelectionVisual(selectedCodeCell, null);
      selectedCodeCell = next;
      sheet.setSelectionVisual(selectedCodeCell, { stroke: THEME.select, strokeWidth: 3 });
    }
  }
  lastSheetCell = remap(lastSheetCell);
  if (editor.isOpen && editor.address) {
    const p = parseAddress(editor.address);
    if (p && p.row > afterRowIndex) editor.close(false);
  }
});

sheet.onContentMoved((from, to) => {
  if (selectedCodeCell === from) {
    sheet.setSelectionVisual(selectedCodeCell, null);
    selectedCodeCell = to;
    sheet.setSelectionVisual(selectedCodeCell, { stroke: THEME.select, strokeWidth: 3 });
  }
  if (lastSheetCell === from) lastSheetCell = to;
  if (editor.isOpen && editor.address === from) editor.close(false);
  hud.say(`Moved ${from}'s content to ${to} 📦`, 'good');
});

InternalEvent.disableContextMenu(container);
const popupMenu = sheet.graph.getPlugin<PopupMenuHandler>('PopupMenuHandler')!;
popupMenu.selectOnPopup = false;
popupMenu.factoryMethod = (menu, cell) => {
  const id = cell?.getId() ?? '';
  if (id.startsWith('hdr:r')) {
    const rowIndex = Number(id.slice(5));
    if (rowIndex < 11) return;
    menu.addItem(`Insert row below ${rowIndex + 1}`, null, () => {
      sheet.insertRow(rowIndex);
      hud.say(`Inserted a row below ${rowIndex + 1}. References in code are updated.`, 'good');
    });
  } else if (id.startsWith('sheet:')) {
    const address = id.slice(6);
    const isBoard = sheet.isBoardAddress(address);
    if (!isBoard) {
      menu.addItem(`Edit ${address}`, null, () => editor.open(address));
      if (sheet.dataAt(address)?.code) menu.addItem(`Clear ${address}`, null, () => sheet.setCode(address, ''));
      const tasks = sheet.taskCount(address);
      if (tasks > 0) {
        menu.addItem(`Stop timers in ${address} (${tasks})`, null, () => {
          sheet.stopTasks(address);
          sheet.notifyChanged(address);
          hud.say(`Stopped the timers and watchers in ${address}.`, 'good');
        });
      }
      menu.addSeparator();
    }
    addCellList(menu, 'Used by', sheet.dependentsOf(address), 'No cell reads this one');
    if (!isBoard) addCellList(menu, 'Reads', sheet.readsOf(address), 'Reads nothing');
  }
};

/** Adds a sub-menu listing cells; picking one selects and flashes it. */
function addCellList(menu: MaxPopupMenu, title: string, items: string[], emptyText: string): void {
  const board = items.filter((a) => sheet.isBoardAddress(a));
  const others = items.filter((a) => !sheet.isBoardAddress(a) && a !== GAME_NODE);
  const parts = [...others];
  if (items.includes(GAME_NODE)) parts.push('game');
  if (board.length > 0) parts.push(board.length === 1 ? board[0] : `${board.length} board squares`);
  if (parts.length === 0) {
    menu.addItem(`${title}: ${emptyText}`, null, () => {}, null, undefined, false);
    return;
  }
  const sub = menu.addItem(`${title} (${parts.length})`, null, () => {});
  for (const part of parts.slice(0, 14)) {
    const target = parseAddress(part) ? part : null;
    menu.addItem(part, null, () => {
      if (!target) return;
      sheet.flash(target, THEME.flash, 600);
      if (!sheet.isBoardAddress(target)) selectCodeCell(target);
    }, sub);
  }
}

if (restored && saved) {
  while (sheet.rowCount < saved.rows && sheet.rowCount < 500) sheet.insertRow(sheet.rowCount - 1);
  for (const [address, code] of saved.cells) sheet.setCode(address, code);
  if (saved.mode === 'view') toggleMode();
} else {
  for (const [address, code] of EXAMPLES) sheet.setCode(address, code);
}
scheduleSave = startAutoSave(view.game, sheet);

// Expose a few handles for tinkering from the browser console / AI chats.
Object.assign(window as unknown as Record<string, unknown>, { sheet, game: view.game, view, hud });
installAiSurface({ sheet, view, hud, editor });
