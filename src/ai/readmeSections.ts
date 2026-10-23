/**
 * The README is the one source of truth. These pure functions find the parts of it that the program itself needs:
 * the rules for AI helpers (chapter 11.5) and the exact API signatures (chapter 8.22, made from src/sheet/apiTypes.ts).
 * They run in the page, in the build (scripts/readme-sync.ts) and in tests, on plain text.
 */

export const API_BEGIN = '<!-- api-reference:begin (made from src/sheet/apiTypes.ts when the app is started or built; never edit by hand) -->';
export const API_END = '<!-- api-reference:end -->';

const FENCE = '```';

/**
 * The text of a numbered section of the README ("11.5", "11.3.5"), without its heading line, up to the next heading of the same
 * or a higher level; '' when the README has no such section.
 */
export function readmeSection(readme: string, number: string): string {
  const escaped = number.replace(/\./g, '\\.');
  const start = new RegExp(`^(#{2,6}) ${escaped}[ \\t]+\\S.*$`, 'm').exec(readme);
  if (!start) return '';
  const level = start[1].length;
  const body = readme.slice(start.index + start[0].length);
  const end = new RegExp(`^#{1,${level}} \\S`, 'm').exec(body);
  return (end ? body.slice(0, end.index) : body).trim();
}

/** The rules for AI helpers: chapter 11.5. */
export const rulesChapter = (readme: string): string => readmeSection(readme, '11.5');

/** The guide to the window.mms console, as returned by mms.help() and published in llms.txt: chapter 11.3.5 and the tips after it (11.3.6). */
export const mmsGuide = (readme: string): string => [readmeSection(readme, '11.3.5'), readmeSection(readme, '11.3.6')].filter(Boolean).join('\n\n');

/** The "#### 11.5.n Heading" parts of the rules chapter, by heading in lower case without its number. */
export function rulesSections(chapter: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name = '';
  for (const line of chapter.split('\n')) {
    const h = /^#{4}\s+(?:\d+(?:\.\d+)*\s+)?(.*)$/.exec(line);
    if (h) {
      name = h[1].trim().toLowerCase();
      out[name] = '';
    } else if (name) out[name] += `${line}\n`;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

/** The declarations inside the generated block of chapter 8.22, or null when the README has no such block. */
export function apiReference(readme: string): string | null {
  const a = readme.indexOf('<!-- api-reference:begin');
  const b = readme.indexOf(API_END);
  if (a < 0 || b < a) return null;
  const block = readme.slice(readme.indexOf('-->', a) + 3, b);
  const open = block.indexOf(`${FENCE}ts\n`);
  const close = block.lastIndexOf(`\n${FENCE}`);
  if (open < 0 || close < open) return null;
  return block.slice(open + FENCE.length + 3, close);
}

/** The README with the generated block of chapter 8.22 replaced by these declarations. Throws when the markers are missing. */
export function withApiReference(readme: string, dts: string): string {
  const a = readme.indexOf('<!-- api-reference:begin');
  const b = readme.indexOf(API_END);
  if (a < 0 || b < a) throw new Error('README.md has no api-reference markers (chapter 8.22)');
  if (dts.includes(FENCE)) throw new Error('the API declarations contain a code fence; they cannot be put in the README');
  return `${readme.slice(0, a)}${API_BEGIN}\n${FENCE}ts\n${dts.trim()}\n${FENCE}\n${readme.slice(b)}`;
}
