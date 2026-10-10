/**
 * Lattakker rules. Board is 10x10, row 0 is the top (Blue's camp), row 9 the bottom (Red's camp).
 * Columns map to spreadsheet columns A..J, rows to 1..10, so board (row 0, col 0) is sheet cell A1.
 */
export type Color = 'red' | 'blue';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'B' | 'F';

export interface Piece {
  id: number;
  color: Color;
  rank: Rank;
  revealed: boolean;
  moved: boolean;
}

export interface Pos {
  row: number;
  col: number;
}

export type Phase = 'setup' | 'play' | 'over';

export const BOARD_ROWS = 10;
export const BOARD_COLS = 10;

export const RANK_NAMES: Record<string, string> = {
  10: 'Marshal',
  9: 'General',
  8: 'Colonel',
  7: 'Major',
  6: 'Captain',
  5: 'Lieutenant',
  4: 'Sergeant',
  3: 'Miner',
  2: 'Scout',
  1: 'Spy',
  B: 'Bomb',
  F: 'Flag',
};

/** Classic 40-piece army. */
export const ARMY: Array<[Rank, number]> = [
  [10, 1],
  [9, 1],
  [8, 2],
  [7, 3],
  [6, 4],
  [5, 4],
  [4, 4],
  [3, 5],
  [2, 8],
  [1, 1],
  ['B', 6],
  ['F', 1],
];

