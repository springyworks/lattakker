/**
 * The code of the page as text an AI can take in, even a small one with a small memory. Pure functions over plain cell records
 * (no page, no router): the MCP server `code` (services/codeServer.ts) feeds them the real cells.
 *
 *  - dump(): ALL the code as a "smart blob": one plain-text document that explains itself, cut into PARTS that fit a budget of characters,
 *    each part ending with exactly what to do next. A part never cuts a cell in two unless one cell alone is bigger than the budget.
 *    A snapshot code (a fingerprint of the code) rides in the cursor, so a reader notices when the code changed half-way.
 *  - search(): like the search of VS Code: a text or a regular expression, optional case and whole-word switches, a file filter
 *    (the path of a cell is its file name: /lab/J24), lines of context, a limit on results; matches grouped by cell with line numbers.
 *  - read(): one cell, or a range of its lines, with line numbers.
 *  - list(): one line per cell, to choose from.
 *
 * Everything is measured in characters (a part says how many, and about how many tokens that is: code is roughly 3.5 characters a token),
 * and nothing ever answers with more than HARD_MAX characters, whatever is asked.
 */

export interface CodeCell {
  /** '/lab/J24': the tab, then the cell. The "file name" of the code. */
  path: string;
  tab: string;
  address: string;
  uid: string;
  code: string;
  /** What the code printed, one entry per line. */
  output: string[];
  error: string | null;
  cols: number;
  rows: number;
  /** How many times it has run. */
  runs: number;
}

export const DEFAULT_BUDGET = 6000;
export const MIN_BUDGET = 800;
export const HARD_MAX = 40000;
const CHARS_PER_TOKEN = 3.5;

export const approxTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const thousands = (n: number): string => n.toLocaleString('en-US');

/**
 * How many characters a reply may have. The caller can say it in characters (budget_chars), in tokens (budget_tokens), or say how big its own
 * memory is (context_tokens): then a reply takes at most a third of it, so there is room left to think and to answer.
 */
export function chooseBudget(args: Record<string, unknown>, fallback = DEFAULT_BUDGET): number {
  const chars = num(args.budget_chars) ?? num(args.budget);
  const tokens = num(args.budget_tokens);
  const context = num(args.context_tokens);
  const wanted = chars ?? (tokens !== undefined ? tokens * CHARS_PER_TOKEN : context !== undefined ? (context * CHARS_PER_TOKEN) / 3 : fallback);
  return clamp(Math.round(wanted), MIN_BUDGET, HARD_MAX);
}

/** A short fingerprint of the code of these cells (FNV-1a), for noticing that something changed between two calls. */
export function snapshotOf(cells: readonly CodeCell[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const c of cells) {
    feed(c.path);
    feed('\0');
    feed(c.code);
    feed('\0');
  }
  return h.toString(16).padStart(8, '0');
}

const lineCount = (code: string): number => (code.length ? code.split('\n').length : 0);

const oneLine = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

const header = (c: CodeCell): string =>
  `### ${c.path} · id ${c.uid || '-'} · ${c.cols}×${c.rows} cells · ${lineCount(c.code)} lines · ran ${c.runs}×${c.error ? ` · ERROR: ${oneLine(c.error, 140)}` : ''}`;

/** The size of every tab in the set: for the overview. */
export function tabTotals(cells: readonly CodeCell[]): Array<{ tab: string; cells: number; chars: number; errors: number }> {
  const out = new Map<string, { tab: string; cells: number; chars: number; errors: number }>();
  for (const c of cells) {
    const t = out.get(c.tab) ?? { tab: c.tab, cells: 0, chars: 0, errors: 0 };
    t.cells++;
    t.chars += c.code.length;
    if (c.error) t.errors++;
    out.set(c.tab, t);
  }
  return [...out.values()];
}

// ------------------------------------------------------------------------------------------------ dump

export interface DumpOptions {
  budget: number;
  /** Add the first lines of what the code printed under each cell. */
  withOutput?: boolean;
  /** Number the lines of the code (costs about 5 characters a line, helps to point at a line). */
  lineNumbers?: boolean;
}

