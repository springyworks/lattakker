import type { GameView } from './game/GameView';
import { parseAddress } from './sheet/address';
import { createSheetTab, type SheetTab } from './sheetTab';
import { forgetTab, loadTabList, loadTabSaved, saveTabList, saveTabNow, startTabAutoSave, type SavedTab } from './storage';
import { router } from './mcp/router';
import { TabServer } from './mcp/tabServer';
import { workspace } from './workspace';
import { HoverMenu, type MenuItem } from './ui/HoverMenu';
import { TAB_ID, type Tabs } from './ui/Tabs';

/**
 * The tabs that come and go while the page runs. Anybody can make one: the ＋ in the strip, a cell (`tabs.create('Plots')`),
 * an AI helper or another program (the MCP server `tabs`). A new tab is a full sheet of its own (cells, editors, blocks,
 * the whole cell API), has its own MCP server (the tab id is the server name), is part of the workspace (so /plots/A1
 * names a cell in it) and is remembered by this browser.
 *
 * The built-in tabs (board, lab, examples, monitor) are listed here too, but cannot be closed.
 */

export interface TabInfo {
  id: string;
  title: string;
  icon: string;
  /** The page's own tabs cannot be closed or renamed. */
  builtin: boolean;
  active: boolean;
  /** How many cells hold code. */
  cells: number;
}

export interface CreateTabOptions {
  /** The id used in paths (/plots/A1), lowercase letters, digits and "-". Default: made from the title. */
  id?: string;
  icon?: string;
  /** Cells to start with: { A1: 'print(1)' }. */
  cells?: Record<string, string>;
  /** Bring the tab to the front (default true). */
  select?: boolean;
}

export interface BuiltInTab {
  id: string;
  title: string;
  icon: string;
  hint: string;
  tab: SheetTab;
}

/** Names that already mean something to the router: a tab with such an id would shadow a server. */
const RESERVED = new Set(['board', 'lab', 'examples', 'monitor', 'tabs', 'router', 'memory', 'weather', 'ollama', 'local-ai', 'status', 'system', 'app', 'new']);
const MAX_USER_TABS = 12;
const DEFAULT_ICON = '📄';

export class TabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TabError';
  }
}

const clean = (title: unknown): string => String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);

function slug(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(base) ? base.slice(0, 20) : `tab${base ? '-' + base.slice(0, 16) : ''}`;
}

export class TabManager {
  /** The tabs made here (the Monitor and the person's own). The board, Lab and Examples are made elsewhere. */
  private readonly open = new Map<string, { tab: SheetTab; builtin: boolean }>();
  private readonly menu = new HoverMenu();
  private closeArmed: string | null = null;
  private readonly changeListeners: Array<() => void> = [];

  constructor(
    private readonly tabs: Tabs,
    private readonly view: GameView,
    private readonly smallScreen: boolean,
    private readonly say: (text: string, tone: 'info' | 'good' | 'bad') => void,
  ) {
    tabs.onChange((id, previous) => {
      this.open.get(previous)?.tab.setActive(false);
      this.open.get(id)?.tab.setActive(true);
      this.closeArmed = null;
    });
    tabs.strip.onAdd = () => void this.askAndCreate();
    tabs.strip.onTabMenu = (id, x, y) => {
      this.closeArmed = null;
      this.showMenu(id, x, y);
    };
  }

  onChange(handler: () => void): void {
    this.changeListeners.push(handler);
  }

  private changed(): void {
    this.changeListeners.forEach((h) => h());
  }

  /** The label in the strip is "icon title". */
  private split(id: string): { icon: string; title: string } {
    const label = this.tabs.list().find((t) => t.id === id)?.label ?? id;
    const at = label.indexOf(' ');
    return at < 0 ? { icon: '', title: label } : { icon: label.slice(0, at), title: label.slice(at + 1) };
  }

  list(): TabInfo[] {
    return this.tabs.list().map((spec) => {
      const sheet = workspace.get(spec.id)?.sheet;
      return { id: spec.id, ...this.split(spec.id), builtin: this.open.get(spec.id)?.builtin ?? true, active: this.tabs.active === spec.id, cells: sheet ? sheet.codeCells().length : 0 };
    });
  }

  private userTabs(): SavedTab[] {
    return [...this.open.entries()].filter(([, e]) => !e.builtin).map(([id]) => ({ id, ...this.split(id) }));
  }

