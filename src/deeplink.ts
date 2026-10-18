/**
 * A link to what is in front of you, for the public page (github.io): the tab, where the sheet is scrolled and zoomed, the cell you are pointing
 * at, and whether the AI chat is open at the side.
 *
 *   https://springyworks.github.io/lattakker/?cell=/lab/A41&v=1.25,640,900&ai=1&mode=view#lab
 *
 *   #lab                the tab (the same address the tab strip already uses; the game board is the default and has none)
 *   cell=/lab/A41       the cell that is pointed at
 *   v=1.25,640,900      zoom, then the place at the top left of the window, in the sheet's own units (so it means the same at any zoom)
 *   sel=3-5             lines of that cell the link points at (a focus point): the editor opens with them selected
 *   ai=1                the AI chat is open
 *   mode=view           the cells show their code instead of what they print
 *
 * Only the PLACE travels in the link. Nobody's cells do: those stay in the browser of whoever wrote them, so a friend who opens the link
 * sees the same tab and the same place of their own page (the examples, the Lab and the Monitor are the same for everyone; a cell you wrote
 * yourself is not). Everything read from a link is checked: it comes from outside.
 */

/** The public page. */
export const PUBLIC_URL = 'https://springyworks.github.io/lattakker/';

export interface ViewLink {
  tab: string;
  /** A cell path like /lab/A41. */
  cell?: string;
  /** Lines (1-based, inclusive) of `cell` that the link points at. */
  lines?: { from: number; to: number };
  /** Zoom, and the sheet's own units (pixels at 100%) of the top left corner of what is shown. */
  view?: { scale: number; x: number; y: number };
  ai?: boolean;
  mode?: 'run' | 'view';
}

const TAB = /^[a-z][a-z0-9-]{0,23}$/;
const CELL = /^\/[a-z][a-z0-9-]{0,23}\/[A-Z]{1,2}\d{1,3}$/;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const MAX_UNITS = 100_000;

const round = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** The link for a view. `base` is the page without query and hash (the public one by default). */
export function buildLink(link: ViewLink, base: string = PUBLIC_URL): string {
  const query: string[] = [];
  if (link.cell && CELL.test(link.cell)) query.push(`cell=${link.cell}`);
  if (link.cell && CELL.test(link.cell) && link.lines && link.lines.from >= 1 && link.lines.to >= link.lines.from) query.push(`sel=${link.lines.from}${link.lines.to > link.lines.from ? `-${link.lines.to}` : ''}`);
  if (link.view) query.push(`v=${round(link.view.scale, 2)},${Math.round(link.view.x)},${Math.round(link.view.y)}`);
  if (link.ai) query.push('ai=1');
  if (link.mode === 'view') query.push('mode=view');
  const tab = TAB.test(link.tab) && link.tab !== 'board' ? `#${link.tab}` : '';
  return `${base}${query.length ? `?${query.join('&')}` : ''}${tab}`;
}

/** What a link asks for. Anything that is not understood is left out (a link never breaks the page). */
export function parseLink(search: string, hash: string): ViewLink {
  const params = new URLSearchParams(search);
  const tabText = hash.replace(/^#/, '');
  const link: ViewLink = { tab: TAB.test(tabText) ? tabText : 'board' };
  const cell = params.get('cell');
  if (cell && CELL.test(cell)) link.cell = cell;
  const sel = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(params.get('sel') ?? '');
  if (link.cell && sel) {
    const from = Number(sel[1]);
    const to = sel[2] ? Number(sel[2]) : from;
    if (from >= 1 && to >= from) link.lines = { from, to };
  }
  const v = params.get('v')?.split(',').map(Number);
  if (v && v.length === 3 && v.every(Number.isFinite) && v[0] >= MIN_SCALE && v[0] <= MAX_SCALE && v[1] >= 0 && v[1] <= MAX_UNITS && v[2] >= 0 && v[2] <= MAX_UNITS) {
    link.view = { scale: v[0], x: v[1], y: v[2] };
  }
  if (params.get('ai') === '1') link.ai = true;
  if (params.get('mode') === 'view') link.mode = 'view';
  return link;
}

/** True when the link asks for anything beyond the tab (then the page has something to arrange when it has started). */
export const asksForMore = (link: ViewLink): boolean => !!(link.cell || link.lines || link.view || link.ai || link.mode);
