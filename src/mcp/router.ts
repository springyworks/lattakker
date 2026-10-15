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

import { estimate, sentence, type Eta } from './eta';

export type Json = unknown;

export const ERR = {
  invalidParams: -32602,
  methodNotFound: -32601,
  internal: -32603,
  /** The deadline of a request passed before the answer came (MCP: requests SHOULD have timeouts, with a maximum). */
  timeout: -32001,
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

/**
 * Where a message comes from, so any message can be followed back to whoever started it (like the headers of an
 * e-mail, or `git log` for traffic). Every message gets an id; a message that is sent because of another one says
 * which (`cause`), and keeps the `origin` and the `lineage` (the parties the chain passed through) of that one.
 *
 * A party that handles a message and sends another because of it passes the trace it got as the last argument
 * (`router.request(from, to, method, params, trace)`). An outside party (another page, a client over /mcp) can say
 * the same in the standard place: `params._meta['lattakker/trace'] = { origin, lineage, id, startedAt }`.
 *
 * Every message that crosses the router (the request and the notification in `params._meta`, the answer in `result._meta`) carries
 * `_meta['lattakker/trace'] = { id, origin, lineage, startedAt, cause }`, so the single moment the initiative was taken, as Unix time in
 * milliseconds, is in the message itself, wherever it ends up (a log, a file, an outside AI).
 */
export interface Trace {
  /** Unique across pages: the page's session code, a dash and a counter ('k3f9-152'). */
  id: string;
  /** Who started the whole chain: a cell ('lab:A16'), 'you', 'ai-chat', 'outside-ai' ... */
  origin: string;
  /** Every party the chain passed through, first to last; the last is the sender of this message. */
  lineage: string[];
  /** The message that made this one happen, or null at the start of a chain. */
  cause: string | null;
  /**
   * The moment of the initiative: the Unix time in milliseconds (Date.now(), since 1970-01-01 UTC; divide by 1000 for Unix seconds) at which
   * the chain this message belongs to was started. There is one initiative per chain, so every message of the chain carries the same number,
   * the answers too. It rides in every message as `_meta['lattakker/trace'].startedAt`.
   */
  startedAt: number;
  /**
   * The moment (Unix ms) by which the one who asks stops waiting for the answer to this message. It is absolute, not "so long from now", so it
   * can be handed on: a request made because of another one never waits longer than the one that caused it (no wait can outlive the first
   * initiative, so a chain of waits can never be a deadlock that lasts). The router enforces it: an answer that is late becomes an error (-32001).
   */
  deadline: number;
}

export interface McpServer {
  /** The name other parties use: 'board', 'lab'. */
  readonly name: string;
  /** One sentence on what this server is for (shown in the router's catalog). */
  readonly description?: string;
  /** `trace` says where the request came from; a server that asks others because of it passes it on. */
  handle(method: string, params: Record<string, unknown>, from: string, trace?: Trace): Promise<Json> | Json;
}

export type Listener = (from: string, method: string, params: Record<string, unknown>, trace?: Trace) => void;

/** One recorded change to something (a cell's code ...): who made it, through which message, and what it was before. */
export interface Change {
  n: number;
  /** Milliseconds since the page started, and the clock time. */
  time: number;
  at: string;
  /** What changed: 'lab/J24', or the cell's uid 'c-1a2b3c4d'. */
  subject: string;
  /** What was done: the tool, like 'set_code'. */
  action: string;
  /** The moment of the initiative that led to this change: Unix time in milliseconds. */
  startedAt: number;
  /** Who started it, the parties it passed through, and the message that carried it. */
  by: string;
  lineage: string[];
  msg: string;
  cause: string | null;
  /** Short fingerprints of the content before and after: equal means nothing really changed. */
  beforeHash: string;
  afterHash: string;
  /** The content itself (shortened to MAX_KEPT_CHARS), so a change can be undone from the record. */
  before?: string;
  after?: string;
}

/** One line of the traffic log. */
export interface Traffic {
  n: number;
  /** The message id (see Trace), who started the chain it belongs to, and the message that caused it. */
  id: string;
  origin: string;
  cause: string | null;
  /** The way it went, from the one who started it to the receiver: ['you', 'ai-chat', 'router', 'board']. */
  hops: string[];
  /** Milliseconds since the page started. */
  time: number;
  /** The moment of the initiative of the chain this message belongs to: Unix time in milliseconds (see Trace). */
  startedAt: number;
  /** The moment this message itself was sent: Unix time in milliseconds. */
  sentAt: number;
  /** The moment by which the asker stops waiting (see Trace). */
  deadline: number;
  from: string;
  to: string;
  kind: 'request' | 'response' | 'error' | 'notification';
  method: string;
  /** The parameters or the answer, shortened to a line. */
  detail: string;
  /** How long an answer took. */
  ms?: number;
}

/** How long a request may wait for its answer, by the server asked (the model and the helper may think for minutes), and the longest any chain may live. */
const DEFAULT_WAIT_MS = 60_000;
const WAIT_MS: Record<string, number> = { ollama: 600_000, helper: 600_000, 'local-ai': 600_000, memory: 120_000, board: 120_000, lab: 120_000, examples: 120_000, monitor: 120_000 };
const CHAIN_MAX_MS = 600_000;
/** A request that has waited this long (then twice as long, and so on up to 15 s) is acknowledged with a progress notification. */
const PROGRESS_FIRST_MS = 1000;
const PROGRESS_MAX_GAP_MS = 15_000;
/** The times of the latest answers per kind of request, for the estimate of how long to wait. */
const LATENCY_KEPT = 60;
const LATENCY_KEYS = 300;
const DEADLINE_META = 'lattakker/deadlineMs';

/** One request on its way: sent, not answered. */
interface Flight {
  trace: Trace;
  from: string;
  to: string;
  method: string;
  /** 'tools/call forecast': what is asked, for words. */
  label: string;
  /** What the latency history is kept under: the server and what is asked. */
  key: string;
  sentAt: number;
  startedPerf: number;
  acks: number;
  timers: Array<ReturnType<typeof setTimeout>>;
}

export interface PendingRequest {
  id: string;
  from: string;
  to: string;
  what: string;
  origin: string;
  startedAt: number;
  sentAt: number;
  deadline: number;
  elapsedMs: number;
  remainingMs: number;
  /** How many progress acknowledgements have been sent for it. */
  acknowledged: number;
  /** The estimate, when there is history (null fields: no honest guess). */
  waitMs: number | null;
  p: number | null;
  basis: number;
  typicalMs: number | null;
}

/** The estimate as it rides in a message and in the list of pending requests. */
function etaMeta(elapsedMs: number, deadline: number, eta: Eta | null): { elapsedMs: number; deadline: number; waitMs: number | null; p: number | null; basis: number; typicalMs: number | null } {
  return { elapsedMs, deadline, waitMs: eta?.waitMs ?? null, p: eta?.p ?? null, basis: eta?.basis ?? 0, typicalMs: eta?.typicalMs ?? null };
}

const MAX_LOG = 400;
const MAX_CHANGES = 100;
const MAX_KEPT_CHARS = 4000;
const MAX_LINEAGE = 8;
/** Where a trace rides inside the params of a message that comes from outside: params._meta[TRACE_META]. */
export const TRACE_META = 'lattakker/trace';
const META_KEY = TRACE_META;
/** Tells pages apart: ids made here start with it. */
const SESSION = Math.random().toString(36).slice(2, 6);
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

/** A short fingerprint of a text (FNV-1a), enough to see whether two versions are the same. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const short = (v: unknown, max = 80): string => String(v ?? '').slice(0, max);

/** A Unix time in milliseconds from outside is believed when it is a whole number between 2001 and 2100; otherwise the initiative is taken to be now. */
const sane = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 1e12 && v < 4.2e12 ? Math.round(v) : Date.now());

