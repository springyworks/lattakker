import { RULES_PARTS } from './rulesText';

/**
 * First contact. Every AI that starts to work with the internals of this page (an outside AI over /mcp or WebMCP,
 * the built-in helper) is told the same thing first: read the README, the place of truth, and follow the
 * rules. Until it has done so, its first tool call is answered with this instead of being carried out, and it
 * says so itself by reading the README through a tool (which fetches it) or by confirming it read it.
 */

export const README_URL = 'https://github.com/springyworks/lattakker/blob/main/README.md';
export const README_RAW = 'https://raw.githubusercontent.com/springyworks/lattakker/main/README.md';

/** The "First contact" part of the rules (README chapter 11.5.1). */
export const FIRST_CONTACT = (RULES_PARTS['first contact'] ?? '').trim();

const PART_CHARS = 12000;
const FETCH_MS = 10000;
let cached: Promise<{ text: string; source: string }> | null = null;

/** True for a README, false for whatever else a server answers with a 200 (a page of "not found", the app's own index.html). */
export const looksLikeReadme = (text: string): boolean => text.length > 5000 && /^#\s+\S/.test(text) && text.includes('Lattakker');

/**
 * The README. First the copy published next to this page (github.io, or the dev server): it is built from the very
 * README of this version of the app, so its API chapter matches the code that runs. Then GitHub, in case that copy is
 * missing. Each try has a time limit, so a slow network never hangs the helper.
 */
export function fetchReadme(): Promise<{ text: string; source: string }> {
  cached ??= (async () => {
    const attempts: Array<[string, string]> = [
      [new URL(`${import.meta.env.BASE_URL}ai/README.md`, location.href).href, 'the README published next to this page'],
      [README_RAW, 'GitHub'],
    ];
    for (const [url, source] of attempts) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
        if (!res.ok) continue;
        const text = await res.text();
        if (looksLikeReadme(text)) return { text, source };
      } catch {
        // try the next place
      }
    }
    throw new Error(`The README could not be loaded. Open it yourself: ${README_URL}`);
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}


/** Cuts the README into parts of about 12 000 characters, at the ends of lines, preferring the start of a heading. */
export function readmeParts(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > PART_CHARS) {
    const window = rest.slice(0, PART_CHARS);
    const heading = window.lastIndexOf('\n#');
    const cut = heading > PART_CHARS * 0.6 ? heading + 1 : window.lastIndexOf('\n') + 1 || PART_CHARS;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}

/** One part of the README: part 1 starts with the table of contents. */
export async function readReadme(part = 1): Promise<{ source: string; url: string; part: number; parts: number; text: string }> {
  const { text, source } = await fetchReadme();
  const all = readmeParts(text);
  const n = Math.min(all.length, Math.max(1, Math.floor(part) || 1));
  return { source, url: README_URL, part: n, parts: all.length, text: all[n - 1] ?? '' };
}

const oriented = new Set<string>();
export const isOriented = (who: string): boolean => oriented.has(who);
export const markOriented = (who: string): void => void oriented.add(who);

/** What a participant that has not read the README yet gets instead of an answer. */
export function orientation(who: string, tool: string): Record<string, unknown> {
  return {
    orientation: true,
    note: `Hello ${who}. Your call to ${tool} was NOT carried out: you are new here, and everybody starts by reading the README. Do that now, then repeat your call.`,
    read_first: README_URL,
    raw: README_RAW,
    how: 'If you can open links, read the README there, then call confirm_readme with one sentence on what you learned. If you cannot, call read_readme (it fetches the README from GitHub for you, part 1 of n, then part 2 ...). Either one lets your calls through.',
    rules: FIRST_CONTACT,
  };
}
