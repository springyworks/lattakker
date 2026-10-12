import type { Game, SavedGame } from './game/model';
import type { Mode, Sheet } from './sheet/Sheet';

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

interface SavedApp {
  game: SavedGame;
  rows: number;
  cols?: number;
  cells: Array<[string, string, string?]>;
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
        cells: sheet.codeCells().map((d) => [d.address, d.code, d.uid]),
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

interface SavedLab {
  rows: number;
  cols?: number;
  cells: Array<[string, string, string?]>;
  mode: Mode;
}

/** What this browser remembered about the Lab's sheet, or null on the first visit. */
export function loadLabSaved(): SavedLab | null {
  try {
    const raw = localStorage.getItem(LAB_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedLab;
    return d && Array.isArray(d.cells) ? d : null;
  } catch {
    return null;
  }
}

/** Keeps the Lab's code cells in this browser, a moment after any change. */
export function startLabAutoSave(sheet: Sheet): void {
  let timer = 0;
  const write = (): void => {
    timer = 0;
    if (savingPaused) return;
    try {
      const lab: SavedLab = {
        rows: sheet.rowCount,
        cols: sheet.colCount,
        cells: sheet.codeCells().map((d) => [d.address, d.code, d.uid]),
        mode: sheet.mode,
      };
      localStorage.setItem(LAB_KEY, JSON.stringify(lab));
    } catch {
      // storage full or blocked: the Lab still works, it just is not remembered
    }
  };
  const schedule = (): void => {
    if (!timer) timer = window.setTimeout(write, 300);
  };
  sheet.onCodeChanged(schedule);
  sheet.onRowsInserted(schedule);
  sheet.onContentMoved(schedule);
  sheet.onRoomMade(schedule);
  sheet.onModeChange(schedule);
  window.addEventListener('pagehide', write);
}
