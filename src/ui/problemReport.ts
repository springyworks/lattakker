import { workspace } from '../workspace';
import { router } from '../mcp/router';
import { jobs, type JobNode } from '../aichat/jobs';
import { callers } from '../ai/entry';
import { focusPoints } from '../editor/focusPoints';

/**
 * The problem report: for the moment a person sees something wrong (or something lovely) in the GUI and an AI is asked about it.
 * The GUI deep-drill key, Ctrl+Alt+Shift+G, freezes what is on the screen as a text tree (every element with its place and size, what covers
 * what at the pointer, the state of the app, the latest errors) and puts it on the clipboard at once; a free text box is always there
 * for what the person wants to say, and its words are put at the top of the same clipboard text. Paste it into any AI.
 *
 * It all happens in this page: no server is needed (the published page has it too), nothing is sent anywhere, and the person
 * can read exactly what was copied in the window. The text of cells' code and what is typed in boxes are never included (only
 * their length); other text is cut short.
 */

const MAX_NODES = 2500;
const MAX_SVG_ITEMS = 80;
const TEXT_CUT = 60;
const KEPT_ERRORS = 20;
const KEPT_CLICKS = 8;

interface Click {
  at: string;
  x: number;
  y: number;
  button: number;
  path: string;
}

const errors: string[] = [];
const clicks: Click[] = [];
let pointer: { x: number; y: number } | null = null;

const clock = (): string => new Date().toTimeString().slice(0, 8);
const cut = (text: string, n = TEXT_CUT): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const note = (kind: string, text: string): void => {
  errors.push(`${clock()} ${kind}: ${cut(text, 300)}`);
  if (errors.length > KEPT_ERRORS) errors.shift();
};

// ------------------------------------------------------------ recording (starts when the page starts)

for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    note(`console.${level}`, args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
    original(...args);
  };
}
window.addEventListener('error', (e) => note('error', `${e.message} (${e.filename?.split('/').pop() ?? '?'}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => note('unhandled rejection', e.reason instanceof Error ? e.reason.message : String(e.reason)));
window.addEventListener('pointermove', (e) => (pointer = { x: Math.round(e.clientX), y: Math.round(e.clientY) }), { passive: true, capture: true });
window.addEventListener(
  'pointerdown',
  (e) => {
    clicks.push({ at: clock(), x: Math.round(e.clientX), y: Math.round(e.clientY), button: e.button, path: e.target instanceof Element ? pathOf(e.target) : String(e.target) });
    if (clicks.length > KEPT_CLICKS) clicks.shift();
  },
  { passive: true, capture: true },
);

// ------------------------------------------------------------ the tree

/** tag#id.class.class: enough to find it again in the DOM. */
function selector(el: Element): string {
  const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3) : [];
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes.map((c) => `.${c}`).join('')}`;
}

/** The element and the ones around it, from itself up a few levels: "div.ai-side > div.ai-log > button.ai-stop". */
function pathOf(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== document.documentElement && parts.length < 5; e = e.parentElement) parts.unshift(selector(e));
  return parts.join(' > ');
}

