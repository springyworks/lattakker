import { ERR, McpError, type Json, type McpServer } from '../mcp/router';
import { tabManager, TabError, type CreateTabOptions } from '../tabManager';

const TOOLS = [
  { name: 'list', description: 'The tabs, left to right: id, title, icon, whether it is one of the page\'s own (builtin), which one is in front, and how many cells hold code. A tab id is the name of its MCP server and the first part of its cell paths (/plots/A1).', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'create',
    description: 'Make a new tab with a sheet of its own (all the cell abilities). It gets an id from the title ("Plots" gives "plots"). Optionally give starting cells as { "A1": "print(1)" }. The tab is remembered by the browser. Answers with the tab and the path of its first cell.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Up to 24 characters.' },
        id: { type: 'string', description: 'Optional: lowercase letters, digits and "-" (default: made from the title).' },
        icon: { type: 'string', description: 'One emoji, default 📄.' },
        cells: { type: 'object', additionalProperties: { type: 'string' }, description: 'Starting cells: address to TypeScript code.' },
        select: { type: 'boolean', description: 'Bring it to the front (default true).' },
      },
      required: ['title'],
    },
  },
  { name: 'ensure', description: 'Like create, but does nothing when the tab with that id is already there (safe to repeat). Starting cells only go into a tab that is new.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, icon: { type: 'string' }, cells: { type: 'object', additionalProperties: { type: 'string' } }, select: { type: 'boolean' } }, required: ['id'] } },
  { name: 'rename', description: 'Give a tab of your own another title.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] } },
  { name: 'close', description: 'Close a tab of your own and delete its cells. The page\'s own tabs cannot be closed.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'select', description: 'Bring a tab to the front.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function optionsOf(args: Record<string, unknown>): CreateTabOptions {
  const cells: Record<string, string> = {};
  if (args.cells !== undefined) {
    if (!isRecord(args.cells)) throw new McpError(ERR.invalidParams, 'cells must be an object like { "A1": "print(1)" }');
    for (const [address, code] of Object.entries(args.cells)) cells[address] = String(code);
  }
  return {
    icon: typeof args.icon === 'string' ? args.icon : undefined,
    id: typeof args.id === 'string' ? args.id : undefined,
    select: typeof args.select === 'boolean' ? args.select : undefined,
    cells: Object.keys(cells).length ? cells : undefined,
  };
}

/** The MCP server `tabs`: make, rename, close and bring forward the page's tabs. */
export class TabsServer implements McpServer {
  readonly name = 'tabs';
  readonly description = 'The tabs of the page: list them, make a new one with a sheet of its own, rename, close, bring forward.';

  async handle(method: string, params: Record<string, unknown>): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-tabs', title: 'Tabs', version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {});
      default:
        throw new McpError(ERR.methodNotFound, `tabs does not know the method "${method}"`);
    }
  }

  private call(name: string, args: Record<string, unknown>): Json {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const manager = tabManager();
    const id = String(args.id ?? '');
    try {
      switch (name) {
        case 'list':
          return reply({ tabs: manager.list() });
        case 'create': {
          const tab = manager.create(String(args.title ?? ''), optionsOf(args));
          return reply({ tab, firstCell: `/${tab.id}/A1` });
        }
        case 'ensure': {
          const tab = manager.ensure(id, typeof args.title === 'string' ? args.title : undefined, optionsOf(args));
          return reply({ tab, firstCell: `/${tab.id}/A1` });
        }
        case 'rename':
          return reply({ tab: manager.rename(id, String(args.title ?? '')) });
        case 'close':
          return reply({ ...manager.close(id) });
        case 'select':
          return reply({ tab: manager.select(id) });
        default:
          throw new McpError(ERR.methodNotFound, `tabs has no tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`);
      }
    } catch (err) {
      if (err instanceof TabError) return { content: [{ type: 'text', text: err.message }], isError: true };
      throw err;
    }
  }
}
