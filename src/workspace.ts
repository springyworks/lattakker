import type { Sheet } from './sheet/Sheet';
import type { CellEditor } from './editor/CellEditor';

/**
 * The workspace knows every tab that holds a sheet, so a cell can be named from anywhere. Cell paths
 * read like file paths, with "/" meaning "inside":
 *
 *   J24            relative: a cell of the tab you are in (what code usually writes)
 *   J24/3,4        relative: tile x=3, y=4 of the grid inside block J24
 *   /lab/J24       absolute: starts at the root, so it works from every tab
 *   /lab/J24/3,4   absolute tile
 *   @c-1a2b3c4d    identity: the code's uid, which stays with the code when cells move
 *   lattakker:///lab/J24/3,4   the same absolute path written as a URI (for tools)
 *
 * Only letters, digits and "/ , @ -" are used, so a path needs no escaping in JSON or in a URL, and it
 * lives inside an ordinary string literal, so TypeScript itself needs no new syntax.
 */

export interface WorkspaceTab {
  /** Short lowercase id used in paths: 'board', 'lab'. */
  id: string;
  title: string;
  sheet: Sheet;
  editor: CellEditor;
  /** Brings this tab to the front. */
  select(): void;
}

export interface ResolvedPath {
  tab: WorkspaceTab;
  address: string;
  /** Set when the path names a tile inside the cell's grid. */
  tile: { x: number; y: number } | null;
}

export interface PathParts {
  tab: string | null;
  /** 'A12', or a uid when `byUid` is true. */
  cell: string;
  byUid: boolean;
  tile: { x: number; y: number } | null;
}

const UID = /^c-[0-9a-f]{8}$/;
const TILE_TAIL = /\/(\d+),(\d+)$/;
const TAB_ID = /^[a-z][a-z0-9-]*$/;

/** Splits a path into its parts without looking at any sheet. Returns an error message for text that is not a path. */
export function parsePath(input: string): PathParts | { error: string } {
  let text = input.trim();
  if (!text) return { error: 'a cell path is empty' };
  if (text.toLowerCase().startsWith('lattakker://')) text = text.slice('lattakker://'.length);
  let tile: PathParts['tile'] = null;
  const t = TILE_TAIL.exec(text);
  if (t) {
    tile = { x: Number(t[1]), y: Number(t[2]) };
    text = text.slice(0, t.index);
  }
  if (text.startsWith('@')) {
    const uid = text.slice(1).toLowerCase();
    return UID.test(uid) ? { tab: null, cell: uid, byUid: true, tile } : { error: `"${input}" is not a cell identity (it looks like @c-1a2b3c4d)` };
  }
  if (UID.test(text.toLowerCase())) return { tab: null, cell: text.toLowerCase(), byUid: true, tile };
  if (text.startsWith('/')) {
    const parts = text.slice(1).split('/');
    if (parts.length !== 2 || !TAB_ID.test(parts[0]) || !parts[1]) return { error: `"${input}" is not a cell path (it looks like /lab/J24 or /lab/J24/3,4)` };
    return { tab: parts[0], cell: parts[1].toUpperCase(), byUid: false, tile };
  }
  if (text.includes('/')) return { error: `"${input}" is not a cell path (start with / for an absolute path: /lab/J24)` };
  return { tab: null, cell: text.toUpperCase(), byUid: false, tile };
}

/** The cell (or tile) the player last pointed at: the answer to "where am I?". */
export interface Focus {
  tab: string;
  address: string;
  tile: { x: number; y: number } | null;
}

/** Where the person on the other end of a shared session is pointing. */
export interface RemotePresence extends Focus {
  name: string;
}

export class Workspace {
  private readonly tabs = new Map<string, WorkspaceTab>();
  private currentId = 'board';
  private readonly listeners: Array<(id: string) => void> = [];
  private focusNow: Focus | null = null;
  /** The identity of the focused cell's code, so the focus follows the cell when it moves. */
  private focusUid: string | null = null;
  private readonly focusListeners: Array<(focus: Focus | null) => void> = [];
  private remoteNow: RemotePresence | null = null;
  private readonly remoteListeners: Array<(remote: RemotePresence | null) => void> = [];
  private readonly changedListeners: Array<() => void> = [];
  private changedQueued = false;

  register(tab: WorkspaceTab): void {
    this.tabs.set(tab.id, tab);
    tab.sheet.setForeignRewriter((rewrite) => {
      for (const other of this.tabs.values()) if (other.sheet !== tab.sheet) other.sheet.rewriteForeign(tab.id, rewrite);
    });
    // Whatever moves, shifts or empties a cell changes where its path points: everything that shows a path is told, once per burst.
    const bump = (): void => this.cellsChanged();
    tab.sheet.onContentMoved(bump);
    tab.sheet.onRowsInserted(bump);
    tab.sheet.onColumnsInserted(bump);
    tab.sheet.onRoomMade(bump);
    tab.sheet.onCodeChanged(bump);
  }