const box = (r: DOMRect): string => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`;
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE']);

/** What is odd about how an element is shown: the things that make a GUI bug (hidden, covered, transparent, out of reach). */
function flags(el: Element, style: CSSStyleDeclaration): string {
  const out: string[] = [];
  if (style.visibility !== 'visible') out.push(`visibility:${style.visibility}`);
  if (style.opacity !== '1') out.push(`opacity:${style.opacity}`);
  if (style.pointerEvents === 'none') out.push('pointer-events:none');
  if (style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky') out.push(`${style.position}${style.zIndex !== 'auto' ? ` z:${style.zIndex}` : ''}`);
  if (style.overflow !== 'visible') out.push(`overflow:${style.overflow}`);
  const h = el as HTMLElement;
  if (h.scrollTop || h.scrollLeft) out.push(`scrolled ${Math.round(h.scrollLeft)},${Math.round(h.scrollTop)} of ${h.scrollWidth}×${h.scrollHeight}`);
  if (el === document.activeElement) out.push('FOCUS');
  if (el.hasAttribute('hidden')) out.push('hidden');
  if ((el as HTMLButtonElement).disabled) out.push('disabled');
  if ((el as HTMLInputElement).checked) out.push('checked');
  return out.join(' ');
}

function attributes(el: Element): string {
  const keep = ['role', 'aria-label', 'title', 'type', 'href', 'placeholder'];
  const parts = keep.flatMap((k) => (el.getAttribute(k) ? [`${k}="${cut(el.getAttribute(k) ?? '', 40)}"`] : []));
  for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-')) parts.push(`${a.name}="${cut(a.value, 30)}"`);
  return parts.join(' ');
}

/** Text that belongs to the element itself, not to its children. */
const ownText = (el: Element): string => cut(Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join(' '));

function describe(el: Element, depth: number): string {
  const style = getComputedStyle(el);
  const field = el as HTMLInputElement;
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const text = isField ? (field.type === 'password' ? '' : `value: ${field.value.length} characters`) : ownText(el);
  return `${'  '.repeat(depth)}${selector(el)} [${box(el.getBoundingClientRect())}]${flags(el, style) ? ` {${flags(el, style)}}` : ''}${attributes(el) ? ` ${attributes(el)}` : ''}${text ? ` "${text}"` : ''}`;
}

/** Where the words of a piece of the drawing really are: the box around its text. (A foreignObject is a frame as big as the whole drawing, and the label box inside it can overflow its cell.) */
function placeOf(e: Element): DOMRect {
  const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? '').trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return e.getBoundingClientRect();
}

const onScreen = (r: DOMRect): boolean => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;

/** The drawing parts (the sheet is an SVG): how much there is, and the pieces that carry words, those on the screen first. */
function svgLines(svg: SVGSVGElement, depth: number): string[] {
  const all = Array.from(svg.querySelectorAll('*'));
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.tagName.toLowerCase(), (counts.get(e.tagName.toLowerCase()) ?? 0) + 1);
  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t} ${n}`).join(', ');
  const pad = '  '.repeat(depth + 1);
  const words = all
    .filter((e) => /^(text|foreignobject)$/i.test(e.tagName) && (e.textContent ?? '').trim())
    .map((e) => ({ e, r: placeOf(e) }));
  const seen = words.filter((w) => onScreen(w.r));
  const lines = [`${pad}(drawing: ${all.length} parts: ${summary}; ${words.length} pieces with text, ${seen.length} of them on the screen, listed first)`];
  for (const { e, r } of seen.slice(0, MAX_SVG_ITEMS)) lines.push(`${pad}${e.tagName.toLowerCase()} [${box(r)}] "${cut(e.textContent ?? '', 40)}"`);
  if (seen.length > MAX_SVG_ITEMS) lines.push(`${pad}… ${seen.length - MAX_SVG_ITEMS} more on the screen, ${words.length - seen.length} off the screen, not listed`);
  else if (words.length > seen.length) lines.push(`${pad}… ${words.length - seen.length} more off the screen, not listed`);
  return lines;
}

function walk(el: Element, depth: number, out: string[], budget: { left: number }): void {
  if (SKIP.has(el.tagName) || budget.left <= 0) return;
  budget.left--;
  out.push(describe(el, depth));
  const style = getComputedStyle(el);
  if (style.display === 'none') {
    out.push(`${'  '.repeat(depth + 1)}(display:none, ${el.querySelectorAll('*').length} elements inside not listed)`);
    return;
  }
  if (el instanceof SVGSVGElement) {
    out.push(...svgLines(el, depth));
    return;
  }
  if (el.classList.contains('monaco-editor')) {
    out.push(`${'  '.repeat(depth + 1)}(code editor: ${el.querySelectorAll('.view-line').length} lines drawn; the code itself is not copied)`);
    return;
  }
  if (el instanceof HTMLCanvasElement) return;
  for (const child of Array.from(el.children)) walk(child, depth + 1, out, budget);
}

