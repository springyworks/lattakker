import { colToLetters, lettersToCol } from '../sheet/address';
import { clickNode } from '../sheet/reactivity';
import { inputPanel } from '../ui/InputPanel';
import { findLines, lastLines, screenAdded, screenRows, trimEnd } from './outputRead';
import { parsePath, workspace, type WorkspaceTab } from '../workspace';
import { ERR, McpError, type Json, type McpRouter, type McpServer, type Trace } from './router';

/**
 * The MCP server of one tab. It offers the tab's code cells as *resources* (a resource is a thing you can
 * read and subscribe to), and a few *tools* (things you can ask it to do). Subscribing is how cross-tab
 * reactivity works over MCP: the subscriber is sent `notifications/resources/updated` whenever the cell
 * changes, and reads it again.
 *
 *   resources/list                       the cells that hold code
 *   resources/read {uri}                 one cell, as JSON
 *   resources/subscribe {uri}            send me notifications/resources/updated when it changes
 *   tools/call get_cell | list_cells     read
 *   tools/call set_code | run_cell       change a cell / run it again
 *   tools/call click                     trigger the cell's click event (wakes its on(cell, 'click') handlers)
 *   tools/call cell_input                type or paste text into the input of a cell that has one (a terminal), and wait for it
 *   tools/call cell_output               the last line a cell has written (or the last n lines, or what is new since a position)
 *   tools/call cell_output_all | _since | _screen | _find     everything / only what is new / the letters on a tile screen / the lines that contain some text
 *   tools/call flash                     make a cell blink
 *   tools/call zoom                      fly the view: to a cell's block, back out, fit to content, or to a scale
 *   tools/call signal                    tell every listener in the page something (a custom event)
 */

const PROTOCOL = '2025-06-18';
const MAX_CODE_CHARS = 20000;
const MAX_INPUT_CHARS = 20000;
const DEFAULT_WAIT_MS = 15000;
const MAX_WAIT_MS = 60000;
const SIGNAL = 'notifications/lattakker/signal';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const address = { type: 'string', description: "A cell address in this tab, like 'J24'" };

const TOOLS: ToolSpec[] = [
  { name: 'list_cells', description: "The cells of this tab that hold code: path, uid and the first line of the code.", inputSchema: { type: 'object', properties: {} } },
  { name: 'get_cell', description: 'One cell: code, shown text, output, error, size.', inputSchema: { type: 'object', properties: { address }, required: ['address'] } },
  { name: 'run_cell', description: "Run a cell's code again.", inputSchema: { type: 'object', properties: { address }, required: ['address'] } },
  {
    name: 'set_code',
    description: "Replace a cell's TypeScript (and run it).",
    inputSchema: { type: 'object', properties: { address, code: { type: 'string' } }, required: ['address', 'code'] },
  },
  {
    name: 'click',
    description: "Trigger a cell's click event, as if it had been clicked: every on(cell, 'click', fn) of that cell wakes up.",
    inputSchema: { type: 'object', properties: { address }, required: ['address'] },
  },
  {
    name: 'insert_column',
    description: 'Insert a blank column next to a column letter, like a spreadsheet: the cells to the right move over and the addresses written in code are rewritten.',
    inputSchema: { type: 'object', properties: { column: { type: 'string', description: "A column letter like 'C'" }, side: { type: 'string', enum: ['left', 'right'], description: "Default 'right'" } }, required: ['column'] },
  },
  {
    name: 'cell_input',
    description:
      "Type or paste text into the input of a cell that has one, like the ASR-33 terminal at /lab/A1 (a cell that called input.onPaste). Every line break in the text counts as Enter, so a pasted program runs line by line; the last line stays typed after the prompt unless enter: true, which sends one more Enter. Waits until the cell has dealt with the text (at most wait_ms, default 15000) and gives back what its output gained meanwhile (added) and its new length, which cell_output can use as since.",
    inputSchema: { type: 'object', properties: { address, text: { type: 'string' }, enter: { type: 'boolean', description: 'Press Enter after the text' }, wait_ms: { type: 'number' } }, required: ['address', 'text'] },
  },
  {
    name: 'cell_output',
    description:
      "The last line a cell has written (text), with its error and length (the number of characters of all its output). With last: the last that many lines. With since: only the text after that many characters, so a second call gives just what is new. A cell that draws a terminal on tiles (like /lab/K1) has no output lines: its screen is read instead (screen: true in the answer). More: cell_output_all, cell_output_since, cell_output_screen, cell_output_find.",
    inputSchema: { type: 'object', properties: { address, last: { type: 'number', description: 'How many lines from the end (default 1)' }, since: { type: 'number' } }, required: ['address'] },
  },
  {
    name: 'cell_output_all',
    description: "All of what a cell has written, lines joined by newlines (a tile terminal: its whole screen, blank lines at the end left out).",
    inputSchema: { type: 'object', properties: { address }, required: ['address'] },
  },
  {
    name: 'cell_output_since',
    description: "Only what is new: the text after position since (a number of characters, the length that cell_input or an earlier call gave). When the output was cleared and is shorter, all of it. A screen scrolls and has no history: for a tile terminal use the added of cell_input.",
    inputSchema: { type: 'object', properties: { address, since: { type: 'number' } }, required: ['address', 'since'] },
  },
  {
    name: 'cell_output_screen',
    description: "The letters on a cell's tile screen (a terminal made with grid() and g.text(..., { snap: true }), like /lab/K1) as rows: rows (every row, from the top) and text (the last non-blank rows, default all of them; last: how many).",
    inputSchema: { type: 'object', properties: { address, last: { type: 'number' } }, required: ['address'] },
  },
  {
    name: 'cell_output_find',
    description: "The lines of a cell's output (or tile screen) that contain some text, each with its line number from 1. Not case sensitive unless case: true. With last: only the last that many matches.",
    inputSchema: { type: 'object', properties: { address, text: { type: 'string' }, case: { type: 'boolean' }, last: { type: 'number' } }, required: ['address', 'text'] },
  },
  { name: 'flash', description: 'Make a cell blink so a person sees which one is meant.', inputSchema: { type: 'object', properties: { address, color: { type: 'string' } }, required: ['address'] } },
  {
    name: 'zoom',
    description: "Move the view of this tab, with a short flight. With an address: zoom in on that cell's block. With out: true, back to where the view was before the last zoom in. With fit: true: zoom to fit the content of the sheet. With scale (the sheet clamps it to its limits, at most 2.5): that zoom around the middle of the window.",
    inputSchema: { type: 'object', properties: { address, out: { type: 'boolean' }, fit: { type: 'boolean' }, scale: { type: 'number' } } },
  },
  {
    name: 'signal',
    description: 'Tell every listener in the page something: a named event with some data. Cells hear it with mcp.on(name, fn).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, data: {} }, required: ['name'] },
  },
];

