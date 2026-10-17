import rulesRaw from '../../ai-docs/rules.md?raw';
import directivesRaw from '../../ai-docs/directives.json?raw';
import { parseDirectives, renderDirectives } from '../ai/directives';
import { CELL_API_DTS } from '../sheet/apiTypes';
import { EXAMPLES } from '../examples';
import { LAB_DEMOS } from '../labDemos';
import { MONITOR_DEMOS } from '../monitorDemos';
import { fetchReadme } from '../ai/orientation';

/**
 * What a human coder has when she joins a project, for the helper: the rules, the API (exact names and
 * signatures), every example cell the children start with, and the README. The API and the examples are the very
 * data the app runs on, so they cannot be out of date; the README is the published copy next to the page.
 * The same documents are published as files (see scripts/ai-docs.ts), so an AI that can open links can read them
 * itself: `docUrls()` says where.
 */

const GITHUB = 'https://github.com/springyworks/lattakker/blob/main/';
const GITHUB_RAW = 'https://raw.githubusercontent.com/springyworks/lattakker/main/';

/** The address of this page's own folder, e.g. https://springyworks.github.io/lattakker/ . */
const site = (): string => new URL(import.meta.env.BASE_URL, location.href).href;

/** Where each document can be read by something that opens links: the published copy, and the source on GitHub. */
export function docUrls(): Record<string, string> {
  const ai = `${site()}ai/`;
  return {
    index: `${ai}index.md`,
    rules: `${ai}rules.md`,
    api: `${ai}cell-api.d.ts`,
    examples: `${ai}examples.md`,
    labDemos: `${ai}lab-demos.md`,
    everything: `${ai}everything.md`,
    manifest: `${ai}manifest.json`,
    readme: `${GITHUB}README.md`,
    readmeRaw: `${GITHUB_RAW}README.md`,
    apiSource: `${GITHUB_RAW}src/sheet/apiTypes.ts`,
    examplesSource: `${GITHUB_RAW}src/examples.ts`,
    labDemosSource: `${GITHUB_RAW}src/labDemos.ts`,
  };
}

// ---------------------------------------------------------------- the rules

/** The "## Heading" parts of rules.md, by heading. */
function sections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name = '';
  for (const line of markdown.split('\n')) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      name = h[1].trim().toLowerCase();
      out[name] = '';
    } else if (name) out[name] += `${line}\n`;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

const parts = sections(rulesRaw);

/** The owner's standing directives that count today (a directive ends after its last day), or '' when there are none. Read each time, so a page left open for days still lets them end. */
export function standingDirectives(): string {
  try {
    return renderDirectives(parseDirectives(JSON.parse(directivesRaw)));
  } catch {
    return '';
  }
}

/** The rules the built-in helper is given (the same file is published for outside AIs). */
export const RULES = {
  first: (parts['first contact'] ?? '').replaceAll('{{GITHUB_README_RAW}}', `${GITHUB_RAW}README.md`).replaceAll('{{GITHUB_README}}', `${GITHUB}README.md`),
  behave: parts['how to behave'] ?? '',
  coder: parts['work like a coder'] ?? '',
  cell: parts['cell code rules'] ?? '',
  get all(): string {
    const text = rulesRaw.replaceAll('{{SITE}}ai/', `${site()}ai/`).replaceAll('{{GITHUB_README_RAW}}', `${GITHUB_RAW}README.md`).replaceAll('{{GITHUB_README}}', `${GITHUB}README.md`);
    const directives = standingDirectives();
    return directives ? `${text}\n\n## Standing directives\n\n${directives}\n` : text;
  },
};

// ---------------------------------------------------------------- chunks

export interface Chunk {
  title: string;
  /** For API entries: the type the member belongs to ('' for globals), and its own name. */
  owner?: string;
  name?: string;
  /** For example cells: where the cell lives, so it can be opened with goto_cell. */
  path?: string;
  text: string;
}

const isComment = (line: string): boolean => /^\s*(\/\*\*|\*|\*\/|\/\/)/.test(line);

