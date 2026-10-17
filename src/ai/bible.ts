import { RULES, standingDirectives } from '../aichat/docs';
import { FIRST_CONTACT, README_URL, fetchReadme } from './orientation';

/**
 * The README as "the Bible" for a model that cannot open links: the rules of the project first, then as many chapters
 * of the README (the copy on GitHub, the place of truth) as fit in a share of the model's memory, most useful
 * chapters first (what Lattakker is, how it is played, how a cell works, the cell API). A local model on this
 * computer has a small window (4k to 32k tokens), so the whole README (about 30k tokens) is cut to fit and the
 * chapters that did not fit are named, so the model knows what exists and can ask for them (read_docs readme).
 */

interface Chapter {
  /** The number in the heading ('4', '8.1'). */
  id: string;
  heading: string;
  text: string;
}

/** Chapters in the order they are worth their room. A chapter that is not listed is only named. */
const PRIORITY = ['1', '4', '5', '7', '8.1', '8.2', '8.3', '6', '8.4', '8.5', '8.6', '8.7', '8.8', '8.14', '8.10', '8.11', '9.1', '9.2', '8.9', '8.15', '8.12', '8.13', '8.16', '8.17', '8.18'];
const CHARS_PER_TOKEN = 3.3;

/** The README cut into chapters by its headings (a "#" line inside a code block is not a heading). */
function chapters(readme: string): Chapter[] {
  const out: Chapter[] = [];
  let fenced = false;
  let current: { id: string; heading: string; lines: string[] } | null = null;
  const close = (): void => {
    if (current) out.push({ id: current.id, heading: current.heading, text: current.lines.join('\n').trim() });
  };
  for (const line of readme.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const h = !fenced ? /^#{1,4}\s+(.*)$/.exec(line) : null;
    if (h) {
      close();
      const num = /^(\d+(?:\.\d+)*)\s/.exec(h[1]);
      current = { id: num ? num[1] : `x${out.length}`, heading: h[1].trim(), lines: [line] };
    } else current?.lines.push(line);
  }
  close();
  return out.filter((c) => c.heading !== 'Contents');
}

export interface Bible {
  /** The text for the start of the model's instructions. */
  text: string;
  /** True when README chapters are in it (not only the rules and the address). */
  hasReadme: boolean;
  included: string[];
  left: string[];
  source: string;
}

const cache = new Map<string, Bible>();

/** The rules and as much of the README as fits in `share` of a window of `windowTokens`. */
export async function bibleFor(windowTokens: number, share = 0.4): Promise<Bible> {
  const directives = standingDirectives();
  // The directives are part of the key: when one ends or changes, the next question gets a new Bible.
  const key = `${Math.round(windowTokens * share)}|${directives}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const budget = Math.floor(windowTokens * share * CHARS_PER_TOKEN);
  const rules = `${FIRST_CONTACT}\n\n${RULES.cell}${directives ? `\n\nStanding directives:\n${directives}` : ''}`.trim();
  const head = `THE LATTAKKER BIBLE. The README of this project, on GitHub (${README_URL}), is the place of truth: it wins over what you remember or guess about Lattakker. Lattakker is a board game and a spreadsheet of TypeScript cells in one page. Rules for every AI here:\n${rules}`;
  let bible: Bible;
  try {
    const { text, source } = await fetchReadme();
    const all = chapters(text);
    const byId = new Map(all.map((c) => [c.id, c]));
    let room = budget - head.length - 400;
    const included: string[] = [];
    const parts: string[] = [];
    for (const id of PRIORITY) {
      const c = byId.get(id);
      if (!c) continue;
      if (c.text.length + 2 > room) continue;
      parts.push(c.text);
      included.push(c.heading);
      room -= c.text.length + 2;
    }
    const left = all.filter((c) => !included.includes(c.heading) && /^\d+(\.\d+)?$/.test(c.id)).map((c) => `${c.id} ${c.heading.replace(/^\d+(?:\.\d+)*\s+/, '')}`);
    bible = {
      text: `${head}\n\n--- README, chapters read from ${source} (${included.length} of ${all.length}) ---\n${parts.join('\n\n')}\n--- end of the README chapters. Not included, to save room: ${left.join('; ')}. If you can, ask for them (read_docs with doc "readme"). ---`,
      hasReadme: parts.length > 0,
      included,
      left,
      source,
    };
  } catch {
    bible = { text: `${head}\n(The README could not be loaded just now. Read it at ${README_URL}.)`, hasReadme: false, included: [], left: [], source: 'none' };
    return bible;
  }
  cache.set(key, bible);
  return bible;
}
