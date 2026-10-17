/**
 * Lets an outside AI chat drive this page through the dev server's /mcp endpoint (see scripts/mcp-bridge.ts).
 * Only a page opened with ?mcp connects, so a normal visit is never driven from outside.
 */

import { throughChannel, type Caller } from './entry';

export interface BridgeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run(args: Record<string, unknown>): unknown;
}

const HEARTBEAT_MS = 2000;

export function installMcpBridge(tools: BridgeTool[]): void {
  const hot = import.meta.hot;
  if (!hot || !new URLSearchParams(location.search).has('mcp')) return;

  // One name per page load: the dev server tells two open pages apart, and prefers the one that is visible.
  const pageId = Math.random().toString(36).slice(2, 10);
  const catalogue = tools.map(({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, readOnly }));
  // Vite's send() does not throw while its socket is closed: it writes an error to the console, and a heartbeat would do that every
  // 2 seconds (a hidden page, a restarting server). So the page only announces itself while Vite says the socket is open.
  let open = false;
  let told = false;
  const announce = (): void => {
    if (!open) return;
    try {
      hot.send('mms:hello', { tools: catalogue, id: pageId, visible: document.visibilityState === 'visible' });
    } catch {
      // The socket closed in this very moment; the next heartbeat retries.
    }
  };
  hot.on('vite:ws:connect', () => {
    open = true;
    told = true;
    announce();
  });
  hot.on('vite:ws:disconnect', () => {
    open = false;
    told = true;
  });
  // The socket may have opened before this code ran, and then no event comes: assume it is open unless Vite has said anything.
  window.setTimeout(() => {
    if (!told) open = true;
    announce();
  }, 1500);
  window.setInterval(announce, HEARTBEAT_MS);
  // Coming to the front or going to the back is told at once, not at the next beat.
  document.addEventListener('visibilitychange', announce);

  hot.on('mms:call', async (msg: { id: string; name: string; args?: Record<string, unknown>; caller?: Caller }) => {
    const tool = tools.find((t) => t.name === msg.name);
    let result: unknown;
    try {
      result = tool ? await throughChannel('mcp-bridge', msg.caller, () => tool.run(msg.args ?? {}), msg.name) : { ok: false, error: `No tool named ${msg.name}` };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    hot.send('mms:result', { id: msg.id, result });
  });
}