/** The declarations of the API, one entry per member (its comment and its signature), named after the type it belongs to. */
function apiChunks(): Chunk[] {
  const out: Chunk[] = [];
  let owner = '';
  let cur: string[] = [];
  let hasCode = false;
  const flush = (): void => {
    const text = cur.join('\n').trim();
    cur = [];
    hasCode = false;
    if (!text) return;
    const signature = (text.split('\n').find((l) => !isComment(l)) ?? text.split('\n')[0]).trim();
    const name = /^(?:readonly\s+)?(?:declare\s+(?:function|const)\s+|function\s+|const\s+|interface\s+|type\s+)?([\w$]+)/.exec(signature)?.[1] ?? signature;
    out.push({ title: `${owner ? `${owner}: ` : ''}${signature.replace(/\s*\{$/, '')}`, owner, name, text });
  };
  for (const line of CELL_API_DTS.split('\n')) {
    const type = /^(?:declare\s+)?(?:interface|type|class)\s+(\w+)/.exec(line);
    const value = /^(?:declare\s+)?(?:function|const)\s+\w+/.test(line);
    if (type || value) {
      // A comment just above a declaration belongs to it: only close the previous entry when that one has real code in it.
      if (hasCode) flush();
      owner = type && /^(?:declare\s+)?interface/.test(line) ? type[1] : '';
    } else if (line.trim() === '' || (/^\s*\/\*\*/.test(line) && hasCode)) flush();
    // Inside an interface every member is an entry of its own (its comment lines above it stay with it).
    else if (owner && /^ {2}\S/.test(line) && !isComment(line) && hasCode) flush();
    if (line.trim() === '') continue;
    cur.push(line);
    if (!isComment(line)) hasCode = true;
  }
  flush();
  return out;
}

const firstComment = (code: string): string => {
  const line = code.split('\n').map((l) => l.trim()).find((l) => l.startsWith('//') && l.replace(/^\/\/\s*/, '').length > 2);
  return (line ?? '').replace(/^\/\/\s*/, '');
};

/** Every example cell of the board and every demo of the Lab, with the path of the cell it lives in. */
function exampleChunks(): Chunk[] {
  const cells = (tab: string, list: ReadonlyArray<readonly [string, string]>): Chunk[] => list.map(([address, code]) => ({ title: firstComment(code) || `cell ${address}`, path: `/${tab}/${address}`, text: code }));
  return [...cells('board', EXAMPLES), ...cells('lab', LAB_DEMOS), ...cells('monitor', MONITOR_DEMOS)];
}

let readmePromise: Promise<Chunk[]> | null = null;

/** The README by heading, as it is on GitHub (the place of truth); the copy published next to the page is the fallback. */
function readmeChunks(): Promise<Chunk[]> {
  readmePromise ??= fetchReadme()
    .then(({ text }) => text)
    .then((text) => {
      const out: Chunk[] = [];
      let title = '';
      let body: string[] = [];
      const flush = (): void => {
        if (title && body.join('').trim()) out.push({ title, text: `${title}\n${body.join('\n').trim()}` });
      };
      for (const line of text.split('\n')) {
        const h = /^(#{2,4})\s+(.*)$/.exec(line);
        if (h) {
          flush();
          title = h[2].trim();
          body = [];
        } else body.push(line);
      }
      flush();
      return out;
    })
    .catch((err) => {
      readmePromise = null;
      throw err;
    });
  return readmePromise;
}

// ---------------------------------------------------------------- search

const terms = (query: string): string[] => [...new Set(query.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length >= 2))];

