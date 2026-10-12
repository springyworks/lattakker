import { getKey, getSettings, type AiSettings } from './config';
import { jobs, type JobHandle } from './jobs';

/**
 * The two kinds of language-model server the helper can talk to, behind one small interface. Messages and tools
 * use a neutral shape; each provider turns it into its own wire format and back.
 *
 *  - OpenAI-compatible (`/chat/completions`): Ollama, LM Studio and many others, on this computer or elsewhere.
 *  - Google Gemini (`generateContent`): called straight from the page with the person's own key.
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMsg {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  /** The model's own turn as it came back (kept so a provider can send it back unchanged). */
  raw?: unknown;
}

export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export type AiErrorKind = 'network' | 'auth' | 'rate' | 'blocked' | 'tools' | 'bad' | 'server';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface ModelProvider {
  /** Who answers, in words. */
  readonly label: string;
  /** Told what happens while waiting (a busy server, a retry), so the chat can show it. */
  onNote?: (text: string) => void;
  complete(system: string, messages: ChatMsg[], tools: ToolDecl[], signal: AbortSignal): Promise<ModelReply>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_OUTPUT_TOKENS = 1400;

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/** A busy server (503/500/504, or 429) often answers a moment later; one that does not answer at all is given up on after `timeoutMs`. Either way: try a few times, then say what happened. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  hooks: { timeoutMs: number; who: string; onWait?: (seconds: number, status: number, attempt: number, of: number) => void; onSent?: (attempt: number) => void },
): Promise<Response> {
  const pauses = [1500, 4000, 8000];
  for (let i = 0; ; i++) {
    hooks.onSent?.(i);
    const ctl = new AbortController();
    const relay = (): void => ctl.abort();
    signal.addEventListener('abort', relay);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, hooks.timeoutMs);
    let res: Response | null = null;
    try {
      res = await fetch(url, { ...init, signal: ctl.signal });
    } catch (err) {
      if (signal.aborted || !timedOut) throw err;
    } finally {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', relay);
    }
    if (res && ![429, 500, 502, 503, 504].includes(res.status)) return res;
    if (i >= pauses.length) {
      if (res) return res;
      throw new AiError('server', `${hooks.who} did not answer within ${Math.round(hooks.timeoutMs / 1000)} s (tried ${i + 1} times)`);
    }
    hooks.onWait?.(Math.round(pauses[i] / 1000), res ? res.status : 0, i + 1, pauses.length);
    await wait(pauses[i], signal);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const e = body.error;
    return (typeof e === 'string' ? e : e?.message) ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function fail(status: number, message: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', message);
  if (status === 429) return new AiError('rate', message);
  if (status >= 500) return new AiError('server', message);
  return new AiError('bad', message);
}

const parseArgs = (text: unknown): Record<string, unknown> => {
  if (typeof text !== 'string') return typeof text === 'object' && text !== null ? (text as Record<string, unknown>) : {};
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------- OpenAI-compatible

export class OpenAiCompatProvider implements ModelProvider {
  readonly label: string;
  onNote?: (text: string) => void;
  private toolsOk = true;
  private thinkingOff = true;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string,
  ) {
    this.label = model || 'the local model';
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private unreachable(err: unknown): AiError {
    const where = (() => {
      try {
        return new URL(this.baseUrl).host;
      } catch {
        return this.baseUrl;
      }
    })();
    return new AiError(
      'network',
      `Could not reach ${where}. Is the model server running? If it is, it has to allow this page's address (for Ollama: set OLLAMA_ORIGINS to ${location.origin}). ${err instanceof Error ? err.message : ''}`.trim(),
    );
  }

  async complete(system: string, messages: ChatMsg[], tools: ToolDecl[], signal: AbortSignal): Promise<ModelReply> {
    const job = jobs.start('local-model', this.model || 'local model', { stallAfterSeconds: 120 });
    const started = performance.now();
    try {
      const reply = await this.send(job, system, messages, tools, signal);
      job.done(`answered after ${((performance.now() - started) / 1000).toFixed(1)} s`);
      return reply;
    } catch (err) {
      if (signal.aborted) job.cancel();
      else job.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Ollama's list of models that are in memory (null for servers that do not have it). */
  private async inMemory(): Promise<boolean | null> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/v1\/?$/, '')}/api/ps`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
      return (data.models ?? []).some((m) => m.name === this.model || m.model === this.model);
    } catch {
      return null;
    }
  }

  private async send(job: JobHandle, system: string, messages: ChatMsg[], tools: ToolDecl[], signal: AbortSignal): Promise<ModelReply> {
    const wire: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') wire.push({ role: 'user', content: m.text ?? '' });
      else if (m.role === 'tool') wire.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.text ?? '' });
      else {
        const msg: Record<string, unknown> = { role: 'assistant', content: m.text || null };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
        }
        wire.push(msg);
      }
    }
    const withTools = tools.length > 0 && this.toolsOk;
    const body: Record<string, unknown> = { model: this.model, messages: wire, temperature: 0.4, stream: true, max_tokens: MAX_OUTPUT_TOKENS };
    // A child should not wait while a model thinks out loud; servers that do not know the setting ignore it.
    if (this.thinkingOff) body.reasoning_effort = 'none';
    if (withTools) {
      body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    // What is really going on while the first word has not come yet: ask the server whether the model is in memory.
    const ctl = new AbortController();
    const relay = (): void => ctl.abort();
    signal.addEventListener('abort', relay);
    let words = 0;
    let waitingForFirst = true;
    let stuck = '';
    job.state('waiting');
    job.say(`question sent to ${new URL(this.baseUrl, location.href).host}; nothing has come back yet`, false);
    const watch = window.setInterval(() => {
      if (!waitingForFirst) return;
      const quiet = Math.round((performance.now() - sentAt) / 1000);
      void this.inMemory().then((loaded) => {
        if (!waitingForFirst) return;
        if (loaded === false) {
          job.say(`the server has not answered and the model is not in memory yet: it is most likely still loading (a big model can take minutes). Waiting ${quiet} s so far`, false);
          // Loading is slow but allowed; a model that never shows up in memory is given up on after 20 minutes.
          if (quiet > 1200) {
            stuck = 'The model did not finish loading within 20 minutes.';
            ctl.abort();
          }
        } else {
          job.say(loaded === true ? `the model is in memory and works on the question; no word yet (${quiet} s)` : `waiting for the server; nothing has come back yet (${quiet} s)`, false);
          if (quiet > 300) {
            stuck = `The model gave no word for ${quiet} s although it is in memory: it looks stuck.`;
            ctl.abort();
          }
        }
      });
    }, 3000);
    const sentAt = performance.now();
    let res: Response;
    try {
      res = await fetch(this.url('/chat/completions'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: ctl.signal });
    } catch (err) {
      window.clearInterval(watch);
      signal.removeEventListener('abort', relay);
      if (signal.aborted) throw err;
      if (stuck) throw new AiError('server', stuck);
      throw this.unreachable(err);
    }
    if (!res.ok) {
      window.clearInterval(watch);
      signal.removeEventListener('abort', relay);
      const message = await errorMessage(res);
      if (res.status === 400 && this.thinkingOff && /reasoning/i.test(message)) {
        this.thinkingOff = false;
        return this.send(job, system, messages, tools, signal);
      }
      // Some models cannot use tools: carry on without them (the helper then answers from what it was shown).
      if (res.status === 400 && withTools && /tool|function/i.test(message)) {
        this.toolsOk = false;
        return this.send(job, system, messages, [], signal);
      }
      throw fail(res.status, message);
    }

    // The answer arrives word by word (server-sent events); every piece is a real sign of life.
    let text = '';
    let finish = '';
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const take = (chunk: { choices?: Array<{ finish_reason?: string | null; delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> } }> }): void => {
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const d = choice.delta;
      if (choice.message) {
        // A server that ignored "stream": the whole answer in one piece.
        text += typeof choice.message.content === 'string' ? choice.message.content : '';
        (choice.message.tool_calls ?? []).forEach((c, i) => calls.set(i, { id: c.id ?? '', name: c.function?.name ?? '', args: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) }));
      }
      if (d?.content) text += d.content;
      for (const c of d?.tool_calls ?? []) {
        const at = c.index ?? 0;
        const cur = calls.get(at) ?? { id: '', name: '', args: '' };
        calls.set(at, { id: c.id || cur.id, name: c.function?.name || cur.name, args: cur.args + (c.function?.arguments ?? '') });
      }
      if (choice.finish_reason) finish = choice.finish_reason;
      words++;
      waitingForFirst = false;
      job.state('running');
      job.alive(d?.reasoning || d?.reasoning_content ? `the model is thinking (${words} pieces received)` : calls.size ? `the model is writing a tool call (${words} pieces received)` : `receiving the answer: ${text.length} characters so far`);
    };
    try {
      if (!(res.headers.get('content-type') ?? '').includes('event-stream')) {
        take((await res.json()) as Parameters<typeof take>[0]);
      } else {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              take(JSON.parse(payload) as Parameters<typeof take>[0]);
            } catch {
              // a half line: the next piece completes it
            }
          }
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      throw new AiError('network', `The answer was cut off after ${text.length} characters: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      window.clearInterval(watch);
      signal.removeEventListener('abort', relay);
    }
    const toolCalls: ToolCall[] = [...calls.entries()].sort((x, y) => x[0] - y[0]).map(([, c], i) => ({ id: c.id || `call_${Date.now()}_${i}`, name: c.name, args: parseArgs(c.args) }));
    if (!text.trim() && !toolCalls.length && finish === 'length') {
      throw new AiError('bad', 'The model ran out of room while it was thinking. Try a model that answers more directly, or one with a bigger context.');
    }
    return { text, toolCalls: toolCalls.filter((c) => c.name) };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(this.url('/models'), { headers: this.headers(), signal });
    } catch (err) {
      throw this.unreachable(err);
    }
    if (!res.ok) throw fail(res.status, await errorMessage(res));
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
  }
}

