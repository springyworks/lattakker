/**
 * The bell of an ASR-33 teletype (a real recording, from Hugh Pyle's ttyemu, CC BY-SA 4.0: see README 14). It rings
 * once, softly, when an answer arrives after the helper made the person wait. The "lid closed" recording is used
 * (the muffled one) and played at a low volume with a tiny fade-in, so it never startles anyone.
 */
import bellUrl from './asr33-bell.mp3?url';
import key1 from './keys/key-01.mp3?url';
import key2 from './keys/key-02.mp3?url';
import key3 from './keys/key-03.mp3?url';
import key4 from './keys/key-04.mp3?url';
import key5 from './keys/key-05.mp3?url';
import key6 from './keys/key-06.mp3?url';
import key7 from './keys/key-07.mp3?url';
import cr1 from './keys/cr-01.mp3?url';
import cr2 from './keys/cr-02.mp3?url';
import humUrl from './keys/hum.mp3?url';
import printCharsUrl from './keys/print-chars-01.mp3?url';
import printSpacesUrl from './keys/print-spaces-01.mp3?url';
import motorOnUrl from './keys/motor-on.mp3?url';
import motorOffUrl from './keys/motor-off.mp3?url';
import { keyProfile } from './keyProfile';

const KEY_URLS = [key1, key2, key3, key4, key5, key6, key7];
const CR_URLS = [cr1, cr2];

/** An answer that came faster than this needs no bell: the person was watching. */
export const BELL_AFTER_MS = 20000;
/** Fraction of the recording's own level (the open-lid recording peaks at 0 dB; this makes it about −19 dB). */
const VOLUME = 0.11;
const FADE_IN_S = 0.01;
const KEY = 'lattakker:ai:bell';

let enabled = ((): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();
const listeners: Array<() => void> = [];

export const bellOn = (): boolean => enabled;

export function onBellChange(listener: () => void): void {
  listeners.push(listener);
}

export function setBell(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
  if (!on) stopMachine(true);
  for (const l of listeners) l();
}

let context: AudioContext | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;
let keyBuffers: Promise<AudioBuffer[]> | null = null;
let crBuffers: Promise<AudioBuffer[]> | null = null;
let machineBuffers: Promise<Record<MachineSound, AudioBuffer | null>> | null = null;

function loadAll(ctx: AudioContext, urls: string[]): Promise<AudioBuffer[]> {
  return Promise.all(
    urls.map((u) =>
      fetch(u)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null),
    ),
  ).then((all) => all.filter((b): b is AudioBuffer => b !== null));
}

type MachineSound = 'hum' | 'chars' | 'spaces' | 'motorOn' | 'motorOff';
const MACHINE_URLS: Record<MachineSound, string> = {
  hum: humUrl,
  chars: printCharsUrl,
  spaces: printSpacesUrl,
  motorOn: motorOnUrl,
  motorOff: motorOffUrl,
};

function loadMachine(ctx: AudioContext): Promise<Record<MachineSound, AudioBuffer | null>> {
  const names = Object.keys(MACHINE_URLS) as MachineSound[];
  return Promise.all(
    names.map((n) =>
      fetch(MACHINE_URLS[n])
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null),
    ),
  ).then((all) => Object.fromEntries(names.map((n, i) => [n, all[i]])) as Record<MachineSound, AudioBuffer | null>);
}

/** Called from a click or key press (browsers only let sound start after one): wakes the audio and loads the recording. */
export function primeBell(): void {
  if (!enabled || typeof AudioContext === 'undefined') return;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  const ctx = context;
  buffer ??= fetch(bellUrl)
    .then((r) => r.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => null);
  keyBuffers ??= loadAll(ctx, KEY_URLS);
  crBuffers ??= loadAll(ctx, CR_URLS);
  machineBuffers ??= loadMachine(ctx);
}

