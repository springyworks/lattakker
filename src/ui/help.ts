import { aiBridge } from '../aichat/bridge';
import { cellLink, nav } from '../nav';
import { workspace } from '../workspace';
import { cellHints } from './hints';

/**
 * Help and "show me", everywhere. One small card explains the thing you are pointing at, and its buttons do the
 * thing for you: fly to a cell, open the helper, light up a control with a pulsing ring. F1 opens it for whatever
 * has the focus (inside a code editor F1 stays the editor's own list of commands, Shift+F1 is the help there),
 * and a tiny "?" sits in every panel header, in the tab strip and in each cell's menu.
 *
 * Everything is built with textContent, so a cell's text (its comments, its output) can never become markup.
 */

export interface HelpHooks {
  /** Where a control of the tab strip is on screen ('ai', 'share', 'back', 'path' ...), or null. */
  stripRect(id: string): DOMRect | null;
}

export interface HelpContext {
  tab?: string;
  address?: string | null;
}

type Maker = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

const el: Maker = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

let hooks: HelpHooks = { stripRect: () => null };

// ---------------------------------------------------------------- spotlight

let spot: { ring: HTMLElement; bubble: HTMLElement | null; timer: number } | null = null;

export function clearSpotlight(): void {
  if (!spot) return;
  window.clearTimeout(spot.timer);
  spot.ring.remove();
  spot.bubble?.remove();
  spot = null;
}

