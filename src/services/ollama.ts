import { getKey, getSettings } from '../aichat/config';
import { OpenAiCompatProvider, friendly, type ChatMsg } from '../aichat/providers';
import { ERR, McpError, type Json, type McpServer } from '../mcp/router';

/**
 * The model on this computer (Ollama, or any server that speaks the same OpenAI-style language, like LM
 * Studio) for cell code (`await ollama.ask('Why is the sky blue?')`) and over MCP (the server `ollama`).
 *
 * Everything stays on this computer: the address comes from the helper's settings (default
 * http://localhost:11434). When the server is not there, every call says so in plain words and tells what to
 * do, and `ollama.status()` never throws: it describes the problem.
 */

const STATUS_TIMEOUT_MS = 2500;
const PING_TIMEOUT_MS = 1500;
const DEFAULT_ASK_SECONDS = 120;
const MAX_ASK_SECONDS = 600;
const MAX_PARALLEL = 2;
const MAX_PROMPT_CHARS = 8000;
const MAX_MESSAGES = 30;
const DEFAULT_SYSTEM = 'You answer briefly and plainly, in the language of the question.';

export interface OllamaStatus {
  /** Something answered at the address. */
  running: boolean;
  /** It answered like Ollama does (false for LM Studio and friends, which still work for ask()). */
  isOllama: boolean;
  /** The address, e.g. 'localhost:11434'. */
  server: string;
  version: string | null;
  /** The models that are installed, and those that are in memory right now. */
  models: string[];
  loaded: string[];
  /** The model chosen in the helper's settings ('' when none). */
  selected: string;
  /** True when ask() can work: the server answers and the model that will be used is installed. */
  ready: boolean;
  /** What is wrong and what to do about it, or a short "all good". */
  message: string;
}

export interface OllamaModel {
  name: string;
  /** Size on disk, in gigabytes. */
  sizeGB: number;
  family: string;
  parameters: string;
  quantization: string;
  /** In memory right now. */
  loaded: boolean;
}

export interface OllamaOptions {
  /** Which model; default is the one chosen in the helper's settings, else the first installed. */
  model?: string;
  /** The instructions for the model (how to behave). */
  system?: string;
}

export interface OllamaMessage {
  role: 'user' | 'assistant';
  content: string;
}

const base = (): string => getSettings().local.baseUrl.replace(/\/+$/, '');
const nativeBase = (): string => base().replace(/\/v1$/, '');
const hostOf = (): string => {
  try {
    return new URL(base()).host;
  } catch {
    return base();
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function getJson(url: string, ms = STATUS_TIMEOUT_MS): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return isRecord(data) ? data : null;
  } catch {
    return null;
  }
}

/** What to tell a person when nothing answers. */
const notFound = (): string =>
  `No model server answered at ${hostOf()}. Is Ollama running? Install it from ollama.com, start it ("ollama serve"), pull a model ("ollama pull qwen2.5-coder:7b") and let this page talk to it: set OLLAMA_ORIGINS=${location.origin} before starting it. The address can be changed in the helper settings (⚙).`;