export class TabServer implements McpServer {
  readonly name: string;
  readonly description: string;
  /** `${client}|${uri}` -> the way to stop sending that client updates. */
  private readonly subscriptions = new Map<string, () => void>();

  constructor(
    private readonly tab: WorkspaceTab,
    private readonly router: McpRouter,
  ) {
    this.name = tab.id;
    this.description = `The cells of the ${tab.id} tab: read, run, click, flash, change their code, watch them.`;
    router.register(this);
  }

  private uri(cell: string): string {
    return `lattakker:///${this.tab.id}/${cell}`;
  }

  /** The cell address inside a resource uri or a path, which must belong to this tab. */
  private cellOf(text: unknown): string {
    if (typeof text !== 'string' || !text.trim()) throw new McpError(ERR.invalidParams, 'a uri or cell address is needed');
    const parts = parsePath(text);
    if ('error' in parts) throw new McpError(ERR.invalidParams, parts.error);
    if (parts.tab && parts.tab !== this.tab.id) throw new McpError(ERR.invalidParams, `${text} belongs to the ${parts.tab} tab, not to ${this.tab.id}`);
    const found = parts.byUid ? this.tab.sheet.addressOfUid(parts.cell) : this.tab.sheet.resolve(parts.cell);
    if (!found) throw new McpError(ERR.invalidParams, `${text} is not a cell of the ${this.tab.id} tab`);
    return found;
  }

  private cell(addr: string): Record<string, unknown> {
    const sheet = this.tab.sheet;
    const d = sheet.dataAt(addr)!;
    return {
      tab: this.tab.id,
      address: addr,
      path: workspace.pathOf(this.tab.id, addr),
      uri: this.uri(addr),
      uid: d.uid || null,
      code: d.code,
      text: sheet.displayText(d),
      output: d.output,
      error: d.error,
      cols: d.span.cols,
      rows: d.span.rows,
      tiles: d.tiles ? { cols: d.tiles.cols, rows: d.tiles.rows, painted: d.tiles.fills.filter(Boolean).length } : null,
      runs: d.runCount,
    };
  }

