import { colToLetters, lettersToCol } from '../sheet/address';
import { clickNode } from '../sheet/reactivity';
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
 *   tools/call flash                     make a cell blink
 *   tools/call zoom                      fly the view: to a cell's block, back out, fit to content, or to a scale
 *   tools/call signal                    tell every listener in the page something (a custom event)
 */

const PROTOCOL = '2025-06-18';
const MAX_CODE_CHARS = 20000;
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

  private callTool(name: string, args: Record<string, unknown>, from: string, trace?: Trace): Json {
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
