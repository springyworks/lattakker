import { router, type Trace } from '../mcp/router';

/**
 * How an outside AI got in. The tools in surface.ts do not know whether they were called by a client over the dev
 * server's /mcp, by the page's own WebMCP or from the browser console (window.mms). The bridge says so around the
 * call, and the tools use it to give the messages they make an origin (see Trace in mcp/router.ts).
 */

/** What is known about whoever is calling: the more the better, it all shows up in the traffic. */
export interface Caller {
  /** The program: from the MCP initialize (clientInfo.name), a header, or the HTTP user agent. */
  client?: string;
  version?: string;
  /** The AI model behind it, when it says (a header, _meta, clientInfo, or the introduce tool). */
  model?: string;
  /** The raw HTTP user agent. */
  agent?: string;
  protocol?: string;
  /** Stable for one conversation (the MCP session id, else address + user agent): the README gate is per key. */
  key?: string;
  /** A note the caller gave about itself (introduce). */
  note?: string;
  /** The moment this call began, as the one who made it took the initiative: Unix time in milliseconds. */
  startedAt?: number;
}

/** A caller as the page has seen it, counted. */
export interface CallerRecord extends Caller {
  origin: string;
  via: string;
  calls: number;
  /** Milliseconds since the page started. */
  first: number;
  last: number;
}

let channel: { name: string; caller: Caller } | null = null;
const seen = new Map<string, CallerRecord>();
const MAX_CALLERS = 50;

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[^\w ./:@()+-]/g, '').trim().slice(0, max);
  return t || undefined;
};

/** The origin an outside caller gets in the traffic: outside-ai:<client>@<model>. */
export function originOf(c: Caller): string {
  const client = clean(c.client, 40);
  const model = clean(c.model, 40);
  if (!client && !model) return 'outside-ai';
  return `outside-ai:${client ?? 'unknown'}${model ? '@' + model : ''}`;
}

/** Runs `fn` (synchronously up to its first await) as a call that came in through `name`, from `caller`. */
export function throughChannel<T>(name: string, caller: Caller | undefined, fn: () => T): T {
  const before = channel;
  const c: Caller = { client: clean(caller?.client, 40), version: clean(caller?.version, 30), model: clean(caller?.model, 40), agent: clean(caller?.agent, 80), protocol: clean(caller?.protocol, 20), key: clean(caller?.key, 80), note: clean(caller?.note, 120), startedAt: typeof caller?.startedAt === 'number' && Number.isFinite(caller.startedAt) ? caller.startedAt : undefined };
  channel = { name, caller: c };
  const origin = originOf(c);
  const now = Math.round(performance.now());
  const known = seen.get(origin);
  if (known) Object.assign(known, { ...c, origin, via: name, calls: known.calls + 1, last: now });
  else {
    if (seen.size >= MAX_CALLERS) seen.delete(seen.keys().next().value as string);
    seen.set(origin, { ...c, origin, via: name, calls: 1, first: now, last: now });
  }
  try {
    return fn();
  } finally {
    channel = before;
  }
}

/** Everyone who has called in from outside, newest first. */
export function callers(): CallerRecord[] {
  return [...seen.values()].sort((a, b) => b.last - a.last);
}

/** The caller of the call that is running right now (null for the page's own console). */
export function currentCaller(): (Caller & { origin: string; via: string }) | null {
  return channel ? { ...channel.caller, origin: originOf(channel.caller), via: channel.name } : null;
}

/** The start of a chain for what an outside AI does right now: 'outside-ai:<client>@<model>' through the channel it used. */
export function outsideTrace(): Trace {
  if (!channel) return router.origin('console-or-webmcp');
  return router.origin(originOf(channel.caller), [channel.name], channel.caller.startedAt);
}

/** Who is calling, when it is an outside AI that came in through the bridge or WebMCP (null for the page's own console). */
export function participant(): string | null {
  if (!channel) return null;
  const c = channel.caller;
  return `${channel.name}:${c.key ?? c.client ?? ''}`;
}
