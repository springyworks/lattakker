import { callers } from '../ai/entry';
import { analyze, ask as askTraffic, FILTER_HELP, FilterError, packets as pickPackets } from './analyze';
import { ERR, McpError, TRACE_META, type Json, type McpRouter, type McpServer, type Trace } from './router';

/**
 * The router as an MCP server called "router": ask the page's message carrier about itself, from a cell
 * (`mcp.tool('router', 'stats')`), from the AI helper or from an outside AI.
 *
 *   resources/read lattakker-router:///stats     the counters
 *   resources/read lattakker-router:///catalog   every server with its tools: what can be done in this app
 *   tools/call stats                             counters: messages, errors, rate, per server / client / method
 *   tools/call catalog                           every server, what it is for, its tools and how many resources
 *   tools/call servers                           just the names
 *   tools/call recent {n?, server?, method?}     the last messages, optionally only one server or method
 *   tools/call reset_stats                       start counting from zero
 *
 * Looking at the traffic, a little like Wireshark (see analyze.ts):
 *   tools/call packets {filter?, n?}             the messages as a packet list: type (kind of traffic), who asked whom, what
 *   tools/call analyze {filter?}                 count what a filter picks: kinds of traffic, who talks to whom, slowest, errors, in words
 *   tools/call ask {question}                    "what is going on?", "any errors?", "who is busiest?", "what does ai-chat do?"
 *
 *   tools/call callers                           outside AIs that called in: client, version, model, user agent, how often
 *
 * Who did what (provenance): every message has an id, a start of its chain (origin), the parties it passed through
 * (hops) and the message that caused it (cause). Changes to cells that were made over MCP are written down too.
 *   tools/call trace {id}                        a message, what led to it and what it led to
 *   tools/call history {subject?, n?}            who changed what, newest last (a cell path or uid)
 *   tools/call change {n}                        one change with the code before and after, to undo it
 *   tools/call endpoints                         the servers of this page and who the page is
 *   tools/call self_check                        the router asks itself: do ids, origin, hops, causes, _meta and the record of changes all work?
 *   resources/read lattakker-router:///ledger    the same record of changes
 */

const PROTOCOL = '2025-06-18';
const STATS = 'lattakker-router:///stats';
const CATALOG = 'lattakker-router:///catalog';
const LEDGER = 'lattakker-router:///ledger';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TOOLS = [
  { name: 'stats', description: 'What the router has counted: messages, errors, messages per second (now and the last 60 s), and per server, client and method: how many, how many failed, how long they took.', inputSchema: { type: 'object', properties: {} } },
  { name: 'catalog', description: 'Everything this app can do over MCP: every server with a sentence on what it is for, its tools (name and description) and how many resources it holds. Start here when you do not know what is possible.', inputSchema: { type: 'object', properties: {} } },
  { name: 'servers', description: 'The names of the MCP servers of this page.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'recent',
    description: 'The last messages that crossed the router (who asked whom, what, how long it took).',
    inputSchema: { type: 'object', properties: { n: { type: 'integer', description: 'How many (1 to 100, default 20).' }, server: { type: 'string', description: 'Only messages to or from this server.' }, method: { type: 'string', description: 'Only this method, e.g. tools/call.' }, origin: { type: 'string', description: 'Only messages of chains that were started by this party (a cell like lab:A16, you, ai-chat, outside-ai).' } } },
  },
  {
    name: 'packets',
    description: `The traffic as a packet list, like Wireshark: each message with its TYPE (heartbeat, discovery, read, subscribe, news, signal, tool, change), who asked whom, the method, the tool, how long it took. A filter picks messages. ${FILTER_HELP}`,
    inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Display filter, e.g. type==tool && ms>20 or from~ai. Empty: everything.' }, n: { type: 'integer', description: 'How many (1 to 400, default 30).' } } },
  },
  {
    name: 'analyze',
    description: `Counts the messages a filter picks (default: all in the log) and says what is going on: the kinds of traffic and their share, who talks to whom, the busiest parties, the slowest answers, the errors, and a short story in plain words. ${FILTER_HELP}`,
    inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Display filter. Empty: everything in the log (the last 400 messages).' } } },
  },
  {
    name: 'ask',
    description: 'Ask the router about its own traffic in plain words: "what is going on?", "any errors?", "who is busiest?", "what is slow?", "what does ai-chat do?", "how many messages?", "what was the last thing?". It is a keyword matcher over the real log, not a model: an answer says which filter it used, so you can run it again. A question it does not know gets the list of what it knows.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'callers',
    description: 'Who has called in from outside (an AI chat over /mcp or WebMCP): the client program, its version, the model behind it, the user agent, how it came in, how many calls, when. They show in the traffic as origin outside-ai:<client>@<model>.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'trace',
    description: 'Follow one message by its id (the id field of recent): the message, the messages that led to it (oldest first) and the messages it led to. Says who started the chain and the way it went.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: "A message id like 'k3f9-152'." } }, required: ['id'] },
  },
  {
    name: 'history',
    description: 'Who changed what over MCP: the recorded changes (a cell\'s code was replaced ...) with who started it, the message id, and short fingerprints before and after. Newest last.',
    inputSchema: { type: 'object', properties: { subject: { type: 'string', description: "Only this cell: a path like lab/J24 or J24, or a uid like c-1a2b3c4d." }, n: { type: 'integer', description: 'How many (1 to 100, default 20).' } } },
  },
  {
    name: 'change',
    description: 'One recorded change in full, with the code before and after it. To undo it, put the "before" back with set_code on that cell.',
    inputSchema: { type: 'object', properties: { n: { type: 'integer', description: 'The number of the change, from history.' } }, required: ['n'] },
  },
  {
    name: 'self_check',
    description: 'The router checks itself over MCP, as a client of its own server: it sends messages and then reads back, through its own tools, who sent them, the way they went, what caused what, whether a trace that arrives in _meta is taken over, and whether a change is recorded with the code before. Answers { ok, checks: [{ name, ok, detail }] }. It leaves a few messages in the traffic log and one entry (subject selfcheck/probe) in the record of changes.',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'endpoints', description: 'The MCP servers of this page (when they joined, how often they were asked) and who this page is (its session code, which starts every message id it makes).', inputSchema: { type: 'object', properties: {} } },
  { name: 'reset_stats', description: 'Start the counters again from zero. The traffic log is kept.', inputSchema: { type: 'object', properties: {} } },
];

