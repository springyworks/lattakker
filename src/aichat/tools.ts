import { router, type Trace } from '../mcp/router';
import { isOriented, markOriented, orientation } from '../ai/orientation';

/** The message the running chat turn is answering: what the tools ask the router is marked as caused by it (see mcp/router.ts, Trace). */
/** The built-in helper, as a participant that has to read the README once (see ai/orientation.ts). */
const HELPER = 'helper';
let turnTrace: Trace | undefined;
export const setTurnTrace = (t: Trace | undefined): void => {
  turnTrace = t;
};
import { nav } from '../nav';
import { workspace } from '../workspace';
import { resolveSmart } from './cellPaths';
import { ammo } from './ammo';
import { RULES, readDocs } from './docs';
import { getSettings } from './config';
import type { ToolDecl } from './providers';

/** The name the helper uses on the in-page MCP router, so its traffic shows up (and can be watched) like any client's. */
export const CLIENT = 'ai-chat';

// Small local models have small memories (Ollama starts with 4096 tokens), so a tool answer stays short.
const MAX_RESULT = 4000;

/** What the person is pointing at when they ask: a tab, and maybe one cell in it. */
export interface AiContext {
  tab: string;
  address: string | null;
  /** The line (1-based) of the cell's code the question was written on or the cursor is on. */
  line?: number | null;
  /** Text the person had selected in the editor. */
  selection?: string;
}

/** What a cell did when it ran: what it printed, or why it failed. */
export interface RunReport {
  ok: boolean;
  error?: string;
  output?: string;
  text?: string;
  uid?: string | null;
}

/** What the helper wrote by itself in this conversation: how many times, and which cells (by identity) it may still rewrite. */
export class WriteLedger {
  count = 0;
  readonly uids = new Set<string>();
  reset(): void {
    this.count = 0;
    this.uids.clear();
  }
}

/** Most times the helper may write code by itself in one conversation. */
export const MAX_WRITES = 6;
const MAX_WRITE_CHARS = 8000;
/** Size of the empty spot the helper gets for code it writes: wide and tall enough to show a picture or a few lines. */
const FREE_COLS = 6;
const FREE_ROWS = 4;
/** The board's own rows end at row 10; the first row that is free to use is row 12. */
const BOARD_FIRST_FREE_ROW = 11;

/** What the tools need from the rest of the app. */
export interface ToolHost {
  context(): AiContext;
  /** Shows the person some code the helper suggests; nothing is written until they say so. */
  suggest(path: string, code: string, note: string, afterLine: number | null): void;
  /** Runs a cell again and waits until it has finished (or a time limit). */
  run(path: string): Promise<RunReport>;
  /** Types code into a cell where the person can watch, keeps it and runs it. */
  write(path: string, code: string): Promise<RunReport>;
  /** Tells the chat that the helper wrote code on its own, so the person gets a card with an undo button. */
  wrote(path: string, code: string, report: RunReport): void;
  readonly ledger: WriteLedger;
  /** The text in the open editor of that cell (saved or not), or null when no editor is open on it. */
  liveText(tab: string, address: string): string | null;
  help(): string;
  state(): unknown;
  boardText(): string;
}

type Args = Record<string, unknown>;

const cellPath = { type: 'string', description: 'A cell path: "A12" (in the tab the person is in), "/lab/J24" (in another tab) or "@c-1a2b" (by identity).' };

