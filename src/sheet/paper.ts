import type { CellStyle } from '@maxgraph/core';

/** The teletype look a cell can ask for: `paper()` in cell code. */
export interface PaperOptions {
  font?: 'tty33' | 'tty28' | 'tty35';
  /** Paper colour (plain, unyellowed roll paper by default). */
  tint?: string;
  /** Ribbon wear 0..1: the ink gets paler. Default: grows with the number of printed lines. */
  wear?: number;
  /** Characters typed per second, like the real machine (default 10). 0 shows the text at once. */
  speed?: number;
}

/** The font files hold only ink: the paper is the cell's own fill, drawn by maxGraph. */
const FAMILIES: Record<NonNullable<PaperOptions['font']>, string> = {
  tty33: 'TTY33MA',
  tty28: 'TTY28R',
  tty35: 'TTY35D',
};

/** The name of the shape that draws the paper (a rectangle with a faint grain, see paperShape.ts). */
export const PAPER_SHAPE = 'paperroll';
/** The style key that tells the paper shape how far the roll has moved. */
export const PAPER_SCROLL = 'paperScroll';
/** An ASR-33 types 10 characters a second (110 baud). */
export const PAPER_CPS = 10;
export const PAPER_FONT_SIZE = 12;
const PAD_X = 6;
const PAD_Y = 4;
/** maxGraph's own line spacing for a label (Constants.LINE_HEIGHT). */
const LINE = 1.2;
/** The height of one printed line in the cell, in px at 100%. */
export const PAPER_LINE_PX = PAPER_FONT_SIZE * LINE;
const MAX_SOURCE_LINES = 5000;

const family = (o: PaperOptions): string => FAMILIES[o.font ?? 'tty33'] ?? FAMILIES.tty33;

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

/** True once the font is usable. Until then it starts loading and calls `onReady` once, so the cell can lay itself out again. */
export function paperFontReady(o: PaperOptions, onReady: () => void): boolean {
  const fam = family(o);
  if (loaded.has(fam) || typeof document === 'undefined' || !document.fonts) return true;
  if (!loading.has(fam)) {
    loading.set(
      fam,
      document.fonts
        .load(`${PAPER_FONT_SIZE}px ${fam}`)
        .then(() => void loaded.add(fam))
        .catch(() => void loaded.add(fam)),
    );
  }
  void loading.get(fam)!.then(onReady);
  return false;
}

const widths = new Map<string, number>();
function charWidth(fam: string): number {
  const known = widths.get(fam);
  if (known) return known;
  let w = PAPER_FONT_SIZE * 0.6;
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `${PAPER_FONT_SIZE}px ${fam}`;
      w = ctx.measureText('MMMMMMMMMM').width / 10 || w;
    }
  }
  if (loaded.has(fam)) widths.set(fam, w);
  return w;
}

/** How a paper cell looks, as plain maxGraph style: the fill is the paper, the font is the ink. */
export function paperStyle(o: PaperOptions, printedLines: number, feed?: number, scrollLines = 0): CellStyle {
  const wear = Math.max(0, Math.min(1, o.wear ?? Math.min(0.9, 0.08 + printedLines / 120)));
  const tint = o.tint && /^#[0-9a-fA-F]{3,8}$/.test(o.tint) ? o.tint : '#f5f4ef';
  return {
    shape: PAPER_SHAPE,
    // How far the roll has travelled up, in px at 100%: the grain of the paper moves with the text.
    ...({ [PAPER_SCROLL]: Math.max(0, scrollLines) * PAPER_LINE_PX } as CellStyle),
    fillColor: tint,
    strokeColor: '#c8c6bd',
    fontFamily: family(o),
    fontSize: PAPER_FONT_SIZE,
    fontColor: '#16161a',
    textOpacity: Math.round(100 - wear * 45),
    align: 'left',
    verticalAlign: 'bottom',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    spacingLeft: PAD_X,
    spacingTop: PAD_Y,
    // During a line feed the paper sits lower by what is left of one line, and slides up as `feed` goes from 0 to 1.
    spacingBottom: feed === undefined ? PAD_Y : PAD_Y - PAPER_LINE_PX * (1 - Math.max(0, Math.min(1, feed))),
    spacingRight: PAD_X,
  };
}