/** What every message carries about its chain, in the standard place for such things (`_meta`). */
function traceMeta(trace: Trace): Record<string, unknown> {
  return { id: trace.id, origin: trace.origin, lineage: trace.lineage, startedAt: trace.startedAt, sentAt: Date.now(), deadline: trace.deadline, ...(trace.cause ? { cause: trace.cause } : {}) };
}

/** Puts the trace into the `_meta` of a message body (an object); anything else (a list, a number) is left as it is. */
function withMeta<T>(body: T, trace: Trace): T {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const own = body as Record<string, unknown>;
  const meta = typeof own._meta === 'object' && own._meta !== null && !Array.isArray(own._meta) ? (own._meta as Record<string, unknown>) : {};
  return { ...own, _meta: { ...meta, [META_KEY]: traceMeta(trace) } } as T;
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
  private readonly changes: Change[] = [];
  private changeCounter = 0;
  /** When each server joined, and when it was last asked. */
  private readonly joined = new Map<string, { since: number; seen: number }>();
  /** The page's own code for itself in a trace: ids made here start with it. */
  readonly session = SESSION;
  private readonly started = Date.now();
  private readonly count = { requests: 0, errors: 0, notifications: 0, messages: 0 };
  private readonly byServer = new Map<string, Tally>();
  private readonly byClient = new Map<string, Tally>();
  private readonly byMethod = new Map<string, Tally>();
  private slowest: RouterStats['slowest'] = null;
  /** Requests that have been sent and not answered yet, and how long the latest answers of each kind took. */
  private readonly flights = new Map<string, Flight>();
  private readonly latency = new Map<string, number[]>();
  /** Messages per second: a ring of HISTORY_SECONDS counters, and the second the newest one belongs to. */
  private readonly buckets: number[] = new Array<number>(HISTORY_SECONDS).fill(0);
  private bucketSecond = Math.floor(performance.now() / 1000);
  private statsSince = 0;

  register(server: McpServer): void {
    this.servers.set(server.name, server);
    this.joined.set(server.name, { since: Math.round(performance.now()), seen: 0 });
  }

  /** A server goes away (its tab was closed). */
  unregister(name: string): void {
    this.servers.delete(name);
    this.joined.delete(name);
  }

  /** The servers of this page, who they are and how much they have been asked: the endpoints that identify themselves in the traffic. */
  endpoints(): Array<{ name: string; description: string; since: number; lastAsked: number | null; asked: number; errors: number }> {
    return [...this.servers.values()].map((s) => {
      const j = this.joined.get(s.name);
      const t = this.byServer.get(s.name);
      return { name: s.name, description: s.description ?? '', since: j?.since ?? 0, lastAsked: j?.seen ? j.seen : null, asked: t?.requests ?? 0, errors: t?.errors ?? 0 };
    });
  }

  /** Who this page is, as a party in a trace. */
  identity(): { session: string; started: string; page: string } {
    return { session: SESSION, started: new Date(this.started).toISOString(), page: typeof location === 'undefined' ? 'unknown' : location.host };
  }

  /**
   * The start of a chain for a party that is not an MCP server of this page: an outside AI that came in over
   * /mcp (`router.origin('outside-ai', ['mcp-bridge'])`), a person typing. Pass the result as the last argument of request().
   */
  origin(origin: string, relays: string[] = [], startedAt: number = Date.now()): Trace {
    return { id: '', origin: short(origin), lineage: [short(origin), ...relays.map((r) => short(r))].slice(0, MAX_LINEAGE), cause: null, startedAt: sane(startedAt), deadline: sane(startedAt) + CHAIN_MAX_MS };
  }

  /** A trace that came in as `params._meta['lattakker/trace']` (from another page or an outside client), made safe to use. */
  private metaTrace(params: Record<string, unknown>): Trace | undefined {
    const meta = params._meta;
    const raw = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>)[META_KEY] : undefined;
    if (typeof raw !== 'object' || raw === null) return undefined;
    const t = raw as Record<string, unknown>;
    if (typeof t.origin !== 'string' || !t.origin) return undefined;
    const lineage = Array.isArray(t.lineage) ? t.lineage.filter((x): x is string => typeof x === 'string').slice(0, MAX_LINEAGE).map((x) => short(x)) : [short(t.origin)];
    return { id: typeof t.id === 'string' ? short(t.id, 40) : '', origin: short(t.origin), lineage: lineage.length ? lineage : [short(t.origin)], cause: null, startedAt: sane(t.startedAt), deadline: sane(t.deadline ?? Date.now() + CHAIN_MAX_MS) };
  }

  /** The server gets the arguments without the trace that rode along in `_meta` (it has the trace as its own argument). */
  private stripMeta(wire: Record<string, unknown>, own: Trace | undefined): void {
    if (!own || typeof wire._meta !== 'object' || !wire._meta) return;
    delete (wire._meta as Record<string, unknown>)[META_KEY];
    if (!Object.keys(wire._meta).length) delete wire._meta;
  }

  /** The trace of the message being sent: it continues `via` (the message that caused it) or starts a new chain at `from`. */
  private stamp(from: string, via: Trace | undefined, own: Trace | undefined): Trace {
    const id = `${SESSION}-${this.counter + 1}`;
    // A trace that rides in the message itself (from another page or client) says more than the one the local code passes.
    const base = own ?? via;
    if (!base) return { id, origin: from, lineage: [from], cause: null, startedAt: Date.now(), deadline: Date.now() + CHAIN_MAX_MS };
    const lineage = base.lineage[base.lineage.length - 1] === from ? base.lineage : [...base.lineage, from].slice(-MAX_LINEAGE);
    return { id, origin: base.origin, lineage, cause: base.id || null, startedAt: sane(base.startedAt), deadline: base.deadline };
  }

  /** The names of the servers that can be asked something. */
  names(): string[] {
    return [...this.servers.keys()];
  }

  /** What a server says it is for (empty when it does not say). */
  describe(name: string): string {
    return this.servers.get(name)?.description ?? '';
  }

  /**
   * Asks a server something and waits for the answer. `from` says who is asking (it shows in the log and tells the server whom to notify).
   * The wait has a deadline: by default the one of the server asked (60 s, or longer for the model and the helper), never later than the deadline of
   * the message that caused this one, and the asker can set its own with params._meta['lattakker/deadlineMs']. A request that is still
   * waiting after a second is acknowledged now and then with a `notifications/progress` that says how long it has waited, when the deadline is, and
   * (from the times of similar answers) how much longer it is worth waiting.
   */
  async request(from: string, to: string, method: string, params: Record<string, unknown> = {}, via?: Trace): Promise<Json> {
    const server = this.servers.get(to);
    if (!server) throw new McpError(ERR.invalidParams, `There is no MCP server "${to}". Servers: ${this.names().join(', ')}.`);
    const wire = clone(params);
    const own = this.metaTrace(wire);
    const asked = this.askedWait(wire);
    this.stripMeta(wire, own);
    const started = performance.now();
    const base = this.stamp(from, via, own);
    const now = Date.now();
    // A trace that is older than its own deadline (a notification answered much later) does not shorten anything.
    const inherited = base.deadline > now ? base.deadline : Number.POSITIVE_INFINITY;
    const deadline = Math.min(inherited, now + (asked ?? WAIT_MS[to] ?? DEFAULT_WAIT_MS));
    const trace: Trace = { ...base, deadline };
    const joined = this.joined.get(to);
    if (joined) joined.seen = Math.round(started);
    this.record({ from, to, kind: 'request', method, detail: brief(wire) }, trace, [...trace.lineage, 'router', to]);
    const flight = this.openFlight(trace, from, to, method, wire, started);
    // An answer never comes back in the same breath, just like over a real connection.
    await Promise.resolve();
    try {
      const result = clone(await this.within(flight, () => server.handle(method, withMeta(wire, trace), from, trace)));
      const ms = round1(performance.now() - started);
      this.tally(from, to, method, ms, false);
      this.remember(flight.key, ms);
      const answer = { ...trace, id: `${SESSION}-${this.counter + 1}`, cause: trace.id, lineage: [...trace.lineage, to].slice(-MAX_LINEAGE) };
      this.record({ from: to, to: from, kind: 'response', method, detail: brief(result), ms }, answer, [to, 'router', ...trace.lineage.slice().reverse()]);
      return withMeta(result, answer);
    } catch (err) {
      const error = err instanceof McpError ? err : new McpError(ERR.internal, err instanceof Error ? err.message : String(err));
      const ms = round1(performance.now() - started);
      this.tally(from, to, method, ms, true);
      this.record({ from: to, to: from, kind: 'error', method, detail: `${error.code} ${error.message}`, ms }, { ...trace, id: `${SESSION}-${this.counter + 1}`, cause: trace.id, lineage: [...trace.lineage, to].slice(-MAX_LINEAGE) }, [to, 'router', ...trace.lineage.slice().reverse()]);
      throw error;
    } finally {
      this.closeFlight(flight);
    }
  }

  /** The wait the asker asked for, in ms (params._meta['lattakker/deadlineMs']), kept between 1 s and the longest chain. */
  private askedWait(wire: Record<string, unknown>): number | undefined {
    const meta = wire._meta;
    const v = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>)[DEADLINE_META] : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(CHAIN_MAX_MS, Math.max(1000, Math.round(v))) : undefined;
  }

  /** Runs `work`, but stops waiting at the deadline of the flight: a late answer is an error, and what it brings is thrown away. */
  private within<T>(flight: Flight, work: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waited = Math.round(performance.now() - flight.startedPerf);
        reject(
          new McpError(
            ERR.timeout,
            `${flight.to} did not answer ${flight.label} within ${(waited / 1000).toFixed(1)} s: the deadline passed (Unix ms ${flight.trace.deadline}). Ask for more time with params._meta["${DEADLINE_META}"] (milliseconds, at most ${CHAIN_MAX_MS}).`,
          ),
        );
      }, Math.max(0, flight.trace.deadline - Date.now()));
      flight.timers.push(timer);
      try {
        Promise.resolve(work()).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  private openFlight(trace: Trace, from: string, to: string, method: string, wire: Record<string, unknown>, startedPerf: number): Flight {
    const tool = method === 'tools/call' && typeof wire.name === 'string' ? wire.name : '';
    const label = tool ? `${method} ${tool}` : method;
    const flight: Flight = { trace, from, to, method, label, key: `${to} ${label}`, sentAt: Date.now(), startedPerf, acks: 0, timers: [] };
    this.flights.set(trace.id, flight);
    let gap = PROGRESS_FIRST_MS;
    const tick = (): void => {
      if (!this.flights.has(trace.id)) return;
      this.acknowledge(flight);
      gap = Math.min(PROGRESS_MAX_GAP_MS, gap * 2);
      flight.timers.push(setTimeout(tick, gap));
    };
    flight.timers.push(setTimeout(tick, gap));
    return flight;
  }

  private closeFlight(flight: Flight): void {
    for (const t of flight.timers) clearTimeout(t);
    flight.timers.length = 0;
    this.flights.delete(flight.trace.id);
  }

  /** MCP's own way to say "still working": a progress notification to the asker, with words and the estimate in _meta. */
  private acknowledge(f: Flight): void {
    const elapsedMs = Math.round(performance.now() - f.startedPerf);
    const remainingMs = f.trace.deadline - Date.now();
    const eta = estimate(this.latency.get(f.key) ?? [], elapsedMs);
    f.acks++;
    this.notify(
      f.to,
      f.from,
      'notifications/progress',
      { progressToken: f.trace.id, progress: elapsedMs, message: sentence(f.to, f.label, elapsedMs, remainingMs, eta), _meta: { 'lattakker/eta': etaMeta(elapsedMs, f.trace.deadline, eta) } },
      f.trace,
    );
  }

  private remember(key: string, ms: number): void {
    let list = this.latency.get(key);
    if (!list) {
      if (this.latency.size >= LATENCY_KEYS) this.latency.delete(this.latency.keys().next().value as string);
      this.latency.set(key, (list = []));
    }
    list.push(ms);
    if (list.length > LATENCY_KEPT) list.shift();
  }

  /** The requests that have been sent and not answered yet: since when, until when, and (when there is history) how much longer it is worth waiting. */
  pending(): PendingRequest[] {
    const now = Date.now();
    return [...this.flights.values()].map((f) => {
      const elapsedMs = Math.round(performance.now() - f.startedPerf);
      return {
        id: f.trace.id,
        from: f.from,
        to: f.to,
        what: f.label,
        origin: f.trace.origin,
        startedAt: f.trace.startedAt,
        sentAt: f.sentAt,
        remainingMs: Math.max(0, f.trace.deadline - now),
        acknowledged: f.acks,
        ...etaMeta(elapsedMs, f.trace.deadline, estimate(this.latency.get(f.key) ?? [], elapsedMs)),
      };
    });
  }

  /** A server tells one client something. A notification has no answer. Returns its trace, for a message that follows from it. */
  notify(from: string, to: string, method: string, params: Record<string, unknown> = {}, via?: Trace): Trace {
    const wire = clone(params);
    const own = this.metaTrace(wire);
    this.stripMeta(wire, own);
    const trace = this.stamp(from, via, own);
    this.record({ from, to, kind: 'notification', method, detail: brief(wire) }, trace, [...trace.lineage, 'router', to]);
    this.deliver(this.listeners.get(to), from, method, withMeta(wire, trace), trace);
    return trace;
  }

  /** Tells everybody who listens (a signal that is for no one in particular). */
  broadcast(from: string, method: string, params: Record<string, unknown> = {}, via?: Trace): Trace {
    const wire = clone(params);
    const own = this.metaTrace(wire);
    this.stripMeta(wire, own);
    const trace = this.stamp(from, via, own);
    this.record({ from, to: '*', kind: 'notification', method, detail: brief(wire) }, trace, [...trace.lineage, 'router', '*']);
    const stamped = withMeta(wire, trace);
    for (const set of this.listeners.values()) this.deliver(set, from, method, stamped, trace);
    return trace;
  }

  private deliver(set: Set<Listener> | undefined, from: string, method: string, params: Record<string, unknown>, trace: Trace): void {
    if (!set) return;
    for (const listener of [...set]) {
      queueMicrotask(() => {
        try {
          listener(from, method, clone(params), trace);
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

  private record(entry: Omit<Traffic, 'n' | 'time' | 'id' | 'origin' | 'cause' | 'hops' | 'startedAt' | 'sentAt' | 'deadline'>, trace: Trace, hops: string[]): void {
    this.count.messages++;
    if (entry.kind === 'notification') this.count.notifications++;
    this.advance(Math.floor(performance.now() / 1000));
    this.buckets[HISTORY_SECONDS - 1]++;
    const line: Traffic = { n: ++this.counter, id: trace.id, origin: trace.origin, cause: trace.cause, hops, time: Math.round(performance.now()), startedAt: trace.startedAt, sentAt: Date.now(), deadline: trace.deadline, ...entry };
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

  // ------------------------------------------------------------------ provenance: following a message back

  /** One message from the log by its id, or undefined (it may be older than the log keeps). */
  message(id: string): Traffic | undefined {
    return this.log.find((m) => m.id === id);
  }

  /** What led to a message: the message that caused it, and the one that caused that ... oldest first, ending with the message itself. */
  chain(id: string): Traffic[] {
    const out: Traffic[] = [];
    let at = this.message(id);
    for (let i = 0; at && i < 50; i++) {
      out.unshift(at);
      at = at.cause ? this.message(at.cause) : undefined;
    }
    return out;
  }

  /** What a message led to: the messages it caused, and what those caused (breadth first, up to `limit`). */
  effects(id: string, limit = 40): Traffic[] {
    const out: Traffic[] = [];
    const queue = [id];
    while (queue.length && out.length < limit) {
      const parent = queue.shift()!;
      for (const m of this.log) {
        if (m.cause === parent && out.length < limit) {
          out.push(m);
          queue.push(m.id);
        }
      }
    }
    return out;
  }

  /**
   * Writes down that something was changed because of a message: who made the change, through which message, and
   * what it was before (so it can be undone from the record). A short list, oldest dropped first.
   */
  noteChange(trace: Trace | undefined, change: { subject: string; action: string; before?: string; after?: string }): Change {
    const clip = (t: string | undefined): string | undefined => (t === undefined ? undefined : t.length > MAX_KEPT_CHARS ? t.slice(0, MAX_KEPT_CHARS) : t);
    const entry: Change = {
      n: ++this.changeCounter,
      time: Math.round(performance.now()),
      at: new Date().toISOString(),
      startedAt: trace?.startedAt ?? Date.now(),
      subject: change.subject,
      action: change.action,
      by: trace?.origin ?? '?',
      lineage: trace?.lineage ?? [],
      msg: trace?.id ?? '',
      cause: trace?.cause ?? null,
      beforeHash: fingerprint(change.before ?? ''),
      afterHash: fingerprint(change.after ?? ''),
      before: clip(change.before),
      after: clip(change.after),
    };
    this.changes.push(entry);
    if (this.changes.length > MAX_CHANGES) this.changes.splice(0, this.changes.length - MAX_CHANGES);
    return entry;
  }

  /** The recorded changes, oldest first; only those of one subject when given. */
  history(subject?: string): Change[] {
    return subject ? this.changes.filter((c) => c.subject === subject || c.subject.endsWith(`/${subject}`)) : [...this.changes];
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
