/**
 * Spreadsheet-style addressing: A1, c32, ranges A1:J10, and the short form C32-55
 * (same column, rows 32 to 55). Everything is case-insensitive.
 */
export interface CellPos {
  col: number; // 0-based
  row: number; // 0-based
}

export interface RangePos {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

export function colToLetters(col: number): string {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function lettersToCol(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function formatAddress(col: number, row: number): string {
  return `${colToLetters(col)}${row + 1}`;
}

const ADDRESS_RE = /^\s*\$?([a-z]{1,3})\$?(\d{1,3})\s*$/i;

export function parseAddress(text: string): CellPos | null {
  const m = ADDRESS_RE.exec(text);
  if (!m) return null;
  return { col: lettersToCol(m[1]), row: parseInt(m[2], 10) - 1 };
}

/** Accepts "A1", "A1:B3", "B3:A1" (normalised), and "C32-55" (same column span). */
export function parseRange(text: string): RangePos | null {
  const t = text.trim();
  const colon = t.split(':');
  if (colon.length === 2) {
    const a = parseAddress(colon[0]);
    const b = parseAddress(colon[1]);
    if (!a || !b) return null;
    return normalise(a, b);
  }
  const dash = /^\s*([a-z]{1,3})(\d{1,3})\s*-\s*(\d{1,3})\s*$/i.exec(t);
  if (dash) {
    const col = lettersToCol(dash[1]);
    return normalise({ col, row: parseInt(dash[2], 10) - 1 }, { col, row: parseInt(dash[3], 10) - 1 });
  }
  const single = parseAddress(t);
  if (single) return { c1: single.col, r1: single.row, c2: single.col, r2: single.row };
  return null;
}

function normalise(a: CellPos, b: CellPos): RangePos {
  return {
    c1: Math.min(a.col, b.col),
    r1: Math.min(a.row, b.row),
    c2: Math.max(a.col, b.col),
    r2: Math.max(a.row, b.row),
  };
}

/** Lists every address in a range, row by row. */
export function expandRange(range: RangePos): string[] {
  const out: string[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      out.push(formatAddress(c, r));
    }
  }
  return out;
}

export function normaliseAddress(text: string): string | null {
  const p = parseAddress(text);
  return p ? formatAddress(p.col, p.row) : null;
}

// ------------------------------------------------------- rewriting references inside code

/**
 * What a rewriter says about one address literal found in code: the new endpoints (1 for "B7", 2 for
 * "A1:B3"), null to leave it alone, or 'kept' when it touches cells that moved but cannot be
 * rewritten safely (so the caller can warn instead of silently pointing at the wrong cell).
 */
export type RefRewrite = (ends: CellPos[], literal: string) => CellPos[] | 'kept' | null;

export interface RewriteResult {
  code: string;
  /** How many literals were changed. */
  count: number;
  /** Literals that were left as written although they touch moved cells. */
  kept: string[];
}

interface End {
  dollarCol: string;
  letters: string;
  dollarRow: string;
  col: number;
  row: number;
}

interface ParsedLiteral {
  lead: string;
  trail: string;
  kind: 'cell' | 'colon' | 'dash';
  sep: string;
  ends: End[];
}

const SINGLE_RE = /^(\s*)(\$?)([a-z]{1,3})(\$?)(\d{1,3})(\s*)$/i;
const COLON_RE = /^(\s*)(\$?)([a-z]{1,3})(\$?)(\d{1,3})(\s*:\s*)(\$?)([a-z]{1,3})(\$?)(\d{1,3})(\s*)$/i;
const DASH_RE = /^(\s*)([a-z]{1,3})(\d{1,3})(\s*-\s*)(\d{1,3})(\s*)$/i;

function end(dollarCol: string, letters: string, dollarRow: string, digits: string): End | null {
  const row = parseInt(digits, 10) - 1;
  return row < 0 ? null : { dollarCol, letters, dollarRow, col: lettersToCol(letters), row };
}

/** Only a literal whose whole text is one address or one range counts; any other text is left alone. */
function parseLiteral(text: string): ParsedLiteral | null {
  let m = SINGLE_RE.exec(text);
  if (m) {
    const a = end(m[2], m[3], m[4], m[5]);
    return a && { lead: m[1], trail: m[6], kind: 'cell', sep: '', ends: [a] };
  }
  m = COLON_RE.exec(text);
  if (m) {
    const a = end(m[2], m[3], m[4], m[5]);
    const b = end(m[7], m[8], m[9], m[10]);
    return a && b && { lead: m[1], trail: m[11], kind: 'colon', sep: m[6], ends: [a, b] };
  }
  m = DASH_RE.exec(text);
  if (m) {
    const a = end('', m[2], '', m[3]);
    const b = end('', m[2], '', m[5]);
    return a && b && { lead: m[1], trail: m[6], kind: 'dash', sep: m[4], ends: [a, b] };
  }
  return null;
}

function formatEnd(e: End, pos: CellPos): string {
  const letters = colToLetters(pos.col);
  return e.dollarCol + (e.letters === e.letters.toLowerCase() ? letters.toLowerCase() : letters) + e.dollarRow + (pos.row + 1);
}

function formatLiteral(p: ParsedLiteral, to: CellPos[]): string {
  if (p.kind === 'cell') return p.lead + formatEnd(p.ends[0], to[0]) + p.trail;
  if (p.kind === 'dash' && to[0].col === to[1].col) {
    return p.lead + formatEnd(p.ends[0], to[0]) + p.sep + (to[1].row + 1) + p.trail;
  }
  const sep = p.kind === 'dash' ? ':' : p.sep;
  return p.lead + formatEnd(p.ends[0], to[0]) + sep + formatEnd(p.ends[1], to[1]) + p.trail;
}

/** After one of these a "/" starts a regular expression instead of dividing. */
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';

/**
 * Finds every address literal in `code` ("E24", 'A1:J10', `Z21-39`) and lets `fn` rewrite it.
 * Comments, regular expressions and the text parts of template strings are skipped, so an
 * apostrophe in a comment cannot confuse it; `${...}` parts of a template are scanned as code.
 */
export function mapAddressLiterals(code: string, fn: RefRewrite): RewriteResult {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const kept: string[] = [];
  const n = code.length;
  let i = 0;
  let last = '';

  const handle = (start: number, stop: number): void => {
    const inner = code.slice(start + 1, stop - 1);
    const parsed = parseLiteral(inner);
    if (!parsed) return;
    const result = fn(parsed.ends.map((e) => ({ col: e.col, row: e.row })), inner);
    if (result === 'kept') {
      kept.push(inner.trim());
      return;
    }
    if (!result) return;
    const text = formatLiteral(parsed, result);
    if (text !== inner) edits.push({ start: start + 1, end: stop - 1, text });
  };

  const scanTemplate = (): void => {
    const start = i;
    let hasSubstitution = false;
    i++;
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') i += 2;
      else if (ch === '`') {
        i++;
        if (!hasSubstitution) handle(start, i);
        return;
      } else if (ch === '$' && code[i + 1] === '{') {
        hasSubstitution = true;
        i += 2;
        last = '';
        scan(true);
        i++;
      } else i++;
    }
  };

  const scan = (inTemplate: boolean): void => {
    let depth = 0;
    while (i < n) {
      const ch = code[i];
      const next = code[i + 1];
      if (ch === '/' && next === '/') {
        while (i < n && code[i] !== '\n') i++;
      } else if (ch === '/' && next === '*') {
        const close = code.indexOf('*/', i + 2);
        i = close < 0 ? n : close + 2;
      } else if (ch === "'" || ch === '"') {
        const start = i;
        i++;
        while (i < n && code[i] !== ch && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1;
        if (code[i] === ch) {
          i++;
          handle(start, i);
        }
        last = 'v';
      } else if (ch === '`') {
        scanTemplate();
        last = 'v';
      } else if (ch === '/' && (last === '' || BEFORE_REGEX.includes(last))) {
        i++;
        let inClass = false;
        while (i < n && code[i] !== '\n' && (inClass || code[i] !== '/')) {
          if (code[i] === '\\') i++;
          else if (code[i] === '[') inClass = true;
          else if (code[i] === ']') inClass = false;
          i++;
        }
        i++;
        last = 'v';
      } else {
        if (ch === '{') depth++;
        else if (ch === '}') {
          if (inTemplate && depth === 0) return;
          depth--;
        }
        if (!/\s/.test(ch)) last = ch;
        i++;
      }
    }
  };

  scan(false);
  let out = '';
  let from = 0;
  for (const e of edits) {
    out += code.slice(from, e.start) + e.text;
    from = e.end;
  }
  return { code: out + code.slice(from), count: edits.length, kept };
}

/** Like a spreadsheet row insert: every row at or below `fromRow1Based` moves down by `by` (ranges stretch). */
export function rowInsertRewrite(fromRow1Based: number, by: number): RefRewrite {
  return (ends) => {
    let changed = false;
    const moved = ends.map((e) => {
      if (e.row + 1 < fromRow1Based) return e;
      changed = true;
      return { col: e.col, row: e.row + by };
    });
    return changed ? moved : null;
  };
}

export interface BlockMove {
  from: RangePos;
  to: RangePos;
}

const contains = (outer: RangePos, inner: RangePos): boolean =>
  inner.c1 >= outer.c1 && inner.c2 <= outer.c2 && inner.r1 >= outer.r1 && inner.r2 <= outer.r2;
const overlaps = (a: RangePos, b: RangePos): boolean => a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

/** Where a cell goes when it sits inside one of the moved blocks; null when no block carries it. */
export function movedTo(moves: BlockMove[], pos: CellPos): CellPos | null {
  const rect = normalise(pos, pos);
  for (const m of moves) {
    if (contains(m.from, rect)) return { col: pos.col + m.to.c1 - m.from.c1, row: pos.row + m.to.r1 - m.from.r1 };
  }
  return null;
}

/**
 * References follow the cells they name, like a spreadsheet. A swap lists both directions so they apply at
 * the same moment. A single cell follows its block; a range follows only when the whole range was inside one
 * moved block. A range that is split by the move (or a cell that now holds something else) is never guessed:
 * it is left as written and reported as 'kept', so the player is told instead of silently hitting another cell.
 */
export function blockMoveRewrite(moves: BlockMove[]): RefRewrite {
  return (ends) => {
    const rect = ends.length === 1 ? normalise(ends[0], ends[0]) : normalise(ends[0], ends[1]);
    for (const m of moves) {
      if (!contains(m.from, rect)) continue;
      const dc = m.to.c1 - m.from.c1;
      const dr = m.to.r1 - m.from.r1;
      return ends.map((e) => ({ col: e.col + dc, row: e.row + dr }));
    }
    const touching = moves.filter((m) => overlaps(m.from, rect) || overlaps(m.to, rect));
    if (touching.length === 0) return null;
    // A range holding both halves of a swap still holds the same two cells, so it is already right.
    if (touching.every((m) => contains(rect, m.from) && contains(rect, m.to))) return null;
    return 'kept';
  };
}