/** Rings the bell once, softly. Does nothing when muted or when the browser does not allow sound yet. */
export async function ringBell(): Promise<boolean> {
  if (!enabled) return false;
  primeBell();
  const ctx = context;
  const data = await buffer;
  if (!ctx || !data || !enabled) return false;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return false;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(VOLUME, now + FADE_IN_S);
  const source = ctx.createBufferSource();
  source.buffer = data;
  source.connect(gain).connect(ctx.destination);
  source.start(now);
  return true;
}

/** The answer has come: ring if the person had to wait long enough to have looked away. */
export function bellForAnswer(waitedMs: number): void {
  if (waitedMs >= BELL_AFTER_MS) void ringBell();
}

const KEY_VOLUME = 0.11;
const lastPick = { key: -1, cr: -1 };

/** `char` (a typed character, or 'Backspace'/'Delete') gives that key its own small, always the same, character; without it the clack varies at random. */
export async function clack(set: 'key' | 'cr', char?: string): Promise<void> {
  if (!enabled) return;
  primeBell();
  const ctx = context;
  const list = await (set === 'key' ? keyBuffers : crBuffers);
  if (!ctx || !list?.length || !enabled || ctx.state !== 'running') return;
  let i: number;
  let rate: number;
  let level = 1;
  if (set === 'key' && char) {
    const p = keyProfile(char);
    i = p.sample % list.length;
    rate = p.rate * (1 + (Math.random() - 0.5) * 0.006);
    level = p.gain;
  } else {
    i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastPick[set]) i = (i + 1) % list.length;
    rate = 0.96 + Math.random() * 0.08;
  }
  lastPick[set] = i;
  const gain = ctx.createGain();
  gain.gain.value = KEY_VOLUME * level;
  const source = ctx.createBufferSource();
  source.buffer = list[i];
  source.playbackRate.value = rate;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

/** The machine prints about 10 characters a second (110 baud); a carriage return takes two character times. */
export const CHAR_MS = 100;
/** A paste is typed out like this for its first characters; the rest goes in at once so a long paste never keeps anyone waiting. */
export const PASTE_TYPED_MAX = 150;

/*
 * The machine itself, after Hugh Pyle's ttyemu (sounds.py): three long recordings run side by side, the motor hum, a line
 * of characters being printed and a line of spaces being printed (each exactly one 70-letter line at 10 letters a second),
 * and which one you hear is crossfaded by what is printed now. A carriage return starts the print loops again so the next
 * line begins in step with the carriage. The machine cannot print faster than 10 letters a second, so letters wait in a queue.
 */
const PRINT_VOLUME = 0.11;
const HUM_VOLUME = 0.3;
const MOTOR_VOLUME = 0.11;
/** The motor is up to speed (and the hum takes over from the start-up sound) this long after it starts. */
const SPIN_UP_MS = 1500;
/** After this long without printing the motor stops, with its own run-down sound. */
const MOTOR_IDLE_MS = 8000;
const FADE_S = 0.012;

interface Loop {
  mix: GainNode;
  source: AudioBufferSourceNode | null;
}
interface Machine {
  hum: Loop;
  chars: Loop;
  spaces: Loop;
  spunUp: boolean;
  queue: string[];
  tick: number;
  humTimer: number;
  motorTimer: number;
  spinTimer: number;
}
type Mix = 'hum' | 'chars' | 'spaces' | 'none';
let machine: Machine | null = null;

function startLoop(ctx: AudioContext, loop: Loop, data: AudioBuffer): void {
  const now = ctx.currentTime;
  const old = loop.source;
  if (old) {
    const out = ctx.createGain();
    loop.source = null;
    // the old line fades out while the new one starts, so a carriage return never clicks
    old.disconnect();
    old.connect(out).connect(ctx.destination);
    out.gain.setValueAtTime(loop.mix.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + FADE_S);
    old.stop(now + FADE_S + 0.01);
  }
  const source = ctx.createBufferSource();
  source.buffer = data;
  source.loop = true;
  source.connect(loop.mix);
  source.start(now);
  loop.source = source;
}

