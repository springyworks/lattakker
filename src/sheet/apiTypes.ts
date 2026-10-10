/** Type declarations that Monaco shows while editing a cell. Keep in sync with runtime.ts / main.ts. */
export const CELL_API_DTS = `
/** A piece on the board, as seen by code. Hidden Blue pieces report rank '?' unless peeked. */
interface PieceInfo {
  color: 'red' | 'blue';
  /** 1 (Spy) .. 10 (Marshal), 'B' bomb, 'F' flag, or '?' when hidden */
  rank: number | 'B' | 'F' | '?';
  name: string;
  revealed: boolean;
  moved: boolean;
}

/** What plot() can draw: numbers (plotted against 0, 1, 2, ...), [x, y] pairs, {x, y} points, or a function of x. */
type PlotSeries = number[] | Array<[number, number]> | Array<{ x: number; y: number }> | ((x: number) => number);
type PlotData = PlotSeries | Record<string, PlotSeries>;
interface PlotOptions {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** For a function: the first and last x (default -10 and 10). */
  from?: number;
  to?: number;
  /** For a function: how many points to calculate (default 200). */
  steps?: number;
  /** Draw a dot on every point. */
  dots?: boolean;
  /** Line colour (one series only). */
  color?: string;
}

/** One spreadsheet cell, addressed like A1, C7 or M14. */
interface CellRef {
  readonly address: string;
  readonly col: number;
  readonly row: number;
  /** Text currently shown in the cell (output, or code in view mode). */
  readonly text: string;
  /** Source code of the cell, if any. */
  readonly code: string;
  /** Piece standing on this square (board cells A1:J10 only). */
  readonly piece: PieceInfo | null;
  readonly isBoard: boolean;
  readonly isLake: boolean;
  /** Append a line of text to this cell (shown in run mode). */
  print(...values: unknown[]): CellRef;
  /** Replace the text shown in view mode (default: the code itself). */
  view(text: string): CellRef;
  /** Background colour, e.g. '#ffd6d6' or 'lightgreen'. */
  color(fill: string): CellRef;
  /** Text colour. */
  textColor(color: string): CellRef;
  /** Merge this cell over cols x rows neighbours (not over the board). Leave one out to keep it. No arguments: just read the size. */
  span(cols?: number, rows?: number): { cols: number; rows: number };
  /** How many columns / rows this cell covers now. Reading them makes your cell re-run when this cell is resized. */
  readonly cols: number;
  readonly rows: number;
  /** Addresses of the cells whose code read this cell (they re-run when it changes). */
  readonly usedBy: string[];
  /** What this cell's code read last time it ran ('game' counts too). */
  readonly reads: string[];
  /** Throw away this cell's output, then print the values (a display that updates in place). */
  show(...values: unknown[]): CellRef;
  /** Throw away this cell's output and plot. */
  clear(): CellRef;
  /** Draw an XY plot in this cell. See plot() below. */
  plot(data: PlotData, options?: PlotOptions): CellRef;
  /** Flash the cell briefly. */
  flash(color?: string): CellRef;
}

interface CellRange extends Array<CellRef> {
  color(fill: string): CellRange;
  print(...values: unknown[]): CellRange;
}

interface MoveInfo {
  from: string;
  to: string;
  color: 'red' | 'blue';
  piece: string;
  defender: string | null;
  outcome: 'win' | 'lose' | 'draw' | null;
  flagCaptured: boolean;
}

interface GameApi {
  readonly phase: 'setup' | 'play' | 'over';
  readonly turn: 'red' | 'blue';
  readonly winner: 'red' | 'blue' | null;
  readonly moveCount: number;
  readonly lastMove: MoveInfo | null;
  readonly history: MoveInfo[];
  /** All pieces still on the board (optionally one colour). */
  pieces(color?: 'red' | 'blue'): Array<PieceInfo & { address: string }>;
  /** Pieces that have been captured, per colour. */
  captured(color: 'red' | 'blue'): PieceInfo[];
  /** Piece on a square. peek:true shows hidden Blue ranks (cheating, but handy for bots). */
  pieceAt(address: string, options?: { peek?: boolean }): PieceInfo | null;
  /** Legal moves for one square or for a whole colour. */
  legalMoves(addressOrColor: string): Array<{ from: string; to: string }>;
  /** Make a move for Red (only during Red's turn). Returns a message. */
  move(from: string, to: string): string;
  /** Show a message in the game bubble. */
  say(text: string): void;
}

interface SheetApi {
  /** 'run' or 'view'. Reading it makes the cell re-run when the mode changes. */
  readonly mode: 'run' | 'view';
  cell(address: string): CellRef;
  range(text: string): CellRange;
  readonly cols: number;
  readonly rows: number;
}

/** The cell this code lives in. */
declare const cell: CellRef;
/** Short for cell.print(...) */
declare function print(...values: unknown[]): void;
/** Short for cell.view(text) */
declare function view(text: string): void;
/** Short for cell.color(fill) */
declare function color(fill: string): void;
/** Short for cell.span(cols, rows). span(4) keeps the rows; span() just returns the current size. */
declare function span(cols?: number, rows?: number): { cols: number; rows: number };
/** Short for cell.show(...): replaces the output instead of adding a line. */
declare function show(...values: unknown[]): void;
/**
 * Draw an XY plot in this cell (call it again to redraw; clear() removes it; print/show text becomes the caption).
 * plot([3, 1, 4, 1, 5])                            numbers against 0, 1, 2, ...
 * plot([[0, 0], [1, 2], [2, 4]])                   [x, y] pairs
 * plot(Math.sin, { from: 0, to: 6.28 })            a function of x
 * plot({ sin: Math.sin, cos: Math.cos })           several lines with a legend
 */
declare function plot(data: PlotData, options?: PlotOptions): void;
/** Short for cell.clear() */
declare function clear(): void;
/** A time: milliseconds, or text like '500ms', '2s', '1m', '1h'. */
type Interval = number | string;
/** Do something again and again. every('1s', (n) => ...) or every(fn) for once a second. n counts 1, 2, 3... Returns a stop function. Stops by itself when the cell runs again. */
declare function every(interval: Interval, fn: (count: number) => unknown): () => void;
declare function every(fn: (count: number) => unknown): () => void;
/** Do something once, later: after('5s', () => ...). Returns a cancel function. */
declare function after(interval: Interval, fn: () => unknown): () => void;
declare function after(fn: () => unknown): () => void;
/** What happened: the cell (or range member) that woke the handler. */
type CellEventName = 'change' | 'size' | 'code' | 'click';
/**
 * Watch something: fn runs after it happens. Returns a stop function. Stops by itself when the cell runs again.
 * on('B7', (b7) => ...)            B7's text or piece changed
 * on('B7', 'size', (b7) => ...)    B7 was merged or resized (b7.cols, b7.rows)
 * on('B7', 'code', (b7) => ...)    someone edited B7's code, or moved code in or out of it
 * on('B7', 'click', (b7) => ...)   B7 was clicked (a range works too: on('A20:C20', 'click', ...))
 * on('game', (g) => ...)           anything in the game changed
 * on('sheet', 'rows', (s) => ...)  a row was inserted      on('sheet', 'mode', (s) => ...)  Show code / Show output was pressed
 */
declare function on(target: string | CellRef, fn: (changed: CellRef) => unknown): () => void;
declare function on(target: string | CellRef, event: CellEventName, fn: (changed: CellRef) => unknown): () => void;
declare function on(target: 'game', fn: (game: GameApi) => unknown): () => void;
declare function on(target: 'sheet', event: 'rows' | 'mode', fn: (sheet: SheetApi) => unknown): () => void;
/** This cell's notebook: survives re-runs and moves with the cell's code. Use it for counters and "what did I see last time". */
declare const memory: Record<string, any>;
/** Why this run started. reason: 'edit' (code was written or Run pressed), 'moved' (block or row moved) or 'update' (something this cell reads changed). count: runs since the code was written. */
declare const run: { readonly reason: 'edit' | 'moved' | 'update'; readonly count: number };
/** Stop all timers and watchers this cell started. */
declare function stop(): void;
/** Another cell by address, e.g. at('A1') */
declare function at(address: string): CellRef;
/** A range of cells, e.g. range('A1:J10') or range('C32-55') */
declare function range(text: string): CellRange;
declare const sheet: SheetApi;
declare const game: GameApi;
/** 'run' or 'view' */
declare const mode: 'run' | 'view';
/** Wait a bit: await sleep(500) or await sleep('2s'). Other cells keep running meanwhile. */
declare function sleep(time?: Interval): Promise<void>;
/** console.log that also shows up in the cell */
declare function log(...values: unknown[]): void;
`;
