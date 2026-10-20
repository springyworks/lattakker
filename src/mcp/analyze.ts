import type { Traffic } from './router';

/**
 * A small packet analyser for the router's traffic log, in the spirit of Wireshark but much simpler:
 *
 *  - every message gets a TYPE (what kind of traffic it is: a heartbeat, a cell read, a tool call, news ...),
 *  - a display FILTER picks messages (`from~ai && ms>50`, `type==tool and !error`),
 *  - analyze() counts the picked messages and tells the story in plain words,
 *  - ask() answers a few everyday questions ("who is busiest?", "any errors?") by choosing a filter for you.
 *
 * Nothing here is estimated or guessed: it only counts what is in the log (the last 400 messages). ask() is a keyword
 * matcher, not an AI: when it does not know a question it says so and shows what it can do.
 * The filter is parsed by hand (no eval), so a filter that comes from outside can do no harm.
 */

/** What kind of traffic a message is. */
export type TrafficType = 'heartbeat' | 'discovery' | 'read' | 'subscribe' | 'news' | 'signal' | 'tool' | 'change' | 'other';

export const TYPE_HELP: Record<TrafficType, string> = {
  heartbeat: 'ping: "are you there?" (the router checks itself every few seconds)',
  discovery: 'initialize / list: asking a server what it has',
  read: 'resources/read: reading a cell or a value',
  subscribe: 'subscribe / unsubscribe: "tell me when this changes"',
  news: 'notifications/resources/updated: a watched thing changed',
  signal: 'mcp.emit(): a cell shouting something to every listener',
  tool: 'tools/call: asking a server to do something',
  change: 'a tool that changes cells (set_code, run_cell ...)',
  other: 'anything else',
};

/** A message with the extra columns the analyser adds (like Wireshark's Protocol and Info columns). */
export interface Packet {
  n: number;
  id: string;
  /** Milliseconds since the page started. */
  time: number;
  /** The moment of the initiative: Unix time in milliseconds, the same for every message of a chain. */
  startedAt: number;
  /** Who started the chain, and who sent this one. */
  origin: string;
  from: string;
  to: string;
  /** Who asked: for an answer that is the receiver, for everything else the sender. */
  asker: string;
  /** Who was asked. */
  asked: string;
  kind: Traffic['kind'];
  method: string;
  type: TrafficType;
  /** The tool of a tools/call, also on its answer. */
  tool: string;
  info: string;
  ms?: number;
  cause: string | null;
}

const CHANGING_TOOLS = new Set(['set_code', 'run_cell', 'set_cells', 'delete_cell', 'move_cell', 'insert_column', 'click', 'signal', 'create_tab', 'close_tab']);

function typeOf(method: string, tool: string): TrafficType {
  if (method === 'ping') return 'heartbeat';
  if (method === 'initialize' || method.endsWith('/list')) return 'discovery';
  if (method === 'resources/read') return 'read';
  if (method === 'resources/subscribe' || method === 'resources/unsubscribe') return 'subscribe';
  if (method === 'notifications/resources/updated') return 'news';
  if (method.startsWith('notifications/') || method.includes('signal')) return 'signal';
  if (method === 'tools/call') return CHANGING_TOOLS.has(tool) ? 'change' : 'tool';
  return 'other';
}

/** Adds type, tool and info to each message. An answer inherits the tool of the question it answers. */
export function toPackets(log: readonly Traffic[]): Packet[] {
  const byId = new Map<string, Traffic>();
  for (const t of log) byId.set(t.id, t);
  const toolOf = (t: Traffic): string => {
    const source = t.kind === 'response' || t.kind === 'error' ? (t.cause ? byId.get(t.cause) : undefined) : t;
    if (!source || source.method !== 'tools/call') return '';
    return /"name":"([^"]+)"/.exec(source.detail)?.[1] ?? '';
  };
  return log.map((t) => {
    const answer = t.kind === 'response' || t.kind === 'error';
    // The page's "ai" is whichever outside AI started the chain: name it (outside-ai:<client>@<model>).
    const outside = t.origin.startsWith('outside-ai') ? t.origin : '';
    const who = (x: string): string => (outside && x === 'ai' ? outside : x);
    const tool = toolOf(t);
    return {
      n: t.n,
      id: t.id,
      time: t.time,
      startedAt: t.startedAt,
      origin: t.origin,
      from: who(t.from),
      to: who(t.to),
      asker: who(answer ? t.to : t.from),
      asked: who(answer ? t.from : t.to),
      kind: t.kind,
      method: t.method,
      type: typeOf(t.method, tool),
      tool,
      info: t.detail,
      ms: t.ms,
      cause: t.cause,
    };
  });
}

