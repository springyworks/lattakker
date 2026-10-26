import { describe, expect, it } from 'vitest';
import { gridPoint, gridSpan, type LetterGrid } from '../src/sheet/gridSelect';

const grid: LetterGrid = { lines: ['ts> 1+2', '3', 'hello world', ''], x: 100, y: 50, cw: 10, lh: 20, cols: 20 };

describe('selecting letters on a character grid', () => {
  it('finds the place nearest to a point and keeps it inside', () => {
    expect(gridPoint(grid, 100, 50)).toEqual({ line: 0, col: 0 });
    expect(gridPoint(grid, 124, 71)).toEqual({ line: 1, col: 2 });
    expect(gridPoint(grid, 126, 71)).toEqual({ line: 1, col: 3 });
    expect(gridPoint(grid, -500, -500)).toEqual({ line: 0, col: 0 });
    expect(gridPoint(grid, 9999, 9999)).toEqual({ line: 3, col: 20 });
  });

  it('takes the letters of one line', () => {
    const { text, boxes } = gridSpan(grid, { line: 0, col: 4 }, { line: 0, col: 6 });
    expect(text).toBe('1+');
    expect(boxes).toEqual([{ x: 140, y: 50, width: 20, height: 20 }]);
  });

  it('takes several lines, whichever end the drag started at', () => {
    const forward = gridSpan(grid, { line: 0, col: 4 }, { line: 2, col: 5 });
    const backward = gridSpan(grid, { line: 2, col: 5 }, { line: 0, col: 4 });
    expect(forward.text).toBe('1+2\n3\nhello');
    expect(backward).toEqual(forward);
    expect(forward.boxes).toHaveLength(3);
  });

  it('leaves out spaces at line ends and blank lines at the end', () => {
    expect(gridSpan(grid, { line: 2, col: 0 }, { line: 3, col: 0 }).text).toBe('hello world');
    expect(gridSpan(grid, { line: 2, col: 5 }, { line: 2, col: 20 }).text).toBe(' world');
  });

  it('selects nothing from one place to the same place', () => {
    const { text, boxes } = gridSpan(grid, { line: 1, col: 1 }, { line: 1, col: 1 });
    expect(text).toBe('');
    expect(boxes).toEqual([]);
  });
});
