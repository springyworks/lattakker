/**
 * One RunContext lives for one run of one cell's code. It owns everything that run starts in the
 * background (timers, event handlers, pending sleeps). When the cell runs again, is edited or is
 * cleared, the old context is cancelled and all of it stops, so nothing leaks or runs twice.
 */

export class CancelError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelError';
  }
}

export class RunContext {
  cancelled = false;
  /** True while the cell's top level is running: only then do reads become dependencies. */
  tracking = true;
  private tasks = new Set<() => void>();
  private transient = new Set<() => void>();

  constructor(readonly address: string) {}

  /** Timers and handlers started by the cell (what `stop()` and the popup count). */
  get taskCount(): number {
    return this.tasks.size;
  }

  /** Throws CancelError when this run is over, so stale code stops at its next API call. */
  guard(): void {
    if (this.cancelled) throw new CancelError();
  }

  addTask(stop: () => void): () => void {
    this.tasks.add(stop);
    return () => {
      this.tasks.delete(stop);
    };
  }

  /** Short-lived things (a pending sleep) that are only cleaned up when the run is cancelled. */
  addTransient(stop: () => void): () => void {
    this.transient.add(stop);
    return () => {
      this.transient.delete(stop);
    };
  }

  stopTasks(): void {
    const stops = [...this.tasks];
    this.tasks.clear();
    for (const stop of stops) stop();
  }

  cancel(): void {
    this.cancelled = true;
    this.stopTasks();
    const stops = [...this.transient];
    this.transient.clear();
    for (const stop of stops) stop();
  }
}

/** '500ms', '2s', '1m', '1h', '1.5s' or a plain number of milliseconds. */
export function parseInterval(value: unknown, fallbackMs = 1000): number {
  if (value === undefined || value === null) return fallbackMs;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallbackMs;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h)?\s*$/i.exec(String(value));
  if (!m) throw new Error(`"${String(value)}" is not a time (try 500, '500ms', '2s' or '1m')`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  if (unit === 'ms') return n;
  if (unit === 's' || unit === 'sec') return n * 1000;
  if (unit === 'm' || unit === 'min') return n * 60_000;
  return n * 3_600_000;
}
