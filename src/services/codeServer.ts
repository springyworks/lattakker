import { ERR, McpError, type Json, type McpServer } from '../mcp/router';
import {
  DEFAULT_BUDGET,
  SearchError,
  approxTokens,
  chooseBudget,
  globTest,
  parseCursor,
  renderDump,
  renderList,
  renderRead,
  renderSearch,
  snapshotOf,
  tabTotals,
  type CodeCell,
} from '../mcp/codeBlob';
import { workspace, parsePath } from '../workspace';

/**
 * The MCP server `code`: all the TypeScript of the page, as text that even a small AI with a small memory can take in.
 * It only reads: nothing here changes a cell (for that there are the tab servers and set_cell_code).
 * The work is in mcp/codeBlob.ts; this file only fetches the cells and answers in MCP.
 *
 * The advice for a small model, which the `overview` tool says too:  overview first, then either dump (follow "NEXT" until "END")
 * or search (like the search of an editor), then read for a closer look at one cell. Tell it your memory with context_tokens.
 */

const BUDGET_PROPS = {
  budget_chars: { type: 'integer', description: `How many characters the reply may have (800 to 40000, default ${DEFAULT_BUDGET}).` },
  budget_tokens: { type: 'integer', description: 'The same in tokens (about 3.5 characters each).' },
  context_tokens: { type: 'integer', description: 'How big your own memory is, in tokens: the reply then takes at most a third of it.' },
};

const TAB_PROP = { type: 'string', description: "Only this tab ('board', 'lab', 'examples', 'monitor' or one of your own). Several: 'board,lab'. Default: all tabs." };

const TOOLS = [
  {
    name: 'overview',
    description: 'START HERE. A short map: how many cells with code, in which tabs, how big (characters and tokens), which cells fail, and which tool to use for what. Small, always safe to call.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dump',
    description:
      'ALL the TypeScript of the page as one plain-text document, delivered in PARTS that fit your memory. Call it without a cursor for part 1; the end of every part tells you the cursor for the next part, until it says END. ' +
      'Tell it how much you can take with context_tokens or budget_chars. A cell is never cut in two unless it alone is bigger than the budget.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'From the end of the previous part. Leave out for part 1.' },
        tab: TAB_PROP,
        with_output: { type: 'boolean', description: 'Add the first lines each cell printed (default false).' },
        line_numbers: { type: 'boolean', description: 'Number the lines of the code (default false).' },
        ...BUDGET_PROPS,
      },
    },
  },
  {
    name: 'search',
    description:
      'Search the code like the search of an editor. query is text (or a regular expression with regex=true); results are grouped by cell with line numbers and a little context. ' +
      'The "file name" of a cell is its path, so include="/lab/*" limits it to the Lab. Search first, then read the cell you want.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        regex: { type: 'boolean', description: 'query is a regular expression (default: plain text).' },
        match_case: { type: 'boolean', description: 'Capital letters must match (default: any case).' },
        whole_word: { type: 'boolean', description: 'Only whole words.' },
        include: { type: 'string', description: "Which cells, by path: '/lab/*', '/board/A*', 'lab', 'J24', several with commas. Default: all." },
        where: { type: 'string', enum: ['code', 'output', 'error', 'all'], description: "Look in the code (default), in what it printed, in its error messages, or all three." },
        context: { type: 'integer', description: 'Lines around each match, 0 to 5 (default 1).' },
        max_results: { type: 'integer', description: 'At most this many matches (default 20, at most 200).' },
        ...BUDGET_PROPS,
      },
      required: ['query'],
    },
  },
  {
    name: 'read',
    description: 'Read ONE cell (or some lines of it) with line numbers. path is like /lab/J24 (or the id c-1a2b3c4d). Long cells come in pieces: the end tells you the from_line for the next.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "'/lab/J24' or 'c-1a2b3c4d'. A bare 'J24' means the board tab." },
        from_line: { type: 'integer', description: 'First line to show (default 1).' },
        lines: { type: 'integer', description: 'How many lines (default 80, at most 400).' },
        ...BUDGET_PROPS,
      },
      required: ['path'],
    },
  },
  {
    name: 'list',
    description: 'One line per cell that has code: number, path, id, size, first line. To choose what to read. Comes in pages: use from to get the next page.',
    inputSchema: { type: 'object', properties: { tab: TAB_PROP, from: { type: 'integer', description: 'Start at this entry (default 0).' }, ...BUDGET_PROPS } },
  },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every cell with code, tab by tab in the order of the tabs, then row by row. */
export function gatherCells(tabs?: string[]): CodeCell[] {
  const out: CodeCell[] = [];
  for (const tab of workspace.list()) {
    if (tabs?.length && !tabs.includes(tab.id)) continue;
    const cells = tab.sheet.codeCells().slice().sort((a, b) => a.row - b.row || a.col - b.col);
    for (const d of cells) {
      out.push({ path: `/${tab.id}/${d.address}`, tab: tab.id, address: d.address, uid: d.uid, code: d.code, output: d.output, error: d.error, cols: d.span.cols, rows: d.span.rows, runs: d.runCount });
    }
  }
  return out;
}

const tabsOf = (args: Record<string, unknown>): string[] | undefined => {
  const t = typeof args.tab === 'string' ? args.tab.trim().toLowerCase() : '';
  return !t || t === 'all' ? undefined : t.split(',').map((x) => x.trim()).filter(Boolean);
};

const asInt = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);

export class CodeServer implements McpServer {
  readonly name = 'code';
  readonly description = 'All the TypeScript of the page as text for an AI with a small memory: overview, dump in parts that fit a budget, search like an editor, read one cell, list. Read only.';