export interface CatalogEntry {
  server: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
  resources: number | null;
}

/** Asks every server what it offers. A server that does not know a question is listed without that part. */
export async function buildCatalog(router: McpRouter, as = 'router'): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = [];
  for (const server of router.names()) {
    const entry: CatalogEntry = { server, description: router.describe(server), tools: [], resources: null };
    // A server says in `initialize` what it has; asking for what it lacks would only count as an error in the statistics.
    let has = { tools: true, resources: true };
    try {
      const init = (await router.request(as, server, 'initialize')) as { capabilities?: Record<string, unknown> };
      if (init.capabilities) has = { tools: !!init.capabilities.tools, resources: !!init.capabilities.resources };
    } catch {
      // does not say: try both
    }
    if (has.tools) {
      try {
        const list = (await router.request(as, server, 'tools/list')) as { tools?: Array<{ name?: string; description?: string }> };
        entry.tools = (list.tools ?? []).map((t) => ({ name: String(t.name ?? ''), description: String(t.description ?? '').slice(0, 200) }));
      } catch {
        // no tools
      }
    }
    if (has.resources) {
      try {
        const list = (await router.request(as, server, 'resources/list')) as { resources?: unknown[] };
        entry.resources = list.resources?.length ?? 0;
      } catch {
        // no resources
      }
    }
    entries.push(entry);
  }
  return entries;
}

export class RouterServer implements McpServer {
  readonly name = 'router';
  readonly description = 'The message carrier of this page: statistics, the catalog of every server and tool, the recent traffic.';

  constructor(private readonly router: McpRouter) {}

