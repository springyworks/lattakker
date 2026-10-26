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

/**
 * The second terminal (a modern screen, K1:S8) sits next to the ASR-33, so what stood in columns J to AE of rows 1 to 9 moved nine
 * columns further right (the welcome row to the far end). The keys are addresses after the first move above.
 */
export const LAB_MOVES_2: Readonly<Record<string, string>> = {
  J1: 'AJ1',
  K3: 'T3',
  P3: 'Y3',
  U3: 'AD3',
  Z3: 'AI3',
  AE3: 'AN3',
  K7: 'T7',
  P7: 'Y7',
  U7: 'AD7',
  Z7: 'AI7',
  AE7: 'AN7',
};

/** Columns the moved demos need (the last one ends in column AS). */
export const LAB_COLS = 45;

export const movedForTerminal = (address: string): string => LAB_MOVES[address] ?? address;

/** Where a demo of the original Lab sits now. */
export const placedInLab = (address: string): string => {
  const first = movedForTerminal(address);
  return LAB_MOVES_2[first] ?? first;
};

/** Brings a Lab that already has the first layout to the second: the demos in the way of the screen terminal move aside. */
export function upgradeLabLayout2<T extends SavedLabLike>(saved: T, seeds: Record<string, string>): { saved: T; seeds: Record<string, string> } {
  const move = (address: string): string => LAB_MOVES_2[address] ?? address;
  const cells = saved.cells.map((cell): SavedCell => [move(cell[0]), ...cell.slice(1)] as SavedCell);
  const moved = Object.fromEntries(Object.entries(seeds).map(([address, fp]) => [move(address), fp]));
  return { saved: { ...saved, cols: Math.max(saved.cols ?? 0, LAB_COLS), cells }, seeds: moved };
}

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
const FLAG_2 = 'lattakker:lab-layout:2';
const SEEDS = 'lattakker:seeds:lab';

/**
 * Runs once per browser for each layout, before the Lab is made. A first visit only gets the flags (the demos are seeded in their
 * new places); a saved Lab is upgraded and written back at once, so a later visit never finds it half-way.
 */
export function upgradeLabStorage<T extends SavedLabLike>(saved: T | null, terminal: string, save: (saved: T) => void): T | null {
  try {
    const first = !localStorage.getItem(FLAG);
    const second = !localStorage.getItem(FLAG_2);
    if (!first && !second) return saved;
    localStorage.setItem(FLAG, '1');
    localStorage.setItem(FLAG_2, '1');
    if (!saved) return null;
    let seeds: Record<string, string> = {};
    try {
      seeds = JSON.parse(localStorage.getItem(SEEDS) ?? '{}') as Record<string, string>;
    } catch {
      seeds = {};
    }
    let out = { saved, seeds };
    if (first) out = upgradeLabLayout(out.saved, terminal, out.seeds);
    out = upgradeLabLayout2(out.saved, out.seeds);
    save(out.saved);
    localStorage.setItem(SEEDS, JSON.stringify(out.seeds));
    return out.saved;
  } catch {
    return saved;
  }
}
