/**
 * Standing directives: direction the owner gives to EVERY AI that works in Lattakker (the built-in helper, a model on this computer,
 * outside AIs over MCP). They live in ai-docs/directives.json (in git, so the file also has a real history) and are managed with
 * `node scripts/directives.mjs`. Pure code, no browser or Node parts, so the page and the build can both use it.
 *
 * A directive has: a number, when it was made, when it was last changed, a strength (0 to 100 %), an end of life (the last
 * day it counts; null = no end), its text, and its earlier versions (a tiny history of its own).
 *
 * Strength: 100 = "you should always" (use with care: that is why a directive can also end), 70 = a strong preference,
 * 50 = indifferent (take it or leave it), 0 = it is there but absolutely not relevant.
 */

export interface DirectiveVersion {
  updated: string;
  strength: number;
  endOfLife: string | null;
  text: string;
}

export interface Directive {
  number: number;
  /** ISO date and time. */
  created: string;
  updated: string;
  /** 0 to 100, in percent. */
  strength: number;
  /** The last day (YYYY-MM-DD, local time) the directive counts, or null. */
  endOfLife: string | null;
  text: string;
  history: DirectiveVersion[];
}

export interface DirectiveFile {
  version: 1;
  /** The number the next directive gets. */
  next: number;
  directives: Directive[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in the local time zone. */
export function today(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** What is in the file, made safe: anything that is not a well-formed directive is dropped, never trusted. */
export function parseDirectives(data: unknown): DirectiveFile {
  const raw = (data ?? {}) as { next?: unknown; directives?: unknown };
  const list = Array.isArray(raw.directives) ? raw.directives : [];
  const directives = list.flatMap((item): Directive[] => {
    const d = item as Partial<Directive> | null;
    if (!d || typeof d !== 'object' || !Number.isInteger(d.number) || typeof d.text !== 'string' || !d.text.trim()) return [];
    const strength = Number(d.strength);
    if (!Number.isFinite(strength)) return [];
    return [
      {
        number: d.number as number,
        created: String(d.created ?? ''),
        updated: String(d.updated ?? d.created ?? ''),
        strength: Math.min(100, Math.max(0, Math.round(strength))),
        endOfLife: typeof d.endOfLife === 'string' && DAY.test(d.endOfLife) ? d.endOfLife : null,
        text: d.text.trim(),
        history: Array.isArray(d.history) ? (d.history as DirectiveVersion[]) : [],
      },
    ];
  });
  const highest = directives.reduce((n, d) => Math.max(n, d.number), 0);
  return { version: 1, next: Math.max(Number.isInteger(raw.next) ? (raw.next as number) : 1, highest + 1), directives };
}

/** Has its last day passed? */
export const isExpired = (d: Directive, now: Date = new Date()): boolean => d.endOfLife !== null && today(now) > d.endOfLife;

/** The directives that count today, the strongest first (then the newest). */
export function alive(file: DirectiveFile, now: Date = new Date()): Directive[] {
  return file.directives.filter((d) => !isExpired(d, now)).sort((a, b) => b.strength - a.strength || b.number - a.number);
}

/** How to read a strength, in the words an AI should hear. */
export function strengthWords(strength: number): string {
  if (strength >= 100) return 'You should ALWAYS (the highest strength)';
  if (strength >= 85) return 'You should nearly always';
  if (strength >= 70) return 'You should (a strong preference, not absolute)';
  if (strength >= 55) return 'It is good to (a mild preference)';
  if (strength >= 45) return 'Indifferent: take it or leave it';
  if (strength >= 1) return 'A weak hint: let anything else outweigh it';
  return 'Not relevant: it is only here for the record, ignore it';
}

const HEADER = `Standing directives from the owner of this app. They give direction by default to every AI that works here. Each has a strength from 0 to 100 %: 100 = "you should always", 70 = a strong preference, 50 = indifferent (take it or leave it), 0 = present but absolutely not relevant (ignore it). When two directives disagree, the stronger one wins. A directive never overrides the rules about children's safety, and what the person asks for in the current question wins over any directive below 100 %. A directive ends after its end-of-life day: ignore it from the next day on.`;

/** The directives as text for an AI. `now` decides which have ended; the end dates stay in the text, so a stale copy can still be judged. */
export function renderDirectives(file: DirectiveFile, now: Date = new Date()): string {
  const list = alive(file, now);
  if (!list.length) return '';
  const lines = list.map((d) => `${d.number}. [${d.strength} % · ${strengthWords(d.strength)}${d.endOfLife ? ` · counts until ${d.endOfLife} inclusive` : ' · no end date'}] ${d.text}`);
  return `${HEADER}\n\n${lines.join('\n')}`;
}
