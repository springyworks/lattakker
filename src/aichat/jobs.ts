import { ERR, McpError, type Json, type McpServer } from '../mcp/router';

/**
 * What is going on, and what is being waited for: a live list of jobs. Every service that takes time (the
 * chat, a call to Google, a tool, the local model, the database) opens a job, tells what it is doing in
 * words, and gives a *sign of life* whenever something really happened (an answer arrived, a word was
 * received, a poll answered). Jobs nest: a job started while another is open is its child, so a chat that
 * waits for a tool that waits for the local model that waits for the database shows up as a chain.
 *
 * Nothing here is a made-up timer. "Quiet for 40 s" means no sign of life for 40 s; a job that has been
 * quiet for too long is flagged, so a person can see that it may be stuck instead of watching a clock.
 * The same list can be asked over MCP (the server `status`), so a person, a cell or an outside AI can look.
 */

export type JobState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: number;
  parent: number | null;
  /** Who: 'chat', 'google', 'local-model', 'tool', 'local-ai', 'memory' ... */
  service: string;
  title: string;
  state: JobState;
  /** What it is doing or waiting for, in words. */
  detail: string;
  started: number;
  lastSignal: number;
  signals: number;
  ended: number | null;
  /** Quiet for longer than this and the job is flagged as possibly stuck. */
  stallAfterMs: number;
}

export interface JobNode {
  id: number;
  service: string;
  title: string;
  state: JobState;
  detail: string;
  ageSeconds: number;
  /** Seconds since the last real sign of life. */
  quietSeconds: number;
  signals: number;
  stalled: boolean;
  children: JobNode[];
}

export interface JobHandle {
  readonly id: number;
  /** Say what is happening now. Counts as a sign of life unless `alive` is false. */
  say(detail: string, alive?: boolean): void;
  /** Something really happened (a chunk arrived): keeps the job from being flagged. */
  alive(detail?: string): void;
  state(state: 'waiting' | 'running'): void;
  done(detail?: string): void;
  fail(detail: string): void;
  cancel(detail?: string): void;
}

const KEEP_MS = 12000;
const MAX_JOBS = 80;
const listeners: Array<() => void> = [];
const all: Job[] = [];
/** Open jobs, innermost last: the parent of the next job that starts. */
const open: number[] = [];
const cancelers = new Set<() => void>();
let counter = 0;
let notifyTimer = 0;

function changed(): void {
  if (notifyTimer) return;
  // Many updates in one breath are shown once.
  notifyTimer = window.setTimeout(() => {
    notifyTimer = 0;
    listeners.forEach((l) => l());
  }, 60);
}

export const onJobsChange = (l: () => void): void => void listeners.push(l);

function finish(job: Job, state: JobState, detail?: string): void {
  if (job.ended !== null) return;
  job.state = state;
  if (detail) job.detail = detail;
  job.ended = performance.now();
  job.lastSignal = job.ended;
  const at = open.indexOf(job.id);
  if (at >= 0) open.splice(at, 1);
  changed();
}