/** Is the model server there, which models does it have, and what is the problem if it cannot be used. Never throws. */
export async function ollamaStatus(): Promise<OllamaStatus> {
  const selected = getSettings().local.model;
  const status: OllamaStatus = { running: false, isOllama: false, server: hostOf(), version: null, models: [], loaded: [], selected, ready: false, message: '' };
  const root = nativeBase();
  const [version, tags, ps] = await Promise.all([getJson(`${root}/api/version`), getJson(`${root}/api/tags`), getJson(`${root}/api/ps`)]);
  const names = (data: Record<string, unknown> | null, key: string): string[] =>
    Array.isArray(data?.[key]) ? (data![key] as unknown[]).map((m) => (isRecord(m) ? String(m.name ?? m.model ?? '') : '')).filter(Boolean) : [];
  if (version || tags) {
    status.running = true;
    status.isOllama = true;
    status.version = typeof version?.version === 'string' ? version.version : null;
    status.models = names(tags, 'models');
    status.loaded = names(ps, 'models');
  } else {
    // Not Ollama's own door: maybe another server with the OpenAI-style one (LM Studio ...).
    const listed = await getJson(`${base()}/models`);
    if (listed && Array.isArray(listed.data)) {
      status.running = true;
      status.models = (listed.data as unknown[]).map((m) => (isRecord(m) ? String(m.id ?? '') : '')).filter(Boolean);
    }
  }
  if (!status.running) {
    status.message = notFound();
  } else if (!status.models.length) {
    status.message = `The server at ${status.server} is running but has no models. Get one with: ollama pull qwen2.5-coder:7b`;
  } else if (selected && !status.models.some((m) => m === selected || m.split(':')[0] === selected.split(':')[0])) {
    status.message = `The server is running, but the model “${selected}” (chosen in the helper settings) is not installed. Installed: ${status.models.join(', ')}.`;
  } else {
    status.ready = true;
    status.message = `Ready: ${selected || status.models[0]} on ${status.server}${status.version ? ` (Ollama ${status.version})` : ''}.`;
  }
  return status;
}

/** The installed models, with size and kind. Throws a plain-words error when the server is not there. */
export async function ollamaModels(): Promise<OllamaModel[]> {
  const root = nativeBase();
  const [tags, ps] = await Promise.all([getJson(`${root}/api/tags`), getJson(`${root}/api/ps`)]);
  if (!tags || !Array.isArray(tags.models)) {
    const status = await ollamaStatus();
    if (!status.running) throw new Error(status.message);
    return status.models.map((name) => ({ name, sizeGB: 0, family: '', parameters: '', quantization: '', loaded: status.loaded.includes(name) }));
  }
  const loaded = new Set(Array.isArray(ps?.models) ? (ps!.models as unknown[]).map((m) => (isRecord(m) ? String(m.name ?? '') : '')) : []);
  return (tags.models as unknown[]).filter(isRecord).map((m) => {
    const details = isRecord(m.details) ? m.details : {};
    const name = String(m.name ?? m.model ?? '');
    return {
      name,
      sizeGB: Math.round((Number(m.size ?? 0) / 1e9) * 10) / 10,
      family: String(details.family ?? ''),
      parameters: String(details.parameter_size ?? ''),
      quantization: String(details.quantization_level ?? ''),
      loaded: loaded.has(name),
    };
  });
}


/** Does anything answer at the model server's door, right now? Fast (1.5 s at most): the first thing to do before any question. Never throws. */
export async function ollamaPing(): Promise<{ up: boolean; ms: number; version: string | null; error?: string }> {
  const start = performance.now();
  const data = await getJson(`${nativeBase()}/api/version`, PING_TIMEOUT_MS);
  const ms = Math.round((performance.now() - start) * 10) / 10;
  if (data) return { up: true, ms, version: typeof data.version === 'string' ? data.version : null };
  const other = await getJson(`${base()}/models`, PING_TIMEOUT_MS);
  if (other) return { up: true, ms: Math.round((performance.now() - start) * 10) / 10, version: null };
  return { up: false, ms, version: null, error: notFound() };
}

const warming = new Set<string>();

/**
 * Starts loading a model into memory and returns at once (the load goes on in the background, no one waits for it).
 * A big model needs minutes the first time, and a question that gives up while it loads cancels the load: so load first, ask later.
 * Look at ollamaStatus().loaded to see when it is there.
 */
