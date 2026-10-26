import { afterEach, describe, expect, it, vi } from 'vitest';
import { fingerprint, recordSeeds, refreshSeeded } from '../src/seedMigration';
import type { Sheet } from '../src/sheet/Sheet';

function fakeSheet(cells: Record<string, string>): { sheet: Sheet; cells: Record<string, string> } {
  const sheet = {
    dataAt: (address: string) => (cells[address] === undefined ? undefined : { address, code: cells[address] }),
    codeCells: () => Object.entries(cells).filter(([, code]) => code.trim()).map(([address, code]) => ({ address, code })),
    setCode: (address: string, code: string) => void (cells[address] = code),
  } as unknown as Sheet;
  return { sheet, cells };
}

describe('refreshSeeded', () => {
  const OLD = 'every("3s", ping)';
  const seed: Array<[string, string]> = [['A1', 'every("10s", ping)']];
  const older = { A1: [fingerprint(OLD)] };

  it('updates an old shipped cell where it is, and one that was moved to another address', () => {
    const { sheet, cells } = fakeSheet({ A1: OLD, C2: OLD });
    refreshSeeded(sheet, 'test', seed, older);
    expect(cells).toEqual({ A1: seed[0][1], C2: seed[0][1] });
  });

  it('still recognises an old version that has blank lines around it', () => {
    const { sheet, cells } = fakeSheet({ A1: '\n' + OLD + '\n' });
    refreshSeeded(sheet, 'test', seed, older);
    expect(cells.A1).toBe(seed[0][1]);
  });

  it('leaves a moved cell alone when a person changed it', () => {
    const { sheet, cells } = fakeSheet({ A1: seed[0][1], C2: OLD + ' // mine' });
    refreshSeeded(sheet, 'test', seed, older);
    expect(cells.C2).toBe(OLD + ' // mine');
  });
});

describe('refreshSeeded: a block resized by hand', () => {
  const OLD = '// terminal\nspan(9, 8)\nconst title = "/lab/K1"';
  const NEW = '// terminal\nspan(9, 8)\nconst title = cell.path';
  const seed: Array<[string, string]> = [['K1', NEW]];
  const older = { K1: [fingerprint(OLD)] };
  const resized = (code: string): string => code.replace('span(9, 8)', 'span(12, 9)');

  it('is upgraded and keeps its size, where it is and where it was moved to', () => {
    const { sheet, cells } = fakeSheet({ K1: resized(OLD), C2: resized(OLD) });
    refreshSeeded(sheet, 'test', seed, older);
    expect(cells).toEqual({ K1: resized(NEW), C2: resized(NEW) });
  });

  it('is left alone when more than the size was changed', () => {
    const mine = resized(OLD) + ' // mine';
    const { sheet, cells } = fakeSheet({ K1: mine });
    refreshSeeded(sheet, 'test', seed, older);
    expect(cells.K1).toBe(mine);
  });
});

describe('refreshSeeded: cells added in a later version', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  afterEach(() => store.clear());

  function sheetWithRows(cells: Record<string, string>) {
    const { sheet } = fakeSheet(cells);
    const grid = sheet as unknown as { rowCount: number; insertRow: () => void; dataAt: (a: string) => unknown };
    const known = grid.dataAt;
    grid.rowCount = 10;
    grid.insertRow = () => void grid.rowCount++;
    // Rows that do not exist yet have no cell.
    grid.dataAt = (a: string) => (Number(/\d+/.exec(a)![0]) <= grid.rowCount ? (cells[a] === undefined ? { address: a, code: '' } : known(a)) : undefined);
    return { sheet, cells, grid };
  }

  it('puts a never-seen shipped cell into an empty place, and makes the rows it needs', () => {
    recordSeeds('t', [['A1', 'one()']]);
    const { sheet, cells, grid } = sheetWithRows({ A1: 'one()' });
    refreshSeeded(sheet, 't', [['A1', 'one()'], ['A30', 'two()']]);
    expect(cells.A30).toBe('two()');
    expect(grid.rowCount).toBeGreaterThanOrEqual(38);
  });

  it('keeps a cell that was seen and then emptied empty', () => {
    recordSeeds('t', [['A1', 'one()'], ['A5', 'five()']]);
    const { sheet, cells } = sheetWithRows({ A1: 'one()', A5: '' });
    refreshSeeded(sheet, 't', [['A1', 'one()'], ['A5', 'five()']]);
    expect(cells.A5).toBe('');
  });

  it('does nothing for a sheet that was never seeded in this browser', () => {
    const { sheet, cells } = sheetWithRows({});
    refreshSeeded(sheet, 'never', [['A1', 'one()']]);
    expect(cells.A1).toBeUndefined();
  });
});