export const TOOL_DECLS: ToolDecl[] = [
  {
    name: 'look_around',
    description: 'Where the person is right now: which tab, which cell and which line of its code they are asking from, and that cell (code with line numbers, output, error). Call this first when the question is about "this cell" or "here".',
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
    description: 'A short overview of the CODE a cell can contain, with the cell rules. For exact names, signatures and working examples use read_docs instead. (This is not the window.mms API: that is only for outside AIs.)',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_docs',
    description:
      'Read the project like a coder: doc "api" = the exact names and signatures of everything a cell can use (print, plot, grid, at, on, every, game, input ...); doc "examples" = the real example cells the children start with, with comments; doc "readme" = the README by topic; doc "rules" = the rules for helpers. Give "query" (a few words, e.g. "grid click" or "timer every") to get the best matches; "path" (e.g. /lab/A16) to get one example cell whole; with neither you get an outline. Before writing code: look up the names in "api", find a similar cell in "examples", follow its style.',
    parameters: {
      type: 'object',
      properties: {
        doc: { type: 'string', enum: ['api', 'examples', 'readme', 'rules'] },
        query: { type: 'string', description: 'A few words about what you look for.' },
        path: { type: 'string', description: 'For doc "examples": one cell, e.g. /lab/A16 or /board/A12.' },
      },
      required: ['doc'],
    },
  },
  {
    name: 'recall',
    description: 'Look in your memory (notes kept in this browser, they survive a reload) for what you learned earlier about this person, their project or the app. Do this before answering questions about "last time", their goals or their preferences.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Some words or the question.' } }, required: ['query'] },
  },
  {
    name: 'remember',
    description: 'Keep a short note in your memory: something useful and lasting (what they are building, what is hard for them, a lesson that worked). Never personal information (names, e-mail, address, school). A note with the same title is replaced.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, tags: { type: 'string', description: 'A few words separated by commas.' } }, required: ['title', 'text'] },
  },
  {
    name: 'tidy_memory',
    description: 'Admin of your memory. action "duplicates": pairs of notes that say nearly the same; "update": change a note (id, title, text); "forget": delete a note (id). Merge a pair by updating one and forgetting the other.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['duplicates', 'update', 'forget', 'stats'] }, id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
      required: ['action'],
    },
  },
  {
    name: 'discover',
    description: 'What this app can do over MCP, in one answer: every server (tabs, router, memory, status, weather, ollama, local-ai, helper), what it is for and the names of its tools, plus what the router has counted so far. Call it when you are not sure what is possible, then use mcp_call (tools/list shows the details of one server).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'mcp_call',
    description:
      'Talk MCP to the app directly, like any MCP client. Every tab is an MCP server (its id is the server name: "board", "lab", "examples", "monitor", and tabs the person made), and so are "router" (statistics, catalog, recent traffic), "memory" (notes and the little database), "weather" (tools now, forecast, find), "ollama" (the model on this computer: status, models, ask), "system" (CPU, memory, temperatures, graphics card: read, history), "tabs" (list, select; create, rename, close need write permission), "local-ai" (the second brain, if there is one) and "status" (what is going on right now). Methods: "resources/list" (the cells), "resources/read" with {"uri":"lattakker:///board/A12"}, "tools/list", "tools/call" with {"name":"get_cell"|"list_cells"|"run_cell"|"click"|"flash"|"signal","arguments":{...}}. Changing a cell\'s code is not allowed here: use suggest_code, so the person decides.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'The tab id, e.g. "board" or "lab".' },
        method: { type: 'string', description: 'resources/list, resources/read, tools/list or tools/call' },
        params_json: { type: 'string', description: 'The params as JSON text, e.g. {"name":"get_cell","arguments":{"address":"A12"}}. Empty when the method needs none.' },
      },
      required: ['server', 'method'],
    },
  },
  {
    name: 'flash_cell',
    description: 'Make a cell blink so the person sees which cell you mean.',
    parameters: { type: 'object', properties: { path: cellPath }, required: ['path'] },
  },
  {
    name: 'goto_cell',
    description: 'Take the person to a cell: opens its tab, scrolls and zooms to it, and makes it blink. Use it when they say "go to", "show me", "take me to" or "focus on" a cell.',
    parameters: { type: 'object', properties: { path: cellPath }, required: ['path'] },
  },
  {
    name: 'run_cell',
    description: 'Run a cell again and wait for it to finish. The answer says what it printed, or the error it ended with. Use it to test code or to see what a cell does now.',
    parameters: { type: 'object', properties: { path: cellPath }, required: ['path'] },
  },
  {
    name: 'find_free_cell',
    description: `Find an empty spot (${FREE_COLS} columns wide, ${FREE_ROWS} rows tall) where new code can go without touching anybody's work. Answers with the cell path.`,
    parameters: { type: 'object', properties: { tab: { type: 'string', description: 'Tab id: "board" or "lab". Default: the tab the person is in.' } } },
  },
  {
    name: 'write_code',
    description:
      'Write code into an EMPTY cell yourself and run it, so the person can watch it being typed. Without a path it picks an empty spot (find_free_cell). You may only use a cell that is empty or that you wrote earlier; for any other cell use suggest_code. The answer tells what the cell printed or its error: fix the error with write_code on the same path. Start the code with span(6, 4) so it has room.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'An empty cell, or one you wrote earlier. Leave it out to get an empty spot.' },
        code: { type: 'string', description: 'The complete TypeScript for the cell (a top-level script, see read_guide).' },
        note: { type: 'string', description: 'One short sentence: what this code does.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'suggest_code',
    description: 'Offer code for a cell. The person sees it in a card and decides: only if they press the button is it typed into the cell, slowly, where they can watch. Always explain the code in your answer too. Put a comment line above every line of code.',
    parameters: {
      type: 'object',
      properties: {
        path: cellPath,
        code: { type: 'string', description: 'The TypeScript to offer. Without after_line it replaces the whole cell, so it must be the complete code.' },
        after_line: { type: 'integer', description: 'Give a line number of the cell (as numbered by look_around / read_cell) to insert the code as new lines right below that line instead of replacing the cell. Use it when the person asked "here".' },
        note: { type: 'string', description: 'One short sentence: what this code does.' },
      },
      required: ['path', 'code'],
    },
  },
];