  async handle(method: string, params: Record<string, unknown>): Promise<Json> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'lattakker-code', title: 'The code of the page', version: '1' },
          instructions: 'Call overview first. Then dump (follow NEXT until END) or search, then read. Say how big your memory is with context_tokens.',
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {});
      default:
        throw new McpError(ERR.methodNotFound, `code does not know the method "${method}"`);
    }
  }

  private call(name: string, args: Record<string, unknown>): Json {
    const reply = (text: string, extra: Record<string, unknown> = {}) => ({ content: [{ type: 'text', text }], structuredContent: { chars: text.length, approxTokens: approxTokens(text.length), ...extra } });
    const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
    const tabs = tabsOf(args);
    const budget = chooseBudget(args);
    try {
      switch (name) {
        case 'overview': {
          const cells = gatherCells();
          const totals = tabTotals(cells);
          const chars = cells.reduce((s, c) => s + c.code.length, 0);
          const failing = cells.filter((c) => c.error);
          const text =
            `LATTAKKER CODE: ${cells.length} cells hold TypeScript (${chars.toLocaleString('en-US')} characters, about ${approxTokens(chars).toLocaleString('en-US')} tokens), snapshot ${snapshotOf(cells)}.\n` +
            `Tabs: ${totals.map((t) => `${t.tab} (${t.cells} cells, ${t.chars.toLocaleString('en-US')} chars${t.errors ? `, ${t.errors} failing` : ''})`).join('; ') || 'none yet'}.\n` +
            (failing.length ? `Failing cells: ${failing.slice(0, 8).map((c) => `${c.path} (${c.error!.slice(0, 60)})`).join('; ')}${failing.length > 8 ? '; …' : ''}.\n` : 'No cell is failing.\n') +
            'The tabs board, lab, examples and monitor also hold the examples that come with the page; your own tabs and the cells the child wrote are mixed in the same way. Use tab=… to look at one tab.\n' +
            'WHAT TO DO (this order is safe for a small memory):\n' +
            '  1. code.search {query:"…"}: find the cells that mention something (works like an editor search, shows line numbers).\n' +
            '  2. code.read {path:"/lab/J24"}: read one cell.\n' +
            '  3. code.list: one line per cell, to choose.\n' +
            '  4. code.dump: ALL the code, in parts that fit your memory. Add context_tokens (how big your memory is) and follow the cursor at the end of every part until it says END.\n' +
            'Every reply says how many characters and tokens it has. You decide the size with budget_chars, budget_tokens or context_tokens.';
          return reply(text, { cells: cells.length, tabs: totals, snapshot: snapshotOf(cells), failing: failing.length });
        }
        case 'dump': {
          const cursor = args.cursor === undefined || args.cursor === '' ? null : parseCursor(args.cursor);
          if (args.cursor !== undefined && args.cursor !== '' && !cursor) return fail(`The cursor "${String(args.cursor)}" is not one this tool gave. Cursors look like "3f9a21c0:2:6000". Leave it out to start at part 1.`);
          const cells = gatherCells(tabs);
          const snapshot = snapshotOf(cells);
          if (cursor && cursor.snapshot !== snapshot) return fail(`The code changed since you started (snapshot ${cursor.snapshot}, now ${snapshot}). Start again: call dump without a cursor.`);
          const scope = tabs ? `tab ${tabs.join(', ')}` : '';
          const part = renderDump(cells, { budget: cursor?.budget ?? budget, withOutput: args.with_output === true, lineNumbers: args.line_numbers === true }, cursor?.part ?? 1, scope);
          return reply(part.text, { part: part.part, parts: part.parts, next: part.next, snapshot: part.snapshot });
        }
        case 'search': {
          const cells = gatherCells(tabs);
          const include = typeof args.include === 'string' && args.include.trim() ? globTest(args.include) : () => true;
          const where = ['code', 'output', 'error', 'all'].includes(String(args.where)) ? (String(args.where) as 'code' | 'output' | 'error' | 'all') : 'code';
          const found = renderSearch(cells.filter((c) => include(c.path)), {
            query: typeof args.query === 'string' ? args.query : '',
            regex: args.regex === true,
            matchCase: args.match_case === true,
            wholeWord: args.whole_word === true,
            where,
            context: asInt(args.context, 1),
            maxResults: asInt(args.max_results, 20),
            budget,
          });
          return reply(found.text, { matches: found.matches, shown: found.shown, cellsHit: found.cellsHit });
        }
        case 'read': {
          const path = typeof args.path === 'string' ? args.path.trim() : '';
          if (!path) return fail('path is empty. Give a cell path like /lab/J24 (see code.list).');
          const parts = parsePath(path);
          if ('error' in parts) return fail(parts.error);
          const cell = parts.byUid ? gatherCells().find((c) => c.uid === parts.cell) : gatherCells([parts.tab ?? 'board']).find((c) => c.address === parts.cell);
          if (!cell) return fail(`No cell with code at "${path}". Use code.list to see the paths.`);
          const read = renderRead(cell, asInt(args.from_line, 1), asInt(args.lines, 80), budget);
          return reply(read.text, { path: cell.path, next: read.next });
        }
        case 'list': {
          const cells = gatherCells(tabs);
          const page = renderList(cells, budget, Math.max(0, asInt(args.from, 0)));
          return reply(page.text, { total: page.total, next: page.next });
        }
        default:
          throw new McpError(ERR.methodNotFound, `code has no tool "${name}". Tools: overview, dump, search, read, list`);
      }
    } catch (err) {
      if (err instanceof SearchError) return fail(err.message);
      throw err;
    }
  }
}
