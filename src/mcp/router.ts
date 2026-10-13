/**
 * The page's own MCP router. Every tab runs an MCP server (see tabServer.ts), and everything that wants
 * something from a tab (a cell's code, an AI helper, later another computer) talks to it by sending
 * JSON-RPC style messages through this router: requests that get an answer, and notifications that
 * do not. The vocabulary is MCP's (`resources/read`, `resources/subscribe`, `notifications/resources/updated`,
 * `tools/call`), so the same messages mean the same thing to an outside MCP client.
 *
 * Why a router in the middle: one place to see everything that happens (the traffic log, a monitor cell can
 * show it live), one place to check who may do what, and one way to reach a tab whether the asker is a cell,
 * an AI helper or a person on another machine.
 *
 * Messages are copied (as JSON) when they cross the router, so nothing live is shared between the sides, and
 * answers always arrive asynchronously, exactly as they would over a real connection. Reading a neighbour
 * cell with at() stays instant and direct (see api.ts); the router is the layer for everything that is a
 * request, a trigger or an event.
 */

export type Json = unknown;

export const ERR = {
  invalidParams: -32602,
  methodNotFound: -32601,
  internal: -32603,
} as const;

export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpServer {
  /** The name other parties use: 'board', 'lab'. */
  readonly name: string;
  /** One sentence on what this server is for (shown in the router's catalog). */
  readonly description?: string;
  handle(method: string, params: Record<string, unknown>, from: string): Promise<Json> | Json;
}

export type Listener = (from: string, method: string, params: Record<string, unknown>) => void;

/** One line of the traffic log. */
export interface Traffic {
  n: number;
  /** Milliseconds since the page started. */
  time: number;
  from: string;
  to: string;
  kind: 'request' | 'response' | 'error' | 'notification';
  method: string;
  /** The parameters or the answer, shortened to a line. */
  detail: string;
  /** How long an answer took. */
  ms?: number;
}

const MAX_LOG = 400;
const DETAIL_CHARS = 110;
/** Most distinct servers, clients and methods the statistics keep apart; the rest are counted together as '(other)'. */
const MAX_KEYS = 200;
/** How many seconds of message counts are kept. */
const HISTORY_SECONDS = 60;

/** What the router has seen, counted. Nothing in here is estimated. */
export interface RouterStats {
  /** Seconds since the page started. */
  uptimeSeconds: number;
  /** Every message that crossed the router (requests, answers, errors, notifications). */
  messages: number;
  requests: number;
  errors: number;
  notifications: number;
  /** Messages per second, averaged over the last 10 seconds. */
  ratePerSecond: number;
  /** Messages in each of the last 60 seconds, oldest first (the last entry is the second that is running). */
  perSecond: number[];
  /** Servers that can be asked something, and how many parties are listening for notifications. */
  serverCount: number;
  listeners: number;
  /** The servers that were asked, busiest first. */
  servers: Array<{ name: string; requests: number; errors: number; avgMs: number; maxMs: number }>;
  /** Who asked (a cell like 'lab:A16', 'ai-chat' ...), busiest first. */
  clients: Array<{ name: string; requests: number; errors: number }>;
  /** What was asked, busiest first. */
  methods: Array<{ method: string; count: number; errors: number; avgMs: number }>;
  /** The slowest answer so far. */
  slowest: { to: string; method: string; ms: number } | null;
}

interface Tally {
  requests: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

const newTally = (): Tally => ({ requests: 0, errors: 0, totalMs: 0, maxMs: 0 });
const round1 = (n: number): number => Math.round(n * 10) / 10;

function bump(map: Map<string, Tally>, key: string, ms: number, failed: boolean): void {
  let t = map.get(key);
  if (!t) {
    if (map.size >= MAX_KEYS) key = '(other)';
    t = map.get(key);
    if (!t) map.set(key, (t = newTally()));
  }
  t.requests++;
  if (failed) t.errors++;
  t.totalMs += ms;
  t.maxMs = Math.max(t.maxMs, ms);
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

function brief(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? '';
  } catch {
    text = String(value);
  }
  return text.length > DETAIL_CHARS ? text.slice(0, DETAIL_CHARS - 1) + '…' : text;
}

export class McpRouter {
  private readonly servers = new Map<string, McpServer>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly log: Traffic[] = [];
  private readonly taps = new Set<(t: Traffic) => void>();
  private counter = 0;
  private readonly count = { requests: 0, errors: 0, notifications: 0, messages: 0 };
  private readonly byServer = new Map<string, Tally>();
  private readonly byClient = new Map<string, Tally>();
  private readonly byMethod = new Map<string, Tally>();
  private slowest: RouterStats['slowest'] = null;
  /** Messages per second: a ring of HISTORY_SECONDS counters, and the second the newest one belongs to. */
  private readonly buckets: number[] = new Array<number>(HISTORY_SECONDS).fill(0);
  private bucketSecond = Math.floor(performance.now() / 1000);
  private statsSince = 0;

  register(server: McpServer): void {
    this.servers.set(server.name, server);
  }

  /** The names of the servers that can be asked something. */
  names(): string[] {
    return [...this.servers.keys()];
  }

  /** What a server says it is for (empty when it does not say). */
  describe(name: string): string {
    return this.servers.get(name)?.description ?? '';
  }