/** A pulsing ring around something on screen, with an optional line of text beside it. Returns false when there is nothing to show. */
export function spotlight(target: Element | DOMRect | null | undefined, text = '', stay = false): boolean {
  clearSpotlight();
  const rect = target instanceof Element ? target.getBoundingClientRect() : target;
  if (!rect || rect.width < 1 || rect.height < 1) return false;
  const pad = 5;
  const ring = el('div', 'help-spot');
  Object.assign(ring.style, { left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` });
  document.body.append(ring);
  let bubble: HTMLElement | null = null;
  if (text) {
    bubble = el('div', 'help-spot-text', text);
    document.body.append(bubble);
    const below = rect.bottom + 12 + bubble.offsetHeight < window.innerHeight;
    bubble.style.top = `${below ? rect.bottom + pad + 8 : Math.max(6, rect.top - bubble.offsetHeight - pad - 8)}px`;
    bubble.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - bubble.offsetWidth - 6))}px`;
  }
  spot = { ring, bubble, timer: stay ? 0 : window.setTimeout(clearSpotlight, 3600) };
  return true;
}

/** Where something is on screen: the first element that matches (and is visible). */
const rectOf = (selector: string): DOMRect | null => {
  const node = document.querySelector(selector);
  return node && (node as HTMLElement).offsetParent !== null ? node.getBoundingClientRect() : null;
};

// ---------------------------------------------------------------- building blocks

const para = (text: string): HTMLElement => el('p', '', text);

function list(items: string[]): HTMLElement {
  const ul = el('ul');
  for (const item of items) ul.append(el('li', '', item));
  return ul;
}

function keys(rows: Array<[string, string]>): HTMLElement {
  const table = el('div', 'help-keys');
  for (const [key, what] of rows) table.append(el('kbd', '', key), el('span', '', what));
  return table;
}

function actions(...buttons: Array<[string, () => void] | null>): HTMLElement {
  const row = el('div', 'help-actions');
  for (const b of buttons) {
    if (!b) continue;
    const button = el('button', 'help-do', b[0]);
    button.type = 'button';
    button.onclick = b[1];
    row.append(button);
  }
  return row;
}

/** The little yellow hint under a hovered cell can be switched off in the hint itself; this brings it back (and switches it off). */
function hintSwitch(): HTMLElement {
  const row = actions([cellHints.enabled ? '💡 Hide the yellow cell hints' : '💡 Show the yellow cell hints again', () => {
    cellHints.set(!cellHints.enabled);
    button.textContent = cellHints.enabled ? '💡 Hide the yellow cell hints' : '💡 Show the yellow cell hints again';
  }]);
  const button = row.querySelector('button')!;
  return row;
}

// ---------------------------------------------------------------- the topics

interface Topic {
  id: string;
  title: string;
  build(ctx: HelpContext): HTMLElement[];
}

const TOPIC_ORDER = ['start', 'cell', 'editor', 'ai', 'inputs', 'tabs', 'board', 'keys'];

/** What the person is pointing at: a cell of the tab on screen that holds the focus. */
function focusedCell(ctx: HelpContext): { tab: string; address: string } | null {
  if (ctx.tab && ctx.address) return { tab: ctx.tab, address: ctx.address };
  const f = workspace.focus;
  return f && f.tab === workspace.current ? { tab: f.tab, address: f.address } : null;
}

function cellTopic(ctx: HelpContext): HTMLElement[] {
  const out: HTMLElement[] = [];
  const at = focusedCell(ctx);
  const tab = at ? workspace.get(at.tab) : undefined;
  const d = at && tab ? tab.sheet.dataAt(at.address) : undefined;
  if (!at || !tab || !d) {
    out.push(para('A cell is one square of the sheet. It can hold a small program that draws, prints, plays or reacts to the game.'), list(['Click a cell to pick it, then press F1 again: I will tell you what it does.', 'Double-click a cell to write code in it.', 'Drag over empty cells to pick a group, then press Shift+Enter: they become one block to write in.', 'Hover a cell and open its ⋮ menu for more.']));
    return out;
  }
  const path = workspace.pathOf(at.tab, at.address);
  const head = el('p', 'help-path');
  head.append('Cell ', cellLink(path), tab.sheet.isBoardAddress(at.address) ? ' (a board square)' : d.code.trim() ? '' : ' (empty)');
  out.push(head);
  if (tab.sheet.isBoardAddress(at.address)) {
    out.push(para('This is a square of the game board. Click a piece, then a dot to move it. Cells for code are lower down, from row 12.'));
    return out;
  }
  if (!d.code.trim()) {
    out.push(para('This cell is empty. Double-click it (or press Enter on it) to write TypeScript here, or ask the helper to make something.'));
    out.push(actions(['✏️ Write code here', () => tab.editor.open(at.address)], ['🤖 Ask the helper', () => aiBridge.ask({ tab: at.tab, address: at.address }, { side: true })]));
    return out;
  }
  // The comment block at the top of the code, read as one short paragraph.
  const lines = d.code.split('\n').map((l) => l.trim());
  const lead: string[] = [];
  for (const l of lines) {
    if (!l.startsWith('//')) break;
    lead.push(l.replace(/^\/\/\s?/, ''));
  }
  const said = lead.join(' ').replace(/\s+/g, ' ').trim();
  out.push(para(said ? `What it says about itself: ${said.length > 260 ? `${said.slice(0, 259)}…` : said}` : 'It has code, but no comments at the top.'));
  if (d.error) out.push(el('p', 'help-error', `⚠ It stopped with: ${d.error}`));
  else {
    const shown = tab.sheet.displayText(d).trim();
    if (shown) out.push(para(`It shows: ${shown.length > 120 ? `${shown.slice(0, 119)}…` : shown}`));
  }
  out.push(
    actions(
      ['👀 Show me this cell', () => nav.goTo(path)],
      ['✏️ Edit', () => tab.editor.open(at.address)],
      ['▶ Run again', () => tab.sheet.setCode(at.address, d.code)],
      ['🤖 Ask the helper', () => aiBridge.ask({ tab: at.tab, address: at.address }, { side: true })],
    ),
  );
  return out;
}

const TOPICS: Record<string, Topic> = {
  start: {
    id: 'start',
    title: '👋 Start here',
    build: () => [
      para('This page is a game board and a spreadsheet at once. The cells hold small programs (TypeScript) that you can read, change and run.'),
      list(['🎲 Game board: play Lattakker, and write cells under the board.', '🧪 Lab: live demos. Double-click one to change it.', '📚 Examples: a notebook of ideas to copy.', '📡 Monitor: the page and this computer, live (graphs and an animated drawing).', '➕ Make a tab of your own with the + at the end of the tabs.', '🤖 AI: a helper that can explain, go to a cell, run it, even write for you.']),
      para('Press F1 any time to get help for the thing you are pointing at. Every ? button does the same.'),
      para('Zoom the board and cells on their own: Ctrl + mouse wheel, Ctrl + and Ctrl − (Ctrl 0 goes back to 100%), or the − + buttons at the bottom right.'),
      actions(['👀 Show me around', startTour], ['🤖 Open the helper', () => aiBridge.toggleSide()]),
    ],
  },
  cell: { id: 'cell', title: '🔲 This cell', build: (ctx) => [...cellTopic(ctx), hintSwitch()] },
  editor: {
    id: 'editor',
    title: '✏️ The code editor',
    build: () => [
      para('Double-click a cell and a small editor opens right in it. Type TypeScript; the cell runs your code from the top.'),
      keys([
        ['Ctrl+Enter', 'run it again, keep editing'],
        ['Esc', 'run it, keep the code and close'],
        ['Ctrl+Z', 'undo (also undoes code the helper added)'],
        ['Ctrl+I', 'ask the helper right at the cursor'],
        ['F1', 'the editor’s list of commands'],
        ['Shift+F1', 'this help'],
      ]),
      para('Write a line like “// AI: why is this red?” and the helper answers right below it.'),
    ],
  },
  ai: {
    id: 'ai',
    title: '🤖 The AI helper',
    build: () => [
      para('Ask in plain words, in any language. The helper looks at the cell you picked, so click one first.'),
      list(['Explain a cell, or find out why it shows an error.', '“Go to A16”: it flies there and makes the cell blink.', '“Run A16”: it runs the cell and tells you what came out.', 'It suggests code, and you press the button to type it in. A grown-up can also let it write in empty cells by itself (⚙ settings); an undo button comes with it.']),
      para('Nothing is sent anywhere until a helper is chosen in ⚙. A model on this computer keeps everything on this computer.'),
      para('It works like a coder: it looks up the exact names in the API and finds a similar example cell before it writes. Those documents (rules, API, every example, README) are also files at ai/index.md, for any AI that can open links.'),
      actions(
        ['👀 Show me the AI button', () => spotlight(hooks.stripRect('ai'), 'Press here, or Alt+I')],
        ['🤖 Open the helper', () => aiBridge.toggleSide()],
        ['⚙ Settings', () => aiBridge.openSettings()],
      ),
      keys([
        ['Alt+I', 'open or close the helper'],
        ['Alt+Shift+I', 'a small pop-up next to the cell'],
        ['Enter', 'send your question'],
      ]),
    ],
  },
  inputs: {
    id: 'inputs',
    title: '🎛 The Inputs panel',
    build: () => [
      para('Cells can ask you things: sliders, boxes, buttons. They gather in this little panel at the bottom left, grouped by the cell that made them.'),
      list(['It starts docked, as just its title. Click the title to open it, and again to dock it (your choice is remembered).', 'Click a blue cell name to fly to the cell that made the control.']),
      actions(['👀 Show me the panel', () => spotlight(rectOf('.input-panel'), 'The controls of the cells live here')]),
    ],
  },
  tabs: {
    id: 'tabs',
    title: '🧭 Moving around',
    build: () => [
      para('The tabs at the top are the pages. The + makes a tab of your own (right-click a tab to rename or close it). The grey chip on the right says where you are, like /lab/A16. That is a cell path: it works from every tab.'),
      list(['◀ ▶ (or Alt+← and Alt+→) go back and forward through the places you visited.', 'Blue dotted names are links: click one to fly to that cell.', 'Type a cell like Q120 in the “Go to” box to jump around a long sheet.']),
      actions(['👀 Show me the tabs', () => spotlight(hooks.stripRect('tabs'), 'Pages')], ['👀 Show me ◀ ▶', () => spotlight(hooks.stripRect('back'), 'Back and forward')], ['👀 Show me my place', () => spotlight(hooks.stripRect('path'), 'Where you are (click to copy)')]),
    ],
  },
  board: {
    id: 'board',
    title: '🎲 How to play',
    build: () => [
      list(['Both armies have 40 pieces. Yours is RED. Blue’s pieces are face down.', 'Click a red piece, then a dot to move it one square. Scouts (2) can run far.', 'A red cross marks a square where you can attack. Higher rank wins; equal ranks both vanish.', 'Bombs (B) beat everyone except Miners (3). The Spy (S) beats the Marshal (10) only when the Spy attacks.', 'Capture Blue’s flag to win. “Undo my move” takes back your last move.']),
    ],
  },
  keys: {
    id: 'keys',
    title: '⌨ Keys',
    build: () => [
      keys([
        ['F1', 'help for what you are pointing at'],
        ['Alt+I', 'the AI helper'],
        ['Alt+Shift+I', 'the helper, small, next to the cell'],
        ['Alt+← / Alt+→', 'back / forward through your places'],
        ['Double-click', 'edit a cell'],
        ['Drag over cells', 'pick a group (a rubber band)'],
        ['Shift+click', 'pick everything from the first cell to this one'],
        ['Ctrl+click', 'add or remove one cell'],
        ['Ctrl+drag', 'pan the view (the sheet, or the code inside an editor)'],
        ['Click, then press and hold', 'Morse: dit, dah-hold. Drag to pan the view'],
        ['Click, click, then press and hold', 'Morse: dit, dit, dah-hold. Drag up to zoom in, down to zoom out'],
        ['Shift+Enter', 'edit the picked cell, or make one block of the picked cells'],
        ['Delete', 'clear the picked cells (press twice)'],
        ['Ctrl+Enter', 'run a cell again'],
        ['Esc', 'let go of the picked cells, or run and close the editor'],
        ['Shift+F1', 'help inside the code editor'],
      ]),
      para('The green squares on a picked block are handles: drag one to make the block bigger or smaller. If its code has a line like span(4, 2), the numbers follow.'),
    ],
  },
};

// ---------------------------------------------------------------- the tour

interface Step {
  rect: () => DOMRect | null;
  text: string;
}

/** A patch near the top left of the sheet on screen: somewhere that surely holds cells. */
function sheetCorner(): DOMRect | null {
  const box = workspace.get(workspace.current)?.sheet.container.getBoundingClientRect();
  return box ? new DOMRect(box.left + 70, box.top + 70, 200, 70) : null;
}

function startTour(): void {
  const steps: Step[] = [
    { rect: () => hooks.stripRect('tabs'), text: 'These tabs are the pages: the game, the Lab, the Examples and the Monitor. The + makes a tab of your own.' },
    { rect: () => hooks.stripRect('path'), text: 'This says where you are, as a cell path. Click it to copy it.' },
    { rect: () => hooks.stripRect('ai'), text: 'The AI helper lives here (Alt+I). Ask it to explain, go to a cell, run it or write code.' },
    { rect: sheetCorner, text: 'Cells hold small programs. Double-click one to write code, hover it for its ⋮ menu.' },
    { rect: () => hooks.stripRect('help'), text: 'And this ? is here whenever you need help. F1 does the same.' },
  ];
  let index = 0;
  const show = (): void => {
    clearSpotlight();
    const step = steps[index];
    if (!step) return stop();
    if (!spotlight(step.rect(), `${index + 1}/${steps.length}  ${step.text}`, true)) {
      index++;
      return show();
    }
    const bubble = spot?.bubble;
    if (!bubble) return;
    const next = el('button', 'help-do', index === steps.length - 1 ? 'Done ✓' : 'Next ▶');
    next.type = 'button';
    next.onclick = () => {
      index++;
      show();
    };
    bubble.append(el('br'), next);
  };
  const stop = (): void => {
    window.removeEventListener('keydown', onKey, true);
    clearSpotlight();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') stop();
  };
  window.addEventListener('keydown', onKey, true);
  show();
}

// ---------------------------------------------------------------- the card

let card: HTMLElement | null = null;
let current: { topic: string; ctx: HelpContext } | null = null;

export function closeHelp(): void {
  card?.remove();
  card = null;
  current = null;
  clearSpotlight();
}

export function showHelp(topic = 'start', ctx: HelpContext = {}): void {
  const t = TOPICS[topic] ?? TOPICS.start;
  current = { topic: t.id, ctx };
  card?.remove();
  card = el('aside', 'help-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Help');
  const close = el('button', 'help-x', '✕');
  close.type = 'button';
  close.title = 'Close (Esc)';
  close.onclick = closeHelp;
  card.append(el('div', 'help-head', t.title), close);
  const body = el('div', 'help-body');
  body.append(...t.build(ctx));
  card.append(body);
  const more = el('div', 'help-more');
  for (const id of TOPIC_ORDER) {
    if (id === t.id) continue;
    const chip = el('button', 'help-chip', TOPICS[id].title);
    chip.type = 'button';
    chip.onclick = () => showHelp(id, ctx);
    more.append(chip);
  }
  card.append(el('div', 'help-small', 'More help:'), more);
  document.body.append(card);
}

/** The topic for what holds the focus: the helper, the inputs, a code editor, a picked cell, else the start page. */
export function topicFor(target: EventTarget | null): { topic: string; ctx: HelpContext } {
  const node = target instanceof Element ? target : null;
  if (node?.closest('.ai-side, .ai-mini')) return { topic: 'ai', ctx: {} };
  if (node?.closest('.input-panel')) return { topic: 'inputs', ctx: {} };
  if (node?.closest('.monaco-editor')) return { topic: 'editor', ctx: {} };
  if (node?.closest('.tab-strip')) return { topic: 'tabs', ctx: {} };
  if (workspace.list().some((t) => t.editor.isOpen && t.id === workspace.current)) return { topic: 'editor', ctx: {} };
  const f = workspace.focus;
  if (f && f.tab === workspace.current) return { topic: 'cell', ctx: { tab: f.tab, address: f.address } };
  return { topic: 'start', ctx: {} };
}

/** Opens the help for what holds the focus, or closes it when that very help is already showing. */
export function toggleHelp(target: EventTarget | null = null): void {
  const found = topicFor(target);
  if (card && current?.topic === found.topic) closeHelp();
  else showHelp(found.topic, found.ctx);
}

/** A tiny "?" button for a panel header. Without a topic it opens the help for whatever holds the focus. */
export function helpButton(topic?: string, className = 'help-icon'): HTMLButtonElement {
  const b = el('button', className, '?');
  b.type = 'button';
  b.title = 'Help and show me (F1)';
  b.setAttribute('aria-label', 'Help');
  b.onclick = (e) => {
    e.stopPropagation();
    if (!topic) return toggleHelp(b);
    if (card && current?.topic === topic) closeHelp();
    else showHelp(topic);
  };
  return b;
}

/** Sets the help up: F1 for whatever has the focus, Esc to close, and where the tab strip's controls are. */
export function installHelp(h: HelpHooks): void {
  hooks = h;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && card) {
        closeHelp();
        return;
      }
      if (e.key !== 'F1' || e.ctrlKey || e.metaKey || e.altKey) return;
      // In a code editor F1 is Monaco's own list of commands; Shift+F1 is the help there.
      if (!e.shiftKey && (e.target as Element | null)?.closest?.('.monaco-editor')) return;
      e.preventDefault();
      e.stopPropagation();
      toggleHelp(e.target);
    },
    true,
  );
}

export const help = { show: showHelp, close: closeHelp, toggle: toggleHelp, spotlight };