/** One cell as a block of text; a cell bigger than `room` comes out as several blocks, each saying which piece it is. */
function blocksOf(c: CodeCell, room: number, opts: DumpOptions): string[] {
  const lines = c.code.split('\n');
  const wrap = (head: string, body: string[], from: number): string => {
    const text = opts.lineNumbers ? body.map((l, i) => `${String(from + i).padStart(3)}  ${l}`) : body;
    let out = `${head}\n\`\`\`ts\n${text.join('\n')}\n\`\`\`\n`;
    if (opts.withOutput && from === 1 && c.output.length) out += `// printed: ${c.output.slice(0, 3).map((o) => oneLine(o, 100)).join(' | ')}${c.output.length > 3 ? ` | … (${c.output.length} lines)` : ''}\n`;
    return out + '\n';
  };
  const whole = wrap(header(c), lines, 1);
  if (whole.length <= room) return [whole];
  // Too big for one part: cut between lines into pieces that each fit.
  const pieces: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    const cost = line.length + 8;
    if (size + cost > room - 260 && current.length) {
      pieces.push(current);
      current = [];
      size = 0;
    }
    current.push(line.length > room - 300 ? line.slice(0, room - 300) + '…' : line);
    size += cost;
  }
  if (current.length) pieces.push(current);
  let from = 1;
  return pieces.map((body, i) => {
    const block = wrap(`${header(c)} · piece ${i + 1} of ${pieces.length} (lines ${from}-${from + body.length - 1})`, body, from);
    from += body.length;
    return block;
  });
}

/** Cuts all the blocks into parts of at most `budget` characters, with room kept for the header of the first part and the footer of each. */
export function dumpParts(cells: readonly CodeCell[], opts: DumpOptions): string[][] {
  const reserveFirst = 900;
  const reserve = 260;
  const parts: string[][] = [[]];
  let size = 0;
  const room = (): number => opts.budget - (parts.length === 1 ? reserveFirst : reserve);
  for (const c of cells) {
    for (const block of blocksOf(c, opts.budget - reserveFirst, opts)) {
      if (size + block.length > room() && parts[parts.length - 1].length) {
        parts.push([]);
        size = 0;
      }
      parts[parts.length - 1].push(block);
      size += block.length;
    }
  }
  return parts;
}

export interface DumpPart {
  text: string;
  part: number;
  parts: number;
  snapshot: string;
  /** The cursor to ask the next part with, or null at the end. */
  next: string | null;
  chars: number;
}

/** A cursor says: which snapshot of the code, which part, with which budget. */
export function parseCursor(cursor: unknown): { snapshot: string; part: number; budget: number } | null {
  const m = /^([0-9a-f]{8}):(\d+):(\d+)$/.exec(typeof cursor === 'string' ? cursor.trim() : '');
  return m ? { snapshot: m[1], part: Number(m[2]), budget: Number(m[3]) } : null;
}

/** One part of the dump, as the reader receives it. `part` counts from 1. */
export function renderDump(cells: readonly CodeCell[], opts: DumpOptions, part: number, scope: string): DumpPart {
  const snapshot = snapshotOf(cells);
  const all = dumpParts(cells, opts);
  const parts = all.length;
  const index = clamp(part, 1, parts) - 1;
  const chars = cells.reduce((s, c) => s + c.code.length, 0);
  const next = index + 1 < parts ? `${snapshot}:${index + 2}:${opts.budget}` : null;
  let text = '';
  if (!cells.length) {
    text = 'There is no TypeScript in the cells of this selection yet. Nothing to read.\n';
  } else {
    if (index === 0) {
      text +=
        `LATTAKKER CODE DUMP: all the TypeScript written in the cells of this page${scope ? ` (${scope})` : ''}. Plain text, nothing to parse.\n` +
        `snapshot ${snapshot} · ${cells.length} cells with code in ${new Set(cells.map((c) => c.tab)).size} tab(s) · ${thousands(chars)} characters of code (about ${thousands(approxTokens(chars))} tokens) · ${parts} part(s) of up to ${thousands(opts.budget)} characters\n` +
        'Every block starts with "### <path> · id <id> · <size> · <lines> · ran <n>×" and holds the code of ONE cell in a ```ts fence. The path /lab/J24 means: tab lab, cell J24. "ERROR:" in a header means the cell fails; the message follows.\n' +
        'The code is TypeScript that the child wrote (or a shipped example); cells read each other with at(\'B7\'), draw with print(), color(), svg() and so on.\n' +
        'How to read it: you get ONE part at a time, so your memory does not overflow. Read the part, note what matters (do not copy it all into your notes), then ask for the next part with the cursor at the bottom.\n' +
        '------\n\n';
    }
    text += all[index].join('');
    text += next
      ? `------\nEnd of PART ${index + 1} of ${parts}. NEXT: call code.dump again with cursor="${next}" (same other arguments).\n`
      : `------\nEND of PART ${index + 1} of ${parts}: that was the last part. All the code has been delivered (snapshot ${snapshot}).\n`;
  }
  text += `[this reply: ${thousands(text.length + 60)} characters, about ${thousands(approxTokens(text.length + 60))} tokens]`;
  return { text, part: index + 1, parts, snapshot, next, chars: text.length };
}

