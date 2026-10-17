import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const load = await import('../src/aichat/ollamaLoad');
const GB = 1024 ** 3;

beforeEach(() => store.clear());

describe('parsePs and describeModel (what /api/ps says, in words)', () => {
  it('reads size, GPU share, window and a model kept for ever', () => {
    const [m] = load.parsePs({ models: [{ name: 'qwen3.5:4b', size: 4 * GB, size_vram: 4 * GB, context_length: 32768, expires_at: '2319-01-27T09:29:39+01:00' }] });
    expect(m).toMatchObject({ name: 'qwen3.5:4b', sizeGB: 4, gpuPercent: 100, context: 32768, keeps: 'forever' });
    expect(load.describeModel(m)).toBe('4 GB, all on the GPU, 32768 tokens of memory, kept in memory: forever');
  });
  it('says so when the model is partly on the CPU, or all on it', () => {
    const half = load.parsePs({ models: [{ name: 'a', size: 10 * GB, size_vram: 5 * GB, expires_at: new Date(Date.now() + 5 * 60000).toISOString() }] })[0];
    expect(half.gpuPercent).toBe(50);
    expect(load.describeModel(half)).toMatch(/50% on the GPU, the rest on the CPU/);
    expect(half.keeps).toMatch(/minutes/);
    expect(load.describeModel(load.parsePs({ models: [{ name: 'b', size: GB, size_vram: 0 }] })[0])).toMatch(/all on the CPU \(slow\)/);
  });
  it('survives rubbish', () => {
    expect(load.parsePs(null)).toEqual([]);
    expect(load.parsePs({ models: 'x' })).toEqual([]);
    expect(load.parsePs({ models: [{ size: 1 }, 5] })).toEqual([]);
  });
});

describe('parseTimings (the numbers Ollama measured, nanoseconds)', () => {
  const done = { total_duration: 757746600, load_duration: 351680507, prompt_eval_count: 14, prompt_eval_duration: 79176000, eval_count: 11, eval_duration: 215824000 };
  it('converts to seconds with one decimal', () => {
    expect(load.parseTimings(done)).toEqual({ totalS: 0.8, loadS: 0.4, readTokens: 14, readS: 0.1, writeTokens: 11, writeS: 0.2 });
  });
  it('returns null when the piece carries no timings', () => {
    expect(load.parseTimings({})).toBeNull();
    expect(load.parseTimings({ total_duration: 0 })).toBeNull();
  });
});

describe('describeTimings keeps facts and guesses apart', () => {
  it('a quick answer has facts only', () => {
    const note = load.describeTimings({ totalS: 0.8, loadS: 0.4, readTokens: 14, readS: 0.1, writeTokens: 11, writeS: 0.2 });
    expect(note.known[0]).toMatch(/Ollama measured: loading the model 0.4 s, reading 14 tokens 0.1 s, writing 11 tokens 0.2 s \(55 tokens\/s\), in all 0.8 s/);
    expect(note.maybe).toEqual([]);
  });
  it('a long load is a fact plus a labelled guess', () => {
    const note = load.describeTimings({ totalS: 240, loadS: 230, readTokens: 4627, readS: 8, writeTokens: 80, writeS: 2 });
    expect(note.known[0]).toContain('loading the model 230 s');
    expect(note.maybe[0]).toMatch(/not in memory/);
  });
  it('a slow read without a load points at the conversation or the CPU', () => {
    expect(load.describeTimings({ totalS: 30, loadS: 0, readTokens: 9000, readS: 20, writeTokens: 5, writeS: 1 }).maybe[0]).toMatch(/slow/);
  });
  it('does not divide by zero', () => {
    expect(load.describeTimings({ totalS: 1, loadS: 0, readTokens: 1, readS: 0, writeTokens: 0, writeS: 0 }).known[0]).not.toMatch(/Infinity|NaN/);
  });
});

describe('the estimate of a load', () => {
  it('says plainly there is nothing to compare with', () => {
    expect(load.loadEstimate('m', 10)).toMatch(/no percentage/);
  });
  it('remembers a load, estimates from it, never reaches 100 %, and warns when it takes longer', () => {
    load.rememberLoad('m', 100);
    expect(load.lastLoadSeconds('m')).toBe(100);
    expect(load.loadEstimate('m', 50)).toMatch(/about 50% by estimate \(the last load took 100 s; Ollama itself does not report load progress\)$/);
    expect(load.loadEstimate('m', 500)).toMatch(/about 95%.*taking longer than last time/);
  });
  it('ignores loads under 3 s and empty names', () => {
    load.rememberLoad('m', 2);
    load.rememberLoad('', 50);
    expect(load.lastLoadSeconds('m')).toBeNull();
  });
  it('survives broken storage', () => {
    store.set('lattakker:ollama:loadSeconds', '{not json');
    expect(load.lastLoadSeconds('m')).toBeNull();
  });
});

describe('the live note', () => {
  it('shows the running note while a question waits, then the last answer', () => {
    const seen: number[] = [];
    load.onLiveChange(() => seen.push(1));
    load.setLive({ known: ['sent 3 s ago'], maybe: ['loading'] });
    expect(load.getLive()).toEqual({ note: { known: ['sent 3 s ago'], maybe: ['loading'] }, now: true });
    load.setLastRun({ known: ['measured'], maybe: [] });
    expect(load.getLive()).toEqual({ note: { known: ['measured'], maybe: [] }, now: false });
    load.setLive(null);
    expect(load.getLive().now).toBe(false);
    expect(seen.length).toBe(3);
  });
});
