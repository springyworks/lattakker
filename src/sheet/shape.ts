/**
 * The shape of a code cell: how many columns and rows its block covers.
 *
 * Two voices can decide it. The *code* says `span(cols, rows)` (a default: "this is how big I want to be"), and the
 * *person* resizes the block with its handles, or makes it from a selection of cells. The rule that keeps both
 * honest:
 *
 *   - Nobody said anything: the block keeps its shape (1 x 1 for a new cell).
 *   - Only the code spoke: the code's size is used.
 *   - The person spoke (`user`): the person's size wins for as long as the code keeps asking for the same size it
 *     asked for before. When the code's own numbers change (someone edited them, or the code computes something
 *     else), the code is speaking again and wins; the person's size is forgotten.
 *   - When the person resizes a block whose code has a plain `span(4, 2)` line, that line is rewritten to the new
 *     numbers, so what the code says and what is on the screen never disagree.
 */

export interface Size {
  cols: number;
  rows: number;
}

export interface ShapeState {
  /** The size the person chose (resize handles, or a selection turned into a block); null when nobody did. */
  user: Size | null;
  /** The size the code asked for the last time it ran; null before its first run. */
  code: Size | null;
}

export const emptyShape = (): ShapeState => ({ user: null, code: null });

export const sameSize = (a: Size | null, b: Size | null): boolean => !!a && !!b && a.cols === b.cols && a.rows === b.rows;

/** A whole `span(...)` statement on its own line, with plain numbers: span(4, 2) or span(4). */
const SPAN_LINE = /^(\s*)span\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)(\s*;?)(\s*\/\/.*)?$/;

/** What the code literally says, from its first plain `span(...)` line; null when it has none (or computes the numbers). */
export function readSpanCall(code: string): { cols: number; rows: number | null } | null {
  for (const line of code.split('\n')) {
    const m = SPAN_LINE.exec(line);
    if (m) return { cols: Number(m[2]), rows: m[3] === undefined ? null : Number(m[3]) };
  }
  return null;
}

/** The code with the numbers of its first plain `span(...)` line replaced, or null when there is no such line to change. */
export function rewriteSpanCall(code: string, cols: number, rows: number): string | null {
  const lines = code.split('\n');
  const at = lines.findIndex((l) => SPAN_LINE.test(l));
  if (at < 0) return null;
  const m = SPAN_LINE.exec(lines[at])!;
  lines[at] = `${m[1]}span(${cols}, ${rows})${m[4] ?? ''}${m[5] ?? ''}`;
  return lines.join('\n');
}

export interface SpanDecision {
  /** The size the block should have now. */
  apply: Size;
  shape: ShapeState;
  /** Set when the code's `span(...)` line should be rewritten to these numbers. */
  rewriteTo: Size | null;
}

/** What `span(cols, rows)` in the code means for a block, given what the person and the code said before. */
export function decideSpan(shape: ShapeState, request: Size, literal: { cols: number; rows: number | null } | null): SpanDecision {
  const user = shape.user;
  if (!user) return { apply: request, shape: { user: null, code: request }, rewriteTo: null };
  // The code asked for something different from last time: its numbers changed, so the code speaks again.
  if (shape.code && !sameSize(request, shape.code)) return { apply: request, shape: { user: null, code: request }, rewriteTo: null };
  const disagrees = !!literal && (literal.cols !== user.cols || literal.rows !== user.rows);
  return { apply: user, shape: { user, code: disagrees ? user : (shape.code ?? request) }, rewriteTo: disagrees ? user : null };
}
