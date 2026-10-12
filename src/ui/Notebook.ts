import { aiBridge } from '../aichat/bridge';
import { installPopupMenu } from '../editor/EditorContextMenu';
import { CH, Sheet } from '../sheet/Sheet';
import { formatAddress } from '../sheet/address';
import { clickNode } from '../sheet/reactivity';
import { createNotebookEditor, modelFor, monaco } from '../editor/monaco';
import { exampleTemplate } from '../exampleTemplate';
import { loadExamplesSaved, startExamplesAutoSave } from '../storage';
import type { GameView } from '../game/GameView';
import { MAX_COLS } from '../sheet/Sheet';
import { SheetPane, type Tone } from './SheetPane';
import { installGrabGesture, installPinchZoom } from './touch';

/**
 * The Examples tab, as a notebook. It is a real sheet, like the game board's and the Lab's (headers, grid, the
 * ⋮ menu, popups, the editor), but its blocks are big: one example under the other, each with its code at full
 * size on top and its live output underneath, like the strip under the floating editor.
 *
 * The shipped examples were written for the board (they read A12, paint the squares of the board, write to
 * L12 ...), so they run where they live, in their own cells on the game board. A notebook block is a large
 * view of that cell: its code is the very same text (edit it here and the board cell changes), and its output
 * pane shows what that cell shows. If the cell has been emptied, the block shows the original and offers to
 * put it back. Empty cells of the notebook are free: "Create an example here" in the ⋮ menu (or the button
 * above) makes a block of your own that runs right here and is remembered.
 */

export interface NotebookExample {
  /** The cell this example lives in on the game board. */
  address: string;
  code: string;
}

export interface NotebookBoard {
  /** The game board's sheet: where the examples run. */
  sheet: Sheet;
  /** Brings the board to the front and points at a cell. */
  show(address: string): void;
}

export interface Notebook {
  root: HTMLElement;
  sheet: Sheet;
  pane: SheetPane;
  setActive(active: boolean): void;
}

const ENTRY_COLS = 14;
const HEAD_H = 38;
const LINE_H = 19;
const START_BATCH = 4;
const MORE_BATCH = 3;
const NEW_COLS = 10;
const NEW_ROWS = 8;

const STOP_TYPES = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'keydown'];

/** What a block is about, from the first comment line of its code. */
function titleOf(code: string): string {
  const first = code.split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^\s*\/\/+\s*/, '').trim() || 'Example';
}

const codeOnly = (code: string): string =>
  code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n');