export async function ollamaWarm(model?: string): Promise<{ model: string; loaded: boolean; started: boolean; message: string }> {
  const status = await ollamaStatus();
  if (!status.running) throw new Error(status.message);
  const name = model || status.selected || status.models[0] || '';
  if (!name) throw new Error(status.message || 'No model chosen.');
  if (status.models.length && !status.models.some((m) => m === name || m.split(':')[0] === name.split(':')[0])) throw new Error(`The model “${name}” is not installed. Installed: ${status.models.join(', ')}.`);
  if (status.loaded.includes(name)) return { model: name, loaded: true, started: false, message: `${name} is in memory.` };
  if (!warming.has(name)) {
    warming.add(name);
    fetch(`${nativeBase()}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name, prompt: '', keep_alive: -1, options: { num_ctx: getSettings().local.context } }) })
      .catch(() => undefined)
      .finally(() => warming.delete(name));
  }
  return { model: name, loaded: false, started: true, message: `${name} is loading into memory (a big model can take minutes the first time). Ask again when status says it is in "loaded".` };
}

let running = 0;

/** Sends a conversation to the model and returns its answer. `signal` stops the wait (a cell that runs again cancels its questions). */
export async function ollamaChat(messages: OllamaMessage[], options: OllamaOptions = {}, signal?: AbortSignal): Promise<string> {
  if (!Array.isArray(messages) || !messages.length) throw new Error('ollama.chat needs a list of messages: [{ role: "user", content: "Hello" }]');
  if (messages.length > MAX_MESSAGES) throw new Error(`ollama.chat takes at most ${MAX_MESSAGES} messages.`);
  const wire: ChatMsg[] = messages.map((m) => {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m?.content ?? '');
    if (content.length > MAX_PROMPT_CHARS) throw new Error(`A message is longer than ${MAX_PROMPT_CHARS} characters. A small local model cannot read that much: shorten it.`);
    return { role, text: content };
  });
  if (wire[wire.length - 1].role !== 'user') throw new Error('The last message must be from the user.');
  if (running >= MAX_PARALLEL) throw new Error(`The local model is already busy with ${running} questions. Wait for one to finish (await it) before asking more.`);

  // The place is taken at once, before any waiting, so questions started in the same breath cannot all slip past the limit.
  running++;
  try {
    const status = await ollamaStatus();
    if (!status.running) throw new Error(status.message);
    const model = options.model || status.selected || status.models[0] || '';
    if (!model) throw new Error(status.message || 'No model chosen.');
    if (status.models.length && !status.models.some((m) => m === model || m.split(':')[0] === model.split(':')[0])) throw new Error(`The model “${model}” is not installed. Installed: ${status.models.join(', ')}.`);

    const provider = new OpenAiCompatProvider(getSettings().local.baseUrl, model, getKey('local'), getSettings().local.context);
    const stop = signal ?? new AbortController().signal;
    try {
      const reply = await provider.complete(String(options.system ?? DEFAULT_SYSTEM).slice(0, 2000), wire, [], stop);
      return reply.text.trim();
    } catch (err) {
      if (stop.aborted) throw err;
      throw new Error(friendly(err));
    }
  } finally {
    running--;
  }
}

/** One question, one answer. */
export const ollamaAsk = (prompt: string, options: OllamaOptions = {}, signal?: AbortSignal): Promise<string> => ollamaChat([{ role: 'user', content: String(prompt ?? '') }], options, signal);

// ------------------------------------------------------------ the MCP server

const TOOLS = [
  { name: 'status', description: 'Is the model server (Ollama) there? Which models are installed and in memory, which one is used, and what to do if something is missing. Never fails: it describes the problem.', inputSchema: { type: 'object', properties: {} } },
  { name: 'ping', description: 'Does the model server answer at all? Answers at once (1.5 s at most) with up true or false, how many milliseconds it took and the version. Do this before ask: when it is not up, nothing will answer and asking would only wait.', inputSchema: { type: 'object', properties: {} } },
  { name: 'warm', description: 'Start loading the model into memory and return at once (loading goes on in the background). A big model needs minutes the first time. Look at status.loaded to see when it is there; only then ask.', inputSchema: { type: 'object', properties: { model: { type: 'string' } } } },
  { name: 'models', description: 'The installed models with size, family and whether they are in memory.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'ask',
    description: 'Ask the model on this computer one question and wait for the answer (it can take a while when the model has to load first, but never longer than timeout_seconds). Pings the server first and says at once when it is not there; when the model is not in memory yet it starts loading it and answers at once (ask again when status.loaded has it). Refused for outside AIs unless the person allowed outside questions.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, system: { type: 'string', description: 'How the model should behave.' }, model: { type: 'string' }, timeout_seconds: { type: 'number', description: `Give up after this many seconds (default ${DEFAULT_ASK_SECONDS}, at most ${MAX_ASK_SECONDS}): a model that is not in memory yet can take a long time to load.` } }, required: ['prompt'] },
  },
];

/** The MCP server `ollama`. */
export class OllamaServer implements McpServer {
  readonly name = 'ollama';
  readonly description = 'The model on this computer (Ollama or LM Studio): is it there, which models, ask it a question. Warns in plain words when it is not found.';

  async handle(method: string, params: Record<string, unknown>, from: string): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-ollama', title: 'Local model', version: '1' } };
      case 'ping': {
        // A real one: a ping that is answered says the model server is there. When it is not, say so at once.
        const pong = await ollamaPing();
        if (!pong.up) throw new McpError(ERR.internal, pong.error ?? 'The model server does not answer.');
        return { ms: pong.ms, version: pong.version };
      }
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {}, from);
      default:
        throw new McpError(ERR.methodNotFound, `ollama does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>, from: string): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const failure = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
    switch (name) {
      case 'status':
        return reply({ ...(await ollamaStatus()) });
      case 'ping':
        return reply({ ...(await ollamaPing()) });
      case 'warm':
        try {
          return reply({ ...(await ollamaWarm(typeof args.model === 'string' ? args.model : undefined)) });
        } catch (err) {
          return failure(err instanceof Error ? err.message : String(err));
        }
      case 'models':
        try {
          return reply({ models: await ollamaModels() });
        } catch (err) {
          return failure(err instanceof Error ? err.message : String(err));
        }
      case 'ask': {
        if (from === 'ai' && !getSettings().allowOutside) return failure('The person has not allowed outside AIs to use the local model (⚙ in the AI chat: "Let an outside AI ask the helper").');
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        if (!prompt) return failure('prompt must be some text');
        const pong = await ollamaPing();
        if (!pong.up) return failure(pong.error ?? 'The model server does not answer.');
        // Never wait on a cold model: giving up during the load would cancel it. Start the load and say so.
        try {
          const warm = await ollamaWarm(typeof args.model === 'string' ? args.model : undefined);
          if (!warm.loaded) return failure(`${warm.message} Nothing was asked yet.`);
        } catch (err) {
          return failure(err instanceof Error ? err.message : String(err));
        }
        const seconds = typeof args.timeout_seconds === 'number' && Number.isFinite(args.timeout_seconds) ? Math.min(Math.max(args.timeout_seconds, 1), MAX_ASK_SECONDS) : DEFAULT_ASK_SECONDS;
        const limit = new AbortController();
        const timer = setTimeout(() => limit.abort(), seconds * 1000);
        const started = performance.now();
        try {
          const answer = await ollamaAsk(prompt, { system: typeof args.system === 'string' ? args.system : undefined, model: typeof args.model === 'string' ? args.model : undefined }, limit.signal);
          return reply({ answer, seconds: Math.round((performance.now() - started) / 100) / 10 });
        } catch (err) {
          if (limit.signal.aborted) return failure(`No answer within ${seconds} seconds. The server is up (it answered the ping in ${pong.ms} ms), so the model is probably still loading or thinking: try again, or give a longer timeout_seconds.`);
          return failure(err instanceof Error ? err.message : String(err));
        } finally {
          clearTimeout(timer);
        }
      }
      default:
        throw new McpError(ERR.methodNotFound, `ollama has no tool "${name}". Tools: status, ping, warm, models, ask`);
    }
  }
}