export const jobs = {
  /** Opens a job. Its parent is the innermost job that is still open. */
  start(service: string, title: string, options: { stallAfterSeconds?: number } = {}): JobHandle {
    const now = performance.now();
    const job: Job = { id: ++counter, parent: open.length ? open[open.length - 1] : null, service, title, state: 'running', detail: '', started: now, lastSignal: now, signals: 0, ended: null, stallAfterMs: (options.stallAfterSeconds ?? 45) * 1000 };
    all.push(job);
    open.push(job.id);
    // Old finished jobs are dropped, so the list stays small.
    while (all.length > MAX_JOBS) {
      const old = all.findIndex((j) => j.ended !== null);
      if (old < 0) break;
      all.splice(old, 1);
    }
    changed();
    return {
      id: job.id,
      say(detail, alive = true) {
        job.detail = detail;
        if (alive) {
          job.lastSignal = performance.now();
          job.signals++;
        }
        changed();
      },
      alive(detail) {
        job.lastSignal = performance.now();
        job.signals++;
        if (detail) job.detail = detail;
        changed();
      },
      state(state) {
        job.state = state;
        changed();
      },
      done: (detail) => finish(job, 'done', detail),
      fail: (detail) => finish(job, 'failed', detail),
      cancel: (detail) => finish(job, 'cancelled', detail ?? 'stopped'),
    };
  },

  /** The jobs as a tree: open ones, and ones that finished a moment ago. */
  tree(options: { includeFinished?: boolean } = {}): JobNode[] {
    const now = performance.now();
    const visible = all.filter((j) => j.ended === null || options.includeFinished || now - j.ended < KEEP_MS);
    const ids = new Set(visible.map((j) => j.id));
    const node = (j: Job): JobNode => ({
      id: j.id,
      service: j.service,
      title: j.title,
      state: j.state,
      detail: j.detail,
      ageSeconds: Math.round(((j.ended ?? now) - j.started) / 100) / 10,
      quietSeconds: Math.round((now - j.lastSignal) / 1000),
      signals: j.signals,
      stalled: j.ended === null && now - j.lastSignal > j.stallAfterMs,
      children: visible.filter((c) => c.parent === j.id).map(node),
    });
    return visible.filter((j) => j.parent === null || !ids.has(j.parent)).map(node);
  },

  /** A running service says how it can be stopped (for example by aborting its request); "Stop" calls all of them. Returns the way to withdraw. */
  onCancel(fn: () => void): () => void {
    cancelers.add(fn);
    return () => void cancelers.delete(fn);
  },

  cancelAll(): void {
    for (const fn of [...cancelers]) fn();
  },

  /** True while any job is open. */
  get busy(): boolean {
    return open.length > 0;
  },
};

const ICON: Record<JobState, string> = { waiting: '⏳', running: '⚙️', done: '✓', failed: '✗', cancelled: '■' };

/** The tree as plain text, one line per job (what the status server returns next to the structure). */
export function describeTree(nodes: JobNode[], depth = 0): string {
  return nodes
    .map((n) => {
      const quiet = n.state === 'done' || n.state === 'failed' || n.state === 'cancelled' ? '' : n.stalled ? ` ⚠ nothing heard for ${n.quietSeconds} s, it may be stuck` : n.quietSeconds >= 3 ? ` (last sign of life ${n.quietSeconds} s ago)` : '';
      return `${'  '.repeat(depth)}${ICON[n.state]} ${n.service}: ${n.title}${n.detail ? ` — ${n.detail}` : ''} [${n.ageSeconds} s]${quiet}\n${describeTree(n.children, depth + 1)}`;
    })
    .join('');
}

/** The MCP server `status`: ask what is going on, from the chat, a cell or an outside AI. */
export class StatusServer implements McpServer {
  readonly name = 'status';

  handle(method: string, params: Record<string, unknown>): Json {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'lattakker-status', title: 'What is going on', version: '1' } };
      case 'ping':
        return {};
      case 'resources/list':
        return { resources: [{ uri: 'lattakker-status:///jobs', name: 'jobs', description: 'The jobs that run or have just finished, as a tree', mimeType: 'application/json' }] };
      case 'resources/read':
        return { contents: [{ uri: 'lattakker-status:///jobs', mimeType: 'application/json', text: JSON.stringify(this.report(false)) }] };
      case 'tools/list':
        return { tools: [{ name: 'jobs', description: 'What is going on right now and what each part waits for, as a tree (chat > Google or tool > local model > database ...). Each job has ageSeconds, quietSeconds (since its last real sign of life) and stalled.', inputSchema: { type: 'object', properties: { include_finished: { type: 'boolean' } } } }] };
      case 'tools/call': {
        const args = (typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
        if (params.name !== 'jobs') throw new McpError(ERR.methodNotFound, 'status has one tool: jobs');
        const report = this.report(args.include_finished === true);
        return { content: [{ type: 'text', text: JSON.stringify(report) }], structuredContent: report };
      }
      default:
        throw new McpError(ERR.methodNotFound, `status does not know the method "${method}"`);
    }
  }

  private report(includeFinished: boolean): Record<string, unknown> {
    const tree = jobs.tree({ includeFinished });
    return { busy: jobs.busy, text: tree.length ? describeTree(tree) : 'Nothing is running.', jobs: tree };
  }
}