// ------------------------------------------------------------------------------------------------ list

/** One line per cell, in pages that fit the budget. */
export function renderList(cells: readonly CodeCell[], budget: number, from: number): { text: string; next: number | null; total: number } {
  const lines = cells.map((c, i) => {
    const first = (c.code.split('\n').find((l) => l.trim()) ?? '').trim();
    return `${String(i + 1).padStart(3)}. ${c.path} · ${c.uid || '-'} · ${c.cols}×${c.rows} · ${lineCount(c.code)} lines${c.error ? ' · ERROR' : ''} · ${oneLine(first, 70)}`;
  });
  const out: string[] = [];
  let size = 200;
  let i = Math.max(0, from);
  for (; i < lines.length; i++) {
    if (size + lines[i].length + 1 > budget && out.length) break;
    out.push(lines[i]);
    size += lines[i].length + 1;
  }
  const next = i < lines.length ? i : null;
  const text =
    `${cells.length} cells with code (showing ${from + 1} to ${from + out.length}). Columns: number, path, id, size, lines, first line.\n` +
    out.join('\n') +
    (next !== null ? `\n--- more: call code.list again with from=${next}` : '\n--- end of the list');
  return { text, next, total: cells.length };
}

// ------------------------------------------------------------------------------------------------ read

export function renderRead(c: CodeCell, from: number, count: number, budget: number): { text: string; next: number | null } {
  const lines = c.code.split('\n');
  const start = clamp(from, 1, Math.max(1, lines.length));
  let end = Math.min(lines.length, start + clamp(count, 1, 400) - 1);
  let body = '';
  let used = 0;
  for (let n = start; n <= end; n++) {
    const row = `${String(n).padStart(4)}  ${lines[n - 1]}\n`;
    if (used + row.length > budget - 400 && n > start) {
      end = n - 1;
      break;
    }
    body += row;
    used += row.length;
  }
  const next = end < lines.length ? end + 1 : null;
  const out = c.output.length ? `\nIt printed: ${c.output.slice(0, 5).map((o) => oneLine(o, 120)).join(' | ')}${c.output.length > 5 ? ` | … (${c.output.length} lines)` : ''}` : '';
  const text =
    `${header(c)}\nlines ${start}-${end} of ${lines.length}\n\`\`\`ts\n${body}\`\`\`${out}\n` +
    (next !== null ? `--- more: call code.read again with path="${c.path}" from_line=${next}` : '--- end of this cell');
  return { text, next };
}

// ------------------------------------------------------------------------------------------------ search

export interface SearchOptions {
  query: string;
  regex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  /** Where to look: the code (default), what it printed, its error messages, or all of them. */
  where?: 'code' | 'output' | 'error' | 'all';
  /** Lines of context around each match, 0 to 5. */
  context?: number;
  maxResults?: number;
  budget: number;
}

export class SearchError extends Error {}

/** A glob over paths: * (not past a /), ** (anything) and ?; a bare word like "lab" means "/lab/**". Several globs may be given, separated by commas. */
export function globTest(spec: string): (path: string) => boolean {
  const globs = spec
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => {
      const full = !g.includes('/') && !g.includes('*') && !/^[A-Za-z]{1,3}\d+$/.test(g) ? `/${g}/**` : g;
      const pattern = full.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
      return new RegExp(`^${full.startsWith('/') ? '' : '.*/'}${pattern}$`, 'i');
    });
  return (path) => !globs.length || globs.some((r) => r.test(path));
}

