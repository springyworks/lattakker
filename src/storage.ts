import type { Game, SavedGame } from './game/model';
import type { Mode, Sheet } from './sheet/Sheet';

const KEY = 'lattakker:v1';

interface SavedApp {
  game: SavedGame;
  rows: number;
  cells: Array<[string, string]>;
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
    try {
      const app: SavedApp = {
        game: game.serialize(),
        rows: sheet.rowCount,
        cells: sheet.codeCells().map((d) => [d.address, d.code]),
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
  sheet.onModeChange(schedule);
  window.addEventListener('pagehide', write);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') write();
  });
  return schedule;
}