// ----------------------------------------------------------------------------------------------- the filter

export class FilterError extends Error {
  constructor(message: string) {
    super(`${message}. ${FILTER_HELP}`);
    this.name = 'FilterError';
  }
}

export const FILTER_HELP =
  'Filter: fields (n, id, time, started, ms, from, to, asker, asked, origin, kind, type, method, tool, info, cause), operators == != ~ (contains) !~ > >= < <=, combine with && || ! and ( ). ' +
  'A lone word searches every text field. Examples: type==tool && ms>20   |   from~ai   |   kind==error   |   asked==weather and !heartbeat   |   origin~lab';

const FIELDS = new Set(['n', 'id', 'time', 'started', 'ms', 'from', 'to', 'asker', 'asked', 'origin', 'kind', 'type', 'method', 'tool', 'info', 'cause']);
const NUMERIC = new Set(['n', 'time', 'started', 'ms']);
const ALIAS: Record<string, string> = { src: 'from', dst: 'to', protocol: 'type', detail: 'info', slow: 'ms', server: 'asked', client: 'asker' };
const TEXT_FIELDS = ['from', 'to', 'origin', 'kind', 'type', 'method', 'tool', 'info'] as const;

type Test = (p: Packet) => boolean;
type Token = { t: 'op' | 'word' | 'str' | '(' | ')' | '&&' | '||' | '!'; v: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (/\s/.test(c)) i++;
    else if (c === '(' || c === ')') (out.push({ t: c, v: c }), i++);
    else if (two === '&&' || two === '||') (out.push({ t: two, v: two }), (i += 2));
    else if (['==', '!=', '>=', '<=', '!~'].includes(two)) (out.push({ t: 'op', v: two }), (i += 2));
    else if (c === '>' || c === '<' || c === '~') (out.push({ t: 'op', v: c }), i++);
    else if (c === '!') (out.push({ t: '!', v: c }), i++);
    else if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) throw new FilterError(`A quote was opened at position ${i} and never closed`);
      out.push({ t: 'str', v: text.slice(i + 1, end) });
      i = end + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s()&|!<>=~"']/.test(text[j])) j++;
      if (j === i) throw new FilterError(`Unexpected "${c}" at position ${i}`);
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === 'and') out.push({ t: '&&', v: '&&' });
      else if (lower === 'or') out.push({ t: '||', v: '||' });
      else if (lower === 'not') out.push({ t: '!', v: '!' });
      else if (lower === 'contains') out.push({ t: 'op', v: '~' });
      else out.push({ t: 'word', v: word });
      i = j;
    }
  }
  return out;
}

/** Turns a filter text into a test. An empty filter matches everything. Throws FilterError with a hint when it cannot be read. */
export function compileFilter(text: string): Test {
  const tokens = tokenize(text);
  if (!tokens.length) return () => true;
  let at = 0;
  const peek = (): Token | undefined => tokens[at];

  const term = (): Test => {
    const tok = tokens[at++];
    if (!tok) throw new FilterError('The filter ends too early');
    if (tok.t === '!') {
      const inner = unary();
      return (p) => !inner(p);
    }
    if (tok.t === '(') {
      const inner = or();
      if (tokens[at++]?.t !== ')') throw new FilterError('A "(" was never closed');
      return inner;
    }
    if (tok.t !== 'word' && tok.t !== 'str') throw new FilterError(`Did not expect "${tok.v}" here`);
    const next = peek();
    const field = ALIAS[tok.v.toLowerCase()] ?? tok.v.toLowerCase();
    if (next?.t === 'op' && tok.t === 'word') {
      at++;
      if (!FIELDS.has(field)) throw new FilterError(`There is no field "${tok.v}"`);
      const valueToken = tokens[at++];
      if (!valueToken || (valueToken.t !== 'word' && valueToken.t !== 'str')) throw new FilterError(`The field "${tok.v}" needs a value after ${next.v}`);
      return compare(field, next.v, valueToken.v);
    }
    // A lone word: look for it in every text field.
    const needle = tok.v.toLowerCase();
    return (p) => TEXT_FIELDS.some((f) => String(p[f]).toLowerCase().includes(needle));
  };

  const unary = (): Test => term();

  const and = (): Test => {
    let left = unary();
    while (peek()?.t === '&&') {
      at++;
      const a = left;
      const b = unary();
      left = (p) => a(p) && b(p);
    }
    return left;
  };

  const or = (): Test => {
    let left = and();
    while (peek()?.t === '||') {
      at++;
      const a = left;
      const b = and();
      left = (p) => a(p) || b(p);
    }
    return left;
  };

  const test = or();
  if (at < tokens.length) throw new FilterError(`Did not expect "${tokens[at].v}" here (use && or || between two parts)`);
  return test;
}

