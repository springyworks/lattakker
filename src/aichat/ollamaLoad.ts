/**
 * What Ollama's /api/ps tells about a model in memory, in words for a person, and an honest estimate of a load.
 * Ollama does not report how far a load has come (/api/ps lists a model only when it is already loaded), so while
 * it loads the percentage is an estimate from how long the last load of this model took, and it is marked as one.
 */

export interface PsModel {
  name: string;
  sizeGB: number;
  /** The part of the model that sits in GPU memory (0 to 100); the rest runs on the CPU, which is much slower. */
  gpuPercent: number;
  /** The window the model was loaded with, in tokens (0 when the server does not say). */
  context: number;
  /** When it is dropped from memory: 'never', 'in 4 min' ... */
  keeps: string;
}

const GB = 1024 ** 3;
const KEY = 'lattakker:ollama:loadSeconds';

export function parsePs(data: unknown): PsModel[] {
  const list = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): PsModel[] => {
    const m = raw as { name?: string; model?: string; size?: number; size_vram?: number; context_length?: number; expires_at?: string };
    const name = String(m.name ?? m.model ?? '');
    if (!name) return [];
    const size = Number(m.size) || 0;
    const until = m.expires_at ? Date.parse(m.expires_at) : NaN;
    const minutes = Number.isFinite(until) ? (until - Date.now()) / 60000 : NaN;
    return [{
      name,
      sizeGB: Math.round((size / GB) * 10) / 10,
      gpuPercent: size > 0 ? Math.min(100, Math.round(((Number(m.size_vram) || 0) / size) * 100)) : 0,
      context: Number(m.context_length) || 0,
      keeps: !Number.isFinite(minutes) ? 'unknown' : minutes > 60 * 24 * 365 ? 'forever' : minutes < 1 ? 'less than a minute more' : `${Math.round(minutes)} more minutes`,
    }];
  });
}

/** One line: how big, how much of it on the GPU, how big a window, how long it stays. */
export function describeModel(m: PsModel): string {
  const where = m.gpuPercent >= 99 ? 'all on the GPU' : m.gpuPercent === 0 ? 'all on the CPU (slow)' : `${m.gpuPercent}% on the GPU, the rest on the CPU (slower)`;
  return `${m.sizeGB} GB, ${where}${m.context ? `, ${m.context} tokens of memory` : ''}, kept in memory: ${m.keeps}`;
}

function history(): Record<string, number> {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, number>;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Remember how long a load of this model took, to estimate the next one. */
export function rememberLoad(model: string, seconds: number): void {
  if (!model || !(seconds >= 3)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...history(), [model]: Math.round(seconds) }));
  } catch {
    // Storage may be full or blocked: the estimate is then just missing.
  }
}

export function lastLoadSeconds(model: string): number | null {
  const s = history()[model];
  return typeof s === 'number' && s > 0 ? s : null;
}

/** "about 42% (the last load took 142 s)", or a plain statement that there is nothing to compare with. Never 100%: only the server knows when it is done. */
export function loadEstimate(model: string, elapsedSeconds: number): string {
  const last = lastLoadSeconds(model);
  if (!last) return 'no earlier load of this model to compare with, so no percentage';
  const pct = Math.min(95, Math.round((elapsedSeconds / last) * 100));
  return `about ${pct}% by estimate (the last load took ${last} s; Ollama itself does not report load progress)${elapsedSeconds > last * 1.5 ? ', it is taking longer than last time: memory may be short or swapping' : ''}`;
}

/** What Ollama itself measured for one answer (the last piece of its reply carries these, in nanoseconds). */
export interface Timings {
  totalS: number;
  loadS: number;
  readTokens: number;
  readS: number;
  writeTokens: number;
  writeS: number;
}

const seconds = (ns: unknown): number => Math.round((Number(ns) / 1e9) * 10) / 10;

/** The timings of a finished native reply, or null when the piece has none (other servers do not send them). */
export function parseTimings(done: { total_duration?: number; load_duration?: number; prompt_eval_count?: number; prompt_eval_duration?: number; eval_count?: number; eval_duration?: number }): Timings | null {
  if (!(Number(done.total_duration) > 0)) return null;
  return {
    totalS: seconds(done.total_duration),
    loadS: seconds(done.load_duration ?? 0),
    readTokens: Number(done.prompt_eval_count) || 0,
    readS: seconds(done.prompt_eval_duration ?? 0),
    writeTokens: Number(done.eval_count) || 0,
    writeS: seconds(done.eval_duration ?? 0),
  };
}

/** What is measured (known) and what is only a reading of it (maybe): never mixed in one sentence. */
export interface LiveNote {
  known: string[];
  maybe: string[];
}

export function describeTimings(t: Timings): LiveNote {
  const known = [`Ollama measured: loading the model ${t.loadS} s, reading ${t.readTokens} tokens ${t.readS} s, writing ${t.writeTokens} tokens ${t.writeS} s${t.writeS > 0 ? ` (${Math.round((t.writeTokens / t.writeS) * 10) / 10} tokens/s)` : ''}, in all ${t.totalS} s`];
  const maybe: string[] = [];
  if (t.loadS >= 1) maybe.push('the model was not in memory for this question (first use, a different window size, or another model pushed it out)');
  else if (t.readS > 10) maybe.push('a long conversation or a slow part of the model (CPU) made the reading slow');
  return { known, maybe };
}

const EMPTY: LiveNote = { known: [], maybe: [] };
let current: LiveNote | null = null;
let last: LiveNote = EMPTY;
const liveListeners: Array<() => void> = [];

export const onLiveChange = (l: () => void): void => void liveListeners.push(l);

/** What is going on right now, while a question waits. */
export function setLive(note: LiveNote | null): void {
  current = note;
  liveListeners.forEach((l) => l());
}

/** What the last finished question measured. */
export function setLastRun(note: LiveNote): void {
  last = note;
  current = null;
  liveListeners.forEach((l) => l());
}

export const getLive = (): { note: LiveNote; now: boolean } => (current ? { note: current, now: true } : { note: last, now: false });
