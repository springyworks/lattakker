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

  register(server: McpServer): void {
    this.servers.set(server.name, server);
  }

  /** The names of the servers that can be asked something. */
  names(): string[] {
    return [...this.servers.keys()];
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
      this.record({ from: to, to: from, kind: 'response', method, detail: brief(result), ms: Math.round((performance.now() - started) * 10) / 10 });
      return result;
    } catch (err) {
      const error = err instanceof McpError ? err : new McpError(ERR.internal, err instanceof Error ? err.message : String(err));
      this.record({ from: to, to: from, kind: 'error', method, detail: `${error.code} ${error.message}`, ms: Math.round((performance.now() - started) * 10) / 10 });
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

  private record(entry: Omit<Traffic, 'n' | 'time'>): void {
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
