import { describe, expect, it } from 'vitest';
import { fingerprint, refreshSeeded } from '../src/seedMigration';
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

  it('leaves a moved cell alone when a person changed it', () => {
    const { sheet, cells } = fakeSheet({ A1: seed[0][1], C2: OLD + ' // mine' });
    refreshSeeded(sheet, 'test', seed, older);
    expect(cells.C2).toBe(OLD + ' // mine');
  });
});
