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
  /** Merge this cell over cols x rows neighbours (not over the board). */
  span(cols: number, rows: number): CellRef;
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
/** Short for cell.span(cols, rows) */
declare function span(cols: number, rows: number): void;
/** Another cell by address, e.g. at('A1') */
declare function at(address: string): CellRef;
/** A range of cells, e.g. range('A1:J10') or range('C32-55') */
declare function range(text: string): CellRange;
declare const sheet: SheetApi;
declare const game: GameApi;
/** 'run' or 'view' */
declare const mode: 'run' | 'view';
/** Wait a bit: await sleep(500) */
declare function sleep(ms: number): Promise<void>;
/** console.log that also shows up in the cell */
declare function log(...values: unknown[]): void;
`;