  /** Asks a server something and waits for the answer. `from` says who is asking (it shows in the log and tells the server whom to notify). */
  async request(from: string, to: string, method: string, params: Record<string, unknown> = {}): Promise<Json> {
    const server = this.servers.get(to);
    if (!server) throw new McpError(ERR.invalidParams, `There is no MCP server "${to}". Servers: ${this.names().join(', ')}.`);
    const wire = clone(params);
    const started = performance.now();
    this.record({ from, to, kind: 'request', method, detail: brief(wire) });
    // An answer never comes back in the same breath, just like over a real connection.
    await Promise.resolve();
    try {
      const result = clone(await server.handle(method, wire, from));
      const ms = round1(performance.now() - started);
      this.tally(from, to, method, ms, false);
      this.record({ from: to, to: from, kind: 'response', method, detail: brief(result), ms });
      return result;
    } catch (err) {
      const error = err instanceof McpError ? err : new McpError(ERR.internal, err instanceof Error ? err.message : String(err));
      const ms = round1(performance.now() - started);
      this.tally(from, to, method, ms, true);
      this.record({ from: to, to: from, kind: 'error', method, detail: `${error.code} ${error.message}`, ms });
      throw error;
    }
  }

  /** A server tells one client something. A notification has no answer. */
  notify(from: string, to: string, method: string, params: Record<string, unknown> = {}): void {
    const wire = clone(params);
    this.record({ from, to, kind: 'notification', method, detail: brief(wire) });
    this.deliver(this.listeners.get(to), from, method, wire);
  }

  /** Tells everybody who listens (a signal that is for no one in particular). */
  broadcast(from: string, method: string, params: Record<string, unknown> = {}): void {
    const wire = clone(params);
    this.record({ from, to: '*', kind: 'notification', method, detail: brief(wire) });
    for (const set of this.listeners.values()) this.deliver(set, from, method, wire);
  }

  private deliver(set: Set<Listener> | undefined, from: string, method: string, params: Record<string, unknown>): void {
    if (!set) return;
    for (const listener of [...set]) {
      queueMicrotask(() => {
        try {
          listener(from, method, clone(params));
        } catch (err) {
          console.warn('MCP listener failed', err);
        }
      });
    }
  }

  /** A client says it wants to hear notifications sent to `client`. Returns the way to stop listening. */
  listen(client: string, listener: Listener): () => void {
    let set = this.listeners.get(client);
    if (!set) this.listeners.set(client, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(client);
    };
  }

  // ------------------------------------------------------------------ the traffic log

  private tally(from: string, to: string, method: string, ms: number, failed: boolean): void {
    this.count.requests++;
    if (failed) this.count.errors++;
    bump(this.byServer, to, ms, failed);
    bump(this.byClient, from, ms, failed);
    bump(this.byMethod, method, ms, failed);
    if (!this.slowest || ms > this.slowest.ms) this.slowest = { to, method, ms };
  }

  /** Moves the per-second ring to the second that is running now, emptying the seconds that passed without messages. */
  private advance(second: number): void {
    const gap = Math.min(HISTORY_SECONDS, second - this.bucketSecond);
    for (let i = 0; i < gap; i++) {
      this.buckets.shift();
      this.buckets.push(0);
    }
    this.bucketSecond = second;
  }

  private record(entry: Omit<Traffic, 'n' | 'time'>): void {
    this.count.messages++;
    if (entry.kind === 'notification') this.count.notifications++;
    this.advance(Math.floor(performance.now() / 1000));
    this.buckets[HISTORY_SECONDS - 1]++;
    const line: Traffic = { n: ++this.counter, time: Math.round(performance.now()), ...entry };
    this.log.push(line);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    for (const tap of [...this.taps]) {
      try {
        tap(line);
      } catch {
        // a broken observer must not break the traffic
      }
    }
  }

  /** Everything the router has counted since the page started (or since resetStats). */
  stats(): RouterStats {
    const now = performance.now();
    this.advance(Math.floor(now / 1000));
    const recent = this.buckets.slice(-11, -1);
    const busiest = <T extends { requests?: number; count?: number }>(a: T, b: T): number => (b.requests ?? b.count ?? 0) - (a.requests ?? a.count ?? 0);
    const rows = (map: Map<string, Tally>) => [...map].map(([name, t]) => ({ name, requests: t.requests, errors: t.errors, avgMs: t.requests ? round1(t.totalMs / t.requests) : 0, maxMs: round1(t.maxMs) }));
    return {
      uptimeSeconds: Math.round((now - this.statsSince) / 1000),
      messages: this.count.messages,
      requests: this.count.requests,
      errors: this.count.errors,
      notifications: this.count.notifications,
      ratePerSecond: round1(recent.reduce((a, b) => a + b, 0) / recent.length),
      perSecond: [...this.buckets],
      serverCount: this.servers.size,
      listeners: [...this.listeners.values()].reduce((n, set) => n + set.size, 0),
      servers: rows(this.byServer).sort(busiest),
      clients: rows(this.byClient)
        .map(({ name, requests, errors }) => ({ name, requests, errors }))
        .sort(busiest),
      methods: rows(this.byMethod)
        .map((r) => ({ method: r.name, count: r.requests, errors: r.errors, avgMs: r.avgMs }))
        .sort(busiest),
      slowest: this.slowest ? { ...this.slowest } : null,
    };
  }

  /** Starts the counting again from zero (the traffic log stays). */
  resetStats(): void {
    this.count.requests = this.count.errors = this.count.notifications = this.count.messages = 0;
    this.byServer.clear();
    this.byClient.clear();
    this.byMethod.clear();
    this.slowest = null;
    this.buckets.fill(0);
    this.statsSince = performance.now();
  }

  /** The last `n` messages that crossed the router, oldest first. */
  recent(n = 10): Traffic[] {
    return this.log.slice(-Math.max(1, Math.min(MAX_LOG, Math.floor(n))));
  }

  /** Watch every message as it happens. Returns the way to stop. */
  tap(observer: (t: Traffic) => void): () => void {
    this.taps.add(observer);
    return () => {
      this.taps.delete(observer);
    };
  }
}

/** The one router of the page. */
export const router = new McpRouter();
