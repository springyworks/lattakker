import { describe, expect, it } from 'vitest';
import { RunContext } from '../src/sheet/tasks';
import { makeSync } from '../src/sheet/sync';

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe('Semaphore', () => {
  it('lets n in and keeps the rest in line, first come first served', async () => {
    const { Semaphore } = makeSync();
    const sem = new Semaphore(2);
    const order: string[] = [];
    const worker = async (id: string) => {
      using _p = await sem.acquire();
      order.push(id);
      await tick(5);
    };
    await Promise.all(['a', 'b', 'c', 'd'].map(worker));
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(sem.value).toBe(2);
  });

  it('a permit is given back once, also by dispose', async () => {
    const { Semaphore } = makeSync();
    const sem = new Semaphore(1);
    const p = await sem.acquire();
    expect(sem.value).toBe(0);
    p.release();
    p.release();
    expect(sem.value).toBe(1);
    expect(sem.tryAcquire()).not.toBeNull();
    expect(sem.tryAcquire()).toBeNull();
  });

  it('a value of 0 is a signal', async () => {
    const { Semaphore } = makeSync();
    const go = new Semaphore(0);
    let woke = false;
    const waiter = go.acquire().then(() => (woke = true));
    await tick();
    expect(woke).toBe(false);
    go.release();
    await waiter;
    expect(woke).toBe(true);
  });

  it('use() releases when the function throws', async () => {
    const { Mutex } = makeSync();
    const m = new Mutex();
    await expect(m.use(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(m.locked).toBe(false);
  });

  it('a timeout leaves the line and fails with TimeoutError', async () => {
    const { Mutex } = makeSync();
    const m = new Mutex();
    await m.acquire();
    await expect(m.acquire(1, { timeout: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(m.waiting).toBe(0);
  });

  it('an aborted waiter leaves the line and the next one can go', async () => {
    const { Semaphore } = makeSync();
    const sem = new Semaphore(1);
    await sem.acquire();
    const stop = new AbortController();
    const big = sem.acquire(2, { signal: stop.signal });
    let small = false;
    void sem.acquire(1).then(() => (small = true));
    stop.abort();
    await expect(big).rejects.toBeDefined();
    sem.release();
    await tick();
    expect(small).toBe(true);
  });

  it('refuses a number that is not 1 or more', async () => {
    const { Semaphore } = makeSync();
    await expect(new Semaphore(1).acquire(0)).rejects.toThrow(RangeError);
  });
});

describe('cancelled runs', () => {
  it('a waiter of a cancelled run leaves the line, a permit of it goes back', async () => {
    const ctx = new RunContext('A1');
    const { Mutex } = makeSync({ guard: () => ctx.guard(), onCancel: (stop) => ctx.addTransient(stop) });
    const m = new Mutex();
    const held = await m.acquire();
    const waiting = m.acquire();
    const caught = waiting.catch((e) => e.name);
    ctx.cancel();
    expect(await caught).toBe('CancelError');
    expect(m.value).toBe(1);
    expect(m.waiting).toBe(0);
    expect(held.released).toBe(true);
    expect(m.value).toBe(1);
  });
});

describe('RWLock', () => {
  it('readers go in together, a writer is alone and is not overtaken', async () => {
    const { RWLock } = makeSync();
    const rw = new RWLock();
    const r1 = await rw.read();
    const r2 = await rw.read();
    expect(rw.readers).toBe(2);
    const events: string[] = [];
    const w = rw.write().then((p) => {
      events.push('write');
      return p;
    });
    const r3 = rw.read().then((p) => {
      events.push('read3');
      return p;
    });
    await tick();
    expect(events).toEqual([]);
    r1.release();
    r2.release();
    (await w).release();
    (await r3).release();
    expect(events).toEqual(['write', 'read3']);
    expect(rw.readers).toBe(0);
    expect(rw.writing).toBe(false);
  });
});

describe('Channel', () => {
  it('has back-pressure: send waits while the buffer is full', async () => {
    const { Channel } = makeSync();
    const ch = new Channel<number>(2);
    await ch.send(1);
    await ch.send(2);
    let third = false;
    void ch.send(3).then(() => (third = true));
    await tick();
    expect(third).toBe(false);
    expect(await ch.receive()).toBe(1);
    await tick();
    expect(third).toBe(true);
    expect(ch.size).toBe(2);
    expect(await ch.receive()).toBe(2);
    expect(await ch.receive()).toBe(3);
  });

  it('capacity 0 is a hand-over', async () => {
    const { Channel } = makeSync();
    const ch = new Channel<string>();
    const got = ch.receive();
    await ch.send('hi');
    expect(await got).toBe('hi');
    const sent = ch.send('there');
    expect(await ch.receive()).toBe('there');
    await sent;
  });

  it('for await ends after close, once the messages inside are taken', async () => {
    const { Channel } = makeSync();
    const ch = new Channel<number>(3);
    await ch.send(1);
    await ch.send(2);
    ch.close();
    const seen: number[] = [];
    for await (const n of ch) seen.push(n);
    expect(seen).toEqual([1, 2]);
    await expect(ch.send(3)).rejects.toMatchObject({ name: 'ChannelClosedError' });
    await expect(ch.receive()).rejects.toMatchObject({ name: 'ChannelClosedError' });
  });

  it('close wakes the ones that wait', async () => {
    const { Channel } = makeSync();
    const ch = new Channel<number>();
    const reading = ch.receive().catch((e) => e.name);
    ch.close();
    expect(await reading).toBe('ChannelClosedError');
  });
});

describe('lock(name)', () => {
  it('is the same lock for every cell, shared ones go together', async () => {
    const a = makeSync();
    const b = makeSync();
    const first = await a.lock('printer');
    let second = false;
    void b.lock('printer').then(() => (second = true));
    await tick();
    expect(second).toBe(false);
    first.release();
    await tick();
    expect(second).toBe(true);
    const s1 = await a.lock('docs', { mode: 'shared' });
    const s2 = await b.lock('docs', { mode: 'shared' });
    s1.release();
    s2.release();
  });
});
