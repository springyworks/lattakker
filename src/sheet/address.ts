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

const STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const SINGLE_LITERAL_RE = /^(\s*\$?[a-z]{1,3}\$?)(\d{1,3})(\s*)$/i;
const COLON_LITERAL_RE = /^(\s*\$?[a-z]{1,3}\$?)(\d{1,3})(\s*:\s*\$?[a-z]{1,3}\$?)(\d{1,3})(\s*)$/i;
const DASH_LITERAL_RE = /^(\s*[a-z]{1,3})(\d{1,3})(\s*-\s*)(\d{1,3})(\s*)$/i;

function shiftRowDigits(rowText: string, fromRow1Based: number, by: number): string {
  const row = parseInt(rowText, 10);
  return row >= fromRow1Based ? String(row + by) : rowText;
}

/** Rewrites the row number(s) inside a single/colon-range/dash-range address literal, if it is one. */
function shiftAddressLiteral(inner: string, fromRow1Based: number, by: number): string | null {
  const single = SINGLE_LITERAL_RE.exec(inner);
  if (single) return single[1] + shiftRowDigits(single[2], fromRow1Based, by) + single[3];
  const colon = COLON_LITERAL_RE.exec(inner);
  if (colon) {
    return (
      colon[1] +
      shiftRowDigits(colon[2], fromRow1Based, by) +
      colon[3] +
      shiftRowDigits(colon[4], fromRow1Based, by) +
      colon[5]
    );
  }
  const dash = DASH_LITERAL_RE.exec(inner);
  if (dash) {
    return (
      dash[1] + shiftRowDigits(dash[2], fromRow1Based, by) + dash[3] + shiftRowDigits(dash[4], fromRow1Based, by) + dash[5]
    );
  }
  return null;
}

/**
 * Rewrites spreadsheet-address string literals inside a cell's code so references to rows at or
 * below `fromRow1Based` shift by `by` rows — like formula rewriting after a spreadsheet row insert.
 * Only literals whose *entire trimmed contents* are unambiguously a single address or a range are
 * touched (same grammar as parseAddress/parseRange), so incidental text is left alone.
 */
export function shiftAddressesInCode(code: string, fromRow1Based: number, by: number): string {
  return code.replace(STRING_LITERAL_RE, (lit) => {
    const quote = lit[0];
    const inner = lit.slice(1, -1);
    const shifted = shiftAddressLiteral(inner, fromRow1Based, by);
    return shifted === null ? lit : quote + shifted + quote;
  });
}