export interface PaperLayout {
  /** The lines in view, joined with newlines: what maxGraph prints as the label. */
  label: string;
  /** All printed lines after wrapping. */
  total: number;
  /** How many lines fit in the cell. */
  fit: number;
  /** How far the paper can be wound back (0 = everything is in view). */
  maxBack: number;
  /** The wind-back actually shown, clamped to 0..maxBack. */
  back: number;
}

/** Wraps the text to the width of the cell and keeps the lines in view when the paper is `back` lines wound back from the newest (`extra` more lines above, for a line feed in progress). */
export function paperLayout(text: string, width: number, height: number, o: PaperOptions, back: number, extra = 0): PaperLayout {
  const fam = family(o);
  const cols = Math.max(4, Math.floor((width - 2 * PAD_X - 2) / charWidth(fam)));
  const fit = Math.max(1, Math.floor((height - 2 * PAD_Y) / (PAPER_FONT_SIZE * LINE)));
  const source = text.split('\n');
  const lines: string[] = [];
  for (const raw of source.length > MAX_SOURCE_LINES ? source.slice(-MAX_SOURCE_LINES) : source) {
    const line = raw.replace(/\t/g, '    ').replace(/\r/g, '');
    if (line.length <= cols) lines.push(line);
    else for (let i = 0; i < line.length; i += cols) lines.push(line.slice(i, i + cols));
  }
  const maxBack = Math.max(0, lines.length - fit);
  const b = Math.max(0, Math.min(maxBack, Math.floor(back)));
  const end = lines.length - b;
  return { label: lines.slice(Math.max(0, end - fit - extra), end).join('\n'), total: lines.length, fit, maxBack, back: b };
}

/** Characters per second this paper types at; 0 means the text is there at once. */
export function paperSpeed(o: PaperOptions): number {
  return typeof o.speed === 'number' && Number.isFinite(o.speed) ? Math.max(0, Math.min(2000, o.speed)) : PAPER_CPS;
}

/** How much of the text the printer has typed so far, and the start of it (to notice a text that was cleared and written again). */
export interface PrintState {
  shown: number;
  head: string;
}

const HEAD = 40;

/** Where the printer stands after the text changed: carries on when the text only grew, starts again at the top when it was cleared or rewritten. */
export function settle(state: PrintState | undefined, full: string, instant: boolean): PrintState {
  if (instant) return { shown: full.length, head: full.slice(0, HEAD) };
  if (!state || state.shown > full.length || !full.startsWith(state.head)) return { shown: 0, head: '' };
  return state;
}

export function advance(full: string, shown: number): PrintState {
  return { shown, head: full.slice(0, Math.min(HEAD, shown)) };
}

/**
 * What the printer does next: how many characters it types in one go, and how long it takes. A carriage return plus line feed
 * takes two character times. With a lot of text waiting (and no sound to keep in step with) it speeds up so that the paper is
 * never more than about ten seconds behind the cell.
 */
export function printStep(full: string, shown: number, cps: number, paced: boolean): { take: number; wait: number } {
  const charMs = 1000 / Math.max(0.1, cps);
  const speed = paced ? 1 : Math.max(1, (full.length - shown) / 100);
  const chunk = full.slice(shown, shown + Math.max(1, Math.floor(speed)));
  const feeds = chunk.split('\n').length - 1;
  return { take: Math.max(1, chunk.length), wait: (charMs * (chunk.length + feeds)) / speed };
}

/** How long the paper takes to slide up one line: the two character times a line feed costs, but long enough to be seen. */
export function feedMs(cps: number): number {
  return Math.max(160, Math.min(400, 2000 / Math.max(0.1, cps)));
}