/** What is on top at the pointer, from the top down: the answer to "what is covering what". */
function stackAt(p: { x: number; y: number } | null): string[] {
  if (!p) return ['(the pointer has not moved on this page)'];
  return document.elementsFromPoint(p.x, p.y).slice(0, 8).map((e, i) => `${i === 0 ? 'top   ' : `under ${i}`} ${selector(e)} [${box(e.getBoundingClientRect())}]`);
}

const jobLines = (nodes: JobNode[], depth = 0): string[] => nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.state} ${n.service}: ${cut(n.title, 50)}${n.detail ? ` — ${cut(n.detail, 100)}` : ''} [${n.ageSeconds.toFixed(0)} s]`, ...jobLines(n.children, depth + 1)]);

/** Everything about the page right now, except the person's own words. Made before the window opens, so the window is not in it. */
export function snapshot(): string {
  const tabs = workspace.list().map((t) => {
    const h = t.sheet.health();
    return `  ${t.id === workspace.current ? '▶' : ' '} ${t.id} "${t.title}": ${h.codeCells} code cells, runs ${h.finished}/${h.started} finished${t.editor.isOpen ? `, editor open on ${t.editor.address}` : ''}`;
  });
  const focus = workspace.focus;
  const tree: string[] = [];
  const budget = { left: MAX_NODES };
  walk(document.body, 0, tree, budget);
  const traffic = router.recent(8).map((m) => `  ${m.kind} ${m.from} → ${m.to} ${m.method}${m.ms !== undefined ? ` (${m.ms} ms)` : ''}: ${cut(m.detail, 80)}`);
  const open = jobLines(jobs.tree());
  return [
    '## Environment',
    `- Lattakker ${__APP_VERSION__} (${__APP_DATE__}), ${import.meta.env.DEV ? 'dev server' : 'published build'}, ${location.origin}${location.pathname}${location.hash}`,
    `- window ${innerWidth}×${innerHeight}, device pixel ratio ${devicePixelRatio}, screen ${screen.width}×${screen.height}, ${navigator.language}`,
    `- ${navigator.userAgent}`,
    `- taken at ${new Date().toISOString()}`,
    '',
    '## App state',
    `Tabs (▶ = in front):`,
    ...tabs,
    ...focusPoints.report().map((l) => (l.startsWith(' ') ? l : `  ${l}`)),
    `Last cell pointed at: ${focus ? workspace.pathOf(focus.tab, focus.address, focus.tile) : 'none'}`,
    ...(open.length ? ['Jobs of the helper:', ...open.map((l) => `  ${l}`)] : ['Jobs of the helper: none']),
    '',
    'Outside AIs that called in (newest first):',
    ...(callers().length ? callers().slice(0, 5).map((c) => `  ${c.origin}: last call ${Math.round((performance.now() - c.last) / 1000)} s ago${c.doing ? ` (${c.doing})` : ''}, ${c.calls} calls${c.note ? `, says: ${cut(c.note, 80)}` : ''}`) : ['  none']),
    '',
    '## Latest errors and warnings of the page (oldest first)',
    ...(errors.length ? errors.map((e) => `  ${e}`) : ['  none']),
    '',
    '## Latest MCP traffic',
    ...(traffic.length ? traffic : ['  none']),
    '',
    '## Pointer',
    `Last pointer position: ${pointer ? `${pointer.x},${pointer.y}` : 'unknown'}. What is there, top first:`,
    ...stackAt(pointer).map((l) => `  ${l}`),
    `Latest presses (oldest first):`,
    ...(clicks.length ? clicks.map((c) => `  ${c.at} button ${c.button} at ${c.x},${c.y} on ${c.path}`) : ['  none']),
    '',
    `## GUI tree (${tree.length} elements${budget.left <= 0 ? `, cut at ${MAX_NODES}` : ''})`,
    'Each line: selector [x,y width×height in CSS pixels, from the window\'s top left] {what is special: FOCUS, hidden, z-index, scroll...} attributes "own text".',
    ...tree,
  ].join('\n');
}

