import type { Plugin, ViteDevServer } from 'vite';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dev-only MCP endpoint at /mcp (Streamable HTTP, stateless, JSON responses only).
 * Tool calls travel over Vite's own HMR socket to a page opened with ?mcp, so there is no extra port or package.
 */

const PROTOCOL_VERSION = '2025-06-18';
const PAGE_TTL_MS = 6000;
const CALL_TIMEOUT_MS = 125000; // a question to the local model may take two minutes (it has its own limit)
const MAX_BODY = 1_000_000;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const NO_PAGE =
  'No Lattakker page is connected. Ask the player to run "npm run dev" and open http://localhost:5178/?mcp in a browser, then try again.';
const INSTRUCTIONS =
  'Lattakker sheet: a Lattakker board game (Red = the child, Blue = the computer) that is also a spreadsheet whose cells hold TypeScript. ' +
  'FIRST read the README, the place of truth: https://github.com/springyworks/lattakker/blob/main/README.md (raw: https://raw.githubusercontent.com/springyworks/lattakker/main/README.md). If you cannot open links, call read_readme (it fetches it for you) or confirm_readme: until you have, your first tool call is answered with the rules instead of being carried out. ' +
  'Start with get_state and get_board. Every cell has a stable uid (c-xxxxxxxx) that follows its content when cells move; resolve_cell turns an address or uid into the current address.';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

interface PageLink {
  send(event: string, payload?: unknown): void;
  seen: number;
}

/** What is known about whoever calls (see Caller in src/ai/entry.ts, which cleans it again on the page). */
interface Caller {
  client?: string;
  version?: string;
  model?: string;
  agent?: string;
  protocol?: string;
  key?: string;
  note?: string;
  /** The moment the caller took the initiative (this request arrived): Unix time in milliseconds. */
  startedAt?: number;
}

/** What one HTTP request says about its sender, before the JSON-RPC message is looked at. */
interface Who {
  sid?: string;
  address: string;
  agent?: string;
  headerClient?: string;
  headerModel?: string;
}

const MAX_SESSIONS = 100;
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.replace(/[^\w ./:@()+-]/g, '').trim().slice(0, max) || undefined : undefined);
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneHeader = (req: IncomingMessage, name: string, max: number): string | undefined => {
  const v = req.headers[name];
  return text(Array.isArray(v) ? v[0] : v, max);
};

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MAX_BODY) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}

