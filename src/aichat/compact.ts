import type { ChatMsg, ToolDecl } from './providers';

/**
 * Fewer tokens for the same meaning. A paid model charges for every token of the whole conversation, on every
 * round of a tool loop, so what the helper only *reads* is sent without padding: empty fields, spaces, blank
 * lines. Nothing the model could use is changed: the person's words, the model's own turns and the code inside
 * strings stay exactly as they are (the helper may write that code back). The stored chat is not touched; only
 * the copy that goes over the wire is smaller.
 */

const empty = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** The same JSON without the properties that say nothing (null, "", [], {}). Array elements stay, since their place means something. false and 0 stay. */
export function pruneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = pruneJson(v);
      if (!empty(p)) out[k] = p;
    }
    return out;
  }
  return value;
}

/** A tool answer or a text for the model to read: JSON becomes one line without empty fields; other text loses trailing spaces and runs of blank lines. */
export function compactText(text: string): string {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const packed = JSON.stringify(pruneJson(JSON.parse(t)));
      // A number too big for JavaScript would not survive the round trip: then the original is kept.
      if (packed.length < text.length && !/\d{16,}/.test(t)) return packed;
      return text;
    } catch {
      // not JSON (or cut off in the middle): treated as text
    }
  }
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Packed {
  system: string;
  messages: ChatMsg[];
  tools: ToolDecl[];
  /** Characters of the whole request before and after packing. */
  before: number;
  after: number;
}

const sizeOf = (system: string, tools: ToolDecl[], messages: ChatMsg[]): number =>
  system.length + JSON.stringify(tools).length + messages.reduce((n, m) => n + (m.text?.length ?? 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0), 0);

/** The request as it goes out: instructions and tool answers compacted, tool descriptions on one line. The input is not changed. */
export function packRequest(system: string, messages: ChatMsg[], tools: ToolDecl[]): Packed {
  const before = sizeOf(system, tools, messages);
  const out: Packed = {
    system: compactText(system),
    messages: messages.map((m) => (m.role === 'tool' && m.text ? { ...m, text: compactText(m.text) } : m)),
    tools: tools.map((t) => ({ ...t, description: t.description.replace(/\s+/g, ' ').trim() })),
    before,
    after: 0,
  };
  out.after = sizeOf(out.system, out.tools, out.messages);
  return out;
}

/** Models that only cache when told where (Anthropic's, through OpenRouter). Other models cache a repeated start by themselves. */
export const needsCacheMarks = (model: string): boolean => /^anthropic\/|claude/i.test(model);

/**
 * Marks the end of the part of the question that is the same as last time (the instructions, and the history up to
 * the person's latest question) so the provider can read it back at a fraction of the price. Returns new messages.
 */
export function withCacheMarks(wire: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const mark = (m: Record<string, unknown>): Record<string, unknown> => (typeof m.content === 'string' && m.content ? { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] } : m);
  let lastUser = -1;
  wire.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  return wire.map((m, i) => (m.role === 'system' || i === lastUser ? mark(m) : m));
}

/** How much of a cached token's price is still paid (a guess by model family; the real money is what the provider reports). */
export const cacheFactor = (model: string): number => (/anthropic|claude|deepseek/i.test(model) ? 0.1 : /gemini|google/i.test(model) ? 0.25 : 0.5);