const HOW_TO_READ = 'This is a report from the GUI of Lattakker Sheet (a spreadsheet of TypeScript cells with a board game, drawn with maxGraph in a web page). The person\'s own words come first. Then the state of the app, the latest errors, what is under the pointer and the tree of everything on the screen. Help with what the person wrote: say which element(s) are involved (by selector and place), what is likely wrong and what to change; if the tree does not show enough, say which extra fact you need.';

/** The text that goes on the clipboard: the person's words first, then the frozen snapshot. */
export function composeReport(words: string, shot: string): string {
  return `# Lattakker GUI report\n\n${HOW_TO_READ}\n\n## What the person says\n${words.trim() || '(nothing written yet)'}\n\n${shot}\n`;
}

// ------------------------------------------------------------ the window and the GUI deep-drill key

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some browsers only allow it from a user's action in a visible field: try the old way.
    const helper = Object.assign(document.createElement('textarea'), { value: text });
    helper.style.cssText = 'position:fixed;left:-9999px';
    document.body.append(helper);
    helper.select();
    const ok = document.execCommand('copy');
    helper.remove();
    return ok;
  }
}

let open: HTMLElement | null = null;

function close(): void {
  open?.remove();
  open = null;
}

function show(): void {
  if (open) return close();
  const shot = snapshot();
  const words = Object.assign(document.createElement('textarea'), { className: 'report-words', rows: 5, placeholder: 'What is wrong (or lovely)? Say it in your own words: what you did, what you expected, what you see. Everything you type is added to the copy at once.' });
  const status = Object.assign(document.createElement('div'), { className: 'report-status' });
  const preview = Object.assign(document.createElement('textarea'), { className: 'report-preview', readOnly: true, rows: 12, spellcheck: false });
  const copy = Object.assign(document.createElement('button'), { className: 'ai-send', textContent: 'Copy again' });
  const done = Object.assign(document.createElement('button'), { className: 'ai-stop', textContent: 'Close (Esc)' });
  const refresh = async (): Promise<void> => {
    const text = composeReport(words.value, shot);
    preview.value = text;
    const ok = await toClipboard(text);
    status.textContent = ok ? `✔ ${Math.round(text.length / 1024)} KB are on your clipboard. Paste them into an AI.` : '⚠ The browser did not allow copying: press “Copy again”, or select the text below and copy it yourself.';
    status.classList.toggle('bad', !ok);
  };
  let timer = 0;
  words.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 350);
  });
  copy.onclick = () => void refresh();
  done.onclick = close;
  const head = Object.assign(document.createElement('div'), { className: 'report-head', textContent: '🐞 GUI deep drill: problem report' });
  const details = Object.assign(document.createElement('details'), { className: 'ai-help' });
  details.append(Object.assign(document.createElement('summary'), { textContent: 'Exactly what was copied (nothing leaves this page unless you paste it)' }), preview);
  const actions = Object.assign(document.createElement('div'), { className: 'ai-actions' });
  actions.append(copy, done);
  const card = Object.assign(document.createElement('div'), { className: 'report-card' });
  card.append(head, words, status, actions, details);
  open = Object.assign(document.createElement('div'), { className: 'report-overlay' });
  open.append(card);
  open.addEventListener('pointerdown', (e) => e.target === open && close());
  document.body.append(open);
  words.focus();
  void refresh();
}

window.addEventListener(
  'keydown',
  (e) => {
    if (e.code === 'KeyG' && e.ctrlKey && e.altKey && e.shiftKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      show();
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
    }
  },
  true,
);