  async handle(method: string, params: Record<string, unknown>, from: string, trace?: Trace): Promise<Json> {
    const sheet = this.tab.sheet;
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: PROTOCOL,
          capabilities: { resources: { subscribe: true, listChanged: false }, tools: {} },
          serverInfo: { name: `lattakker-${this.tab.id}`, title: this.tab.title, version: '1' },
        };
      case 'ping':
        return {};
      case 'resources/list':
        return {
          resources: sheet.codeCells().map((d) => ({
            uri: this.uri(d.address),
            name: d.address,
            title: workspace.pathOf(this.tab.id, d.address),
            description: d.code.split('\n').find((l) => l.trim())?.replace(/^\s*\/\/\s*/, '').slice(0, 90) ?? '',
            mimeType: 'application/json',
          })),
        };
      case 'resources/read': {
        const addr = this.cellOf(params.uri);
        return { contents: [{ uri: this.uri(addr), mimeType: 'application/json', text: JSON.stringify(this.cell(addr)) }] };
      }
      case 'resources/subscribe': {
        const addr = this.cellOf(params.uri);
        const uri = this.uri(addr);
        const key = `${from}|${uri}`;
        if (!this.subscriptions.has(key)) {
          const stop = sheet.subscribe([addr], () => this.router.notify(this.name, from, 'notifications/resources/updated', { uri }));
          this.subscriptions.set(key, stop);
        }
        return {};
      }
      case 'resources/unsubscribe': {
        const uri = this.uri(this.cellOf(params.uri));
        const key = `${from}|${uri}`;
        this.subscriptions.get(key)?.();
        this.subscriptions.delete(key);
        return {};
      }
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.callTool(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {}, from, trace);
      default:
        throw new McpError(ERR.methodNotFound, `${this.name} does not know the method "${method}"`);
    }
  }

  /** What a cell shows as text: its output lines, or (a terminal drawn on tiles, which prints nothing) the rows of its screen. */
  private readOf(addr: string): { lines: string[]; text: string; screen: boolean } {
    const d = this.tab.sheet.dataAt(addr);
    const out = d?.output ?? [];
    if (!out.length && d?.tiles) {
      const rows = screenRows(d.tiles);
      if (trimEnd(rows).length) return { lines: rows, text: trimEnd(rows).join('\n'), screen: true };
    }
    const text = out.join('\n');
    return { lines: text ? text.split('\n') : [], text, screen: false };
  }

  private async callTool(name: string, args: Record<string, unknown>, from: string, trace?: Trace): Promise<Json> {
    const sheet = this.tab.sheet;
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const failure = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
    try {
      switch (name) {
        case 'list_cells':
          return reply({
            cells: sheet.codeCells().map((d) => ({ path: workspace.pathOf(this.tab.id, d.address), uid: d.uid, first: d.code.split('\n').find((l) => l.trim())?.slice(0, 80) ?? '' })),
          });
        case 'get_cell':
          return reply(this.cell(this.cellOf(args.address)));
        case 'run_cell': {
          const addr = this.cellOf(args.address);
          sheet.markDirty([addr]);
          sheet.requestRun();
          return reply({ path: workspace.pathOf(this.tab.id, addr), started: true });
        }
        case 'set_code': {
          const addr = this.cellOf(args.address);
          if (typeof args.code !== 'string' || args.code.length > MAX_CODE_CHARS) return failure(`code must be text of at most ${MAX_CODE_CHARS} characters`);
          if (sheet.isBoardAddress(addr)) return failure(`${addr} is a board square, not a code cell`);
          const before = sheet.dataAt(addr)?.code ?? '';
          sheet.setCode(addr, args.code);
          // Written down for whoever asks later who changed this cell (router tool 'history'), with the old code so it can be put back.
          this.router.noteChange(trace, { subject: `${this.tab.id}/${addr}`, action: 'set_code', before, after: args.code });
          return reply({ path: workspace.pathOf(this.tab.id, addr), written: args.code.length });
        }
        case 'cell_input': {
          const addr = this.cellOf(args.address);
          if (typeof args.text !== 'string' || args.text.length > MAX_INPUT_CHARS) return failure(`text must be text of at most ${MAX_INPUT_CHARS} characters`);
          if (!inputPanel.hasPaste(sheet.id, addr)) return failure(`${addr} has no input: only a cell that called input.onPaste(fn) takes typed text (the terminal at /lab/A1 does)`);
          const waitMs = typeof args.wait_ms === 'number' && args.wait_ms >= 0 ? Math.min(args.wait_ms, MAX_WAIT_MS) : DEFAULT_WAIT_MS;
          const before = this.readOf(addr);
          let timer = 0;
          const settled = await Promise.race([
            inputPanel.pasteTo(sheet.id, addr, args.text + (args.enter === true ? '\n' : '')).then(() => true),
            new Promise<boolean>((resolve) => {
              timer = window.setTimeout(() => resolve(false), waitMs);
            }),
          ]);
          window.clearTimeout(timer);
          const after = this.readOf(addr);
          const added = before.screen || after.screen ? screenAdded(before.lines, after.lines).join('\n') : after.text.startsWith(before.text) ? after.text.slice(before.text.length) : after.text;
          this.router.noteChange(trace, { subject: `${this.tab.id}/${addr}`, action: 'cell_input', before: '', after: args.text.slice(0, 200) });
          return reply({ path: workspace.pathOf(this.tab.id, addr), delivered: true, settled, length: after.text.length, added, screen: after.screen, error: sheet.dataAt(addr)?.error ?? null });
        }
        case 'cell_output':
        case 'cell_output_all':
        case 'cell_output_since':
        case 'cell_output_screen':
        case 'cell_output_find': {
          const addr = this.cellOf(args.address);
          const read = this.readOf(addr);
          const count = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? Math.floor(v) : null);
          const answer = (extra: Record<string, unknown>) =>
            reply({ path: workspace.pathOf(this.tab.id, addr), ...extra, length: read.text.length, screen: read.screen, error: sheet.dataAt(addr)?.error ?? null, input: inputPanel.hasPaste(sheet.id, addr) });
          const since = (): number | null => (typeof args.since === 'number' && args.since >= 0 ? Math.floor(args.since) : null);
          const after = (from: number): string => (from <= read.text.length ? read.text.slice(from) : read.text);
          if (name === 'cell_output_all') return answer({ text: read.text });
          if (name === 'cell_output_since') {
            const from = since();
            return from === null ? failure('cell_output_since needs since: a number of characters (the length an earlier call gave)') : answer({ text: after(from) });
          }
          if (name === 'cell_output_screen') {
            const tiles = sheet.dataAt(addr)?.tiles;
            if (!tiles) return failure(`${addr} has no tile screen: only a cell that called grid(cols, rows) has one. For other cells use cell_output.`);
            const rows = screenRows(tiles);
            const last = count(args.last);
            return answer({ text: (last ? lastLines(rows, last) : trimEnd(rows)).join('\n'), rows, cols: tiles.cols });
          }
          if (name === 'cell_output_find') {
            if (typeof args.text !== 'string' || !args.text) return failure('cell_output_find needs text: what the lines must contain');
            const found = findLines(read.lines, args.text, args.case !== true);
            const last = count(args.last);
            const matches = last ? found.slice(-last) : found;
            return answer({ text: matches.map((m) => m.text).join('\n'), matches, count: found.length });
          }
          const from = since();
          if (from !== null) return answer({ text: after(from) });
          return answer({ text: lastLines(read.lines, count(args.last) ?? 1).join('\n') });
        }
        case 'click': {
          const addr = this.cellOf(args.address);
          sheet.pulse(clickNode(addr));
          sheet.flash(addr, '#f2e4bd', 500);
          return reply({ path: workspace.pathOf(this.tab.id, addr), clicked: true, by: from });
        }
        case 'insert_column': {
          if (typeof args.column !== 'string' || !/^[a-z]{1,2}$/i.test(args.column.trim())) return failure("column must be a letter like 'C'");
          const col = lettersToCol(args.column.trim());
          if (col >= sheet.colCount) return failure(`${args.column.toUpperCase()} is beyond the last column (${colToLetters(sheet.colCount - 1)})`);
          const after = args.side === 'left' ? col - 1 : col;
          const why = sheet.columnInsertProblem(after);
          if (why) return failure(why);
          sheet.insertColumn(after);
          sheet.highlightColumn(after + 1);
          this.router.noteChange(trace, { subject: `${this.tab.id}/columns`, action: 'insert_column', before: `${sheet.colCount - 1} columns`, after: `${sheet.colCount} columns, new ${colToLetters(after + 1)}` });
          return reply({ tab: this.tab.id, inserted: colToLetters(after + 1), columns: sheet.colCount });
        }
        case 'flash': {
          const addr = this.cellOf(args.address);
          sheet.flash(addr, typeof args.color === 'string' ? args.color : undefined, 700);
          return reply({ path: workspace.pathOf(this.tab.id, addr), flashed: true });
        }
        case 'zoom': {
          if (typeof args.address === 'string') {
            const addr = this.cellOf(args.address);
            void sheet.zoomInOn(addr);
          } else if (args.out === true) void sheet.zoomOut();
          else if (args.fit === true) void sheet.fitToView(null);
          else if (typeof args.scale === 'number' && args.scale > 0) {
            const r = sheet.container.getBoundingClientRect();
            sheet.zoomAround(args.scale / sheet.viewState().scale, r.left + r.width / 2, r.top + r.height / 2);
          } else return failure('zoom needs an address, out: true, fit: true or a scale');
          return reply({ tab: this.tab.id, flying: true });
        }
        case 'signal': {
          if (typeof args.name !== 'string' || !args.name || args.name.length > 60) return failure('a signal needs a short name');
          this.router.broadcast(from, SIGNAL, { name: args.name, data: args.data ?? null, from });
          return reply({ signalled: args.name });
        }
        default:
          throw new McpError(ERR.methodNotFound, `${this.name} has no tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`);
      }
    } catch (err) {
      if (err instanceof McpError && err.code === ERR.invalidParams) return failure(err.message);
      throw err;
    }
  }
}

export { SIGNAL };