  /** A tab was closed: its cells can no longer be named. */
  unregister(id: string): void {
    if (this.tabs.delete(id)) this.cellsChanged();
  }

  /** Called after cells moved, shifted or changed: paths that were handed out may point somewhere else now. Runs once per burst of changes. */
  private cellsChanged(): void {
    if (this.changedQueued) return;
    this.changedQueued = true;
    queueMicrotask(() => {
      this.changedQueued = false;
      this.followFocus();
      this.changedListeners.forEach((l) => l());
    });
  }

  /** Listens for "some cells moved or changed": links and path chips use it to re-read where their cell is now. */
  onCellsChanged(listener: () => void): void {
    this.changedListeners.push(listener);
  }

  private followFocus(): void {
    const f = this.focusNow;
    if (!f || !this.focusUid) return;
    const address = this.tabs.get(f.tab)?.sheet.addressOfUid(this.focusUid);
    if (address && address !== f.address) {
      this.focusNow = { ...f, address };
      this.focusListeners.forEach((l) => l(this.focusNow));
    }
  }

  list(): WorkspaceTab[] {
    return [...this.tabs.values()];
  }

  get(id: string): WorkspaceTab | undefined {
    return this.tabs.get(id);
  }

  /** The tab the player is looking at ('board', 'lab', or another page such as 'examples'). */
  get current(): string {
    return this.currentId;
  }

  setCurrent(id: string): void {
    if (this.currentId === id) return;
    this.currentId = id;
    this.listeners.forEach((l) => l(id));
  }

  onCurrentChange(listener: (id: string) => void): void {
    this.listeners.push(listener);
  }

  get focus(): Focus | null {
    return this.focusNow;
  }

  setFocus(tab: string, address: string, tile: Focus['tile'] = null): void {
    this.focusNow = { tab, address, tile };
    this.focusUid = this.tabs.get(tab)?.sheet.dataAt(address)?.uid || null;
    this.focusListeners.forEach((l) => l(this.focusNow));
  }

  onFocusChange(listener: (focus: Focus | null) => void): void {
    this.focusListeners.push(listener);
  }

  get remote(): RemotePresence | null {
    return this.remoteNow;
  }

  setRemote(remote: RemotePresence | null): void {
    this.remoteNow = remote;
    this.remoteListeners.forEach((l) => l(remote));
  }

  onRemoteChange(listener: (remote: RemotePresence | null) => void): void {
    this.remoteListeners.push(listener);
  }

  /** What to show for "you are here": the focused cell's absolute path when it is in the tab on screen, else the tab's own path. */
  hereText(): string {
    const f = this.focusNow;
    return f && f.tab === this.currentId ? this.pathOf(f.tab, f.address, f.tile) : `/${this.currentId}`;
  }

  /** Which tab owns a sheet, or undefined. */
  tabOf(sheet: Sheet): WorkspaceTab | undefined {
    return this.list().find((t) => t.sheet === sheet);
  }

  /**
   * Finds the cell a path names. A relative path starts in `from` (the tab the asker is in; 'board' when
   * nobody says). A bare uid is looked for in `from` first, then everywhere.
   */
  resolve(input: string, from: string | null = null): ResolvedPath | { error: string } {
    const parts = parsePath(input);
    if ('error' in parts) return parts;
    if (parts.byUid) {
      const order = [from ? this.tabs.get(from) : undefined, ...this.tabs.values()].filter((t): t is WorkspaceTab => !!t);
      for (const tab of order) {
        const address = tab.sheet.addressOfUid(parts.cell);
        if (address) return { tab, address, tile: parts.tile };
      }
      return { error: `No cell has the identity "${parts.cell}" any more (its code was cleared or replaced).` };
    }
    const tabId = parts.tab ?? from ?? 'board';
    const tab = this.tabs.get(tabId);
    if (!tab) return { error: `There is no tab "${tabId}". Tabs: ${this.list().map((t) => t.id).join(', ')}.` };
    const address = tab.sheet.resolve(parts.cell);
    if (!address) return { error: `"${parts.cell}" is not a cell address in the ${tab.id} tab (try something like A12; columns A-Z, rows 1-${tab.sheet.rowCount})` };
    return { tab, address, tile: parts.tile };
  }

  /** The absolute path of a cell (or of a tile in its grid). */
  pathOf(tabId: string, address: string, tile?: { x: number; y: number } | null): string {
    return `/${tabId}/${address}${tile ? `/${tile.x},${tile.y}` : ''}`;
  }

  /**
   * The shortest path that is still unambiguous for someone standing in `from`: a plain address inside the
   * same tab, the full path from any other tab. This is what a menu or a chat message should show.
   */
  pathFor(tabId: string, address: string, from: string | null, tile?: { x: number; y: number } | null): string {
    return from === tabId ? `${address}${tile ? `/${tile.x},${tile.y}` : ''}` : this.pathOf(tabId, address, tile);
  }
}

/** The one workspace of the page. */
export const workspace = new Workspace();
