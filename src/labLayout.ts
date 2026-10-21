import { fingerprint } from './seedMigration';
import type { SavedCell } from './storage';

/**
 * The ASR-33 terminal sits in the Lab's top left corner (A1:I8). The demos that used to be there moved aside: the welcome row
 * to the right of the terminal, the chart demos of rows 3 and 7 to the right end of their rows. Everything else stayed where it
 * was, so addresses such as /lab/J24 keep working.
 */
export const LAB_MOVES: Readonly<Record<string, string>> = {
  A1: 'J1',
  K1: 'T1',
  S1: 'AB1',
  A3: 'Z3',
  F3: 'AE3',
  A7: 'Z7',
  F7: 'AE7',
};

/** Columns the moved demos need (the last one ends in column AI). */
export const LAB_COLS = 35;

export const movedForTerminal = (address: string): string => LAB_MOVES[address] ?? address;

interface SavedLabLike {
  cols?: number;
  cells: SavedCell[];
}

/**
 * Brings a saved Lab to the new layout: the demos in the terminal's way move aside, the old terminal (R50) goes when nobody changed
 * it, and the new one is put at A1. `seeds` says which version of each cell the page itself put there (see seedMigration.ts); the
 * moved entries are returned so the cells stay recognised as shipped.
 */
export function upgradeLabLayout<T extends SavedLabLike>(saved: T, terminal: string, seeds: Record<string, string>): { saved: T; seeds: Record<string, string> } {
  const cells = saved.cells
    .filter(([address, code]) => !(address === 'R50' && seeds.R50 === fingerprint(code)))
    .map((cell): SavedCell => [movedForTerminal(cell[0]), ...cell.slice(1)] as SavedCell);
  if (!cells.some(([address]) => address === 'A1')) cells.unshift(['A1', terminal]);
  const moved = Object.fromEntries(Object.entries(seeds).filter(([address]) => address !== 'R50').map(([address, fp]) => [movedForTerminal(address), fp]));
  moved.A1 = fingerprint(terminal);
  return { saved: { ...saved, cols: Math.max(saved.cols ?? 0, LAB_COLS), cells }, seeds: moved };
}

const FLAG = 'lattakker:lab-layout';
const SEEDS = 'lattakker:seeds:lab';

/**
 * Runs once per browser, before the Lab is made. A first visit only gets the flag (the demos are seeded in their new places); a
 * saved Lab is upgraded and written back at once, so a later visit never finds it half-way.
 */
export function upgradeLabStorage<T extends SavedLabLike>(saved: T | null, terminal: string, save: (saved: T) => void): T | null {
  try {
    if (localStorage.getItem(FLAG)) return saved;
    localStorage.setItem(FLAG, '1');
    if (!saved) return null;
    let seeds: Record<string, string> = {};
    try {
      seeds = JSON.parse(localStorage.getItem(SEEDS) ?? '{}') as Record<string, string>;
    } catch {
      seeds = {};
    }
    const out = upgradeLabLayout(saved, terminal, seeds);
    save(out.saved);
    localStorage.setItem(SEEDS, JSON.stringify(out.seeds));
    return out.saved;
  } catch {
    return saved;
  }
}