// ---------------------------------------------------------------- Google Gemini

/** Gemini accepts only a part of JSON Schema: keep what it knows and write the type names its way. */
export function geminiSchema(schema: unknown): Record<string, unknown> {
  const s = (typeof schema === 'object' && schema !== null ? schema : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof s.type === 'string') out.type = s.type.toUpperCase();
  if (typeof s.description === 'string') out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String);
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  if (s.properties && typeof s.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, geminiSchema(v)]));
  }
  if (s.items) out.items = geminiSchema(s.items);
  return out;
}

export class GeminiProvider implements ModelProvider {
  readonly label: string;
  onNote?: (text: string) => void;

  constructor(
    private readonly model: string,
    private readonly key: string,
  ) {
    this.label = model;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': this.key };
  }

  async complete(system: string, messages: ChatMsg[], tools: ToolDecl[], signal: AbortSignal): Promise<ModelReply> {
    const job = jobs.start('google', this.model, { stallAfterSeconds: 60 });
    const started = performance.now();
    try {
      const reply = await this.send(job, system, messages, tools, signal);
      job.done(`answered after ${((performance.now() - started) / 1000).toFixed(1)} s`);
      return reply;
    } catch (err) {
      if (signal.aborted) job.cancel();
      else job.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async send(job: JobHandle, system: string, messages: ChatMsg[], tools: ToolDecl[], signal: AbortSignal): Promise<ModelReply> {
    const contents: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.text ?? '' }] });
      else if (m.role === 'assistant') {
        if (m.raw) contents.push(m.raw as Record<string, unknown>);
        else {
          const parts: Array<Record<string, unknown>> = [];
          if (m.text) parts.push({ text: m.text });
          for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
          contents.push({ role: 'model', parts });
        }
      } else {
        // Every answer to the model's function calls goes back together, as one turn.
        const answer = { functionResponse: { name: m.toolName ?? '', response: { result: parseJsonOr(m.text ?? '') } } };
        const last = contents[contents.length - 1] as { role?: string; parts?: Array<Record<string, unknown>> } | undefined;
        if (last?.role === 'user' && last.parts?.every((p) => 'functionResponse' in p)) last.parts.push(answer);
        else contents.push({ role: 'user', parts: [answer] });
      }
    }
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS },
    };
    if (tools.length) {
      // A function without arguments is declared without `parameters`: Gemini refuses an object with no properties.
      body.tools = [
        {
          functionDeclarations: tools.map((t) => {
            const params = geminiSchema(t.parameters);
            return params.properties && Object.keys(params.properties as object).length ? { name: t.name, description: t.description, parameters: params } : { name: t.name, description: t.description };
          }),
        },
      ];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }
    let res: Response;
    try {
      job.state('waiting');
      res = await fetchWithRetry(`${GEMINI}/models/${encodeURIComponent(this.model)}:generateContent`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal }, signal, {
        timeoutMs: 120000,
        who: 'Google',
        onSent: (n) => job.say(n === 0 ? 'question sent to Google; the answer has not arrived yet' : `question sent again (try ${n + 1}); the answer has not arrived yet`, false),
        onWait: (secs, status, n, of) => {
          const text = status === 0 ? `no answer within 120 s; trying again in ${secs} s (retry ${n} of ${of})` : `Google answered HTTP ${status} (busy); trying again in ${secs} s (retry ${n} of ${of})`;
          job.say(text);
          this.onNote?.(text);
        },
      });
      job.state('running');
      job.alive('an answer arrived; reading it');
    } catch (err) {
      if (signal.aborted) throw err;
      throw new AiError('network', `Could not reach Google. Is the internet working? ${err instanceof Error ? err.message : ''}`.trim());
    }
    if (!res.ok) throw fail(res.status, `${await errorMessage(res)} [Google answered HTTP ${res.status} for the model ${this.model}]`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { role?: string; parts?: Array<Record<string, unknown>> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
    };
    const candidate = data.candidates?.[0];
    if (!candidate?.content) {
      throw new AiError('blocked', data.promptFeedback?.blockReason ? `Google did not answer this one (${data.promptFeedback.blockReason}).` : `Google sent no answer${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}.`);
    }
    const parts = candidate.content.parts ?? [];
    const text = parts.filter((p) => typeof p.text === 'string' && p.thought !== true).map((p) => p.text as string).join('');
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => {
        const call = p.functionCall as { name?: string; args?: unknown };
        return { id: `gemini_${Date.now()}_${i}`, name: call.name ?? '', args: parseArgs(call.args) };
      });
    return { text, toolCalls: toolCalls.filter((c) => c.name), raw: { role: 'model', parts } };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: this.headers(), signal });
    } catch (err) {
      throw new AiError('network', `Could not reach Google. ${err instanceof Error ? err.message : ''}`.trim());
    }
    if (!res.ok) throw fail(res.status, await errorMessage(res));
    const data = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean)
      .sort((a, b) => Number(/flash/.test(b)) - Number(/flash/.test(a)) || a.localeCompare(b));
  }
}

function parseJsonOr(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The provider the settings ask for, or null when it is not set up. */
export function makeProvider(settings: AiSettings = getSettings()): ModelProvider | null {
  if (settings.provider === 'local') {
    return settings.local.baseUrl && settings.local.model ? new OpenAiCompatProvider(settings.local.baseUrl, settings.local.model, getKey('local')) : null;
  }
  return getKey('gemini') && settings.gemini.adultAck ? new GeminiProvider(settings.gemini.model, getKey('gemini')) : null;
}

/** A sentence a child can read for what went wrong. */
export function friendly(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.kind) {
      case 'rate':
        return 'The AI is resting for a moment (too many questions in a short time). Wait a minute and ask again.';
      case 'server':
        return `The AI service is busy right now (${err.message}). I tried a few times. Ask again in a minute, or pick another model in the settings ⚙ (a “lite” or “flash” model is often less busy).`;
      case 'auth':
        return `The AI said no: ${err.message} (a grown-up can check the key in the settings ⚙).`;
      case 'network':
        return err.message;
      case 'blocked':
        return err.message;
      default:
        return `The AI had a problem: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
