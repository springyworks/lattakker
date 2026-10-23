/**
 * Taking turns between cells: Semaphore, Mutex, RWLock, Channel and the named lock().
 *
 * Cells share one thread, so there is never a data race inside one step; trouble starts when a cell awaits in the MIDDLE of
 * read -> change -> write. These are the tools for that, in the shape of today's languages and browsers:
 *  - every wait can be given a `timeout` or an AbortSignal, and a waiter that is cancelled leaves the line cleanly;
 *  - a permit is a "lease": `using permit = await lock.acquire()` gives it back at the end of the block, even after an error,
 *    and it is given back by itself when the run of the cell that holds it is cancelled (the cell was edited or run again),
 *    so an old run can never keep everybody waiting;
 *  - a Channel passes messages instead of sharing things ("share memory by communicating"), with back-pressure.
 * Semaphores themselves are Dijkstra's (1965): P = acquire, V = release. Nothing newer replaced the idea, newer tools are built on it.
 */
import { CancelError, parseInterval } from './tasks';

/** What a cell run offers so a waiting cell can be cancelled (see RunContext). */
export interface Scope {
  guard(): void;
  onCancel(stop: () => void): () => void;
}

export const NO_SCOPE: Scope = { guard() {}, onCancel: () => () => {} };

export interface WaitOptions {
  /** Give up after this long ('2s', 500): the wait then fails with an error named TimeoutError. */
  timeout?: number | string;
  /** Give up when this signal aborts. */
  signal?: AbortSignal;
  /** Which run the wait belongs to; the named lock() sets it, so the waiting cell is the one that is cancelled. */
  scope?: Scope;
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`waited ${ms} ms for ${what}`);
    this.name = 'TimeoutError';
  }
}

export class ChannelClosedError extends Error {
  constructor(what: string) {
    super(`${what} is closed`);
    this.name = 'ChannelClosedError';
  }
}

// `using` needs these two names; older browsers do not have them yet.
const symbols = Symbol as unknown as Record<string, symbol>;
symbols.dispose ??= Symbol.for('Symbol.dispose');
symbols.asyncDispose ??= Symbol.for('Symbol.asyncDispose');

/** A held permit. `release()` gives it back once; `using p = await sem.acquire()` does that at the end of the block. */
export interface Permit {
  readonly released: boolean;
  release(): void;
  [Symbol.dispose](): void;
}

interface Entry {
  n: number;
  write: boolean;
  value: unknown;
  go(value?: unknown): void;
  fail(error: unknown): void;
}

/** Puts a waiter in a line and resolves when someone calls its `go`. Leaves the line again on cancel, timeout or abort. */
function wait<T>(
  scope: Scope,
  line: Entry[],
  what: string,
  opts: WaitOptions | undefined,
  spec: { n?: number; write?: boolean; value?: unknown },
  after: () => void,
): Promise<T> {
  scope.guard();
  if (opts?.signal?.aborted) return Promise.reject(opts.signal.reason ?? new DOMException('aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const undo: Array<() => void> = [];
    const done = (): void => {
      for (const u of undo.splice(0)) u();
    };
    const entry: Entry = {
      n: spec.n ?? 1,
      write: spec.write ?? false,
      value: spec.value,
      go: (value) => {
        done();
        resolve(value as T);
      },
      fail: (error) => {
        done();
        reject(error);
      },
    };
    const drop = (error: unknown): void => {
      const at = line.indexOf(entry);
      if (at < 0) return;
      line.splice(at, 1);
      entry.fail(error);
      after();
    };
    line.push(entry);
    undo.push(scope.onCancel(() => drop(new CancelError())));
    if (opts?.signal) {
      const signal = opts.signal;
      const onAbort = (): void => drop(signal.reason ?? new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort);
      undo.push(() => signal.removeEventListener('abort', onAbort));
    }
    if (opts?.timeout !== undefined) {
      const ms = parseInterval(opts.timeout, 0);
      const id = setTimeout(() => drop(new TimeoutError(what, ms)), ms);
      undo.push(() => clearTimeout(id));
    }
  });
}

function count(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`n must be a whole number of 1 or more, not ${n}`);
  return n;
}

