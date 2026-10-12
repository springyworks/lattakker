import '@maxgraph/core/css/common.css';
import './style.css';
import { Sheet } from './sheet/Sheet';
import { HUD_W, HUD_X, Hud } from './ui/Hud';
import { GameView } from './game/GameView';
import { EXAMPLES } from './examples';
import { LAB_DEMOS } from './labDemos';
import { migrateExamples } from './examplesMigration';
import { formatAddress, parseAddress } from './sheet/address';
import { CW, MAX_COLS, ORIGIN_X } from './sheet/Sheet';
import { Dock } from './ui/Dock';
import { Tabs } from './ui/Tabs';
import { createNotebook } from './ui/Notebook';
import { fitBoardToWidth, installGrabGesture, installPinchZoom } from './ui/touch';
import { GAME_NODE } from './sheet/reactivity';
import { SheetPane } from './ui/SheetPane';
import { createLab } from './lab';
import { installAiSurface } from './ai/surface';
import { loadSaved, startAutoSave } from './storage';
import { workspace } from './workspace';
import { router } from './mcp/router';
import { TabServer } from './mcp/tabServer';
import { ShareDialog } from './ui/ShareDialog';

const HELP = `How to play Lattakker
• Both armies have 40 pieces. Yours is RED. Blue's pieces are face down.
• Pick a red piece, then click a dot to move it one square. Scouts (2) can run far.
• A red cross marks a square where you can attack. Higher rank wins, equal ranks both vanish.
• Bombs (B) beat everyone except Miners (3). The Spy (S) beats the Marshal (10) only when the Spy attacks.
• Capture Blue's flag to win. "Undo my move" takes back your last move.
Sheet tricks
• Double-click any cell to write TypeScript. Ctrl+Enter restarts it, Esc restarts it and closes the editor.
• Cells can print, change colour, read other cells (at('A12')), paint ranges (range('A1:J10')) and even move pieces.
• Move a cell or insert a row and the addresses in your code follow along.
• Type a cell like Q120 in the Go to box (right edge) to jump around a long sheet.
• Make things tick: every('1s', () => ...) or watch a square: on('E5', () => ...). Right-click a cell to see who uses it.`;

const HELP_SHORT = 'Pick a red piece, tap a dot to move it. Tap a red cross to attack. Higher rank wins. Capture the Blue flag to win.';

const smallScreen = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
const container = document.getElementById('app')!;
container.classList.add('sheet-pane');
const sheet = new Sheet(container, { board: true, id: 'board' });
const hud = new Hud(sheet);
const view = new GameView(sheet, hud);
const saved = loadSaved();
const restored = saved ? view.game.restore(saved.game) : false;

const pane = new SheetPane(
  sheet,
  view,
  {
    say: (text, tone) => hud.say(text, tone),
    firstFreeRow: 11,
    hasBoard: true,
    onEditorOpen: (address) => hud.setButtonStatus('btn:code', `Coding in ${address}`),
    onEditorClose: () => hud.setButtonStatus('btn:code', 'Not coding'),
    onBoardClick: (address) => view.onSquareClick(address),
    // During the battle double-clicks on the board are part of moving; use the "Code cell" button instead.
    mayEdit: (address) => !(sheet.isBoardAddress(address) && view.game.phase === 'play'),
    onOtherClick: (id) => {
      if (id.startsWith('piece:')) {
        view.onPieceClick(Number(id.slice(6)));
        return true;
      }
      if (id.startsWith('btn:')) {
        pressButton(id);
        return true;
      }
      if (id === 'hud:msg' || id === 'hud:title' || id === 'hud:turn') {
        hud.say(id === 'hud:title' ? 'That is the title 😄 The buttons below do things!' : 'This bubble tells you what is going on. Try clicking a piece!', 'info');
        return true;
      }
      return false;
    },
    tooltipFor: (id) => (id === 'hdr:corner' ? 'Click here to go back to the game board' : (hud.tooltipFor(id) ?? view.tooltipFor(id))),
    onCorner: () => goToGame(),
  },
  'A12',
);
const { editor, popups } = pane;
const lab = createLab(view, smallScreen);

