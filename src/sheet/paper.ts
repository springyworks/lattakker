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
/** The style key that tells the paper shape where the print head stands: px from the left edge at 100%, or -1 when it is out of view. */
export const PAPER_HEAD = 'paperHead';
/** The width of the print head's block, in px at 100% (one character), under the key PAPER_HEAD_W. */
export const PAPER_HEAD_W = 'paperHeadW';
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
export function paperStyle(o: PaperOptions, printedLines: number, feed?: number, scrollLines = 0, headCol = -1): CellStyle {
  const wear = Math.max(0, Math.min(1, o.wear ?? Math.min(0.9, 0.08 + printedLines / 120)));
  const tint = o.tint && /^#[0-9a-fA-F]{3,8}$/.test(o.tint) ? o.tint : '#f5f4ef';
  return {
    shape: PAPER_SHAPE,
    // How far the roll has travelled up, in px at 100%: the grain of the paper moves with the text.
    ...({ [PAPER_SCROLL]: Math.max(0, scrollLines) * PAPER_LINE_PX } as CellStyle),
    // The print head: a block on the line being typed, at the column the next letter will strike (-1: not in view).
    ...({ [PAPER_HEAD]: headCol < 0 ? -1 : PAD_X + headCol * charWidth(family(o)), [PAPER_HEAD_W]: charWidth(family(o)) } as CellStyle),
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
    // The sheet's own label padding (spacing: 3) is switched off, or the text would stand 3px right of and above where the print head thinks it is.
    spacing: 0,
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
  /** The column the print head stands at (0 = the left margin) on the last line, where the next letter will be struck. */
  col: number;
}

/** The control characters the machine obeys itself: carriage return, backspace, and a line feed without a return. */
const MOVES = /[\r\b\v\f]/;

/**
 * What is on the paper once the machine has obeyed the text. A newline is a carriage return and a line feed in one, as the
 * terminal driver of a Unix machine made it. The raw movements are separate, like on the real machine: "\r" brings the head back
 * to the left margin without feeding the paper (the next letters strike over the old ones), "\b" moves it one column back, and
 * "\v" (or "\f") feeds the paper one line but leaves the head where it is. A space moves the head without striking, so it leaves
 * old ink alone; a letter struck on top of another one replaces it in the picture (the paper cannot show both). A line that
 * gets longer than the paper is wide carries on at the left margin of the next line.
 */
export function roll(text: string, cols: number): { lines: string[]; col: number } {
  const source = text.split('\n');
  const kept = source.length > MAX_SOURCE_LINES ? source.slice(-MAX_SOURCE_LINES) : source;
  if (!MOVES.test(text)) {
    const lines: string[] = [];
    for (const raw of kept) {
      const line = raw.replace(/\t/g, '    ');
      if (line.length <= cols) lines.push(line);
      else for (let i = 0; i < line.length; i += cols) lines.push(line.slice(i, i + cols));
    }
    const last = lines[lines.length - 1] ?? '';
    return { lines, col: Math.min(last.length, cols - 1) };
  }
  const rows: string[][] = [[]];
  let col = 0;
  const strike = (ch: string): void => {
    if (col >= cols) {
      rows.push([]);
      col = 0;
    }
    const row = rows[rows.length - 1];
    while (row.length < col) row.push(' ');
    if (ch !== ' ' || row[col] === undefined) row[col] = ch;
    col++;
  };
  for (const ch of kept.join('\n')) {
    if (ch === '\n') {
      rows.push([]);
      col = 0;
    } else if (ch === '\v' || ch === '\f') rows.push([]);
    else if (ch === '\r') col = 0;
    else if (ch === '\b') col = Math.max(0, col - 1);
    else if (ch === '\t') for (let i = 0; i < 4; i++) strike(' ');
    else if (ch >= ' ') strike(ch);
  }
  return { lines: rows.map((r) => r.join('')), col: Math.min(col, cols - 1) };
}

/**
 * maxGraph trims every line of an SVG label and the browser folds runs of spaces into one, which would pull the letters away from
 * the columns the print head counts. Hard spaces keep every column, and an invisible zero-width mark in front stops a line that
 * starts with spaces from being trimmed.
 */
const solid = (line: string): string => (line.startsWith(' ') ? '\u200b' : '') + line.replace(/ /g, '\u00a0');

/** Wraps the text to the width of the cell and keeps the lines in view when the paper is `back` lines wound back from the newest (`extra` more lines above, for a line feed in progress). */
export function paperLayout(text: string, width: number, height: number, o: PaperOptions, back: number, extra = 0): PaperLayout {
  const fam = family(o);
  const cols = Math.max(4, Math.floor((width - 2 * PAD_X - 2) / charWidth(fam)));
  const fit = Math.max(1, Math.floor((height - 2 * PAD_Y) / (PAPER_FONT_SIZE * LINE)));
  const { lines, col } = roll(text, cols);
  const maxBack = Math.max(0, lines.length - fit);
  const b = Math.max(0, Math.min(maxBack, Math.floor(back)));
  const end = lines.length - b;
  return { label: lines.slice(Math.max(0, end - fit - extra), end).map(solid).join('\n'), total: lines.length, fit, maxBack, back: b, col };
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
