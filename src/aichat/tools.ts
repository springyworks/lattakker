import { router } from '../mcp/router';
import { workspace } from '../workspace';
import type { ToolDecl } from './providers';

/** The name the helper uses on the in-page MCP router, so its traffic shows up (and can be watched) like any client's. */
export const CLIENT = 'ai-chat';

// Small local models have small memories (Ollama starts with 4096 tokens), so a tool answer stays short.
const MAX_RESULT = 4000;

/** What the person is pointing at when they ask: a tab, and maybe one cell in it. */
export interface AiContext {
  tab: string;
  address: string | null;
}

/** What the tools need from the rest of the app. */
export interface ToolHost {
  context(): AiContext;
  /** Shows the person some code the helper suggests; nothing is written until they say so. */
  suggest(path: string, code: string, note: string): void;
  help(): string;
  state(): unknown;
  boardText(): string;
}

type Args = Record<string, unknown>;

const cellPath = { type: 'string', description: 'A cell path: "A12" (in the tab the person is in), "/lab/J24" (in another tab) or "@c-1a2b" (by identity).' };

export const TOOL_DECLS: ToolDecl[] = [
  {
    name: 'look_around',
    description: 'Where the person is right now: which tab, which cell they are asking from, and that cell (code, output, error). Call this first when the question is about "this cell".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_tabs',
    description: 'The tabs (pages) of the app and how many code cells each has.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_cells',
    description: 'The code cells of one tab: path and the first line of each.',
    parameters: { type: 'object', properties: { tab: { type: 'string', description: 'Tab id such as "board", "lab", "examples". Default: the tab the person is in.' } } },
  },
  {
    name: 'read_cell',
    description: 'One cell in full: its code, what it shows, its output lines and its error if it has one.',
    parameters: { type: 'object', properties: { path: cellPath }, required: ['path'] },
  },
  {
    name: 'game_state',
    description: 'The state of the Lattakker game: phase, whose turn, counts, last move.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'board_text',
    description: 'The Lattakker board as text (Red pieces are known; Blue pieces are hidden).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_guide',
    description: 'The guide to the app: what cells can do (grid, at, on, mcp ...), how paths work. Read it before explaining how the app works or writing code for it.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'flash_cell',
    description: 'Make a cell blink so the person sees which cell you mean.',
    parameters: { type: 'object', properties: { path: cellPath }, required: ['path'] },
  },
  {
    name: 'suggest_code',
    description: 'Offer code for a cell. The person sees it in a card and decides: only if they press the button is it typed into the cell, slowly, where they can watch. Always explain the code in your answer too. Put a comment line above every line of code.',
    parameters: {
      type: 'object',
      properties: { path: cellPath, code: { type: 'string', description: 'The complete TypeScript for the cell.' }, note: { type: 'string', description: 'One short sentence: what this code does.' } },
      required: ['path', 'code'],
    },
  },
];

function limit(text: string): string {
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n… (cut: ${text.length - MAX_RESULT} more characters)` : text;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/** What a router tool answer holds: its structured part, or the message of an error. */
function inner(answer: unknown): { ok: boolean; value: unknown } {
  const a = answer as { structuredContent?: unknown; isError?: boolean; content?: Array<{ text?: string }> };
  if (a?.isError) return { ok: false, value: a.content?.[0]?.text ?? 'the tool failed' };
  return { ok: true, value: a?.structuredContent ?? answer };
}

async function readCell(host: ToolHost, path: string): Promise<unknown> {
  const here = host.context();
  const hit = workspace.resolve(path, here.tab);
  if ('error' in hit) return { error: hit.error };
  const answer = await router.request(CLIENT, hit.tab.id, 'tools/call', { name: 'get_cell', arguments: { address: hit.address } });
  const { ok, value } = inner(answer);
  return ok ? value : { error: value };
}

/** Runs one tool the model asked for. The answer is always text; a problem is reported in it, never thrown at the model. */
export async function runTool(host: ToolHost, name: string, args: Args): Promise<string> {
  try {
    switch (name) {
      case 'look_around': {
        const here = host.context();
        const cell = here.address ? await readCell(host, workspace.pathOf(here.tab, here.address)) : null;
        return limit(asText({ tab: here.tab, cell: here.address ? workspace.pathOf(here.tab, here.address) : null, theCell: cell, tabs: workspace.list().map((t) => ({ id: t.id, title: t.title })) }));
      }
      case 'list_tabs':
        return asText(workspace.list().map((t) => ({ id: t.id, title: t.title, codeCells: t.sheet.codeCells().length })));
      case 'list_cells': {
        const id = typeof args.tab === 'string' && args.tab ? args.tab : host.context().tab;
        if (!workspace.get(id)) return asText({ error: `There is no tab "${id}". Tabs: ${workspace.list().map((t) => t.id).join(', ')}.` });
        const answer = await router.request(CLIENT, id, 'tools/call', { name: 'list_cells', arguments: {} });
        return limit(asText(inner(answer).value));
      }
      case 'read_cell':
        return limit(asText(await readCell(host, String(args.path ?? ''))));
      case 'game_state':
        return limit(asText(host.state()));
      case 'board_text':
        return limit(host.boardText());
      case 'read_guide':
        return limit(host.help());
      case 'flash_cell': {
        const hit = workspace.resolve(String(args.path ?? ''), host.context().tab);
        if ('error' in hit) return asText({ error: hit.error });
        const answer = await router.request(CLIENT, hit.tab.id, 'tools/call', { name: 'flash', arguments: { address: hit.address } });
        return asText(inner(answer).value);
      }
      case 'suggest_code': {
        const hit = workspace.resolve(String(args.path ?? ''), host.context().tab);
        if ('error' in hit) return asText({ error: hit.error });
        if (hit.tab.sheet.isBoardAddress(hit.address)) return asText({ error: `${hit.address} is a board square. Code goes in a lower row such as A12.` });
        if (typeof args.code !== 'string' || !args.code.trim()) return asText({ error: 'code must be the TypeScript text for the cell' });
        host.suggest(workspace.pathOf(hit.tab.id, hit.address), args.code, typeof args.note === 'string' ? args.note : '');
        return asText({ shownToThePerson: true, note: 'The person has to press the button before anything is typed. Explain the code in your answer.' });
      }
      default:
        return asText({ error: `There is no tool "${name}". Tools: ${TOOL_DECLS.map((t) => t.name).join(', ')}.` });
    }
  } catch (err) {
    return asText({ error: err instanceof Error ? err.message : String(err) });
  }
}