// The sheets join the workspace (the Examples notebook below too), so a cell can be named from anywhere: /board/A12, /lab/J24, @c-1a2b3c4d.
workspace.register({ id: 'board', title: 'Game board', sheet, editor, select: () => tabs.select('board') });
workspace.register({ id: 'lab', title: 'Lab', sheet: lab.sheet, editor: lab.pane.editor, select: () => tabs.select('lab') });

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
      editor.open(pane.lastSheetCell);
      hud.say(`Editing ${pane.lastSheetCell}. Click a cell first to edit a different one.`, 'info');
      break;
  }
}

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
  lab.sheet.markDirty([GAME_NODE]);
  lab.sheet.requestRun();
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

/** Puts the example cells into every cell that is still empty (cells you wrote yourself are never touched). */
function loadExamples(): number {
  let added = 0;
  for (const [address, code] of EXAMPLES) {
    if (sheet.dataAt(address)?.code.trim()) continue;
    sheet.setCode(address, code);
    added++;
  }
  return added;
}

/** The notebook's "↗ On the board": come back to the game board and point at the cell. */
function showOnBoard(address: string): void {
  tabs.select('board');
  const pos = parseAddress(address);
  if (pos) sheet.reveal(pos.row, pos.col, false);
  pane.selectCodeCell(address);
}

// The Examples tab is a notebook: a sheet of its own with big blocks (see ui/Notebook.ts).
const notebook = createNotebook(
  view,
  { sheet, show: showOnBoard },
  EXAMPLES.map(([address, code]) => ({ address, code })),
  smallScreen,
);
lab.root.after(notebook.root);
workspace.register({ id: 'examples', title: 'Examples', sheet: notebook.sheet, editor: notebook.pane.editor, select: () => tabs.select('examples') });
// Every tab runs an MCP server; cells, AI helpers and tools reach them through the page's router (see mcp/router.ts).
for (const tab of workspace.list()) new TabServer(tab, router);
const tabs = new Tabs({ board: container, lab: lab.root, examples: notebook.root });
const share = new ShareDialog(tabs.strip);

// The strip always says where you are, as a cell path: click a cell (or a tile) and it follows.
const showHere = (): void => tabs.setPath(workspace.hereText());
workspace.onFocusChange(showHere);
tabs.onChange((tab) => {
  workspace.setCurrent(tab);
  showHere();
  popups.closeAll();
  pane.cellMenu.closeMenu();
  pane.navigator.root.hidden = tab !== 'board';
  sheet.setSuspended(tab !== 'board');
  lab.setActive(tab === 'lab');
  notebook.setActive(tab === 'examples');
  if (tab === 'board') sheet.container.focus({ preventScroll: true });
});
tabs.select(tabs.fromHash());
showHere();

if (restored && saved) {
  while (sheet.rowCount < saved.rows && sheet.rowCount < 500) sheet.insertRow(sheet.rowCount - 1);
  if (saved.cols && saved.cols > sheet.colCount) sheet.addColumns(Math.min(saved.cols, MAX_COLS) - sheet.colCount);
  for (const [address, code, uid] of saved.cells) sheet.setCode(address, code, uid);
  if (saved.mode === 'view') toggleMode();
} else {
  loadExamples();
}
// Someone returning with saved cells gets the examples that are new since their last visit (never over their own code).
const brought = migrateExamples({ restored, board: sheet, lab: lab.sheet, examples: EXAMPLES, labDemos: LAB_DEMOS });
if (brought > 0) hud.say(`${brought} new or updated examples are on your sheet ✨ Look for the cross-tab and MCP cells in row 42 (and A31 in the Lab).`, 'good');
scheduleSave = startAutoSave(view.game, sheet);

// Expose a few handles for tinkering from the browser console / AI chats.
Object.assign(window as unknown as Record<string, unknown>, { sheet, game: view.game, view, hud, loadExamples, tabs, lab: lab.sheet, labPane: lab.pane, workspace, share, mcpRouter: router });
installAiSurface({ sheet, view, hud, editor });
