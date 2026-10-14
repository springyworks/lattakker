import { router, type Trace } from '../mcp/router';

/**
 * How an outside AI got in. The tools in surface.ts do not know whether they were called by a client over the dev
 * server's /mcp, by the page's own WebMCP or from the browser console (window.mms). The bridge says so around the
 * call, and the tools use it to give the messages they make an origin (see Trace in mcp/router.ts).
 */
let channel: { name: string; client: string } | null = null;

/** Runs `fn` (synchronously up to its first await) as a call that came in through `name`, from `client`. */
export function throughChannel<T>(name: string, client: string | undefined, fn: () => T): T {
  const before = channel;
  channel = { name, client: (client ?? '').slice(0, 60) };
  try {
    return fn();
  } finally {
    channel = before;
  }
}

/** The start of a chain for what an outside AI does right now: 'outside-ai:<client>' through the channel it used. */
export function outsideTrace(): Trace {
  if (!channel) return router.origin('console-or-webmcp');
  const who = channel.client ? `outside-ai:${channel.client}` : 'outside-ai';
  return router.origin(who, [channel.name]);
}

/** Who is calling, when it is an outside AI that came in through the bridge or WebMCP (null for the page's own console). */
export function participant(): string | null {
  if (!channel) return null;
  return channel.client ? `${channel.name}:${channel.client}` : channel.name;
}