function compare(field: string, op: string, raw: string): Test {
  if (NUMERIC.has(field)) {
    const want = Number(raw);
    if (!Number.isFinite(want)) throw new FilterError(`The field "${field}" is a number, "${raw}" is not`);
    const num = (p: Packet): number | undefined => (field === 'started' ? p.startedAt : p[field as 'n' | 'time' | 'ms']);
    switch (op) {
      case '==': return (p) => num(p) === want;
      case '!=': return (p) => num(p) !== want;
      case '>': return (p) => (num(p) ?? -Infinity) > want;
      case '>=': return (p) => (num(p) ?? -Infinity) >= want;
      case '<': return (p) => (num(p) ?? Infinity) < want;
      case '<=': return (p) => (num(p) ?? Infinity) <= want;
      default: throw new FilterError(`"${op}" is for text fields; the field "${field}" is a number (use == != > >= < <=)`);
    }
  }
  const want = raw.toLowerCase();
  const text = (p: Packet): string => String(p[field as keyof Packet] ?? '').toLowerCase();
  switch (op) {
    case '==': return (p) => text(p) === want;
    case '!=': return (p) => text(p) !== want;
    case '~': return (p) => text(p).includes(want);
    case '!~': return (p) => !text(p).includes(want);
    default: throw new FilterError(`"${op}" is for numbers; the field "${field}" is text (use == != ~ !~)`);
  }
}

// ------------------------------------------------------------------------------------------- the analysis

