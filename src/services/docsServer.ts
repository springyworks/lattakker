import { ERR, McpError, type Json, type McpServer } from '../mcp/router';
import { askRules, readDocs } from '../aichat/docs';

const TOOLS = [
  {
    name: 'ask_rules',
    description: 'The one counter for the rules: a few words about what you wonder ("editor mistakes", "may I change a cell") give the rule sections that answer it, plus the owner\'s standing directives with their strengths. No query gives all the rules.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A few words about what you wonder.' } } },
  },
  {
    name: 'read_docs',
    description: 'Read the project like a coder: doc "api" (exact names and signatures), "examples" (real example cells), "readme" (by topic) or "rules". query = a few words; path = one example cell whole.',
    inputSchema: {
      type: 'object',
      properties: { doc: { type: 'string', enum: ['api', 'examples', 'readme', 'rules'] }, query: { type: 'string' }, path: { type: 'string' } },
      required: ['doc'],
    },
  },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (t: string): Json => ({ content: [{ type: 'text', text: t }] });

/** The MCP server `docs`: the rules and the project documents, so every party (helper, outside AI, cell code) asks the same counter. */
export class DocsServer implements McpServer {
  readonly name = 'docs';
  readonly description = 'The rules (ask_rules) and the documents of the project (read_docs: api, examples, readme, rules). Read only.';

  async handle(method: string, params: Record<string, unknown>): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-docs', title: 'The rules and documents', version: '1' }, instructions: 'Unsure what you may or must do? Call ask_rules with a few words.' };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call': {
        const args = isRecord(params.arguments) ? params.arguments : {};
        const query = typeof args.query === 'string' ? args.query : '';
        switch (String(params.name ?? '')) {
          case 'ask_rules':
            return text(askRules(query, 6000));
          case 'read_docs':
            if (typeof args.doc !== 'string') return { content: [{ type: 'text', text: 'doc must be api, examples, readme or rules' }], isError: true };
            return text(await readDocs({ doc: args.doc, query: query || undefined, path: typeof args.path === 'string' ? args.path : undefined }, 6000));
          default:
            throw new McpError(ERR.methodNotFound, `docs has no tool "${String(params.name)}"`);
        }
      }
      default:
        throw new McpError(ERR.methodNotFound, `docs does not know the method "${method}"`);
    }
  }
}
