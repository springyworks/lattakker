import { describe, expect, it } from 'vitest';
import { LAB_COLS, LAB_MOVES, LAB_MOVES_2, movedForTerminal, placedInLab, upgradeLabLayout, upgradeLabLayout2 } from '../src/labLayout';
import { LAB_DEMOS, TERMINAL_DEMOS } from '../src/labDemos';
import { fingerprint } from '../src/seedMigration';
import { parseAddress } from '../src/sheet/address';

const blockSize = (code: string): [number, number] => {
  const m = /span\((\d+),\s*(\d+)\)/.exec(code);
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
};

describe('the Lab layout', () => {
  it('puts the ASR-33 at A1, the screen terminal at K1 as big as it, and no demo overlaps any other', () => {
    expect(LAB_DEMOS[0][0]).toBe('A1');
    expect(LAB_DEMOS[1][0]).toBe('K1');
    expect(blockSize(LAB_DEMOS[1][1])).toEqual(blockSize(LAB_DEMOS[0][1]));
    const taken = new Set<string>();
    for (const [address, code] of LAB_DEMOS) {
      const at = parseAddress(address)!;
      const [cols, rows] = blockSize(code);
      expect(at.col + cols).toBeLessThanOrEqual(LAB_COLS);
      for (let r = at.row; r < at.row + rows; r++) {
        for (let c = at.col; c < at.col + cols; c++) {
          const key = `${c},${r}`;
          expect(taken.has(key), `${address} overlaps at ${key}`).toBe(false);
          taken.add(key);
        }
      }
    }
  });

  it('keeps every other address where it was', () => {
    const left = LAB_DEMOS.slice(1).map(([a]) => a);
    expect(left).toContain('J24');
    expect(left).toContain('A16');
    expect(movedForTerminal('J24')).toBe('J24');
    expect(movedForTerminal('A1')).toBe('J1');
    expect(placedInLab('A1')).toBe('AJ1');
    expect(placedInLab('K3')).toBe('T3');
  });

  it('moves a saved Lab aside, drops an untouched old terminal and adds the new one', () => {
    const old = 'span(9, 8)\nold terminal';
    const saved = {
      cols: 26,
      cells: [
        ['A1', 'welcome'],
        ['K3', 'mine'],
        ['F7', 'changed by me', 'uid-1'],
        ['R50', old],
      ] as Array<[string, string, string?]>,
    };
    const out = upgradeLabLayout(saved, TERMINAL_DEMOS[0][1], { A1: 'x', R50: fingerprint(old) });
    expect(out.saved.cells.map((c) => c[0])).toEqual(['A1', 'J1', 'K3', 'AE7']);
    expect(out.saved.cells[0][1]).toBe(TERMINAL_DEMOS[0][1]);
    expect(out.saved.cells[3]).toEqual(['AE7', 'changed by me', 'uid-1']);
    expect(out.saved.cols).toBe(LAB_COLS);
    expect(out.seeds.J1).toBe('x');
    expect(out.seeds.R50).toBeUndefined();
  });

  it('keeps an old terminal the person changed', () => {
    const out = upgradeLabLayout({ cells: [['R50', 'mine now']] as Array<[string, string]> }, 'T', { R50: fingerprint('as shipped') });
    expect(out.saved.cells.map((c) => c[0])).toEqual(['A1', 'R50']);
  });

  it('moves the demos in the way of the screen terminal one more time and keeps their seeds', () => {
    const out = upgradeLabLayout2({ cols: 35, cells: [['A1', 'ASR'], ['J1', 'welcome'], ['K3', 'mine', 'uid-2'], ['J24', 'x']] as Array<[string, string, string?]> }, { J1: 'a', K3: 'b', J24: 'c' });
    expect(out.saved.cells).toEqual([['A1', 'ASR'], ['AJ1', 'welcome'], ['T3', 'mine', 'uid-2'], ['J24', 'x']]);
    expect(out.seeds).toEqual({ AJ1: 'a', T3: 'b', J24: 'c' });
    expect(out.saved.cols).toBe(LAB_COLS);
    expect(Object.keys(LAB_MOVES_2)).toHaveLength(11);
  });

  it('has a move for every demo that was in the terminal block', () => {
    expect(Object.keys(LAB_MOVES)).toEqual(['A1', 'K1', 'S1', 'A3', 'F3', 'A7', 'F7']);
  });
});