/** How well a chunk answers a few words: a hit in its title counts most, then how often the words occur. */
function score(chunk: Chunk, words: string[]): number {
  const title = `${chunk.title} ${chunk.path ?? ''}`.toLowerCase();
  const text = chunk.text.toLowerCase();
  let total = 0;
  let found = 0;
  for (const w of words) {
    const inTitle = title.includes(w);
    const count = Math.min(4, text.split(w).length - 1);
    if (inTitle || count) found++;
    total += (inTitle ? 4 : 0) + count;
  }
  return found === words.length ? total + 5 : total;
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(200, max))}\n… (cut: ${text.length - max} more characters)` : text);

/** A short list of what a document holds: the names in the API by type, the example cells by path, the README by heading. */
function outline(doc: string, chunks: Chunk[], budget: number): string {
  if (doc === 'api') {
    const groups = new Map<string, string[]>();
    for (const c of chunks) {
      const owner = c.owner || '(globals)';
      const list = groups.get(owner) ?? [];
      if (c.name && !list.includes(c.name)) list.push(c.name);
      groups.set(owner, list);
    }
    const lines = [...groups.entries()].map(([owner, names]) => `${owner}: ${names.join(', ')}`);
    return cut(`The API, by type (use query to get the exact signatures, e.g. query "plot" or "CellRef flash"):\n${lines.join('\n')}`, budget);
  }
  const lines = chunks.map((c) => (c.path ? `${c.path} — ${c.title.slice(0, 80)}` : c.title.slice(0, 90)));
  let text = '';
  let shown = 0;
  for (const line of lines) {
    if (text.length + line.length > budget - 160) break;
    text += `${line}\n`;
    shown++;
  }
  return `${text}${shown < lines.length ? `… ${lines.length - shown} more: give a query (a few words) to find the ones you need.` : ''}`;
}

/**
 * Reads one document. `doc` is api, examples, readme or rules. With `path` an example cell comes back whole; with
 * `query` the best matching parts do; with neither, an outline. Never longer than `budget` characters.
 */
export async function readDocs(args: { doc: string; query?: string; path?: string }, budget: number): Promise<string> {
  const doc = args.doc.toLowerCase();
  if (doc === 'rules') return cut(RULES.all, budget);
  if (doc !== 'api' && doc !== 'examples' && doc !== 'readme') return JSON.stringify({ error: `doc must be api, examples, readme or rules (not "${args.doc}")`, urls: docUrls() });
  let chunks: Chunk[];
  try {
    chunks = doc === 'api' ? apiChunks() : doc === 'examples' ? exampleChunks() : await readmeChunks();
  } catch (err) {
    return JSON.stringify({ error: `The README could not be loaded (${err instanceof Error ? err.message : String(err)}). It is at ${docUrls().readme}.` });
  }

  if (args.path) {
    const wanted = args.path.trim().replace(/^\//, '').toLowerCase();
    const hit = chunks.find((c) => c.path?.slice(1).toLowerCase() === wanted) ?? chunks.find((c) => c.path?.toLowerCase().endsWith(`/${wanted}`));
    if (!hit) return JSON.stringify({ error: `There is no example cell "${args.path}". Give a query to search, or none for the list.` });
    return `${hit.path} — ${hit.title}\n${cut(hit.text, budget - 80)}`;
  }

  const words = terms(args.query ?? '');
  if (!words.length) return outline(doc, chunks, budget);
  const ranked = chunks
    .map((c) => ({ c, s: score(c, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return `Nothing in the ${doc} matches "${args.query}". Try other words, or leave the query out for an outline.\n${outline(doc, chunks, Math.min(budget, 1500))}`;
  // Examples are long: two of them fill the room. The API's entries are short: several fit.
  const take = doc === 'examples' ? 2 : doc === 'api' ? 8 : 3;
  const parts: string[] = [];
  let left = budget;
  for (const { c } of ranked.slice(0, take)) {
    const share = Math.max(500, Math.floor(left / (take - parts.length)));
    const body = cut(c.text, doc === 'api' ? left : share);
    const entry = c.path ? `### ${c.path} — ${c.title}\n${body}` : body;
    if (entry.length > left && parts.length) break;
    parts.push(entry);
    left -= entry.length + 2;
  }
  const more = ranked.length - parts.length;
  return `${parts.join('\n\n')}${more > 0 ? `\n\n(${more} more matches: narrow the query${doc === 'examples' ? ', or ask for one by path' : ''}.)` : ''}`;
}