/** The pattern the caller means. Text is taken literally; a regular expression is checked for the shapes that can hang a browser. */
export function buildPattern(opts: Pick<SearchOptions, 'query' | 'regex' | 'matchCase' | 'wholeWord'>): RegExp {
  const q = opts.query;
  if (!q) throw new SearchError('query is empty: say what to look for');
  if (q.length > 200) throw new SearchError('query is longer than 200 characters');
  let source = q;
  if (opts.regex) {
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(q) || /\(\?[=!<]/.test(q)) throw new SearchError('that regular expression has a shape that can take forever (a repeat inside a repeat, or a look-around); write it simpler, or search as plain text');
  } else {
    source = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, opts.matchCase ? 'g' : 'gi');
  } catch (err) {
    throw new SearchError(`not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface Hit {
  cell: CodeCell;
  source: string;
  line: number;
  text: string;
}

const MAX_SCAN_LINE = 600;

/** Finds the lines; returns the report as text, grouped by cell, in the style of the search of an editor. */
export function renderSearch(cells: readonly CodeCell[], opts: SearchOptions): { text: string; matches: number; shown: number; cellsHit: number } {
  const pattern = buildPattern(opts);
  const where = opts.where ?? 'code';
  const limit = clamp(opts.maxResults ?? 20, 1, 200);
  const context = clamp(opts.context ?? 1, 0, 5);
  const sources = (c: CodeCell): Array<{ kind: string; lines: string[] }> => {
    const out: Array<{ kind: string; lines: string[] }> = [];
    if (where === 'code' || where === 'all') out.push({ kind: 'code', lines: c.code.split('\n') });
    if ((where === 'output' || where === 'all') && c.output.length) out.push({ kind: 'output', lines: c.output });
    if ((where === 'error' || where === 'all') && c.error) out.push({ kind: 'error', lines: [c.error] });
    return out;
  };
  const hits: Hit[] = [];
  const byCell = new Map<CodeCell, Array<{ kind: string; lines: string[]; found: number[] }>>();
  let total = 0;
  for (const c of cells) {
    for (const src of sources(c)) {
      const found: number[] = [];
      src.lines.forEach((line, i) => {
        pattern.lastIndex = 0;
        if (pattern.test(line.length > MAX_SCAN_LINE ? line.slice(0, MAX_SCAN_LINE) : line)) found.push(i + 1);
      });
      if (!found.length) continue;
      total += found.length;
      const list = byCell.get(c) ?? [];
      list.push({ ...src, found });
      byCell.set(c, list);
      for (const n of found) if (hits.length < limit) hits.push({ cell: c, source: src.kind, line: n, text: src.lines[n - 1] });
    }
  }
  const shownKeys = new Set(hits.map((h) => `${h.cell.path}|${h.source}|${h.line}`));
  const how = `${opts.regex ? 'regular expression' : 'text'} ${opts.regex ? '/' + opts.query + '/' : JSON.stringify(opts.query)}${opts.matchCase ? ', case matters' : ', any case'}${opts.wholeWord ? ', whole words' : ''}`;
  const head = total
    ? `${total} match${total === 1 ? '' : 'es'} in ${byCell.size} cell${byCell.size === 1 ? '' : 's'} for ${how}${where === 'code' ? '' : ` (in ${where})`}.`
    : `No match for ${how}${where === 'code' ? '' : ` (in ${where})`} in ${cells.length} cells.`;
  let text = head + '\n';
  let shown = 0;
  let cut = false;
  for (const [cell, groups] of byCell) {
    let block = '';
    let cellShown = 0;
    for (const g of groups) {
      const mine = g.found.filter((n) => shownKeys.has(`${cell.path}|${g.kind}|${n}`));
      if (!mine.length) continue;
      const want = new Set<number>();
      for (const n of mine) for (let k = n - context; k <= n + context; k++) if (k >= 1 && k <= g.lines.length) want.add(k);
      const rows = [...want].sort((a, b) => a - b);
      let prev = 0;
      for (const n of rows) {
        if (prev && n > prev + 1) block += '      ⋯\n';
        const isMatch = mine.includes(n);
        const line = g.lines[n - 1];
        block += `  ${String(n).padStart(4)}${isMatch ? ':' : '-'} ${g.kind === 'code' ? '' : `[${g.kind}] `}${oneLine(line.length > 400 ? line.slice(0, 400) : line, 190)}\n`;
        prev = n;
      }
      cellShown += mine.length;
    }
    if (!cellShown) continue;
    const chunk = `${cell.path} · ${cellShown} match${cellShown === 1 ? '' : 'es'}${cell.error ? ' · ERROR' : ''}\n${block}`;
    if (text.length + chunk.length > opts.budget - 300 && shown > 0) {
      cut = true;
      break;
    }
    text += chunk;
    shown += cellShown;
  }
  if (total > shown) {
    text += cut
      ? `--- cut here to stay within ${thousands(opts.budget)} characters: ${total - shown} more matches. Narrow it (include="/lab/*", a longer query, whole_word) or raise budget_chars.\n`
      : `--- showing the first ${shown} of ${total} matches. Narrow it (include="/lab/*", a longer query) or raise max_results.\n`;
  }
  return { text: text.trimEnd(), matches: total, shown, cellsHit: byCell.size };
}