  /** Brings back the tabs this browser remembered. */
  restore(): void {
    for (const saved of loadTabList()) {
      if (!TAB_ID.test(saved.id) || this.tabs.has(saved.id)) continue;
      try {
        this.make(saved.id, clean(saved.title) || saved.id, saved.icon || DEFAULT_ICON, undefined, false);
      } catch {
        // a tab that cannot come back is left out; the others still do
      }
    }
  }

  /** Makes one of the page's own tabs (the Monitor): a sheet with starting cells that cannot be closed. */
  makeBuiltIn(spec: Omit<BuiltInTab, 'tab'>, create: () => SheetTab): SheetTab {
    const tab = create();
    this.open.set(spec.id, { tab, builtin: true });
    this.registerTab(tab, spec.icon, spec.title, spec.hint, false);
    return tab;
  }

  private registerTab(tab: SheetTab, icon: string, title: string, hint: string, persist: boolean): void {
    workspace.register({ id: tab.id, title, sheet: tab.sheet, editor: tab.pane.editor, select: () => this.tabs.select(tab.id) });
    new TabServer(workspace.get(tab.id)!, router);
    this.tabs.add({ id: tab.id, label: `${icon} ${title}`, hint }, tab.root);
    if (persist) saveTabList(this.userTabs());
    this.changed();
  }

  private uniqueId(wanted: string): string {
    let id = wanted;
    for (let n = 2; RESERVED.has(id) || this.tabs.has(id) || router.names().includes(id); n++) id = `${wanted.slice(0, 20)}-${n}`;
    return id;
  }

  private make(id: string, title: string, icon: string, cells: Record<string, string> | undefined, select: boolean): TabInfo {
    const tab = createSheetTab(this.view, this.smallScreen, {
      id,
      title,
      icon,
      intro: 'A sheet of your own. Double-click a cell to write TypeScript. Right-click the tab to rename or close it.',
      load: () => loadTabSaved(id),
      startSave: (sheet) => startTabAutoSave(id, sheet),
    });
    this.open.set(id, { tab, builtin: false });
    this.registerTab(tab, icon, title, `Your tab "${title}"`, true);
    if (cells) this.fill(tab, cells);
    if (select) this.tabs.select(id);
    return this.list().find((t) => t.id === id)!;
  }

  private fill(tab: SheetTab, cells: Record<string, string>): void {
    const entries = Object.entries(cells);
    for (const [address] of entries) if (!parseAddress(address)) throw new TabError(`"${address}" is not a cell address (like A1 or C5).`);
    const sheet = tab.sheet;
    const maxRow = Math.max(...entries.map(([a]) => parseAddress(a)!.row + 1), 0);
    const maxCol = Math.max(...entries.map(([a]) => parseAddress(a)!.col + 1), 0);
    while (sheet.rowCount < maxRow + 8 && sheet.rowCount < 200) sheet.insertRow(sheet.rowCount - 1);
    if (maxCol > sheet.colCount) sheet.addColumns(Math.min(maxCol + 2, 60) - sheet.colCount);
    for (const [address, code] of entries) sheet.setCode(address.toUpperCase(), String(code));
    saveTabNow(tab.id, sheet);
  }

  /** A new tab. A title like "Plots" gives the id "plots" (or "plots-2" when that is taken). */
  create(title: string, options: CreateTabOptions = {}): TabInfo {
    const name = clean(title);
    if (!name) throw new TabError('A tab needs a name, for example "Plots".');
    if (this.userTabs().length >= MAX_USER_TABS) throw new TabError(`That is already ${MAX_USER_TABS} tabs of your own. Close one first.`);
    let id: string;
    if (options.id !== undefined) {
      id = String(options.id);
      if (!TAB_ID.test(id)) throw new TabError(`The id "${id}" must be lowercase letters, digits and "-", starting with a letter (like "plots").`);
      if (RESERVED.has(id) || this.tabs.has(id) || router.names().includes(id)) throw new TabError(`The id "${id}" is taken. Choose another, or leave it out.`);
    } else {
      id = this.uniqueId(slug(name));
    }
    const icon = (options.icon ?? DEFAULT_ICON).trim().slice(0, 4) || DEFAULT_ICON;
    return this.make(id, name, icon, options.cells, options.select !== false);
  }

  /** The tab with this id, made when it is not there yet (a cell that runs again does not pile up tabs). `cells` only fill a new tab. */
  ensure(id: string, title?: string, options: Omit<CreateTabOptions, 'id'> = {}): TabInfo {
    const existing = this.list().find((t) => t.id === id);
    if (existing) {
      if (options.select) this.tabs.select(id);
      return this.list().find((t) => t.id === id)!;
    }
    return this.create(title ?? id, { ...options, id });
  }

