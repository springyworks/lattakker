import { ERR, McpError, type Json, type McpServer } from '../mcp/router';
import { getKey, getSettings } from './config';
import { jobs } from './jobs';
import { memoryInfo } from './memory';
import { OpenAiCompatProvider, friendly, type ChatMsg, type ModelProvider, type ToolDecl } from './providers';
import { DB_DECLS, LIBRARIAN_TOOLS, runTool, TOOL_DECLS, type ToolHost } from './tools';

/**
 * The second brain: a model on this computer (Ollama, LM Studio ...) that works next to the main helper. When the
 * main helper is Gemini and a local model is set up and answering, Gemini gets tools to consult it and to teach
 * it. The local model is the librarian of the page: it keeps the memory and the little database, so the big
 * model does not have to. Everything goes over the page's MCP router, as the server `local-ai`, so the traffic
 * can be watched and an outside AI (if the person allows it) can use the same door.
 *
 *   tools/call status                    is the local model there, and which
 *   tools/call consult {question}        ask it something (it may look in the memory and the database)
 *   tools/call teach {material, how?}    give it knowledge to sort, store and keep tidy
 *   tools/call manage {task}             database admin: merge duplicates, list collections, clean up ...
 */

/** The local model, whatever the main provider is. */
export function makeLocalProvider(): ModelProvider | null {
  const { local } = getSettings();
  return local.baseUrl && local.model ? new OpenAiCompatProvider(local.baseUrl, local.model, getKey('local')) : null;
}

export const localState = { ok: false, checked: 0, model: '', error: '' };
const listeners: Array<() => void> = [];
export const onLocalChange = (l: () => void): void => void listeners.push(l);

/** Looks whether the local server answers (at most every 15 s, and never for longer than 2.5 s). */
export async function probeLocal(force = false): Promise<boolean> {
  const provider = makeLocalProvider();
  const now = performance.now();
  if (!provider) {
    if (localState.ok) {
      localState.ok = false;
      listeners.forEach((l) => l());
    }
    return false;
  }
  if (!force && now - localState.checked < 15000) return localState.ok;
  localState.checked = now;
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), 2500);
  const before = localState.ok;
  try {
    const models = await provider.listModels(abort.signal);
    const want = getSettings().local.model;
    localState.ok = models.length > 0 && (models.includes(want) || models.some((m) => m.split(':')[0] === want.split(':')[0]));
    localState.error = localState.ok ? '' : `the server does not list the model "${want}"`;
  } catch (err) {
    localState.ok = false;
    localState.error = abort.signal.aborted ? 'no answer within 2.5 s' : friendly(err);
  } finally {
    window.clearTimeout(timer);
  }
  localState.model = getSettings().local.model;
  if (before !== localState.ok) listeners.forEach((l) => l());
  return localState.ok;
}

/** Ollama's own list of models that are in memory right now (null when the server is not Ollama). */
async function isLoaded(): Promise<boolean | null> {
  try {
    const base = getSettings().local.baseUrl.replace(/\/v1\/?$/, '');
    const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const want = getSettings().local.model;
    return (data.models ?? []).some((m) => m.name === want || m.model === want);
  } catch {
    return null;
  }
}

/** Offered to the main helper only when it is not itself the local model, and the local one answers. */
export const localAssistantReady = (): boolean => getSettings().provider !== 'local' && localState.ok;

// ------------------------------------------------------------ a small agent loop for the local model

async function runSubAgent(opts: { provider: ModelProvider; system: string; task: string; tools: ToolDecl[]; exec: (name: string, args: Record<string, unknown>) => Promise<string>; log: (text: string) => void; maxRounds?: number }): Promise<string> {
  const abort = new AbortController();
  // "Stop" in the chat reaches this too.
  const unhook = jobs.onCancel(() => abort.abort());
  // A big model that was idle must first be loaded into memory, which can take minutes: be patient.
  const timer = window.setTimeout(() => abort.abort(), 15 * 60000);
  const messages: ChatMsg[] = [{ role: 'user', text: opts.task }];
  const rounds = opts.maxRounds ?? 6;
  let last = '';
  try {
    for (let round = 0; round <= rounds; round++) {
      const reply = await opts.provider.complete(opts.system, messages, round < rounds ? opts.tools : [], abort.signal);
      messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
      if (reply.text.trim()) last = reply.text.trim();
      if (!reply.toolCalls.length) break;
      for (const call of reply.toolCalls) {
        opts.log(`${call.name} ${JSON.stringify(call.args).slice(0, 90)}`);
        messages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, text: await opts.exec(call.name, call.args) });
      }
    }
  } finally {
    window.clearTimeout(timer);
    unhook();
  }
  return last || '(the local model gave no text)';
}

const LIBRARIAN = `You are the librarian of "Lattakker Sheet", a small learning app. You run on the person's own computer and you keep two stores for the whole app: the MEMORY (short notes: recall, remember, tidy_memory) and a little DATABASE (collections of JSON records: db_put, db_get, db_query, db_delete, db_collections).
How you work:
- Look before you write: recall / db_collections / db_query first, so you update instead of duplicating.
- Notes are for explanations and lessons (one idea per note, a clear title, a few tags). Collections are for structured lists (a table of words learned, exercises done, scores). Pick the form that fits and say which you chose.
- Never store personal information (names of people, e-mail, address, school, passwords, keys).
- When you are done, answer in two or three short plain sentences: what you stored or found, and where (note titles, collection names).`;

const CONSULT = `You are a small, fast helper that runs on the person's own computer, asked for a second opinion by a bigger AI. Answer briefly and plainly. If it helps, look in the memory (recall) or the database (db_query, db_collections) first. If you do not know, say so.`;

