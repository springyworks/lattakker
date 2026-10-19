/**
 * Patience: what happens when the model on this computer stays silent for the time chosen in the settings.
 * Instead of giving up (or spinning for ever), the page asks the person: keep waiting for another while, or stop?
 * A person who has walked away does not answer; the question then runs out by itself and the request is stopped.
 */

/** How long the question waits for an answer before it stops the request by itself. */
export const AWAY_MS = 3 * 60000;
/** The "keep waiting" choices, in minutes. */
export const EXTENSIONS = [10, 30, 60];

export interface Checkpoint {
  id: number;
  model: string;
  /** performance.now() when the person was asked. */
  askedAt: number;
  /** performance.now() when the question runs out. */
  until: number;
  /** What is known about the wait, for the person to decide on. */
  facts: () => string[];
  silentSeconds: () => number;
}

export interface Answer {
  /** Minutes to wait longer; 0 means stop. */
  minutes: number;
  /** True when nobody answered and the question ran out. */
  away: boolean;
}

interface Open extends Checkpoint {
  settle: (a: Answer) => void;
  timer: ReturnType<typeof setTimeout>;
}

const open: Open[] = [];
const listeners: Array<() => void> = [];
let counter = 0;

export const onCheckpointChange = (l: () => void): void => void listeners.push(l);
export const checkpoints = (): Checkpoint[] => open;

function changed(): void {
  listeners.forEach((l) => l());
}

/** Ask whether to keep waiting. `withdraw` removes the question when the model spoke after all or the request was stopped. */
export function askToContinue(model: string, silentSeconds: () => number, facts: () => string[], awayMs = AWAY_MS): { answer: Promise<Answer>; withdraw: () => void } {
  let settle!: (a: Answer) => void;
  const answer = new Promise<Answer>((resolve) => (settle = resolve));
  const now = performance.now();
  const entry: Open = {
    id: ++counter,
    model,
    askedAt: now,
    until: now + awayMs,
    facts,
    silentSeconds,
    settle,
    timer: setTimeout(() => close(entry, { minutes: 0, away: true }), awayMs),
  };
  open.push(entry);
  changed();
  return { answer, withdraw: () => close(entry, { minutes: -1, away: false }) };
}

function close(entry: Open, a: Answer): void {
  const at = open.indexOf(entry);
  if (at < 0) return;
  open.splice(at, 1);
  clearTimeout(entry.timer);
  entry.settle(a);
  changed();
}

/** The person's answer to one question: minutes to wait longer, or 0 to stop. */
export function answerCheckpoint(id: number, minutes: number): void {
  const entry = open.find((o) => o.id === id);
  if (entry) close(entry, { minutes, away: false });
}

/** "10 min", "1 h" ... for buttons and notes. */
export const minutesText = (m: number): string => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);