/** The classes, bound to one run of one cell: what a cell cancelled while it waits or holds something is told through `scope`. */
export function makeSync(scope: Scope = NO_SCOPE) {
  const lease = (opts: WaitOptions | undefined, give: () => void): Permit => {
    const sc = opts?.scope ?? scope;
    // A permit that comes in after its run was cancelled (a waiter woken by the run's own release) goes straight back.
    try {
      sc.guard();
    } catch (err) {
      give();
      throw err;
    }
    let released = false;
    // When the run that holds the permit is over, the permit goes back by itself.
    const forget = sc.onCancel(() => permit.release());
    const permit: Permit = {
      get released() {
        return released;
      },
      release() {
        if (released) return;
        released = true;
        forget();
        give();
      },
      [Symbol.dispose]() {
        permit.release();
      },
    };
    return permit;
  };

  /** A counting semaphore (Dijkstra): `value` permits; P = acquire waits while there are none, V = release gives them back. */
  class Semaphore {
    protected line: Entry[] = [];

    constructor(
      public value = 1,
      readonly name = 'semaphore',
    ) {}

    /** How many are waiting in line right now. */
    get waiting(): number {
      return this.line.length;
    }

    private pump(): void {
      while (this.line.length > 0 && this.value >= this.line[0].n) {
        const next = this.line.shift()!;
        this.value -= next.n;
        next.go();
      }
    }

    /** P: take n permits or wait in line (first come, first served). The permit it gives back is for `using` or `.release()`. */
    async acquire(n = 1, opts?: WaitOptions): Promise<Permit> {
      count(n);
      (opts?.scope ?? scope).guard();
      // This check and the subtraction are ONE step: no other cell can run between them.
      if (this.line.length === 0 && this.value >= n) this.value -= n;
      else await wait<void>(opts?.scope ?? scope, this.line, `the semaphore '${this.name}'`, opts, { n }, () => this.pump());
      return lease(opts, () => this.release(n));
    }

    /** Take n permits only if they are free right now. Never waits; gives null when they are not. */
    tryAcquire(n = 1, opts?: Pick<WaitOptions, 'scope'>): Permit | null {
      count(n);
      if (this.line.length > 0 || this.value < n) return null;
      this.value -= n;
      return lease(opts, () => this.release(n));
    }

    /** V: give n permits back (or add new ones) and wake those in line that can go now. */
    release(n = 1): void {
      this.value += count(n);
      this.pump();
    }

    /** Acquire, run, and always release, even when fn throws. */
    async use<T>(fn: () => T | Promise<T>, n = 1, opts?: WaitOptions): Promise<T> {
      using _permit = await this.acquire(n, opts);
      return await fn();
    }
  }

  /** A semaphore with one permit: one at a time. */
  class Mutex extends Semaphore {
    constructor(name = 'mutex') {
      super(1, name);
    }
    get locked(): boolean {
      return this.value <= 0;
    }
  }

  /**
   * Many readers or one writer. The line is first come, first served, so a waiting writer is not starved by readers coming and
   * going. Readers can all be inside at once; the writer is alone.
   */
  class RWLock {
    readers = 0;
    writing = false;
    private line: Entry[] = [];

    constructor(readonly name = 'rwlock') {}

    get waiting(): number {
      return this.line.length;
    }

    private pump(): void {
      for (;;) {
        const head = this.line[0];
        if (!head || this.writing || (head.write && this.readers > 0)) return;
        this.line.shift();
        if (head.write) this.writing = true;
        else this.readers++;
        head.go();
      }
    }

    private async enter(write: boolean, opts?: WaitOptions): Promise<Permit> {
      (opts?.scope ?? scope).guard();
      const free = this.line.length === 0 && !this.writing && (!write || this.readers === 0);
      if (free) {
        if (write) this.writing = true;
        else this.readers++;
      } else {
        await wait<void>(opts?.scope ?? scope, this.line, `the lock '${this.name}'`, opts, { write }, () => this.pump());
      }
      return lease(opts, () => {
        if (write) this.writing = false;
        else this.readers--;
        this.pump();
      });
    }

    /** Wait until no writer is inside, then read together with the other readers. */
    read(opts?: WaitOptions): Promise<Permit> {
      return this.enter(false, opts);
    }

    /** Wait until nobody is inside, then write alone. */
    write(opts?: WaitOptions): Promise<Permit> {
      return this.enter(true, opts);
    }

    async useRead<T>(fn: () => T | Promise<T>, opts?: WaitOptions): Promise<T> {
      using _permit = await this.read(opts);
      return await fn();
    }

    async useWrite<T>(fn: () => T | Promise<T>, opts?: WaitOptions): Promise<T> {
      using _permit = await this.write(opts);
      return await fn();
    }
  }

  /**
   * A queue between cells that passes messages instead of sharing things. `capacity` is how many may wait inside: send waits when it is
   * full (back-pressure), receive waits when it is empty. Capacity 0 is a hand-over: send and receive wait for each other.
   * After close() the messages still inside can be received, then receive fails; `for await (const m of channel)` just ends.
   */
  class Channel<T> {
    private buffer: T[] = [];
    private senders: Entry[] = [];
    private receivers: Entry[] = [];
    private shut = false;

    constructor(
      readonly capacity = 0,
      readonly name = 'channel',
    ) {}

    /** Messages waiting inside. */
    get size(): number {
      return this.buffer.length;
    }

    /** Senders and receivers waiting. */
    get waiting(): number {
      return this.senders.length + this.receivers.length;
    }

    get closed(): boolean {
      return this.shut;
    }

    /** Hands a message to the first receiver, or to the buffer when there is room. Gives false when it must wait. */
    trySend(value: T): boolean {
      if (this.shut) throw new ChannelClosedError(`the channel '${this.name}'`);
      const receiver = this.receivers.shift();
      if (receiver) {
        receiver.go(value);
        return true;
      }
      if (this.buffer.length < this.capacity) {
        this.buffer.push(value);
        return true;
      }
      return false;
    }

    async send(value: T, opts?: WaitOptions): Promise<void> {
      if (this.trySend(value)) return;
      await wait<void>(opts?.scope ?? scope, this.senders, `room in the channel '${this.name}'`, opts, { value }, () => {});
    }

    /** The oldest message, or undefined when there is none right now (a message can itself be undefined: then use receive). */
    tryReceive(): { value: T } | undefined {
      if (this.buffer.length > 0) {
        const value = this.buffer.shift()!;
        const sender = this.senders.shift();
        if (sender) {
          this.buffer.push(sender.value as T);
          sender.go();
        }
        return { value };
      }
      const sender = this.senders.shift();
      if (sender) {
        sender.go();
        return { value: sender.value as T };
      }
      return undefined;
    }

    /** The oldest message; waits for one when there is none. Fails with ChannelClosedError when closed and empty. */
    async receive(opts?: WaitOptions): Promise<T> {
      const got = this.tryReceive();
      if (got) return got.value;
      if (this.shut) throw new ChannelClosedError(`the channel '${this.name}'`);
      return wait<T>(opts?.scope ?? scope, this.receivers, `a message in the channel '${this.name}'`, opts, {}, () => {});
    }

    /** No more sending. Whoever waits to send fails; whoever waits to receive is told there is nothing more. */
    close(): void {
      if (this.shut) return;
      this.shut = true;
      for (const entry of this.senders.splice(0)) entry.fail(new ChannelClosedError(`the channel '${this.name}'`));
      for (const entry of this.receivers.splice(0)) entry.fail(new ChannelClosedError(`the channel '${this.name}'`));
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
      for (;;) {
        try {
          yield await this.receive();
        } catch (err) {
          if (err instanceof ChannelClosedError) return;
          throw err;
        }
      }
    }
  }

  /**
   * A lock by name, the same one for every cell (like the Web Locks API of the browser, but between cells): `using l = await lock('printer')`.
   * 'shared' ones can be inside together; 'exclusive' (the default) is alone.
   */
  const lock = (name: string, opts: WaitOptions & { mode?: 'shared' | 'exclusive' } = {}): Promise<Permit> => {
    plain ??= makeSync(NO_SCOPE);
    let rw = namedLocks.get(name);
    if (!rw) namedLocks.set(name, (rw = new plain.RWLock(name)));
    const mine = { ...opts, scope: opts.scope ?? scope };
    return opts.mode === 'shared' ? rw.read(mine) : rw.write(mine);
  };

  return { Semaphore, Mutex, RWLock, Channel, lock };
}

/** The lock() names are shared by all cells, whichever run made them. */
interface NamedLock {
  read(opts?: WaitOptions): Promise<Permit>;
  write(opts?: WaitOptions): Promise<Permit>;
}
const namedLocks = new Map<string, NamedLock>();
let plain: { RWLock: new (name: string) => NamedLock } | undefined;
