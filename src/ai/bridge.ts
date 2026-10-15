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

  const catalogue = tools.map(({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, readOnly }));
  const announce = (): void => {
    try {
      hot.send('mms:hello', { tools: catalogue });
    } catch {
      // The socket is not open yet; the next heartbeat retries.
    }
  };
  announce();
  window.setInterval(announce, HEARTBEAT_MS);

  hot.on('mms:call', async (msg: { id: string; name: string; args?: Record<string, unknown>; caller?: Caller }) => {
    const tool = tools.find((t) => t.name === msg.name);
    let result: unknown;
    try {
      result = tool ? await throughChannel('mcp-bridge', msg.caller, () => tool.run(msg.args ?? {})) : { ok: false, error: `No tool named ${msg.name}` };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    hot.send('mms:result', { id: msg.id, result });
  });
}
