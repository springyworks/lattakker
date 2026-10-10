import type { Sheet, SheetCellData } from './Sheet';
import { COLS } from './Sheet';
import type { GameView } from '../game/GameView';
import type { Hud } from '../ui/Hud';
import { isLake } from '../game/model';
import { GAME_NODE } from './reactivity';

function fmt(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Builds the globals a cell's code can use: cell, print, at, range, game, sheet, ... */
export function buildApi(
  sheet: Sheet,
  view: GameView,
  hud: Hud,
  data: SheetCellData,
  track: (dep: string) => void = () => {},
  markWrite: (target: string) => void = () => {},
): Record<string, unknown> {
  const refs = new Map<string, object>();

  const makeRef = (address: string) => {
    const existing = refs.get(address);
    if (existing) return existing;
    const d = sheet.dataAt(address);
    if (!d) throw new Error(`Unknown cell ${address}`);
    const ref = {
      address,
      col: d.col,
      row: d.row,
      get text() {
        return sheet.displayText(d);
      },
      get code() {
        return d.code;
      },
      get piece() {
        return view.pieceInfoAt(address);
      },
      get isBoard() {
        return sheet.isBoardAddress(address);
      },
      get isLake() {
        return sheet.isBoardAddress(address) && isLake(d.row, d.col);
      },
      print(...values: unknown[]) {
        markWrite(address);
        d.output.push(values.map(fmt).join(' '));
        sheet.refreshCell(address);
        return ref;
      },
      view(text: string) {
        markWrite(address);
        d.viewText = String(text);
        sheet.refreshCell(address);
        return ref;
      },
      color(fill: string) {
        markWrite(address);
        d.codeVisual = { ...d.codeVisual, fill: String(fill) };
        sheet.applyStyle(address);
        return ref;
      },
      textColor(color: string) {
        markWrite(address);
        d.codeVisual = { ...d.codeVisual, fontColor: String(color) };
        sheet.applyStyle(address);
        return ref;
      },
      span(cols: number, rows: number) {
        markWrite(address);
        sheet.setSpan(address, Number(cols) || 1, Number(rows) || 1);
        return ref;
      },
      flash(color?: string) {
        markWrite(address);
        sheet.flash(address, color);
        return ref;
      },
      toString() {
        return address;
      },
    };
    refs.set(address, ref);
    return ref;
  };

  const at = (address: string) => {
    const resolved = sheet.resolve(String(address));
    if (!resolved) throw new Error(`"${address}" is not a cell address (try something like B7)`);
    track(resolved);
    return makeRef(resolved);
  };

  const range = (text: string) => {
    const addresses = sheet.resolveRange(String(text));
    if (addresses.length === 0) throw new Error(`"${text}" is not a range (try A1:J10 or C32-55)`);
    for (const a of addresses) track(a);
    const arr = addresses.map(makeRef) as Array<ReturnType<typeof makeRef>> & {
      color(fill: string): unknown;
      print(...values: unknown[]): unknown;
    };
    arr.color = (fill: string) => {
      for (const r of arr) (r as { color(f: string): unknown }).color(fill);
      return arr;
    };
    arr.print = (...values: unknown[]) => {
      for (const r of arr) (r as { print(...v: unknown[]): unknown }).print(...values);
      return arr;
    };
    return arr;
  };

  const game = {
    get phase() {
      return view.game.phase;
    },
    get turn() {
      return view.game.turn;
    },
    get winner() {
      return view.game.winner;
    },
    get moveCount() {
      return view.game.moveCount;
    },
    get lastMove() {
      return view.game.lastMove ? view.moveInfo(view.game.lastMove) : null;
    },
    get history() {
      return view.game.history.map((m) => view.moveInfo(m));
    },
    pieces(color?: 'red' | 'blue') {
      return view.game.pieces(color).map(({ piece, pos }) => ({ ...view.pieceInfo(piece), address: view.addrOf(pos) }));
    },
    captured(color: 'red' | 'blue') {
      return view.game.captured[color].map((p) => view.pieceInfo(p, true));
    },
    pieceAt(address: string, options?: { peek?: boolean }) {
      return view.pieceInfoAt(String(address), options?.peek === true);
    },
    legalMoves(addressOrColor: string) {
      if (addressOrColor === 'red' || addressOrColor === 'blue') {
        return view.game.allLegalMoves(addressOrColor).map((m) => ({ from: view.addrOf(m.from), to: view.addrOf(m.to) }));
      }
      const pos = view.posOf(String(addressOrColor));
      if (!pos) return [];
      return view.game.legalMoves(pos).map((to) => ({ from: view.addrOf(pos), to: view.addrOf(to) }));
    },
    move(from: string, to: string) {
      return view.codeMove(String(from).toUpperCase(), String(to).toUpperCase());
    },
    say(text: string) {
      hud.say(String(text), 'info');
    },
  };

  const self = makeRef(data.address) as {
    print(...v: unknown[]): unknown;
    view(t: string): unknown;
    color(f: string): unknown;
    span(c: number, r: number): unknown;
  };

  // Any access to `game.*` is treated as a read of the synthetic __game__ node, since aggregate
  // state (phase/turn/winner/history) isn't tied to one address.
  const trackedGame = new Proxy(game, {
    get(target, prop, receiver) {
      track(GAME_NODE);
      return Reflect.get(target, prop, receiver);
    },
  });

  return {
    cell: self,
    print: (...values: unknown[]) => void self.print(...values),
    view: (text: string) => void self.view(text),
    color: (fill: string) => void self.color(fill),
    span: (cols: number, rows: number) => void self.span(cols, rows),
    at,
    range,
    sheet: {
      get mode() {
        return sheet.mode;
      },
      cell: at,
      range,
      cols: COLS,
      get rows() {
        return sheet.rowCount;
      },
    },
    game: trackedGame,
    mode: sheet.mode,
    sleep: (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, Number(ms) || 0))),
    log: (...values: unknown[]) => {
      console.log(`[${data.address}]`, ...values);
      self.print(...values);
    },
  };
}