  private userEntry(id: string): { tab: SheetTab } {
    const entry = this.open.get(id);
    if (!this.tabs.has(id)) throw new TabError(`There is no tab "${id}". Tabs: ${this.tabs.list().map((t) => t.id).join(', ')}.`);
    if (!entry || entry.builtin) throw new TabError(`"${id}" is one of the page's own tabs; it cannot be renamed or closed.`);
    return entry;
  }

  rename(id: string, title: string): TabInfo {
    this.userEntry(id);
    const name = clean(title);
    if (!name) throw new TabError('A tab needs a name.');
    this.tabs.rename(id, `${this.split(id).icon} ${name}`, `Your tab "${name}"`);
    saveTabList(this.userTabs());
    this.changed();
    return this.list().find((t) => t.id === id)!;
  }

  /** Closes a tab and forgets its cells. */
  close(id: string): { closed: string; cells: number } {
    const entry = this.userEntry(id);
    const cells = entry.tab.sheet.codeCells().length;
    this.tabs.remove(id);
    router.unregister(id);
    workspace.unregister(id);
    entry.tab.destroy();
    this.open.delete(id);
    forgetTab(id);
    saveTabList(this.userTabs());
    this.changed();
    return { closed: id, cells };
  }

  select(id: string): TabInfo {
    if (!this.tabs.has(id)) throw new TabError(`There is no tab "${id}". Tabs: ${this.tabs.list().map((t) => t.id).join(', ')}.`);
    this.tabs.select(id);
    return this.list().find((t) => t.id === id)!;
  }

  private showMenu(id: string, x: number, y: number): void {
    this.menu.openAt(x, y, this.menuFor(id, () => this.showMenu(id, x, y)));
  }

  private menuFor(id: string, again: () => void): MenuItem[] {
    const entry = this.open.get(id);
    if (!entry || entry.builtin) {
      const tab = entry?.tab;
      return [
        { label: `/${id}`, tiny: true },
        { label: 'One of the page\'s own tabs: it stays.', disabled: true },
        ...(tab ? [{ separator: true }, { label: '↺ Put the starting cells back', onSelect: () => void this.say(`Restored ${tab.restoreSeed()} cells ✓`, 'good') } satisfies MenuItem] : []),
      ];
    }
    const cells = entry.tab.sheet.codeCells().length;
    const armed = this.closeArmed === id;
    return [
      { label: `/${id}`, tiny: true },
      { label: '✏️ Rename…', onSelect: () => void this.askRename(id) },
      { separator: true },
      {
        label: armed ? `Really close? ${cells} cell${cells === 1 ? '' : 's'} will be deleted` : '✖ Close this tab',
        danger: true,
        onSelect: () => {
          if (cells > 0 && !armed) {
            this.closeArmed = id;
            again();
            return false;
          }
          this.close(id);
          this.say(`Closed the tab ${id}.`, 'info');
        },
      },
    ];
  }

  private async askAndCreate(): Promise<void> {
    const title = await askName('New tab', 'Name your tab', '');
    if (title === null) return;
    try {
      const info = this.create(title);
      this.say(`New tab ${info.icon} ${info.title}: cells here are named /${info.id}/A1 🎉`, 'good');
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), 'bad');
    }
  }

  private async askRename(id: string): Promise<void> {
    const title = await askName('Rename tab', 'New name', this.split(id).title);
    if (title === null) return;
    try {
      this.rename(id, title);
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), 'bad');
    }
  }
}

/** A small box asking for one line of text. Enter confirms, Esc cancels. Answers null when cancelled. */
function askName(heading: string, label: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const shade = document.createElement('div');
    shade.className = 'tab-ask-shade';
    const box = document.createElement('form');
    box.className = 'tab-ask';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', heading);
    const h = document.createElement('strong');
    h.textContent = heading;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.value = initial;
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    const row = document.createElement('div');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    row.append(cancel, ok);
    box.append(h, input, row);
    shade.append(box);
    const done = (value: string | null): void => {
      shade.remove();
      resolve(value);
    };
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      done(input.value);
    });
    cancel.addEventListener('click', () => done(null));
    shade.addEventListener('pointerdown', (e) => {
      if (e.target === shade) done(null);
    });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
    });
    document.body.append(shade);
    input.focus();
    input.select();
  });
}

let instance: TabManager | null = null;
export function installTabManager(manager: TabManager): TabManager {
  instance = manager;
  return manager;
}
/** The one tab manager (cell code and the MCP server reach it through here). */
export function tabManager(): TabManager {
  if (!instance) throw new TabError('Tabs are not ready yet.');
  return instance;
}