  async handle(method: string, params: Record<string, unknown>, from: string, trace?: Trace): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: PROTOCOL, capabilities: { resources: {}, tools: {} }, serverInfo: { name: 'lattakker-router', title: 'MCP router', version: '1' } };
      case 'ping':
        return {};
      case 'resources/list':
        return {
          resources: [
            { uri: STATS, name: 'stats', description: 'Counters of the router', mimeType: 'application/json' },
            { uri: CATALOG, name: 'catalog', description: 'Every server and tool of this app', mimeType: 'application/json' },
            { uri: LEDGER, name: 'ledger', description: 'Who changed what over MCP, with the code before and after', mimeType: 'application/json' },
          ],
        };
      case 'resources/read': {
        const uri = String(params.uri ?? '');
        if (uri === STATS) return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(this.router.stats()) }] };
        if (uri === LEDGER) return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ changes: this.router.history() }) }] };
        if (uri === CATALOG) return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await buildCatalog(this.router, from)) }] };
        throw new McpError(ERR.invalidParams, `router has no resource ${uri}`);
      }
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {}, from, trace);
      default:
        throw new McpError(ERR.methodNotFound, `router does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>, from: string, trace?: Trace): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    switch (name) {
      case 'stats':
        return reply({ ...this.router.stats() });
      case 'catalog':
        return reply({ servers: await buildCatalog(this.router, from) });
      case 'servers':
        return reply({ servers: this.router.names() });
      case 'recent': {
        const n = typeof args.n === 'number' && Number.isFinite(args.n) ? Math.max(1, Math.min(100, Math.floor(args.n))) : 20;
        const server = typeof args.server === 'string' ? args.server : '';
        const method = typeof args.method === 'string' ? args.method : '';
        // Filtering happens on the whole log, so ask for all of it and keep the newest n that fit.
        const origin = typeof args.origin === 'string' ? args.origin : '';
        const messages = this.router.recent(400).filter((m) => (!server || m.from === server || m.to === server) && (!method || m.method === method) && (!origin || m.origin === origin));
        return reply({ messages: messages.slice(-n) });
      }
      case 'packets': {
        const filter = typeof args.filter === 'string' ? args.filter : '';
        const n = typeof args.n === 'number' && Number.isFinite(args.n) ? args.n : 30;
        return reply({ filter, packets: this.filtered(() => pickPackets(this.router.recent(400), filter, n)) });
      }
      case 'analyze':
        return reply({ ...this.filtered(() => analyze(this.router.recent(400), typeof args.filter === 'string' ? args.filter : '')) });
      case 'ask':
        return reply({ ...askTraffic(this.router.recent(400), String(args.question ?? '')) });
      case 'callers':
        return reply({ callers: callers() });
      case 'trace': {
        const id = String(args.id ?? '');
        const message = this.router.message(id);
        if (!message) throw new McpError(ERR.invalidParams, `There is no message ${id} in the log (the log keeps the last 400; ids look like ${this.router.session}-12).`);
        const chain = this.router.chain(id);
        return reply({
          message,
          origin: message.origin,
          path: message.hops.join(' → '),
          because: chain.slice(0, -1),
          led_to: this.router.effects(id),
          note: chain[0]?.cause ? `The chain is older than the log: the first message shown was caused by ${chain[0].cause}.` : undefined,
        });
      }
      case 'history': {
        const n = typeof args.n === 'number' && Number.isFinite(args.n) ? Math.max(1, Math.min(100, Math.floor(args.n))) : 20;
        const subject = typeof args.subject === 'string' ? args.subject : undefined;
        // The code itself stays out of the list (ask for one change to get it).
        const changes = this.router.history(subject).slice(-n).map(({ before, after, ...rest }) => ({ ...rest, hasBefore: before !== undefined, bytesAfter: after?.length }));
        return reply({ changes });
      }
      case 'change': {
        const n = typeof args.n === 'number' ? Math.floor(args.n) : NaN;
        const change = this.router.history().find((c) => c.n === n);
        if (!change) throw new McpError(ERR.invalidParams, `There is no recorded change number ${args.n}. Ask history for the numbers.`);
        return reply({ ...change });
      }
      case 'self_check':
        return reply(await this.selfCheck(trace));
      case 'endpoints': {
        return reply({ page: this.router.identity(), endpoints: this.router.endpoints() });
      }
      case 'reset_stats':
        this.router.resetStats();
        return reply({ ok: true });
      default:
        throw new McpError(ERR.methodNotFound, `router has no tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`);
    }
  }

  /** A filter that cannot be read is the asker's mistake: say so as invalid params, with the syntax. */
  private filtered<T>(run: () => T): T {
    try {
      return run();
    } catch (err) {
      if (err instanceof FilterError) throw new McpError(ERR.invalidParams, err.message);
      throw err;
    }
  }

  /**
   * The router as its own client: it sends messages as "router-selfcheck" and reads the record back with its own
   * tools, so the whole path (ids, origin, hops, cause, _meta, the changes list) is exercised the way an outside AI uses it.
   */
  private async selfCheck(asked?: Trace): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; asked_by: string; page: ReturnType<McpRouter['identity']> }> {
    const r = this.router;
    const probe = 'router-selfcheck';
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const add = (name: string, ok: unknown, detail = ''): void => void checks.push({ name, ok: !!ok, detail: String(detail) });
    const ask = async (tool: string, args: Record<string, unknown>, via?: Trace): Promise<Record<string, any>> => {
      const out = (await r.request(probe, 'router', 'tools/call', { name: tool, arguments: args }, via)) as { structuredContent?: Record<string, any> };
      return out.structuredContent ?? {};
    };
    const last = (pred: (m: ReturnType<McpRouter['recent']>[number]) => boolean) => r.recent(400).filter(pred).pop();
    try {
      // 1. A request is recorded with an id, its origin and the way it went.
      await r.request(probe, 'router', 'ping', {});
      const a = last((m) => m.origin === probe && m.kind === 'request' && m.method === 'ping');
      add('a request gets an id that starts with this page\'s session code', a && a.id.startsWith(`${r.session}-`), a?.id);
      add('it says who started it (origin)', a?.origin === probe, a?.origin);
      add('hops show the way: sender, router, receiver', a?.hops.join(' > ') === `${probe} > router > router`, a?.hops.join(' > '));

      // 2. The answer says which request it answers.
      const answer = a ? last((m) => m.cause === a.id && m.kind === 'response') : undefined;
      add('the answer names the request it answers (cause) and keeps the origin', answer && answer.origin === probe && answer.cause === a?.id, answer ? `${answer.id} answers ${answer.cause}` : 'no answer in the log');

      // 3. A message sent because of another continues its chain.
      const start = r.notify(probe, 'router', 'selfcheck/start', {});
      await r.request('router-selfcheck-helper', 'router', 'ping', {}, start);
      const follow = last((m) => m.cause === start.id && m.kind === 'request');
      add('a follow-up names its cause and keeps the origin of the chain', follow && follow.origin === probe && follow.cause === start.id, follow ? `${follow.id} <- ${follow.cause}, origin ${follow.origin}` : 'not found');
      add('its hops show both parties of the chain', follow && follow.hops[0] === probe && follow.hops.includes('router-selfcheck-helper'), follow?.hops.join(' > '));

      // 4. The router answers questions about its own messages, through its own tools.
      const traced = follow ? await ask('trace', { id: follow.id }) : {};
      add('tool trace: follows a message back to where the chain began', Array.isArray(traced.because) && traced.because.some((m: { id: string }) => m.id === start.id) && traced.origin === probe, `because: ${(traced.because ?? []).map((m: { id: string }) => m.id).join(', ')}`);
      const startTrace = await ask('trace', { id: start.id });
      add('tool trace: from the start it finds what the chain led to', Array.isArray(startTrace.led_to) && startTrace.led_to.some((m: { id: string }) => m.id === follow?.id), `led to ${(startTrace.led_to ?? []).length} messages`);

      // 5. A trace that arrives inside the message (from another page or an outside client) is taken over.
      await r.request('router', 'router', 'ping', { _meta: { [TRACE_META]: { origin: 'selfcheck-remote', lineage: ['selfcheck-remote', 'selfcheck-relay'], id: 'zzzz-1' } } });
      const remote = last((m) => m.origin === 'selfcheck-remote' && m.kind === 'request');
      add('a trace in _meta is taken over: origin, cause and the hops before this page', remote && remote.cause === 'zzzz-1' && remote.hops.slice(0, 2).join('>') === 'selfcheck-remote>selfcheck-relay', remote?.hops.join(' > '));

      // 6. The record of changes keeps who, through which message, and the content before.
      const change = r.noteChange(start, { subject: 'selfcheck/probe', action: 'selfcheck', before: 'before', after: 'after' });
      const hist = await ask('history', { subject: 'selfcheck/probe' });
      add('tool history: lists the change with who made it', (hist.changes ?? []).some((c: { n: number; by: string; msg: string }) => c.n === change.n && c.by === probe && c.msg === start.id), `change ${change.n}`);
      const full = await ask('change', { n: change.n });
      add('tool change: gives the content before and after, and fingerprints that differ', full.before === 'before' && full.after === 'after' && full.beforeHash !== full.afterHash, `${full.beforeHash} -> ${full.afterHash}`);

      // 7. The endpoints say who they are.
      const ends = await ask('endpoints', {});
      add('tool endpoints: names this page and lists the router itself', ends.page?.session === r.session && (ends.endpoints ?? []).some((e: { name: string }) => e.name === 'router'), `${(ends.endpoints ?? []).length} endpoints, session ${ends.page?.session}`);

      // 8. The question that started this check is itself in the record.
      const me = asked ? r.message(asked.id) : undefined;
      add('this very check (the request that asked for it) is in the log with its own trace', !asked || (me && me.origin === asked.origin), asked ? `${asked.id}, origin ${asked.origin}, via ${asked.lineage.join(' > ')}` : 'asked without a trace');

      // 9. The traffic analyser reads the messages sent above: it knows their type, and a filter picks them.
      const picked = await ask('packets', { filter: 'origin==router-selfcheck && type==heartbeat', n: 5 });
      add('tool packets: a filter picks the self-check pings and calls them heartbeat', (picked.packets ?? []).length > 0 && (picked.packets ?? []).every((q: { type: string }) => q.type === 'heartbeat'), `${(picked.packets ?? []).length} packets`);
      const said = await ask('ask', { question: 'how many messages?' });
      add('tool ask: answers a question in words from the log', said.understood === true && /messages in the log/.test(String(said.answer)), String(said.answer).slice(0, 80));
    } catch (err) {
      add('no check raised an error', false, err instanceof Error ? err.message : String(err));
    }
    return { ok: checks.every((c) => c.ok), checks, asked_by: asked?.origin ?? '?', page: r.identity() };
  }
}
