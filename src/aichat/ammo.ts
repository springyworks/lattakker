import type { ChatMsg, ToolDecl } from './providers';

/**
 * The model's "ammunition": how many tokens it can hold in mind at once (its context window), how many the
 * last question really used, and what is left. The numbers that come from the server are measured; only the
 * check *before* a question is an estimate (characters / 3.3, a little pessimistic, because code and JSON
 * use more tokens per character than prose).
 *
 * A model that is asked more than fits does not fail loudly: the server quietly drops the oldest part, which
 * is the helper's own instructions, and the answers turn strange. So before each question the messages are
 * made to fit: old, long tool answers are shortened first, then the oldest turns go.
 */

export interface AmmoState {
  /** The window in tokens, or null when the server does not say. */
  window: number | null;
  /** Tokens the last question used (measured by the server), or null before the first answer. */
  used: number | null;
  /** Tokens of the last answer. */
  reply: number | null;
}

/** Room kept free for the answer itself. */
export const ANSWER_ROOM = 1400;
const CHARS_PER_TOKEN = 3.3;

const state: AmmoState = { window: null, used: null, reply: null };
const listeners: Array<() => void> = [];
const changed = (): void => listeners.forEach((l) => l());

export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export const ammo = {
  get state(): Readonly<AmmoState> {
    return state;
  },
  onChange(listener: () => void): void {
    listeners.push(listener);
  },
  setWindow(window: number | null): void {
    if (state.window === window) return;
    state.window = window;
    changed();
  },
  record(used: number, reply: number): void {
    state.used = used;
    state.reply = reply;
    changed();
  },
  reset(): void {
    state.used = null;
    state.reply = null;
    changed();
  },
  /** How full the window was at the last question, 0 to 1, or null when it is not known. */
  fullness(): number | null {
    return state.window && state.used !== null ? Math.min(1, state.used / state.window) : null;
  },
  /** Characters one tool answer may take: a bit less than a fifth of the room, never more than `cap`. */
  resultChars(cap: number): number {
    if (!state.window) return cap;
    return Math.max(1200, Math.min(cap, Math.floor(state.window * 0.18 * CHARS_PER_TOKEN)));
  },
};

/** "2.1k" for 2100: short enough for a header line. */
export const kilo = (tokens: number): string => (tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k` : String(tokens));

/** The gauge as text, or an empty string when nothing has been measured yet. */
export function gaugeText(): string {
  if (state.used === null) return state.window ? `🔋 chat memory: ${kilo(state.window)} tokens` : '';
  return state.window ? `🔋 ${kilo(state.used)} of ${kilo(state.window)} tokens in use` : `🔋 ${kilo(state.used)} tokens in use`;
}

const textOf = (m: ChatMsg): number => (m.text?.length ?? 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);

export const SHORTENED = '\n… (shortened to save room in the model’s memory)';
const KEEP = 600;

export interface Fitted {
  /** Tokens the question is estimated to take. */
  estimate: number;
  /** Tokens it may take at most (window minus the room for the answer). */
  room: number | null;
  /** How many tool answers were shortened, and how many old messages dropped, to make it fit. */
  shortened: number;
  dropped: number;
  /** True when even the fixed part (instructions and tool descriptions) does not fit. */
  tooBig: boolean;
}

/** Makes the messages fit the window, in place. Does nothing when the window is not known. */
export function fit(system: string, tools: ToolDecl[], messages: ChatMsg[]): Fitted {
  const fixed = system.length + JSON.stringify(tools).length;
  const total = (): number => estimateTokens(fixed + messages.reduce((n, m) => n + textOf(m) + 20, 0));
  const room = state.window ? state.window - ANSWER_ROOM : null;
  const result: Fitted = { estimate: total(), room, shortened: 0, dropped: 0, tooBig: false };
  if (room === null) return result;
  // 1. Shorten the biggest tool answer that is not the newest message.
  while (total() > room) {
    let at = -1;
    messages.forEach((m, i) => {
      if (m.role === 'tool' && i < messages.length - 1 && (m.text?.length ?? 0) > KEEP + SHORTENED.length && (at < 0 || (m.text?.length ?? 0) > (messages[at].text?.length ?? 0))) at = i;
    });
    if (at < 0) break;
    messages[at] = { ...messages[at], text: `${messages[at].text!.slice(0, KEEP)}${SHORTENED}` };
    result.shortened++;
  }
  // 2. Drop the oldest whole turns (up to the next question of the person), but always keep the latest question and what followed.
  while (total() > room) {
    const next = messages.findIndex((m, i) => i > 0 && m.role === 'user');
    if (next < 0) break;
    messages.splice(0, next);
    result.dropped += next;
  }
  // 3. The newest tool answer may be the one that is too big: shorten it as well.
  if (total() > room) {
    const last = messages.length - 1;
    const m = messages[last];
    if (m?.role === 'tool' && (m.text?.length ?? 0) > KEEP + SHORTENED.length) {
      const allowed = Math.max(KEEP, Math.floor((room - estimateTokens(fixed)) * CHARS_PER_TOKEN * 0.5));
      messages[last] = { ...m, text: `${m.text!.slice(0, allowed)}${SHORTENED}` };
      result.shortened++;
    }
  }
  result.estimate = total();
  result.tooBig = estimateTokens(fixed) > room * 0.85;
  return result;
}