/** What a small model is offered: the tools for looking, going there, trying and suggesting. More tools make small models fumble. */
const SMALL_MODEL_TOOLS = new Set(['look_around', 'list_cells', 'read_cell', 'goto_cell', 'flash_cell', 'run_cell', 'find_free_cell', 'write_code', 'suggest_code', 'read_docs']);

/** The shortest list that still lets a model look, go there, try and suggest: for a model whose memory is tiny. */
const TIGHT_TOOLS = new Set(['look_around', 'read_cell', 'goto_cell', 'run_cell', 'write_code', 'suggest_code']);

/** The tools for one question: all of them, or the short list for a small model (the shortest when memory is tiny); write_code only when the person allowed it. */
export function toolsFor(options: { small: boolean; second: boolean; tight?: boolean }): ToolDecl[] {
  const all = options.second ? [...TOOL_DECLS, ...LOCAL_DECLS] : TOOL_DECLS;
  return all.filter((t) => (t.name !== 'write_code' || getSettings().allowWrite) && (!options.small || SMALL_MODEL_TOOLS.has(t.name)) && (!options.tight || TIGHT_TOOLS.has(t.name)));
}

/** The little database, for the local librarian. */
export const DB_DECLS: ToolDecl[] = [
  { name: 'db_put', description: 'Store a small JSON record in a named collection (lowercase name). With an id it replaces that record.', parameters: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' }, data_json: { type: 'string', description: 'The record as JSON text for an object.' } }, required: ['collection', 'data_json'] } },
  { name: 'db_get', description: 'Read one record.', parameters: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' } }, required: ['collection', 'id'] } },
  { name: 'db_query', description: 'Find records in a collection: fields equal to where_json and/or JSON containing some text.', parameters: { type: 'object', properties: { collection: { type: 'string' }, where_json: { type: 'string' }, contains: { type: 'string' } }, required: ['collection'] } },
  { name: 'db_delete', description: 'Delete one record.', parameters: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' } }, required: ['collection', 'id'] } },
  { name: 'db_collections', description: 'The collections, how many records each holds, and an example.', parameters: { type: 'object', properties: {} } },
];

/** What the local librarian may use to store and tidy. */
export const LIBRARIAN_TOOLS = new Set(['recall', 'remember', 'tidy_memory', 'read_cell', 'list_cells', ...DB_DECLS.map((t) => t.name)]);

/** Offered to the main helper when a second, local model is there. */
export const LOCAL_DECLS: ToolDecl[] = [
  {
    name: 'consult_local',
    description: 'Ask the small local model on this computer (the second brain, which keeps the memory and the database) a question: a lookup, a summary, a draft, a second opinion. It is private and free but not as clever as you.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'teach_local',
    description: 'Hand the local model knowledge to keep: facts, a lesson, a list. It decides whether it becomes notes or database records, and avoids duplicates. Use it so lasting knowledge is stored on this computer instead of staying in this chat. Tell it what to keep, in your own words.',
    parameters: { type: 'object', properties: { material: { type: 'string' }, how: { type: 'string', description: 'Optional wishes, e.g. "as a table of words learned".' } }, required: ['material'] },
  },
  {
    name: 'manage_local',
    description: 'Database administration done by the local model: "merge duplicate notes", "list the collections", "forget everything about X", "how much is stored?".',
    parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
  },
];

function limit(text: string, max = MAX_RESULT): string {
  // A tool answer may take only a part of the model's memory: less when the window is small.
  const cap = ammo.resultChars(max);
  return text.length > cap ? `${text.slice(0, cap)}\n… (cut: ${text.length - cap} more characters)` : text;
}

const CELL_RULES = `Rules of cell code (read these first):\n${RULES.cell}\n`;

/** The cell API guide: the "Cell code API" part of /llms.txt (which is served with the page), with the rules in front. */
async function cellGuide(): Promise<string> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}llms.txt`);
    const text = await res.text();
    const start = text.indexOf('## Cell code API');
    const end = text.indexOf('## Game rules');
    if (start >= 0) return `${CELL_RULES}\n${text.slice(start, end > start ? end : undefined)}`;
  } catch {
    // offline copy missing: the short rules and the window.mms guide still help
  }
  return CELL_RULES;
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
  const hit = resolveSmart(path, here.tab);
  if ('error' in hit) return { error: hit.error };
  const answer = await router.request(CLIENT, hit.tab.id, 'tools/call', { name: 'get_cell', arguments: { address: hit.address } }, turnTrace);
  const { ok, value } = inner(answer);
  if (!ok) return { error: value };
  // What is in the open editor is newer than what is saved (the person may still be typing), and line numbers make "here" exact.
  const cell = value as { code?: string };
  const live = host.liveText(hit.tab.id, hit.address);
  const code = live ?? cell.code ?? '';
  return { ...cell, code: undefined, note: hit.note, codeWithLineNumbers: code.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'), editorOpenWithUnsavedText: live !== null && live !== cell.code };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Small models often send code with its line breaks written as the two characters \n (everything then lands on
 * one line), or wrapped in a markdown fence. Both are repaired here so the code means what the model meant.
 */
export function cleanCode(raw: string): string {
  let code = raw;
  const fenced = /^\s*```[\w-]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(code);
  if (fenced) code = fenced[1];
  // All on one line with a backslash-n between statements: the model meant line breaks. Inside a string literal a \n stays.
  if (!code.trim().includes('\n') && code.includes('\\n')) {
    let out = '';
    let quote = '';
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        out += ch;
        if (ch === '\\' && i + 1 < code.length) out += code[++i];
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        out += ch;
      } else if (ch === '\\' && code[i + 1] === 'n') {
        out += '\n';
        i++;
      } else if (ch === '\\' && code[i + 1] === 't') {
        out += '  ';
        i++;
      } else out += ch;
    }
    code = out;
  }
  return code;
}