function setMix(ctx: AudioContext, m: Machine, which: Mix): void {
  const now = ctx.currentTime;
  const target = (loop: Loop, on: boolean, level: number): void => {
    loop.mix.gain.setTargetAtTime(on ? level : 0, now, 0.01);
  };
  target(m.hum, which === 'hum' && m.spunUp, HUM_VOLUME);
  target(m.chars, which === 'chars', PRINT_VOLUME);
  target(m.spaces, which === 'spaces', PRINT_VOLUME);
}

function playOnce(ctx: AudioContext, data: AudioBuffer | null, level: number): void {
  if (!data) return;
  const gain = ctx.createGain();
  gain.gain.value = level;
  const source = ctx.createBufferSource();
  source.buffer = data;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

async function startMachine(): Promise<Machine | null> {
  if (machine) return machine;
  primeBell();
  const ctx = context;
  const data = await machineBuffers;
  if (!ctx || !data || !enabled) return null;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return null;
  if (machine) return machine;
  const loop = (): Loop => {
    const mix = ctx.createGain();
    mix.gain.value = 0;
    mix.connect(ctx.destination);
    return { mix, source: null };
  };
  const m: Machine = { hum: loop(), chars: loop(), spaces: loop(), spunUp: false, queue: [], tick: 0, humTimer: 0, motorTimer: 0, spinTimer: 0 };
  machine = m;
  playOnce(ctx, data.motorOn, MOTOR_VOLUME);
  if (data.hum) startLoop(ctx, m.hum, data.hum);
  if (data.chars) startLoop(ctx, m.chars, data.chars);
  if (data.spaces) startLoop(ctx, m.spaces, data.spaces);
  m.spinTimer = window.setTimeout(() => {
    m.spunUp = true;
    if (!m.queue.length) setMix(ctx, m, 'hum');
  }, SPIN_UP_MS);
  return m;
}

function stopMachine(silent = false): void {
  const m = machine;
  const ctx = context;
  if (!m || !ctx) return;
  machine = null;
  window.clearTimeout(m.tick);
  window.clearTimeout(m.humTimer);
  window.clearTimeout(m.motorTimer);
  window.clearTimeout(m.spinTimer);
  const now = ctx.currentTime;
  for (const l of [m.hum, m.chars, m.spaces]) {
    l.mix.gain.cancelScheduledValues(now);
    l.mix.gain.setTargetAtTime(0, now, 0.15);
    l.source?.stop(now + 1.2);
  }
  if (silent) return;
  void machineBuffers?.then((d) => {
    if (ctx.state === 'running') playOnce(ctx, d.motorOff, MOTOR_VOLUME);
  });
}

function soundFor(ctx: AudioContext, m: Machine, ch: string | undefined, data: Record<MachineSound, AudioBuffer | null>): void {
  if (ch === undefined) return;
  if (ch === '\r' || ch === '\n') {
    setMix(ctx, m, 'spaces');
    void clack('cr');
    if (data.chars) startLoop(ctx, m.chars, data.chars);
    if (data.spaces) startLoop(ctx, m.spaces, data.spaces);
  } else if (ch === '\x07') {
    setMix(ctx, m, 'none');
    void ringBell();
  } else if (ch <= ' ' || /\s/.test(ch)) setMix(ctx, m, 'spaces');
  else setMix(ctx, m, 'chars');
}

/** The teleprinter prints this letter (a "\n" is a carriage return, "\x07" the bell). Letters queue up at 10 a second, like the real machine. Silent when muted. */
export function printChar(ch: string): void {
  if (!enabled || !ch) return;
  void startMachine().then(async (m) => {
    const ctx = context;
    const data = await machineBuffers;
    if (!m || !ctx || !data || m !== machine) return;
    window.clearTimeout(m.humTimer);
    window.clearTimeout(m.motorTimer);
    m.queue.push(ch);
    if (m.queue.length === 1) {
      soundFor(ctx, m, ch, data);
      const next = (): void => {
        m.queue.shift();
        soundFor(ctx, m, m.queue[0], data);
        if (m.queue.length) m.tick = window.setTimeout(next, CHAR_MS);
        else {
          m.humTimer = window.setTimeout(() => setMix(ctx, m, 'hum'), CHAR_MS);
          m.motorTimer = window.setTimeout(() => stopMachine(), MOTOR_IDLE_MS);
        }
      };
      m.tick = window.setTimeout(next, CHAR_MS);
    }
  });
}

/** The motor runs (and hums) for a while after any use of the teletype, a key, a carriage return or the bell as well as a printed letter. */
export function touchMotor(): void {
  if (!enabled) return;
  void startMachine().then((m) => {
    const ctx = context;
    if (!m || !ctx || m !== machine || m.queue.length) return;
    window.clearTimeout(m.motorTimer);
    m.motorTimer = window.setTimeout(() => stopMachine(), MOTOR_IDLE_MS);
    if (m.spunUp) setMix(ctx, m, 'hum');
  });
}

export const machineRunning = (): boolean => machine !== null;

/** Which cells made the sound lately: a cell that is silent is never listed. */
const sources = new Map<string, { at: number; count: number }>();

export function noteSource(path: string): void {
  const s = sources.get(path);
  sources.set(path, { at: Date.now(), count: (s?.count ?? 0) + 1 });
}

export function soundSources(withinMs = 30000): Array<{ path: string; secondsAgo: number; calls: number }> {
  const now = Date.now();
  return [...sources]
    .filter(([, s]) => now - s.at <= withinMs)
    .map(([path, s]) => ({ path, secondsAgo: Math.round((now - s.at) / 100) / 10, calls: s.count }))
    .sort((a, b) => a.secondsAgo - b.secondsAgo);
}

/** Every character typed into the box clacks like a key of the teleprinter, each a little different; Enter is the carriage return. A paste is typed out character by character. Muted with the bell. */
export function typewriterSounds(input: HTMLTextAreaElement): void {
  let typing: (() => void) | null = null;

  /** Types `text` at the cursor, one character per CHAR_MS; returns a function that puts the rest in at once. */
  const typeOut = (text: string): (() => void) => {
    const chars = [...text.replace(/\r\n?/g, '\n')];
    let n = 0;
    let timer = 0;
    const put = (s: string): void => {
      input.setRangeText(s, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: s }));
      input.scrollTop = input.scrollHeight;
    };
    const finish = (): void => {
      window.clearTimeout(timer);
      if (n < chars.length) put(chars.slice(n).join(''));
      n = chars.length;
      typing = null;
    };
    const step = (): void => {
      if (n >= PASTE_TYPED_MAX || n >= chars.length) return finish();
      const ch = chars[n++];
      put(ch);
      if (ch !== '\n') void clack('key', ch);
      printChar(ch);
      timer = window.setTimeout(step, ch === '\n' ? 2 * CHAR_MS : CHAR_MS);
    };
    step();
    return finish;
  };

  input.addEventListener('focus', primeBell);
  input.addEventListener('blur', () => typing?.());
  input.addEventListener('mousedown', () => typing?.());
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!enabled || !text) return;
    e.preventDefault();
    primeBell();
    typing?.();
    typing = typeOut(text);
  });
  input.addEventListener('keydown', (e) => {
    if (typing) {
      // any key stops the typing at once and takes over: the rest of the paste is already in the box
      typing();
      if (e.key === 'Escape') return e.preventDefault();
    }
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') printChar('\n');
    else if (e.key === 'Backspace' || e.key === 'Delete') void clack('key', e.key);
    else if ([...e.key].length === 1) {
      void clack('key', e.key);
      printChar(e.key);
    }
  });
}