export function isLake(row: number, col: number): boolean {
  return (row === 4 || row === 5) && (col === 2 || col === 3 || col === 6 || col === 7);
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isMobile(rank: Rank): boolean {
  return rank !== 'B' && rank !== 'F';
}

export function rankGlyph(rank: Rank): string {
  if (rank === 1) return 'S';
  return String(rank);
}

export function pieceName(piece: Pick<Piece, 'rank'>): string {
  const name = RANK_NAMES[String(piece.rank)];
  if (piece.rank === 'B' || piece.rank === 'F') return name;
  return `${name} (${rankGlyph(piece.rank)})`;
}

export function rankValue(rank: Rank): number {
  if (rank === 'B') return 0;
  if (rank === 'F') return 0;
  return rank;
}

export type Outcome = 'win' | 'lose' | 'draw';

export interface MoveResult {
  from: Pos;
  to: Pos;
  piece: Piece;
  defender: Piece | null;
  outcome: Outcome | null; // null = plain move
  flagCaptured: boolean;
  winner: Color | null;
  color: Color;
}

export interface Move {
  from: Pos;
  to: Pos;
}

export function homeRows(color: Color): number[] {
  return color === 'red' ? [6, 7, 8, 9] : [0, 1, 2, 3];
}

export function isHomeSquare(color: Color, pos: Pos): boolean {
  return homeRows(color).includes(pos.row);
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface GameSnapshot {
  board: (Piece | null)[][];
  states: Array<[Piece, boolean, boolean]>;
  captured: Record<Color, Piece[]>;
  phase: Phase;
  turn: Color;
  winner: Color | null;
  moveCount: number;
  lastMove: MoveResult | null;
  history: MoveResult[];
}

interface SavedMove {
  from: Pos;
  to: Pos;
  piece: number;
  defender: number | null;
  outcome: Outcome | null;
  flagCaptured: boolean;
  winner: Color | null;
  color: Color;
}

interface SavedSnapshot {
  board: Array<Array<number | null>>;
  states: Array<[number, boolean, boolean]>;
  captured: Record<Color, number[]>;
  phase: Phase;
  turn: Color;
  winner: Color | null;
  moveCount: number;
  lastMove: SavedMove | null;
  history: SavedMove[];
}

export interface SavedGame {
  version: 1;
  pieces: Piece[];
  nextId: number;
  board: Array<Array<number | null>>;
  captured: Record<Color, number[]>;
  phase: Phase;
  turn: Color;
  winner: Color | null;
  moveCount: number;
  lastMove: SavedMove | null;
  history: SavedMove[];
  undo: SavedSnapshot[];
}

export class Game {
  board: (Piece | null)[][] = [];
  phase: Phase = 'setup';
  turn: Color = 'red';
  winner: Color | null = null;
  captured: Record<Color, Piece[]> = { red: [], blue: [] };
  moveCount = 0;
  lastMove: MoveResult | null = null;
  history: MoveResult[] = [];
  private undoStack: GameSnapshot[] = [];
  private nextId = 1;
  private rnd: () => number;

  constructor(rnd: () => number = Math.random) {
    this.rnd = rnd;
    this.reset();
  }

  reset(): void {
    this.board = Array.from({ length: BOARD_ROWS }, () => Array<Piece | null>(BOARD_COLS).fill(null));
    this.phase = 'setup';
    this.turn = 'red';
    this.winner = null;
    this.captured = { red: [], blue: [] };
    this.moveCount = 0;
    this.lastMove = null;
    this.history = [];
    this.undoStack = [];
    this.nextId = 1;
    this.placeArmy('red');
    this.placeArmy('blue');
  }

  /** Random but sensible setup: flag on the back row, bombs hugging it. */
  placeArmy(color: Color): void {
    for (const r of homeRows(color)) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const existing = this.board[r][c];
        if (existing && existing.color === color) this.board[r][c] = null;
      }
    }
    const pieces: Piece[] = [];
    for (const [rank, count] of ARMY) {
      for (let i = 0; i < count; i++) {
        pieces.push({ id: this.nextId++, color, rank, revealed: false, moved: false });
      }
    }
    const backRow = color === 'red' ? 9 : 0;
    const dir = color === 'red' ? -1 : 1;
    const squares: Pos[] = [];
    for (const r of homeRows(color)) for (let c = 0; c < BOARD_COLS; c++) squares.push({ row: r, col: c });

    const flag = pieces.find((p) => p.rank === 'F')!;
    const flagCol = Math.floor(this.rnd() * BOARD_COLS);
    const flagPos = { row: backRow, col: flagCol };
    this.board[flagPos.row][flagPos.col] = flag;

    const used = new Set<string>([`${flagPos.row},${flagPos.col}`]);
    const bombs = pieces.filter((p) => p.rank === 'B');
    const guards: Pos[] = [
      { row: backRow, col: flagCol - 1 },
      { row: backRow, col: flagCol + 1 },
      { row: backRow + dir, col: flagCol },
    ].filter((p) => onBoard(p.row, p.col));
    for (const g of guards) {
      const bomb = bombs.pop();
      if (!bomb) break;
      this.board[g.row][g.col] = bomb;
      used.add(`${g.row},${g.col}`);
    }

    const rest = pieces.filter((p) => p !== flag && !guards.some((g) => this.board[g.row][g.col] === p));
    shuffle(rest, this.rnd);
    // Keep most movers near the front: sort the free squares so front rows fill with the strong pieces first.
    const free = squares.filter((s) => !used.has(`${s.row},${s.col}`));
    shuffle(free, this.rnd);
    for (const piece of rest) {
      const s = free.pop()!;
      this.board[s.row][s.col] = piece;
    }
  }

  at(pos: Pos): Piece | null {
    if (!onBoard(pos.row, pos.col)) return null;
    return this.board[pos.row][pos.col];
  }

  find(piece: Piece): Pos | null {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        if (this.board[r][c] === piece) return { row: r, col: c };
      }
    }
    return null;
  }

  pieces(color?: Color): Array<{ piece: Piece; pos: Pos }> {
    const out: Array<{ piece: Piece; pos: Pos }> = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = this.board[r][c];
        if (p && (!color || p.color === color)) out.push({ piece: p, pos: { row: r, col: c } });
      }
    }
    return out;
  }

  /** Setup phase: swap two of your own squares. */
  swap(color: Color, a: Pos, b: Pos): boolean {
    if (this.phase !== 'setup') return false;
    if (!isHomeSquare(color, a) || !isHomeSquare(color, b)) return false;
    const pa = this.board[a.row][a.col];
    const pb = this.board[b.row][b.col];
    this.board[a.row][a.col] = pb;
    this.board[b.row][b.col] = pa;
    return true;
  }

  start(): void {
    this.phase = 'play';
    this.turn = 'red';
  }

  legalMoves(from: Pos): Pos[] {
    const piece = this.at(from);
    if (!piece || !isMobile(piece.rank) || this.phase !== 'play') return [];
    const out: Pos[] = [];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const maxSteps = piece.rank === 2 ? BOARD_ROWS : 1;
    for (const [dr, dc] of dirs) {
      for (let step = 1; step <= maxSteps; step++) {
        const r = from.row + dr * step;
        const c = from.col + dc * step;
        if (!onBoard(r, c) || isLake(r, c)) break;
        const other = this.board[r][c];
        if (other) {
          if (other.color !== piece.color) out.push({ row: r, col: c });
          break;
        }
        out.push({ row: r, col: c });
      }
    }
    return out;
  }

  allLegalMoves(color: Color): Move[] {
    const moves: Move[] = [];
    for (const { pos } of this.pieces(color)) {
      for (const to of this.legalMoves(pos)) moves.push({ from: pos, to });
    }
    return moves;
  }

  hasMoves(color: Color): boolean {
    for (const { pos } of this.pieces(color)) {
      if (this.legalMoves(pos).length > 0) return true;
    }
    return false;
  }

  /** Returns null when the move is legal, otherwise a kid-friendly reason. */
  explain(from: Pos, to: Pos): string | null {
    const piece = this.at(from);
    if (!piece) return 'There is no piece on that square.';
    if (this.phase !== 'play') return 'The battle has not started yet.';
    if (piece.color !== this.turn) return `It is ${this.turn === 'red' ? 'Red' : 'Blue'}'s turn.`;
    if (piece.rank === 'B') return 'Bombs cannot move. They wait quietly for the enemy to bump into them 💣';
    if (piece.rank === 'F') return 'The flag stays where it is. Protect it! 🚩';
    if (!onBoard(to.row, to.col)) return 'That is off the board.';
    if (isLake(to.row, to.col)) return 'Splash! That is a lake 🌊 Nobody can swim there.';
    if (samePos(from, to)) return 'That is the same square. Pick a different one.';
    const dr = to.row - from.row;
    const dc = to.col - from.col;
    if (dr !== 0 && dc !== 0) return 'No diagonals! Pieces only move up, down, left or right ✛';
    const dist = Math.abs(dr) + Math.abs(dc);
    if (dist > 1 && piece.rank !== 2) return 'Too far! Only Scouts (2) can run many squares in one go 🏃';
    const target = this.at(to);
    if (target && target.color === piece.color) return 'That square has one of your own pieces on it.';
    if (dist > 1) {
      const stepR = Math.sign(dr);
      const stepC = Math.sign(dc);
      for (let i = 1; i < dist; i++) {
        const r = from.row + stepR * i;
        const c = from.col + stepC * i;
        if (isLake(r, c)) return 'A lake is in the way 🌊 Scouts cannot jump over water.';
        if (this.board[r][c]) return 'Something is in the way. Scouts cannot jump over pieces.';
      }
    }
    return null;
  }

  resolveBattle(attacker: Piece, defender: Piece): Outcome {
    if (defender.rank === 'F') return 'win';
    if (defender.rank === 'B') return attacker.rank === 3 ? 'win' : 'lose';
    if (attacker.rank === 1 && defender.rank === 10) return 'win';
    if (attacker.rank === defender.rank) return 'draw';
    return rankValue(attacker.rank) > rankValue(defender.rank) ? 'win' : 'lose';
  }

  /** Plain JSON for browser storage. Pieces are stored once and referenced by id everywhere else. */
  serialize(): SavedGame {
    const pieces = new Map<number, Piece>();
    const ref = (p: Piece | null): number | null => {
      if (!p) return null;
      pieces.set(p.id, p);
      return p.id;
    };
    const refs = (list: Piece[]): number[] => list.map((p) => ref(p)!);
    const move = (m: MoveResult | null): SavedMove | null =>
      m && { from: m.from, to: m.to, piece: ref(m.piece)!, defender: ref(m.defender), outcome: m.outcome, flagCaptured: m.flagCaptured, winner: m.winner, color: m.color };
    const top = {
      board: this.board.map((row) => row.map(ref)),
      captured: { red: refs(this.captured.red), blue: refs(this.captured.blue) },
      phase: this.phase,
      turn: this.turn,
      winner: this.winner,
      moveCount: this.moveCount,
      lastMove: move(this.lastMove),
      history: this.history.map((m) => move(m)!),
    };
    const undo = this.undoStack.map((s) => ({
      board: s.board.map((row) => row.map(ref)),
      states: s.states.map(([p, revealed, moved]) => [ref(p)!, revealed, moved] as [number, boolean, boolean]),
      captured: { red: refs(s.captured.red), blue: refs(s.captured.blue) },
      phase: s.phase,
      turn: s.turn,
      winner: s.winner,
      moveCount: s.moveCount,
      lastMove: move(s.lastMove),
      history: s.history.map((m) => move(m)!),
    }));
    return { version: 1, pieces: [...pieces.values()].map((p) => ({ ...p })), nextId: this.nextId, ...top, undo };
  }

  /** Loads a game written by `serialize`. Returns false (and leaves the game unchanged) if the data is not usable. */
  restore(data: unknown): boolean {
    try {
      const d = data as SavedGame;
      if (!d || d.version !== 1 || !Array.isArray(d.pieces) || d.board.length !== BOARD_ROWS) return false;
      const byId = new Map<number, Piece>();
      for (const p of d.pieces) byId.set(p.id, { id: p.id, color: p.color, rank: p.rank, revealed: !!p.revealed, moved: !!p.moved });
      const get = (id: number): Piece => {
        const p = byId.get(id);
        if (!p) throw new Error('unknown piece ' + id);
        return p;
      };
      const getOrNull = (id: number | null): Piece | null => (id === null ? null : get(id));
      const move = (m: SavedMove | null): MoveResult | null =>
        m && { from: m.from, to: m.to, piece: get(m.piece), defender: getOrNull(m.defender), outcome: m.outcome, flagCaptured: m.flagCaptured, winner: m.winner, color: m.color };
      const board = (b: Array<Array<number | null>>) => {
        if (b.length !== BOARD_ROWS || b.some((row) => row.length !== BOARD_COLS)) throw new Error('bad board');
        return b.map((row) => row.map(getOrNull));
      };
      const next = {
        board: board(d.board),
        captured: { red: d.captured.red.map(get), blue: d.captured.blue.map(get) },
        phase: d.phase,
        turn: d.turn,
        winner: d.winner,
        moveCount: d.moveCount,
        lastMove: move(d.lastMove),
        history: d.history.map((m) => move(m)!),
      };
      const undo: GameSnapshot[] = d.undo.map((s) => ({
        board: board(s.board),
        states: s.states.map(([id, revealed, moved]) => [get(id), revealed, moved] as [Piece, boolean, boolean]),
        captured: { red: s.captured.red.map(get), blue: s.captured.blue.map(get) },
        phase: s.phase,
        turn: s.turn,
        winner: s.winner,
        moveCount: s.moveCount,
        lastMove: move(s.lastMove),
        history: s.history.map((m) => move(m)!),
      }));
      if (!['setup', 'play', 'over'].includes(next.phase) || !['red', 'blue'].includes(next.turn)) return false;
      Object.assign(this, next, { undoStack: undo, nextId: Number(d.nextId) || 1000 });
      return true;
    } catch {
      return false;
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Takes back Red's last move together with Blue's answer. Returns false when there is nothing to undo. */
  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.board = snap.board.map((row) => row.slice());
    for (const [piece, revealed, moved] of snap.states) {
      piece.revealed = revealed;
      piece.moved = moved;
    }
    this.captured = { red: snap.captured.red.slice(), blue: snap.captured.blue.slice() };
    this.phase = snap.phase;
    this.turn = snap.turn;
    this.winner = snap.winner;
    this.moveCount = snap.moveCount;
    this.lastMove = snap.lastMove;
    this.history = snap.history.slice();
    return true;
  }

  private takeSnapshot(): GameSnapshot {
    const everyPiece = [...this.pieces().map((p) => p.piece), ...this.captured.red, ...this.captured.blue];
    return {
      board: this.board.map((row) => row.slice()),
      states: everyPiece.map((p) => [p, p.revealed, p.moved]),
      captured: { red: this.captured.red.slice(), blue: this.captured.blue.slice() },
      phase: this.phase,
      turn: this.turn,
      winner: this.winner,
      moveCount: this.moveCount,
      lastMove: this.lastMove,
      history: this.history.slice(),
    };
  }

  /** Performs a legal move. Call `explain` first if unsure. */
  move(from: Pos, to: Pos): MoveResult {
    const piece = this.at(from)!;
    const defender = this.at(to);
    if (piece.color === 'red') this.undoStack.push(this.takeSnapshot());
    const result: MoveResult = {
      from,
      to,
      piece,
      defender,
      outcome: null,
      flagCaptured: false,
      winner: null,
      color: piece.color,
    };
    piece.moved = true;
    if (!defender) {
      this.board[to.row][to.col] = piece;
      this.board[from.row][from.col] = null;
    } else {
      const outcome = this.resolveBattle(piece, defender);
      result.outcome = outcome;
      piece.revealed = true;
      defender.revealed = true;
      this.board[from.row][from.col] = null;
      if (outcome === 'win') {
        this.board[to.row][to.col] = piece;
        this.captured[defender.color].push(defender);
        if (defender.rank === 'F') {
          result.flagCaptured = true;
          this.winner = piece.color;
        }
      } else if (outcome === 'lose') {
        this.captured[piece.color].push(piece);
      } else {
        this.board[to.row][to.col] = null;
        this.captured[piece.color].push(piece);
        this.captured[defender.color].push(defender);
      }
    }
    this.moveCount++;
    this.lastMove = result;
    this.history.push(result);

    if (this.winner) {
      this.phase = 'over';
    } else {
      const next: Color = piece.color === 'red' ? 'blue' : 'red';
      if (!this.hasMoves(next)) {
        this.winner = piece.color;
        this.phase = 'over';
      } else {
        this.turn = next;
      }
    }
    result.winner = this.winner;
    return result;
  }
}
