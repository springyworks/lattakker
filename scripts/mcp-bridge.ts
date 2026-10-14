import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dev-only MCP endpoint at /mcp (Streamable HTTP, stateless, JSON responses only).
 * Tool calls travel over Vite's own HMR socket to a page opened with ?mcp, so there is no extra port or package.
 */

const PROTOCOL_VERSION = '2025-06-18';
const PAGE_TTL_MS = 6000;
const CALL_TIMEOUT_MS = 30000;
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

      const livePage = (): PageLink | null => (page && Date.now() - page.seen < PAGE_TTL_MS ? page : null);

      function callPage(name: string, args: unknown, client?: string): Promise<unknown> {
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
            target.send('mms:call', { id, name, args, client });
          } catch (err) {
            pending.delete(id);
            clearTimeout(timer);
            resolve({ ok: false, error: `Could not reach the page: ${err instanceof Error ? err.message : String(err)}` });
          }
        });
      }

      async function handleRpc(msg: JsonRpc, client?: string): Promise<object | null> {
        const id = msg.id ?? null;
        const isRequest = msg.id !== undefined && msg.id !== null;
        const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
        const failure = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
        switch (msg.method) {
          case 'initialize':
            return reply({
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'lattakker-sheet', version: '1.0.0' },
              instructions: INSTRUCTIONS,
            });
          case 'ping':
            return reply({});
          case 'tools/list':
            return reply({
              tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly } })),
            });
          case 'tools/call': {
            const name = String(msg.params?.name ?? '');
            if (!tools.some((t) => t.name === name)) return failure(-32602, `Unknown tool: ${name}`);
            const result = (await callPage(name, msg.params?.arguments ?? {}, client)) as { ok?: boolean };
            return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result?.ok !== true });
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

        // Who is calling, as far as the HTTP request says: shown in the page's traffic as the origin of what this call causes.
        const client = String(req.headers['user-agent'] ?? '').replace(/[^\w ./:()-]/g, '').slice(0, 60) || undefined;
        const batch = Array.isArray(parsed) ? parsed : [parsed];
        const replies = (await Promise.all(batch.map((m) => handleRpc(m, client)))).filter((r): r is object => r !== null);
        if (replies.length === 0) return sendJson(res, 202, undefined);
        return sendJson(res, 200, Array.isArray(parsed) ? replies : replies[0]);
      });
    },
  };
}