export interface Analysis {
  filter: string;
  /** How many messages the log holds, and how many of them the filter picked. */
  scanned: number;
  matched: number;
  /** Seconds between the first and the last picked message. */
  seconds: number;
  byType: Array<{ type: TrafficType; count: number; share: number; meaning: string }>;
  byKind: Record<string, number>;
  /** Who asked whom, busiest first. */
  conversations: Array<{ asker: string; asked: string; messages: number; errors: number; avgMs: number; types: string[] }>;
  talkers: Array<{ party: string; asked: number; answered: number }>;
  slowest: Array<{ id: string; asker: string; asked: string; method: string; tool: string; ms: number }>;
  errors: Array<{ id: string; asker: string; asked: string; method: string; info: string }>;
  /** The result in plain sentences. */
  story: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const rank = <K>(map: Map<K, number>): Array<[K, number]> => [...map].sort((a, b) => b[1] - a[1]);
const seconds = (ms: number): string => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${round1(ms / 1000)} s`);

/** Counts the messages a filter picks and says what is going on. */
export function analyze(log: readonly Traffic[], filter = ''): Analysis {
  const test = compileFilter(filter);
  const all = toPackets(log);
  const hit = all.filter(test);
  const types = new Map<TrafficType, number>();
  const kinds: Record<string, number> = {};
  const talk = new Map<string, { asker: string; asked: string; messages: number; errors: number; ms: number; timed: number; types: Set<string> }>();
  const asked = new Map<string, number>();
  const answered = new Map<string, number>();
  for (const p of hit) {
    types.set(p.type, (types.get(p.type) ?? 0) + 1);
    kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    if (p.kind === 'response' || p.kind === 'error') answered.set(p.asked, (answered.get(p.asked) ?? 0) + 1);
    else asked.set(p.asker, (asked.get(p.asker) ?? 0) + 1);
    const key = `${p.asker}\u0000${p.asked}`;
    let c = talk.get(key);
    if (!c) talk.set(key, (c = { asker: p.asker, asked: p.asked, messages: 0, errors: 0, ms: 0, timed: 0, types: new Set() }));
    c.messages++;
    c.types.add(p.type);
    if (p.kind === 'error') c.errors++;
    if (p.ms !== undefined) {
      c.ms += p.ms;
      c.timed++;
    }
  }
  const conversations = [...talk.values()]
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 8)
    .map((c) => ({ asker: c.asker, asked: c.asked, messages: c.messages, errors: c.errors, avgMs: c.timed ? round1(c.ms / c.timed) : 0, types: [...c.types] }));
  const parties = new Set([...asked.keys(), ...answered.keys()]);
  const talkers = [...parties]
    .map((party) => ({ party, asked: asked.get(party) ?? 0, answered: answered.get(party) ?? 0 }))
    .sort((a, b) => b.asked + b.answered - (a.asked + a.answered))
    .slice(0, 6);
  const timed = hit.filter((p) => p.ms !== undefined).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
  const slowest = timed.slice(0, 3).map((p) => ({ id: p.id, asker: p.asker, asked: p.asked, method: p.method, tool: p.tool, ms: p.ms ?? 0 }));
  const errors = hit
    .filter((p) => p.kind === 'error')
    .slice(-5)
    .map((p) => ({ id: p.id, asker: p.asker, asked: p.asked, method: p.method, info: p.info }));
  const span = hit.length > 1 ? hit[hit.length - 1].time - hit[0].time : 0;

  const byType = rank(types).map(([type, count]) => ({ type, count, share: hit.length ? Math.round((count / hit.length) * 100) : 0, meaning: TYPE_HELP[type] }));
  const story: string[] = [];
  if (!hit.length) {
    story.push(filter.trim() ? `No message matches "${filter}" among the last ${all.length}.` : 'The log is empty: nothing has crossed the router yet.');
  } else {
    story.push(`${hit.length} of the last ${all.length} messages${filter.trim() ? ` match "${filter}"` : ''}, over ${seconds(span)}.`);
    if (byType.length) story.push(`Kinds of traffic: ${byType.slice(0, 4).map((t) => `${t.type} ${t.share}%`).join(', ')}.`);
    const top = conversations[0];
    if (top) story.push(`Most talk: ${top.asker} → ${top.asked}, ${top.messages} messages (${top.types.join(', ')})${top.errors ? `, ${top.errors} went wrong` : ''}.`);
    if (slowest[0]?.ms) story.push(`Slowest answer: ${slowest[0].asked} ${slowest[0].tool || slowest[0].method} took ${slowest[0].ms} ms.`);
    story.push(errors.length ? `${errors.length === 5 ? 'At least 5' : errors.length} error${errors.length === 1 ? '' : 's'}: ${errors.map((e) => `${e.asked} ${e.method} (${e.info.slice(0, 50)})`).join('; ')}.` : 'No errors.');
  }
  return { filter, scanned: all.length, matched: hit.length, seconds: round1(span / 1000), byType, byKind: kinds, conversations, talkers, slowest, errors, story };
}

/** The picked messages (newest last) as packets, at most n. */
export function packets(log: readonly Traffic[], filter = '', n = 30): Packet[] {
  const test = compileFilter(filter);
  return toPackets(log).filter(test).slice(-Math.max(1, Math.min(400, Math.floor(n))));
}

/** One line per packet, like the packet list of Wireshark: number, time, who → whom, type, what. */
export function packetLine(p: Packet): string {
  const arrow = p.kind === 'response' ? '←' : p.kind === 'error' ? '✕' : p.kind === 'notification' ? '⇢' : '→';
  const what = p.tool ? `${p.method} ${p.tool}` : p.method;
  return `${String(p.n).padStart(4)} ${(p.time / 1000).toFixed(1).padStart(7)}s  ${p.asker} ${arrow} ${p.asked}  [${p.type}] ${what}${p.ms !== undefined ? ` ${p.ms}ms` : ''}`;
}

// -------------------------------------------------------------------------------------- asking in words

export interface Answer {
  question: string;
  /** The answer in plain words. */
  answer: string;
  /** The filter that was used to find it, so it can be run again by hand. */
  filter: string;
  /** A few of the messages behind the answer. */
  packets: Packet[];
  understood: boolean;
}

const QUESTIONS = [
  'what is going on?  (what kinds of traffic are there)',
  'any errors?',
  'who is busiest?  (who talks most)',
  'what is slow?',
  'what does ai-chat do?  (any name of a cell, tab, helper or server in the log)',
  'what was the last thing?',
  'how many messages?',
  'what can I ask?  (this list, and how to write a filter)',
];

/**
 * Answers a question in words by picking a filter and reading the result. It knows these kinds of question:
 * overview, errors, busiest, slow, last, how many, and "what does <name> do". Anything else gets the list.
 */
export function ask(log: readonly Traffic[], question: string): Answer {
  const q = question.toLowerCase().replace(/[?!.]+$/g, '').trim();
  const all = toPackets(log);
  const reply = (filter: string, answer: string, understood = true, show = 5): Answer => ({ question, answer, filter, packets: packets(log, filter, show), understood });
  const has = (re: RegExp): boolean => re.test(q);

  if (!q || has(/\b(help|what can i ask|syntax|filter|how do i)\b/)) {
    return reply('', `I count what the router saw (the last ${all.length} messages). You can ask: ${QUESTIONS.join(' | ')}. Or give a filter to analyze/packets. ${FILTER_HELP}`, true, 0);
  }

  // A name from the log in the question: "what does lab:A16 do", "talk to weather".
  const names = new Set<string>();
  const callerNames = new Set<string>();
  for (const p of all) {
    names.add(p.from);
    names.add(p.to);
    // An outside AI: outside-ai:claude-code@gpt-5 can be asked about as "claude-code" or "gpt-5".
    const m = /^outside-ai:([^@]+)(?:@(.+))?$/.exec(p.origin);
    if (m) for (const part of [m[1], m[2]]) if (part) callerNames.add(part);
  }
  const named = [...names, ...callerNames].filter((n) => n.length > 1 && q.includes(n.toLowerCase())).sort((a, b) => b.length - a.length)[0];

  if (has(/\b(error|errors|wrong|fail|failed|broke|broken|problem|problems|bad)\b/)) {
    const filter = named ? `kind==error && (asker~${quote(named)} || asked~${quote(named)})` : 'kind==error';
    const a = analyze(log, filter);
    return reply(filter, a.matched ? `${a.matched} error${a.matched === 1 ? '' : 's'}: ${a.errors.map((e) => `${e.asker} asked ${e.asked} for ${e.method} → ${e.info.slice(0, 70)}`).join('; ')}.` : `No errors${named ? ` with ${named}` : ''} in the last ${all.length} messages.`);
  }
  if (has(/\b(slow|slowest|long|latency|takes|fast|speed)\b/)) {
    const a = analyze(log, named ? `asker~${quote(named)} || asked~${quote(named)}` : '');
    const s = a.slowest;
    return reply('ms>0', s.length ? `Slowest answers: ${s.map((x) => `${x.asked} ${x.tool || x.method} ${x.ms} ms (asked by ${x.asker})`).join('; ')}.` : 'No timed answers in the log yet.', true, 3);
  }
  if (has(/\b(busy|busiest|most|loudest|top|talks?|talking|chatty|noisy)\b/) && !named) {
    const a = analyze(log);
    return reply('', a.talkers.length ? `Busiest parties: ${a.talkers.slice(0, 5).map((t) => `${t.party} (asked ${t.asked}, answered ${t.answered})`).join('; ')}. Most talk between: ${a.conversations[0]?.asker} → ${a.conversations[0]?.asked} (${a.conversations[0]?.messages} messages).` : 'Nobody has talked yet.', true, 0);
  }
  if (named) {
    const filter = callerNames.has(named) ? `origin~${quote(named)}` : `from==${quote(named)} || to==${quote(named)}`;
    const a = analyze(log, filter);
    const kinds = a.byType.slice(0, 3).map((t) => `${t.type} ${t.share}%`).join(', ');
    return reply(filter, a.matched ? `${named} is in ${a.matched} messages. Mostly: ${kinds}. ${a.conversations[0] ? `Its main partner: ${a.conversations[0].asker === named || (callerNames.has(named) && a.conversations[0].asker.includes(named)) ? a.conversations[0].asked : a.conversations[0].asker}.` : ''} ${a.errors.length ? `${a.errors.length} error(s).` : 'No errors.'}` : `${named} is not in the last ${all.length} messages.`);
  }
  if (has(/\b(last|latest|recent|just now|newest)\b/)) {
    const a = packets(log, '', 1)[0];
    return reply('', a ? `The last message: ${packetLine(a).trim()}` : 'Nothing has crossed the router yet.', true, 5);
  }
  if (has(/\b(how many|count|number of|total)\b/)) {
    const a = analyze(log);
    return reply('', `${a.scanned} messages in the log: ${Object.entries(a.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}.`, true, 0);
  }
  if (has(/\b(going on|happening|traffic|kinds?|types?|overview|summary|explain|what is)\b/)) {
    const a = analyze(log);
    return reply('', a.story.join(' ') + ' ' + a.byType.slice(0, 4).map((t) => `${t.type}: ${t.meaning}`).join(' | '), true, 0);
  }
  if (has(/\b(ai|helper|chat|outside)\b/)) {
    const a = analyze(log, 'from~ai || to~ai');
    return reply('from~ai || to~ai', a.story.join(' '));
  }
  return reply('', `I did not understand "${question}". I can answer: ${QUESTIONS.join(' | ')}.`, false, 0);
}

const quote = (s: string): string => `"${s.replace(/"/g, '')}"`;
