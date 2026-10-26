/**
 * Selecting letters on a character grid, the same for every cell that prints letters itself instead of as page text: a tile
 * terminal (/lab/K1), a teletype paper (/lab/A1), and any kind that can say what its lines are and where each letter stands.
 * Pure arithmetic: the sheet gives the lines and the geometry, and gets back the text and the boxes to highlight.
 */

export interface LetterGrid {
  /** What is printed, one string per line. */
  lines: string[];
  /** Where the first letter of the first line stands (model units). */
  x: number;
  y: number;
  /** The width of one letter and the height of one line. */
  cw: number;
  lh: number;
  /** The longest a line can be (a selection never reaches further right). */
  cols: number;
}

/** A place between two letters: before letter `col` of line `line`. */
export interface GridPoint {
  line: number;
  col: number;
}

export interface GridBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The place nearest to a point (model units), kept inside the grid. */
export function gridPoint(g: LetterGrid, px: number, py: number): GridPoint {
  const line = Math.max(0, Math.min(Math.max(0, g.lines.length - 1), Math.floor((py - g.y) / g.lh)));
  const col = Math.max(0, Math.min(g.cols, Math.round((px - g.x) / g.cw)));
  return { line, col };
}

/** What lies between two places, whichever comes first: the text (lines joined by newlines, no spaces at line ends) and a box per line to highlight. */
export function gridSpan(g: LetterGrid, a: GridPoint, b: GridPoint): { text: string; boxes: GridBox[] } {
  const [s, t] = a.line < b.line || (a.line === b.line && a.col <= b.col) ? [a, b] : [b, a];
  const parts: string[] = [];
  const boxes: GridBox[] = [];
  for (let l = s.line; l <= t.line; l++) {
    const line = g.lines[l] ?? '';
    const from = l === s.line ? s.col : 0;
    const to = l === t.line ? t.col : Math.max(from, line.length);
    parts.push(line.slice(from, to).trimEnd());
    if (to > from) boxes.push({ x: g.x + from * g.cw, y: g.y + l * g.lh, width: (to - from) * g.cw, height: g.lh });
  }
  return { text: parts.join('\n').replace(/\n+$/, ''), boxes };
}

export const samePlace = (a: GridPoint, b: GridPoint): boolean => a.line === b.line && a.col === b.col;
