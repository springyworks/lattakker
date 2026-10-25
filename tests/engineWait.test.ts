import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const later = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('waiting for the TypeScript engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is not stuck while a queue of calls is being answered one after the other', async () => {
    const { answered } = await import('../src/editor/engineWait');
    const stuck = vi.fn();
    // Ten calls made at once; the engine answers one every 4 s, so the last one waits 40 s: far over the 15 s limit.
    const calls = Array.from({ length: 10 }, (_, i) => answered(later(4000 * (i + 1), i), 15000, stuck));
    await vi.advanceTimersByTimeAsync(45000);
    expect(await Promise.all(calls)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stuck).not.toHaveBeenCalled();
  });

  it('is stuck when the engine answers nothing at all', async () => {
    const { answered } = await import('../src/editor/engineWait');
    const stuck = vi.fn();
    const call = answered(new Promise<never>(() => {}), 15000, stuck);
    const outcome = expect(call).rejects.toThrow('did not answer in time');
    await vi.advanceTimersByTimeAsync(16000);
    await outcome;
    expect(stuck).toHaveBeenCalledOnce();
  });

  it('is stuck when the engine answered once and then went quiet', async () => {
    const { answered } = await import('../src/editor/engineWait');
    const stuck = vi.fn();
    const first = answered(later(1000, 'ok'), 15000, stuck);
    const second = answered(new Promise<never>(() => {}), 15000, stuck);
    const outcome = expect(second).rejects.toThrow('did not answer in time');
    await vi.advanceTimersByTimeAsync(17000);
    expect(await first).toBe('ok');
    await outcome;
    expect(stuck).toHaveBeenCalledOnce();
  });
});