// ------------------------------------------------------------ the MCP server

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TOOLS = [
  { name: 'status', description: 'Whether the local model is there and answering, and which one.', inputSchema: { type: 'object', properties: {} } },
  { name: 'consult', description: 'Ask the local model a question (it may look in the memory and the database). Cheap and private; good for lookups, summaries and drafts.', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'teach', description: 'Give the local model knowledge to sort, store and keep: it decides whether it becomes notes or database records, and avoids duplicates. Returns what it did.', inputSchema: { type: 'object', properties: { material: { type: 'string' }, how: { type: 'string', description: 'Optional wishes, e.g. "keep it as a table of words".' } }, required: ['material'] } },
  { name: 'manage', description: 'Database administration by the local model: for example "merge duplicate notes", "list the collections", "forget everything about X".', inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
];

export class LocalAiServer implements McpServer {
  readonly name = 'local-ai';
  private busy = false;

  constructor(
    private readonly host: () => ToolHost,
    private readonly announce: (text: string) => void,
    /** The built-in helper's own name on the router, which may always call. */
    private readonly insider: string,
  ) {}

  async handle(method: string, params: Record<string, unknown>, from: string): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-local-ai', title: 'Local model (librarian)', version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {}, from);
      default:
        throw new McpError(ERR.methodNotFound, `local-ai does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>, from: string): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const failure = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
    if (name === 'status') {
      await probeLocal(true);
      return reply({ available: localState.ok, model: localState.model || null, problem: localState.ok ? null : localState.error || 'no local model is set up (⚙ in the AI chat)', outsideAllowed: getSettings().allowOutside });
    }
    if (!['consult', 'teach', 'manage'].includes(name)) throw new McpError(ERR.methodNotFound, `local-ai has no tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`);
    if (from !== this.insider && !getSettings().allowOutside) return failure('The person has not allowed outside AIs to use the helpers (⚙ in the AI chat: "Let an outside AI ask the helper").');
    if (!(await probeLocal())) return failure(`The local model is not answering: ${localState.error || 'not set up'}.`);
    if (this.busy) return failure('The local model is busy with another job. Try again in a moment.');
    const provider = makeLocalProvider()!;
    const text = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string).trim().slice(0, 6000) : '');
    const task = name === 'consult' ? text('question') : name === 'teach' ? `Please store this knowledge:\n${text('material')}${text('how') ? `\n\nWishes: ${text('how')}` : ''}` : text('task');
    if (!task || task.endsWith(':\n')) return failure(`${name === 'consult' ? 'question' : name === 'teach' ? 'material' : 'task'} must be some text`);
    const allowed = name === 'consult' ? new Set(['recall', 'db_query', 'db_get', 'db_collections']) : LIBRARIAN_TOOLS;
    const tools = [...TOOL_DECLS, ...DB_DECLS].filter((t) => allowed.has(t.name));
    this.busy = true;
    const job = jobs.start('local-ai', name === 'consult' ? 'consulted' : name === 'teach' ? 'filing knowledge' : 'database admin', { stallAfterSeconds: 3600 });
    job.say(name === 'consult' ? 'the local model thinks about the question' : name === 'teach' ? 'the local model decides how to store the material' : 'the local model works on the task', false);
    const steps: string[] = [];
    const started = performance.now();
    if ((await isLoaded()) === false) this.announce(`🧠 ${localState.model} is not in memory yet. Loading it can take a few minutes the first time (and again after it was idle). Please wait; it is not stuck.`);
    this.announce(`🧠 The local model (${localState.model}) ${name === 'consult' ? 'is thinking about a question from the main helper' : name === 'teach' ? 'is filing new knowledge' : 'is tidying the database'}…`);
    try {
      const before = memoryInfo();
      const run = (jobTask: string): Promise<string> =>
        runSubAgent({
        provider,
        system: name === 'consult' ? CONSULT : LIBRARIAN,
        task: jobTask,
        tools,
        exec: (tool, a) => (allowed.has(tool) ? runTool(this.host(), tool, a, this.name) : Promise.resolve(JSON.stringify({ error: `you may not use ${tool} here` }))),
        log: (t) => {
          steps.push(t);
          job.say(`step ${steps.length}: ${t.slice(0, 70)}`, false);
        },
      });
      const touched = (): number => Math.abs(memoryInfo().count - before.count) + Math.abs(memoryInfo().records - before.records) + steps.filter((s) => /^(remember|db_put|db_delete|tidy_memory)/.test(s)).length;
      let answer = await run(task);
      // A small model sometimes says it stored something and has not: that is checked, never taken on trust.
      if (name === 'teach' && touched() === 0) {
        job.say('the local model said it stored the knowledge but wrote nothing; asking it once more to really do it', false);
        answer = await run(`You answered without using a tool, so NOTHING was stored. Call remember or db_put now to store this, then say what you stored:\n${task}`);
      }
      const after = memoryInfo();
      const changes = { notes: after.count - before.count, records: after.records - before.records };
      const wrote = name === 'consult' || touched() > 0;
      job.done(`${steps.length} database step${steps.length === 1 ? '' : 's'}`);
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      this.announce(`🧠 The local model answered after ${secs} s${steps.length ? ` (${steps.length} database step${steps.length === 1 ? '' : 's'}: ${steps.map((s) => s.split(' ')[0]).join(', ')})` : ''}.`);
      if (!wrote) return failure(`The local model did not store anything (it only talked). Its words were: ${answer.slice(0, 300)}`);
      return reply({ answer, by: `local · ${localState.model}`, steps, changes, verified: name === 'consult' ? undefined : true, seconds: Number(secs) });
    } catch (err) {
      this.announce(`🧠 The local model had a problem: ${friendly(err)}`);
      job.fail(friendly(err));
      return failure(friendly(err));
    } finally {
      this.busy = false;
    }
  }
}
