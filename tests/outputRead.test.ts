import { describe, expect, it } from 'vitest';
import { findLines, lastLines, screenAdded, screenRows, trimEnd } from '../src/mcp/outputRead';
import type { TileGrid } from '../src/sheet/Sheet';

const grid = (cols: number, rows: number, extra: Partial<TileGrid> = {}): TileGrid =>
  ({ cols, rows, fills: [], texts: new Array(cols * rows).fill(null), inks: [], bolds: [], labels: [], lines: [], ...extra }) as unknown as TileGrid;

const label = (x: number, y: number, w: number, text: string, extra: Record<string, unknown> = {}) => ({ x, y, w, text, ink: '', bold: false, align: 'left', snap: false, mono: true, size: 1, ...extra });

describe('screenRows', () => {
  it('reads letters from tiles and labels, row by row', () => {
    const g = grid(6, 3);
    g.texts[7] = 'a';
    g.labels.push(label(0, 2, 6, 'ts> 1') as never);
    expect(screenRows(g)).toEqual(['', ' a', 'ts> 1']);
  });

  it('aligns labels that are not snapped, and clips to the width', () => {
    const g = grid(8, 3);
    g.labels.push(label(0, 0, 8, 'ab', { align: 'right' }) as never, label(0, 1, 8, 'ab', { align: 'center' }) as never, label(6, 2, 4, 'abcd', { snap: true }) as never);
    expect(screenRows(g)).toEqual(['      ab', '   ab', '      ab']);
  });
});

describe('lines', () => {
  it('trimEnd and lastLines ignore blank lines at the end', () => {
    expect(trimEnd(['a', '', ' ', ''])).toEqual(['a']);
    expect(lastLines(['a', 'b', 'c', '', ''], 1)).toEqual(['c']);
    expect(lastLines(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
    expect(lastLines([], 1)).toEqual([]);
  });

  it('findLines gives 1-based numbers and ignores case unless told', () => {
    const lines = ['Hello', 'world', 'HELLO again'];
    expect(findLines(lines, 'hello')).toEqual([{ line: 1, text: 'Hello' }, { line: 3, text: 'HELLO again' }]);
    expect(findLines(lines, 'hello', false)).toEqual([]);
  });
});

describe('screenAdded', () => {
  it('gives the rows after the old ones, the prompt row being what was typed', () => {
    expect(screenAdded(['title', 'ts> '], ['title', 'ts> 1+1', '2', 'ts> '])).toEqual(['ts> 1+1', '2', 'ts> ']);
  });

  it('finds the old rows again after the screen scrolled', () => {
    expect(screenAdded(['title', 'a', 'b', 'ts> '], ['title', 'b', 'ts> x', 'res', 'ts> '])).toEqual(['ts> x', 'res', 'ts> ']);
  });
});
