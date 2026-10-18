/**
 * The written form of a focus point: a cell path with a place in its code, so a person and an AI can point at the same lines.
 *
 *   /lab/J24#L3        line 3
 *   /lab/J24#L3-5      lines 3 to 5 (whole lines)
 *   /lab/J24#L3C5-L5C12   from line 3 column 5 to line 5 column 12 (columns count from 1; the end column is not included)
 *
 * A bare address (J24#L3) means the tab the reader is in, like everywhere else. Text typed by someone else is checked here, never trusted.
 */

export interface FocusRange {
  startLine: number;
  startColumn?: number;
  endLine: number;
  endColumn?: number;
}

export interface FocusRef extends FocusRange {
  path: string;
}

const PATH = String.raw`(?:\/[a-z][a-z0-9-]*\/[A-Za-z]\d{1,3}|[A-Z]\d{1,3})`;
const RANGE = String.raw`#L\d{1,5}(?:C\d{1,4})?(?:-L?\d{1,5}(?:C\d{1,4})?)?`;

/** The pattern (without anchors) of a whole reference, for finding them inside a text. */
export const FOCUS_REF_SOURCE = `${PATH}${RANGE}`;

const WHOLE = new RegExp(`^(${PATH})#L(\\d{1,5})(?:C(\\d{1,4}))?(?:-L?(\\d{1,5})(?:C(\\d{1,4}))?)?$`);

/** Reads "/lab/J24#L3-5"; null when the text is not a reference. A range written backwards is put the right way round. */
export function parseFocusRef(text: string): FocusRef | null {
  const m = WHOLE.exec(text.trim());
  if (!m) return null;
  const num = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s));
  let startLine = Number(m[2]);
  let startColumn = num(m[3]);
  let endLine = num(m[4]) ?? startLine;
  let endColumn = num(m[5]);
  if (startLine < 1 || endLine < 1 || startColumn === 0 || endColumn === 0) return null;
  // "L3C5" alone is a point; "L3C5-L3C5" is the same: keep columns only when both ends have one.
  if (startColumn === undefined || endColumn === undefined) {
    startColumn = undefined;
    endColumn = undefined;
  }
  if (endLine < startLine || (endLine === startLine && endColumn !== undefined && startColumn !== undefined && endColumn < startColumn)) {
    [startLine, endLine] = [endLine, startLine];
    [startColumn, endColumn] = [endColumn, startColumn];
  }
  return { path: m[1], startLine, startColumn, endLine, endColumn };
}

/** Writes a reference. Without columns it is a line range. */
export function formatFocusRef(path: string, range: FocusRange): string {
  const { startLine, startColumn, endLine, endColumn } = range;
  if (startColumn !== undefined && endColumn !== undefined) return `${path}#L${startLine}C${startColumn}-L${endLine}C${endColumn}`;
  return endLine === startLine ? `${path}#L${startLine}` : `${path}#L${startLine}-${endLine}`;
}

/** "line 3" or "lines 3-5", for sentences. */
export const describeLines = (range: FocusRange): string => (range.endLine === range.startLine ? `line ${range.startLine}` : `lines ${range.startLine}-${range.endLine}`);