export function mcpBridge(): Plugin {
  return {
    name: 'lattakker-mcp-bridge',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      let page: PageLink | null = null;
      let tools: Tool[] = [];
      let nextId = 1;
      const pending = new Map<string, { resolve(result: unknown): void; timer: ReturnType<typeof setTimeout> }>();

      server.ws.on('mms:hello', (data: { tools: Tool[] }, client: PageLink) => {
        page = { send: (event, payload) => client.send(event, payload), seen: Date.now() };
        tools = data.tools;
      });

      server.ws.on('mms:result', (data: { id: string; result: unknown }) => {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        clearTimeout(entry.timer);
        entry.resolve(data.result);
      });

      // Who is who. A client that echoes Mcp-Session-Id is told apart by it; one that does not is told apart by address and user agent.
      const sessions = new Map<string, Caller>();
      const remember = (who: Who, patch: Caller): void => {
        const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Caller;
        for (const key of [who.sid, who.address]) {
          if (!key) continue;
          if (!sessions.has(key) && sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
          sessions.set(key, { ...sessions.get(key), ...clean });
        }
      };
      const callerOf = (msg: JsonRpc, who: Who, startedAt: number): Caller => {
        const meta = record(msg.params?._meta);
        const stored = { ...sessions.get(who.address), ...(who.sid ? sessions.get(who.sid) : undefined) };
        const product = /^([^\s/]+)(?:\/(\S+))?/.exec(who.agent ?? '');
        return {
          client: who.headerClient ?? text(meta.client, 40) ?? stored.client ?? text(product?.[1], 40),
          version: stored.version ?? text(product?.[2], 30),
          model: who.headerModel ?? text(meta.model, 40) ?? stored.model,
          agent: who.agent,
          protocol: stored.protocol,
          key: who.sid ?? who.address,
          note: stored.note,
          startedAt,
        };
      };

      const livePage = (): PageLink | null => (page && Date.now() - page.seen < PAGE_TTL_MS ? page : null);

      function callPage(name: string, args: unknown, caller?: Caller): Promise<unknown> {
        const target = livePage();
        if (!target) return Promise.resolve({ ok: false, error: NO_PAGE });
        const id = String(nextId++);
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, error: `The page did not answer ${name} within ${CALL_TIMEOUT_MS / 1000} seconds.` });
          }, CALL_TIMEOUT_MS);
          pending.set(id, { resolve, timer });
          try {
            target.send('mms:call', { id, name, args, caller });
          } catch (err) {
            pending.delete(id);
            clearTimeout(timer);
            resolve({ ok: false, error: `Could not reach the page: ${err instanceof Error ? err.message : String(err)}` });
          }
        });
      }

      async function handleRpc(msg: JsonRpc, who: Who): Promise<object | null> {
        const id = msg.id ?? null;
        const isRequest = msg.id !== undefined && msg.id !== null;
        // The initiative: the moment the caller's message arrived, as Unix time in milliseconds. Every answer says it, in the standard place (_meta).
        const startedAt = Date.now();
        const meta = { 'lattakker/trace': { startedAt } };
        const reply = (result: object) => ({ jsonrpc: '2.0', id, result: { ...result, _meta: { ...((result as { _meta?: object })._meta ?? {}), ...meta } } });
        const failure = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message, data: { _meta: meta } } });
        switch (msg.method) {
          case 'initialize': {
            const info = record(msg.params?.clientInfo);
            remember(who, {
              client: text(info.name, 40),
              version: text(info.version, 30),
              model: text(info.model, 40) ?? text(record(msg.params?._meta).model, 40),
              protocol: text(msg.params?.protocolVersion, 20),
            });
            return reply({
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'lattakker-sheet', version: '1.0.0' },
              instructions: INSTRUCTIONS,
            });
          }
          case 'ping':
            return reply({});
          case 'tools/list':
            return reply({
              tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly } })),
            });
          case 'tools/call': {
            const name = String(msg.params?.name ?? '');
            if (!tools.some((t) => t.name === name)) return failure(-32602, `Unknown tool: ${name}`);
            const args = msg.params?.arguments ?? {};
            if (name === 'introduce') {
              const a = record(args);
              remember(who, { client: text(a.client, 40), version: text(a.version, 30), model: text(a.model, 40), note: text(a.note, 120) });
            }
            const result = (await callPage(name, args, callerOf(msg, who, startedAt))) as { ok?: boolean };
            // Inside the text too: an agent that only reads the text still sees the moment of the initiative.
            const body = JSON.stringify(result && typeof result === 'object' ? { ...result, _meta: meta } : result, null, 2);
            return reply({ content: [{ type: 'text', text: body }], isError: result?.ok !== true });
          }
          default:
            return isRequest ? failure(-32601, `Method not found: ${msg.method}`) : null;
        }
      }

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') return next();

        const origin = req.headers.origin;
        if (typeof origin === 'string' && !LOCAL_ORIGIN.test(origin)) return sendJson(res, 403, { error: 'Origin not allowed' });
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return sendJson(res, 405, { error: 'Use POST with JSON-RPC' });
        }

        let parsed: JsonRpc | JsonRpc[];
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: body must be JSON-RPC' } });
        }

        // Who is calling: shown in the page's traffic as the origin of what this call causes (outside-ai:<client>@<model>).
        const agent = oneHeader(req, 'user-agent', 80);
        const batch = Array.isArray(parsed) ? parsed : [parsed];
        const who: Who = {
          sid: oneHeader(req, 'mcp-session-id', 64),
          address: `${req.socket.remoteAddress ?? ''}|${agent ?? ''}`,
          agent,
          headerClient: oneHeader(req, 'x-mcp-client', 40),
          headerModel: oneHeader(req, 'x-mcp-model', 40),
        };
        if (batch.some((m) => m.method === 'initialize')) {
          who.sid = randomUUID();
          res.setHeader('Mcp-Session-Id', who.sid);
        }
        const replies = (await Promise.all(batch.map((m) => handleRpc(m, who)))).filter((r): r is object => r !== null);
        if (replies.length === 0) return sendJson(res, 202, undefined);
        return sendJson(res, 200, Array.isArray(parsed) ? replies : replies[0]);
      });
    },
  };
}
