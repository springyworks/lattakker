import type { Game, SavedGame } from './game/model';
import type { Mode, Sheet, SheetCellData } from './sheet/Sheet';

const KEY = 'lattakker:v1';

/**
 * While a visitor is a guest in someone else's shared session, the sheets show that person's cells. Those
 * must not overwrite what this browser remembers of its own work, so saving is switched off until the page
 * is reloaded (which brings the visitor's own cells back).
 */
let savingPaused = false;
export function pauseSaving(on: boolean): void {
  savingPaused = on;
}

/** A saved code cell: address, code, identity, and the size the person gave the block (resize handles, a selection) when they did. */
export type SavedCell = [string, string, string?, [number, number]?];

function savedCell(d: SheetCellData): SavedCell {
  return d.shape.user ? [d.address, d.code, d.uid, [d.shape.user.cols, d.shape.user.rows]] : [d.address, d.code, d.uid];
}

/** Puts saved cells back on a sheet: their code, their identity and the size the person gave them. */
export function restoreCells(sheet: Sheet, cells: SavedCell[]): void {
  for (const [address, code, uid, size] of cells) {
    sheet.setCode(address, code, uid);
    if (Array.isArray(size) && size.length === 2) sheet.restoreUserSize(address, { cols: Number(size[0]), rows: Number(size[1]) });
  }
  sheet.freeBuried();
}

interface SavedApp {
  game: SavedGame;
  rows: number;
  cols?: number;
  cells: SavedCell[];
  mode: Mode;
}

/** Reads what this browser remembered about the last visit, or null if nothing usable is there. */
export function loadSaved(): SavedApp | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedApp;
    if (!d || !d.game || !Array.isArray(d.cells)) return null;
    return d;
  } catch {
    return null;
  }
}

/** Keeps the game and every code cell in this browser's own storage (localStorage), a moment after any change. */
export function startAutoSave(game: Game, sheet: Sheet): () => void {
  let timer = 0;
  const write = (): void => {
    timer = 0;
    if (savingPaused) return;
    try {
      const app: SavedApp = {
        game: game.serialize(),
        rows: sheet.rowCount,
        cols: sheet.colCount,
        cells: sheet.codeCells().map(savedCell),
        mode: sheet.mode,
      };
      localStorage.setItem(KEY, JSON.stringify(app));
    } catch {
      // storage full or blocked (private window): playing still works, it just is not remembered
    }
  };
  const schedule = (): void => {
    if (!timer) timer = window.setTimeout(write, 300);
  };
  sheet.onCodeChanged(schedule);
  sheet.onRowsInserted(schedule);
  sheet.onColumnsInserted(schedule);
  sheet.onContentMoved(schedule);
  sheet.onRoomMade(schedule);
  sheet.onModeChange(schedule);
  window.addEventListener('pagehide', write);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') write();
  });
  return schedule;
}

const LAB_KEY = 'lattakker:lab:v1';
const EXAMPLES_KEY = 'lattakker:examples:v1';

interface SavedLab {
  rows: number;
  cols?: number;
  cells: SavedCell[];
  mode: Mode;
}

/** What this browser remembered about a plain sheet (the Lab's, the Examples notebook's), or null on the first visit. */
function loadSheetSaved(key: string): SavedLab | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedLab;
    return d && Array.isArray(d.cells) ? d : null;
  } catch {
    return null;
  }
}

/** Keeps a plain sheet's code cells in this browser, a moment after any change. */
function startSheetAutoSave(key: string, sheet: Sheet): () => void {
  let timer = 0;
  let stopped = false;
  const write = (): void => {
    timer = 0;
    if (savingPaused || stopped) return;
    try {
      const saved: SavedLab = {
        rows: sheet.rowCount,
        cols: sheet.colCount,
        cells: sheet.codeCells().map(savedCell),
        mode: sheet.mode,
      };
      localStorage.setItem(key, JSON.stringify(saved));
    } catch {
      // storage full or blocked: the sheet still works, it just is not remembered
    }
  };
  const schedule = (): void => {
    if (!timer) timer = window.setTimeout(write, 300);
  };
  sheet.onCodeChanged(schedule);
  sheet.onRowsInserted(schedule);
  sheet.onColumnsInserted(schedule);
  sheet.onContentMoved(schedule);
  sheet.onRoomMade(schedule);
  sheet.onModeChange(schedule);
  window.addEventListener('pagehide', write);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('pagehide', write);
  };
}

/** A tab the person (or a cell, or an AI helper) added: what the strip needs to bring it back. */
export interface SavedTab {
  id: string;
  title: string;
  icon: string;
}

const TABS_KEY = 'lattakker:tabs:v1';
const tabKey = (id: string): string => `lattakker:tab:${id}:v1`;

export function loadTabList(): SavedTab[] {
  try {
    const list = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((t): t is SavedTab => !!t && typeof t.id === 'string' && typeof t.title === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTabList(list: SavedTab[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked: the tabs are there for this visit only
  }
}

export const loadTabSaved = (id: string): SavedLab | null => loadSheetSaved(tabKey(id));
/** Keeps a tab's cells in this browser. Returns what stops it (before the tab is closed). */
export const startTabAutoSave = (id: string, sheet: Sheet): (() => void) => startSheetAutoSave(tabKey(id), sheet);
export function forgetTab(id: string): void {
  try {
    localStorage.removeItem(tabKey(id));
  } catch {
    // nothing to forget
  }
}
/** Saves a tab's cells right now (used when a new tab is made, so a reload finds it). */
export function saveTabNow(id: string, sheet: Sheet): void {
  try {
    localStorage.setItem(tabKey(id), JSON.stringify({ rows: sheet.rowCount, cols: sheet.colCount, cells: sheet.codeCells().map(savedCell), mode: sheet.mode } satisfies SavedLab));
  } catch {
    // storage full or blocked
  }
}

export const loadLabSaved = (): SavedLab | null => loadSheetSaved(LAB_KEY);
export const startLabAutoSave = (sheet: Sheet): void => void startSheetAutoSave(LAB_KEY, sheet);
export const loadExamplesSaved = (): SavedLab | null => loadSheetSaved(EXAMPLES_KEY);
export const startExamplesAutoSave = (sheet: Sheet): void => void startSheetAutoSave(EXAMPLES_KEY, sheet);
