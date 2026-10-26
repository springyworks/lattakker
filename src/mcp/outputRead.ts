import type { TileGrid } from '../sheet/Sheet';

/**
 * Reading what a cell shows as text, for the cell_output tools. A cell that prints has output lines; a cell that
 * draws a terminal on a grid of tiles (like /lab/K1) has no output at all, only letters in tiles, so its screen is
 * read row by row.
 */

/** The letters of a tile grid, one string per row, without trailing spaces. Later text lies over earlier text. */
export function screenRows(tiles: TileGrid): string[] {
  const grid = Array.from({ length: tiles.rows }, () => new Array<string>(tiles.cols).fill(' '));
  for (let i = 0; i < tiles.texts.length; i++) {
    const text = tiles.texts[i];
    if (text) grid[Math.floor(i / tiles.cols)][i % tiles.cols] = [...text][0] ?? ' ';
  }
  for (const label of tiles.labels) {
    const row = grid[label.y];
    if (!row) continue;
    const letters = [...label.text].slice(0, label.w);
    const spare = Math.max(0, label.w - letters.length);
    const start = label.x + (label.snap || label.align === 'left' ? 0 : label.align === 'center' ? Math.floor(spare / 2) : spare);
    letters.forEach((ch, k) => {
      if (start + k < tiles.cols) row[start + k] = ch;
    });
  }
  return grid.map((row) => row.join('').trimEnd());
}

/** Drops blank lines at the end. */
export const trimEnd = (lines: string[]): string[] => {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  return lines.slice(0, end);
};

/** The last n lines (blank lines at the end do not count). */
export const lastLines = (lines: string[], n: number): string[] => trimEnd(lines).slice(-Math.max(1, Math.floor(n)));

/**
 * What a screen gained between two readings. A screen scrolls, so it is not a longer text: the rows that stayed
 * (as many as can be found, in a row) are found again higher up, and what comes after them is new. The title row does not scroll, so the match need not start at the top. The last row before is left out of the match
 * because it was the prompt, which now holds what was typed.
 */
export function screenAdded(before: string[], after: string[]): string[] {
  const b = trimEnd(before);
  const a = trimEnd(after);
  const kept = b.slice(0, -1);
  for (let skip = 0; skip < kept.length; skip++) {
    const rest = kept.slice(skip);
    for (let at = 0; at + rest.length <= a.length; at++) {
      if (rest.every((line, k) => a[at + k] === line)) return a.slice(at + rest.length);
    }
  }
  return a;
}

/** The lines that contain the text, each with its line number (from 1). */
export function findLines(lines: string[], needle: string, ignoreCase = true): Array<{ line: number; text: string }> {
  const find = ignoreCase ? needle.toLowerCase() : needle;
  const found: Array<{ line: number; text: string }> = [];
  lines.forEach((text, k) => {
    if ((ignoreCase ? text.toLowerCase() : text).includes(find)) found.push({ line: k + 1, text });
  });
  return found;
}