/** What a run left behind, in a few lines the model can use. */
function reportText(path: string, report: RunReport): Record<string, unknown> {
  const cut = (s: string | undefined, n: number): string | undefined => (s && s.length > n ? `${s.slice(0, n)}… (cut)` : s);
  return report.ok
    ? { path, ran: true, printed: cut(report.output, 1200) || null, shows: cut(report.text, 400) || null }
    : { path, ran: false, error: report.error ?? 'it did not finish', printed: cut(report.output, 600) || null };
}

/** The tab for new code: the one the person is in when it can hold code of its own, else the lab. */
function tabForNewCode(host: ToolHost, asked: unknown): string {
  const wanted = typeof asked === 'string' ? asked.trim().replace(/^\//, '') : '';
  const id = wanted || host.context().tab;
  return id === 'board' || id === 'lab' ? id : 'lab';
}

function freeSpot(tabId: string): { path: string } | { error: string } {
  const tab = workspace.get(tabId);
  if (!tab) return { error: `There is no tab "${tabId}". Use "board" or "lab".` };
  const address = tab.sheet.findFreeBlock(FREE_COLS, FREE_ROWS, tabId === 'board' ? BOARD_FIRST_FREE_ROW : 0);
  return address ? { path: workspace.pathOf(tabId, address) } : { error: `The ${tabId} tab has no empty ${FREE_COLS}x${FREE_ROWS} spot left. Try the other tab.` };
}

async function writeCode(host: ToolHost, args: Args): Promise<string> {
  if (!getSettings().allowWrite) {
    return asText({ error: 'The person has not allowed you to write code yourself. Offer the code with suggest_code, and say that a grown-up can switch on "Let the helper write code in empty cells" in the settings (⚙).' });
  }
  const code = typeof args.code === 'string' ? cleanCode(args.code) : '';
  if (!code.trim()) return asText({ error: 'code must be the TypeScript text for the cell' });
  if (code.length > MAX_WRITE_CHARS) return asText({ error: `The code is too long (${code.length} characters, at most ${MAX_WRITE_CHARS}). Write something shorter.` });
  if (host.ledger.count >= MAX_WRITES) return asText({ error: `You have already written code ${MAX_WRITES} times in this conversation. Offer further code with suggest_code.` });

  let path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    const spot = freeSpot(tabForNewCode(host, args.tab));
    if ('error' in spot) return asText(spot);
    path = spot.path;
  }
  const hit = workspace.resolve(path, host.context().tab);
  if ('error' in hit) return asText({ error: hit.error });
  const { tab, address } = hit;
  if (tab.sheet.isBoardAddress(address)) return asText({ error: `${address} is a board square. Code goes in a lower row such as A12.` });
  if (tab.id !== 'board' && tab.id !== 'lab') return asText({ error: `You may only write in the board and lab tabs, not in ${tab.id}.` });
  const data = tab.sheet.dataAt(address)!;
  const own = !!data.uid && host.ledger.uids.has(data.uid);
  if (data.code.trim() && !own) return asText({ error: `${workspace.pathOf(tab.id, address)} already has someone else's code. Use find_free_cell for an empty one, or suggest_code to propose a change.` });

  const full = workspace.pathOf(tab.id, address);
  host.ledger.count++;
  const typed = await host.write(full, code);
  const uid = typed.uid ?? tab.sheet.dataAt(address)?.uid ?? null;
  if (uid) host.ledger.uids.add(uid);
  host.wrote(full, code, typed);
  const failedLine = !typed.ok ? Number(/line (\d+)/i.exec(typed.error ?? '')?.[1]) : NaN;
  return asText({
    ...reportText(full, typed),
    errorLineText: Number.isInteger(failedLine) ? (code.split('\n')[failedLine - 1] ?? null) : undefined,
    wroteLines: code.split('\n').length,
    writesLeft: MAX_WRITES - host.ledger.count,
    next: !typed.ok
      ? `Fix the error and call write_code again with the same path. This is TypeScript (not Python): write real line breaks, never the two characters \\n, and call plot/print the way read_guide shows.${/Invalid character/i.test(typed.error ?? '') ? ' "Invalid character" usually means a stray backslash or non-TypeScript syntax.' : ''}`
      : !typed.output?.trim() && !typed.text?.trim()
        ? 'It ran but printed and showed nothing. If the person expects to see something, check that the code calls print(...) and fix it with write_code on the same path.'
        : 'It works. Tell the person what you made and what it does, in simple words.',
  });
}