/** The block's size on the board, from the span(cols, rows) in its code. */
function askedSpan(code: string): { cols: number; rows: number } {
  const m = /\bspan\(\s*(\d+)\s*(?:,\s*(\d+))?/.exec(code);
  return { cols: Number(m?.[1] ?? 1), rows: Number(m?.[2] ?? 1) };
}

/** How many sheet rows a notebook block needs for its code (full size) and its output pane. */
function sizeOf(code: string): { rows: number; outH: number } {
  const lines = code.split('\n').length;
  const outH = Math.min(300, Math.max(96, askedSpan(code).rows * CH + 18));
  const codeH = Math.min(720, lines * LINE_H + 24);
  return { rows: Math.max(5, Math.ceil((HEAD_H + codeH + outH + 10) / CH)), outH };
}

interface Entry {
  n: number;
  example: NotebookExample;
  title: string;
  haystack: string;
  rows: number;
  outH: number;
  /** The notebook cell the block sits in, while it is on screen. */
  address: string | null;
  host: HTMLElement | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  /** True while the block shows the real cell of the board (false: it shows the original, for a cell that was emptied). */
  bound: boolean | null;
  syncing: boolean;
  pending: boolean;
  writeTimer: number;
  lastOutput: string;
  refs: { chip: HTMLElement; primary: HTMLButtonElement; out: HTMLElement; outCell: HTMLElement } | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export function createNotebook(view: GameView, board: NotebookBoard, examples: ReadonlyArray<NotebookExample>, smallScreen: boolean): Notebook {
  // ------------------------------------------------------------------ the page around the sheet

  const root = el('section');
  root.id = 'examples-panel';
  root.setAttribute('role', 'tabpanel');
  root.setAttribute('aria-labelledby', 'tab-examples');
  root.hidden = true;

  const bar = el('div', 'lab-bar');
  const title = el('strong', '', '📚 Examples');
  const say = el('span', 'lab-say');
  say.setAttribute('aria-live', 'polite');
  const search = el('input', 'nb-search');
  search.type = 'search';
  search.placeholder = 'Search (timer, colour, plot…)';
  search.setAttribute('aria-label', 'Search examples');
  search.autocomplete = 'off';
  search.spellcheck = false;
  const newBtn = el('button', '', '📝 New example');
  newBtn.type = 'button';
  newBtn.title = 'A free block of your own, with a starting text to fill in';
  const modeBtn = el('button', '', 'Show code');
  modeBtn.type = 'button';
  modeBtn.title = 'For your own blocks: switch between what they print and their TypeScript';
  bar.append(title, say, search, newBtn, modeBtn);

  const container = el('div', 'sheet-pane');
  container.id = 'examples-sheet';
  root.append(bar, container);
  document.getElementById('app')!.after(root);

  const sheet = new Sheet(container, { board: false, id: 'examples' });
  let sayTimer = 0;
  const speak = (text: string, tone: Tone = 'info'): void => {
    say.textContent = text;
    say.dataset.tone = tone;
    window.clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => {
      say.dataset.tone = 'info';
    }, 5000);
  };

  const entryAt = new Map<string, Entry>();
  const pane = new SheetPane(
    sheet,
    view,
    {
      say: speak,
      hasBoard: false,
      firstFreeRow: 0,
      mayEdit: (address) => !entryAt.has(address),
      reserved: (address) => entryAt.has(address),
      onCorner: () => {
        sheet.container.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
        speak('Back at the top of the notebook.', 'info');
      },
    },
    'A1',
  );

  const setMode = (mode: 'run' | 'view'): void => {
    sheet.setMode(mode);
    modeBtn.textContent = mode === 'run' ? 'Show code' : 'Show output';
  };
  modeBtn.addEventListener('click', () => setMode(sheet.mode === 'run' ? 'view' : 'run'));

  // ------------------------------------------------------------------ the blocks

  const entries: Entry[] = examples.map((example, i) => {
    const { rows, outH } = sizeOf(example.code);
    const title = titleOf(example.code);
    return {
      n: i + 1,
      example,
      title,
      haystack: `${title} ${example.code}`.toLowerCase(),
      rows,
      outH,
      address: null,
      host: null,
      editor: null,
      bound: null,
      syncing: false,
      pending: false,
      writeTimer: 0,
      lastOutput: '',
      refs: null,
    };
  });
  let shown: Entry[] = entries;
  let placed = 0;
  let nextRow = 0;

  const ensureRows = (count: number): void => {
    while (sheet.rowCount < count && sheet.rowCount < 999) sheet.insertRow(sheet.rowCount - 1);
  };

  /** The first row at or below `from` where `rows` rows of the notebook's left part are free of the user's own blocks. */
  const nextFreeRow = (from: number, rows: number): number => {
    let r = from;
    for (;;) {
      const hit = sheet.codeCells().find((d) => d.col < ENTRY_COLS && d.row < r + rows && d.row + d.span.rows > r);
      if (!hit) return r;
      r = hit.row + hit.span.rows;
    }
  };

  const previewModel = (e: Entry): monaco.editor.ITextModel => {
    const uri = monaco.Uri.parse(`file:///gallery/ex-${e.n}.ts`);
    return monaco.editor.getModel(uri) ?? monaco.editor.createModel(e.example.code, 'typescript', uri);
  };

  const flash = (b: HTMLButtonElement, text: string, back: string, ms: number): void => {
    b.textContent = text;
    window.setTimeout(() => (b.textContent = back), ms);
  };

  /** The block starts or stops showing the real board cell, depending on whether that cell holds code. */
  const bind = (e: Entry, bound: boolean): void => {
    if (!e.editor) return;
    const home = e.example.address;
    const data = board.sheet.dataAt(home);
    e.bound = bound;
    e.syncing = true;
    e.editor.setModel(bound && data ? modelFor(home, data.code, board.sheet.id) : previewModel(e));
    e.syncing = false;
    if (e.refs) e.refs.primary.textContent = bound ? '▶ Restart' : '▶ Put on the board';
    e.lastOutput = '';
  };

  const paint = (e: Entry): void => {
    if (!e.host || !e.editor || !e.refs) return;
    const home = e.example.address;
    const data = board.sheet.dataAt(home);
    const bound = !!data && data.code.trim() !== '';
    if (bound !== e.bound || !e.editor.getModel()) bind(e, bound);

    // Keep up with changes made on the board while this block is open (but never over what is being typed).
    if (bound && data && !e.pending && !e.editor.hasTextFocus()) {
      const model = e.editor.getModel()!;
      if (model.getValue() !== data.code) {
        e.syncing = true;
        model.setValue(data.code);
        e.syncing = false;
      }
    }

    const { chip, out, outCell } = e.refs;
    chip.textContent = bound ? (codeOnly(data!.code) === codeOnly(e.example.code) ? `board ${home}` : `board ${home} · your version`) : `${home} · not on your board yet`;
    chip.classList.toggle('mine', bound && codeOnly(data!.code) !== codeOnly(e.example.code));

    let html: string;
    let fill = '#f6f7f9';
    if (bound) {
      const geo = board.sheet.geometryOf(home);
      const cw = Math.max(40, geo?.width ?? 240);
      const ch = Math.max(30, geo?.height ?? 120);
      const k = Math.min(1, (out.clientWidth - 14) / cw, (e.outH - 12) / ch);
      outCell.style.width = `${cw}px`;
      outCell.style.height = `${ch}px`;
      outCell.style.transform = `scale(${Math.max(0.2, k)})`;
      html = board.sheet.outputHtml(home, { width: cw, height: ch }, true);
      fill = board.sheet.fillOf(home);
    } else {
      outCell.style.width = 'auto';
      outCell.style.height = 'auto';
      outCell.style.transform = 'none';
      html = '<div class="cell-text out" style="color:#7b8794;padding:8px">This example is not on your board yet. Press “Put on the board” to see it run.</div>';
    }
    const key = fill + html;
    if (key === e.lastOutput) return;
    e.lastOutput = key;
    outCell.style.background = fill;
    outCell.innerHTML = html || '<div class="cell-text out" style="color:#9aa5b1">(no output yet)</div>';
  };

  const mount = (e: Entry): void => {
    const address = e.address!;
    const geo = sheet.geometryOf(address);
    if (!geo) return;
    const home = e.example.address;

    const host = el('div', 'nb-entry');
    host.style.width = `${geo.width - 6}px`;
    host.style.height = `${geo.height - 6}px`;
    host.style.margin = '3px';

    const head = el('div', 'nb-head');
    const heading = el('span', 'nb-title', e.title);
    heading.title = e.title;
    const chip = el('span', 'nb-chip');
    const primary = el('button', 'nb-btn primary', '▶ Restart');
    primary.type = 'button';
    const onBoard = el('button', 'nb-btn', '↗ On the board');
    onBoard.type = 'button';
    onBoard.title = 'Go to the cell of this example on the game board';
    const reset = el('button', 'nb-btn', '↺ Original');
    reset.type = 'button';
    reset.title = 'Put the example back as it was written';
    const copy = el('button', 'nb-btn', '⧉ Copy');
    copy.type = 'button';
    const ask = el('button', 'nb-btn', '🤖 Ask');
    ask.type = 'button';
    ask.title = 'Ask the AI helper about this example';
    ask.addEventListener('click', (ev) => {
      const r = ask.getBoundingClientRect();
      aiBridge.ask(e.bound ? { tab: 'board', address: home } : { tab: 'examples', address }, { at: { x: r.left, y: r.bottom } });
      ev.stopPropagation();
    });
    head.append(heading, chip, primary, onBoard, reset, copy, ask);

    const codeBox = el('div', 'nb-code');
    const out = el('div', 'nb-out');
    out.style.height = `${e.outH}px`;
    out.title = 'What this example shows right now. A click here clicks the cell, as on the board.';
    const outCell = el('div', 'nb-out-cell');
    out.append(outCell);
    host.append(head, codeBox, out);

    // Right-click on a block's header or output pane gets the app's own popup menu, like the editors do.
    const copyText = (text: string): void => void navigator.clipboard?.writeText(text).catch(() => {});
    const askHere = (): void => {
      const r = host.getBoundingClientRect();
      aiBridge.ask(e.bound ? { tab: 'board', address: home } : { tab: 'examples', address }, { at: { x: r.left + 40, y: r.top + 40 } });
    };
    installPopupMenu(head, () => [
      { label: 'Restart', onSelect: () => primary.click() },
      { label: 'On the board', onSelect: () => onBoard.click() },
      { label: 'Back to the original', onSelect: () => reset.click() },
      { label: 'Copy the code', onSelect: () => copyText(e.editor?.getValue() ?? e.example.code) },
      { separator: true },
      { label: '🤖 Ask the AI about this…', hint: 'Alt+I', onSelect: askHere },
    ]);
    installPopupMenu(out, () => {
      const picked = window.getSelection()?.toString() ?? '';
      const text = picked || outCell.innerText.trim();
      return [
        { label: picked ? 'Copy selection' : 'Copy output', disabled: !text, onSelect: () => copyText(text) },
        { label: 'Restart', onSelect: () => primary.click() },
        { separator: true },
        { label: '🤖 Ask the AI about this…', hint: 'Alt+I', onSelect: askHere },
      ];
    });

    for (const type of STOP_TYPES) {
      host.addEventListener(type, (ev) => ev.stopPropagation(), { passive: type === 'wheel' || type === 'touchstart' });
    }

    e.host = host;
    e.refs = { chip, primary, out, outCell };
    sheet.setNodeLabel(`sheet:${address}`, host);
    e.editor = createNotebookEditor(codeBox, previewModel(e));
    e.editor.layout();
    e.editor.onDidChangeModelContent(() => {
      if (!e.bound || e.syncing) return;
      e.pending = true;
      window.clearTimeout(e.writeTimer);
      e.writeTimer = window.setTimeout(() => {
        e.pending = false;
        const value = e.editor?.getValue();
        if (value !== undefined && board.sheet.dataAt(home)?.code !== value) board.sheet.setCode(home, value);
      }, 300);
    });

    primary.addEventListener('click', () => {
      if (e.bound) board.sheet.setCode(home, e.editor?.getValue() ?? e.example.code);
      else board.sheet.setCode(home, e.example.code);
      paint(e);
      speak(e.bound ? `Restarted ${home} on the board ▶` : `${home} is on your board again ✨`, 'good');
    });
    onBoard.addEventListener('click', () => board.show(home));
    reset.addEventListener('click', () => {
      if (e.bound) board.sheet.setCode(home, e.example.code);
      else e.editor?.getModel()?.setValue(e.example.code);
      paint(e);
    });
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(e.editor?.getValue() ?? e.example.code).then(() => flash(copy, '✓ Copied', '⧉ Copy', 1500), () => {});
    });
    out.addEventListener('click', () => {
      if (!e.bound) return;
      board.sheet.pulse(clickNode(home));
      board.sheet.flash(home, '#f2e4bd', 300);
    });

    bind(e, !!board.sheet.dataAt(home)?.code.trim());
    paint(e);
  };

  const unmount = (e: Entry): void => {
    window.clearTimeout(e.writeTimer);
    if (e.address) {
      sheet.setNodeLabel(`sheet:${e.address}`, null);
      sheet.setSpan(e.address, 1, 1);
      entryAt.delete(e.address);
    }
    e.editor?.dispose();
    e.editor = null;
    e.host = null;
    e.refs = null;
    e.address = null;
    e.bound = null;
    e.pending = false;
    e.lastOutput = '';
  };

  const place = (e: Entry, row: number): void => {
    const address = formatAddress(0, row);
    ensureRows(row + e.rows + 1);
    sheet.setSpan(address, ENTRY_COLS, e.rows);
    e.address = address;
    entryAt.set(address, e);
    mount(e);
  };

  const placeMore = (count: number): void => {
    while (placed < shown.length && count-- > 0) {
      const e = shown[placed++];
      const row = nextFreeRow(nextRow, e.rows);
      place(e, row);
      nextRow = row + e.rows + 1;
    }
  };

  const relayout = (): void => {
    for (const e of entries) unmount(e);
    placed = 0;
    nextRow = 0;
    placeMore(START_BATCH);
    container.scrollTo({ top: 0 });
  };

  /** The notebook grows as you scroll: a block is only built when you get near it. */
  const maybeMore = (): void => {
    if (placed >= shown.length) return;
    if (container.scrollTop + container.clientHeight + 1400 > nextRow * CH) placeMore(MORE_BATCH);
  };
  container.addEventListener('scroll', maybeMore, { passive: true });

  search.addEventListener('input', () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = entries.filter((e) => words.every((w) => e.haystack.includes(w)));
    relayout();
    speak(words.length ? `${shown.length} of ${entries.length} examples` : `${entries.length} examples`, 'info');
  });

  // ------------------------------------------------------------------ blocks of your own

  newBtn.addEventListener('click', () => {
    const col = ENTRY_COLS + 1;
    let r = 0;
    for (;;) {
      const hit = sheet.codeCells().find((d) => d.col < col + NEW_COLS && d.col + d.span.cols > col && d.row < r + NEW_ROWS && d.row + d.span.rows > r);
      if (!hit) break;
      r = hit.row + hit.span.rows;
    }
    ensureRows(r + NEW_ROWS + 1);
    const address = formatAddress(col, r);
    sheet.setCode(address, exampleTemplate(Math.min(NEW_COLS, MAX_COLS - col), NEW_ROWS));
    sheet.reveal(r, col, false);
    pane.selectCodeCell(address);
    pane.editor.open(address);
    speak(`A new example in ${address}. Change the title and write your idea below it.`, 'good');
  });

  const saved = loadExamplesSaved();
  if (saved) {
    const lastRow = saved.cells.reduce((m, [a]) => Math.max(m, Number(/\d+/.exec(a)?.[0] ?? 1)), 0);
    ensureRows(Math.min(500, lastRow + 1));
    if (saved.cols && saved.cols > sheet.colCount) sheet.addColumns(Math.min(saved.cols, MAX_COLS) - sheet.colCount);
    for (const [address, code, uid] of saved.cells) sheet.setCode(address, code, uid);
    if (saved.mode === 'view') setMode('view');
  }
  startExamplesAutoSave(sheet);

  if (smallScreen) {
    installPinchZoom(sheet);
    installGrabGesture(sheet);
  }

  // ------------------------------------------------------------------ on screen or not

  let poll = 0;
  const setActive = (active: boolean): void => {
    sheet.setSuspended(!active);
    pane.navigator.root.hidden = !active;
    window.clearInterval(poll);
    if (active) {
      if (placed === 0) placeMore(START_BATCH);
      sheet.updateStickyHeaders();
      sheet.graph.refresh();
      for (const e of entries) e.editor?.layout();
      pane.editor.isOpen && pane.editor.refreshFromSheet();
      poll = window.setInterval(() => {
        for (const e of shown) if (e.host) paint(e);
      }, 400);
      speak(`${entries.length} examples, one under the other. Change a block's code and watch its output.`, 'info');
    } else {
      pane.cellMenu.closeMenu();
      pane.popups.closeAll();
    }
  };
  pane.navigator.root.style.top = 'calc(var(--tabs-h, 0px) + 76px)';
  setActive(false);

  return { root, sheet, pane, setActive };
}