/** Tools that read the page directly instead of asking an MCP server: the router would never see them, so they are announced to it. */
const DIRECT_TOOLS = new Set(['look_around', 'list_tabs', 'read_cell', 'game_state', 'board_text', 'read_guide', 'read_docs', 'run_cell', 'find_free_cell', 'write_code', 'suggest_code']);

function announceDirect(host: ToolHost, name: string, args: Args, client: string): void {
  if (!DIRECT_TOOLS.has(name)) return;
  const guide = name === 'read_guide' || name === 'read_docs';
  const path = typeof args.path === 'string' ? args.path : '';
  const hit = path && !guide ? workspace.resolve(path, host.context().tab) : null;
  const tab = hit && !('error' in hit) ? hit.tab.id : host.context().tab;
  router.notify(client, guide ? 'cells' : tab, `tools/${name}`, args, turnTrace);
}

/** Runs one tool the model asked for. The answer is always text; a problem is reported in it, never thrown at the model. */
export async function runTool(host: ToolHost, name: string, args: Args, client: string = CLIENT): Promise<string> {
  try {
    // First contact: the helper reads the README (the place of truth, on GitHub) before its first tool does anything.
    const readsReadme = name === 'read_docs' && (args.doc === 'readme' || args.doc === 'rules');
    if (!isOriented(HELPER) && !readsReadme) {
      return asText({ ...orientation('helper', name), how: 'Call read_docs with doc "readme" now (no query gives the list of its headings; a few words as query give the parts that answer them). Then repeat your call.' });
    }
    announceDirect(host, name, args, client);
    switch (name) {
      case 'look_around': {
        const here = host.context();
        const cell = here.address ? await readCell(host, workspace.pathOf(here.tab, here.address)) : null;
        return limit(asText({ tab: here.tab, cell: here.address ? workspace.pathOf(here.tab, here.address) : null, line: here.line ?? null, theCell: cell, tabs: workspace.list().map((t) => ({ id: t.id, title: t.title })) }));
      }
      case 'list_tabs':
        return asText(workspace.list().map((t) => ({ id: t.id, title: t.title, codeCells: t.sheet.codeCells().length })));
      case 'list_cells': {
        const id = typeof args.tab === 'string' && args.tab ? args.tab : host.context().tab;
        if (!workspace.get(id)) return asText({ error: `There is no tab "${id}". Tabs: ${workspace.list().map((t) => t.id).join(', ')}.` });
        const answer = await router.request(CLIENT, id, 'tools/call', { name: 'list_cells', arguments: {} }, turnTrace);
        return limit(asText(inner(answer).value));
      }
      case 'read_cell':
        return limit(asText(await readCell(host, String(args.path ?? ''))));
      case 'game_state':
        return limit(asText(host.state()));
      case 'board_text':
        return limit(host.boardText());
      case 'read_guide':
        return limit(await cellGuide(), 9500);
      case 'read_docs': {
        if (typeof args.doc !== 'string') return asText({ error: 'doc must be api, examples, readme or rules' });
        const text = await readDocs({ doc: args.doc, query: typeof args.query === 'string' ? args.query : undefined, path: typeof args.path === 'string' ? args.path : undefined }, ammo.resultChars(6000));
        if (args.doc === 'readme' && !text.startsWith('{"error"')) markOriented(HELPER);
        return text;
      }
      case 'recall':
      case 'remember':
      case 'tidy_memory': {
        let tool: string = name;
        let a: Args = args;
        if (name === 'remember') a = { ...args, tags: typeof args.tags === 'string' ? args.tags.split(',') : args.tags };
        if (name === 'tidy_memory') {
          const action = String(args.action ?? '');
          tool = { duplicates: 'find_duplicates', update: 'update_note', forget: 'forget', stats: 'stats' }[action] ?? '';
          if (!tool) return asText({ error: 'action must be duplicates, update, forget or stats' });
        }
        const answer = await router.request(client, 'memory', 'tools/call', { name: tool, arguments: a }, turnTrace);
        const r = inner(answer);
        return limit(asText(r.ok ? r.value : { error: r.value }));
      }
      case 'db_put':
      case 'db_get':
      case 'db_query':
      case 'db_delete':
      case 'db_collections': {
        const r = inner(await router.request(client, 'memory', 'tools/call', { name, arguments: args }, turnTrace));
        return limit(asText(r.ok ? r.value : { error: r.value }));
      }
      case 'consult_local':
      case 'teach_local':
      case 'manage_local': {
        const tool = { consult_local: 'consult', teach_local: 'teach', manage_local: 'manage' }[name]!;
        const r = inner(await router.request(client, 'local-ai', 'tools/call', { name: tool, arguments: args }, turnTrace));
        return limit(asText(r.ok ? r.value : { error: r.value }));
      }
      case 'discover': {
        const catalog = inner(await router.request(client, 'router', 'tools/call', { name: 'catalog', arguments: {} }, turnTrace));
        const stats = inner(await router.request(client, 'router', 'tools/call', { name: 'stats', arguments: {} }, turnTrace));
        if (!catalog.ok) return asText({ error: catalog.value });
        const servers = ((catalog.value as { servers?: Array<{ server: string; description: string; tools: Array<{ name: string }>; resources: number | null }> }).servers ?? []).map((s) => ({
          server: s.server,
          for: s.description,
          tools: s.tools.map((t) => t.name),
          resources: s.resources,
        }));
        const s = (stats.value ?? {}) as { messages?: number; errors?: number; ratePerSecond?: number; servers?: Array<{ name: string; requests: number }> };
        return limit(asText({ servers, router: { messages: s.messages, errors: s.errors, ratePerSecond: s.ratePerSecond, busiest: (s.servers ?? []).slice(0, 3) } }));
      }
      case 'mcp_call': {
        const server = String(args.server ?? '');
        const method = String(args.method ?? '');
        if (!router.names().includes(server)) return asText({ error: `There is no MCP server "${server}". Servers: ${router.names().join(', ')}.` });
        if (!['resources/list', 'resources/read', 'tools/list', 'tools/call', 'ping'].includes(method)) return asText({ error: `Method "${method}" is not available to you. Use resources/list, resources/read, tools/list or tools/call.` });
        let params: Record<string, unknown> = {};
        const raw = typeof args.params_json === 'string' ? args.params_json.trim() : '';
        if (raw) {
          try {
            const v = JSON.parse(raw) as unknown;
            if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
            params = v as Record<string, unknown>;
          } catch {
            return asText({ error: 'params_json must be JSON text for an object, e.g. {"uri":"lattakker:///board/A12"}' });
          }
        }
        if (server === 'tabs' && method === 'tools/call' && String(params.name ?? '') !== 'list' && String(params.name ?? '') !== 'select' && !getSettings().allowWrite) {
          return asText({ error: 'Making, renaming and closing tabs is switched off for you (a grown-up can allow it in the helper settings, "Let the helper write code"). You can list tabs and select one; ask the person to use the ＋ in the tab strip.' });
        }
        if (method === 'tools/call' && String(params.name ?? '') === 'set_code') return asText({ error: 'set_code is not allowed for you. Use suggest_code: the person looks at the code and decides.' });
        return limit(asText(await router.request(CLIENT, server, method, params, turnTrace)));
      }
      case 'flash_cell': {
        const hit = resolveSmart(String(args.path ?? ''), host.context().tab);
        if ('error' in hit) return asText({ error: hit.error });
        const answer = await router.request(CLIENT, hit.tab.id, 'tools/call', { name: 'flash', arguments: { address: hit.address } }, turnTrace);
        return asText({ ...(inner(answer).value as object), note: hit.note });
      }
      case 'goto_cell': {
        const hit = resolveSmart(String(args.path ?? ''), host.context().tab);
        if ('error' in hit) return asText({ error: hit.error });
        const full = workspace.pathOf(hit.tab.id, hit.address);
        if (!nav.goTo(full)) return asText({ error: `Could not go to ${full}.` });
        // The screen flies there for a moment; the blink comes when it has arrived.
        await sleep(900);
        await router.request(CLIENT, hit.tab.id, 'tools/call', { name: 'flash', arguments: { address: hit.address } }, turnTrace);
        const d = hit.tab.sheet.dataAt(hit.address);
        return asText({ path: full, there: true, hasCode: !!d?.code.trim(), firstLine: d?.code.split('\n').find((l) => l.trim())?.slice(0, 100) ?? null, note: hit.note });
      }
      case 'run_cell': {
        const hit = resolveSmart(String(args.path ?? ''), host.context().tab);
        if ('error' in hit) return asText({ error: hit.error });
        const full = workspace.pathOf(hit.tab.id, hit.address);
        if (!hit.tab.sheet.dataAt(hit.address)?.code.trim()) return asText({ error: `${full} has no code to run.`, note: hit.note });
        return asText({ ...reportText(full, await host.run(full)), note: hit.note });
      }
      case 'find_free_cell': {
        const tabId = tabForNewCode(host, args.tab);
        return asText({ ...freeSpot(tabId), tab: tabId, size: `${FREE_COLS}x${FREE_ROWS}`, next: 'Use write_code (or suggest_code) with this path.' });
      }
      case 'write_code':
        return await writeCode(host, args);
      case 'suggest_code': {
        const hit = workspace.resolve(String(args.path ?? ''), host.context().tab);
        if ('error' in hit) return asText({ error: hit.error });
        if (hit.tab.sheet.isBoardAddress(hit.address)) return asText({ error: `${hit.address} is a board square. Code goes in a lower row such as A12.` });
        if (typeof args.code !== 'string' || !args.code.trim()) return asText({ error: 'code must be the TypeScript text for the cell' });
        const after = typeof args.after_line === 'number' && Number.isInteger(args.after_line) && args.after_line >= 1 ? args.after_line : null;
        host.suggest(workspace.pathOf(hit.tab.id, hit.address), cleanCode(args.code), typeof args.note === 'string' ? args.note : '', after);
        return asText({ shownToThePerson: true, note: 'The person has to press the button before anything is changed. Explain the code in your answer.' });
      }
      default:
        return asText({ error: `There is no tool "${name}". Tools: ${TOOL_DECLS.map((t) => t.name).join(', ')}.` });
    }
  } catch (err) {
    return asText({ error: err instanceof Error ? err.message : String(err) });
  }
}
