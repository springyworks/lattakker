import type { Sheet, SheetCellData } from './Sheet';
import { COLS } from './Sheet';
import type { GameView } from '../game/GameView';
import type { Hud } from '../ui/Hud';
import { isLake } from '../game/model';
import { GAME_NODE } from './reactivity';
import { CancelError, parseInterval, type RunContext } from './tasks';

const MIN_INTERVAL_MS = 10;
const MAX_OUTPUT_LINES = 300;

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
  ctx: RunContext,
): Record<string, unknown> {
  const refs = new Map<string, object>();
  // Only the top level of a cell makes dependencies; timers and handlers read freely.
  const track = (dep: string): void => {
    if (ctx.tracking && !ctx.cancelled) sheet.trackRead(data.address, dep);
  };
  const markWrite = (target: string): void => {
    ctx.guard();
    sheet.trackWrite(data.address, target);
  };

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
      get cols() {
        return d.span.cols;
      },
      get rows() {
        return d.span.rows;
      },
      get usedBy() {
        return sheet.dependentsOf(address);
      },
      get reads() {
        return sheet.readsOf(address).map((a) => (a === GAME_NODE ? 'game' : a));
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
        if (d.output.length > MAX_OUTPUT_LINES) d.output.splice(0, d.output.length - MAX_OUTPUT_LINES);
        sheet.refreshCell(address);
        return ref;
      },
      clear() {
        markWrite(address);
        d.output = [];
        sheet.refreshCell(address);
        return ref;
      },
      show(...values: unknown[]) {
        markWrite(address);
        d.output = [values.map(fmt).join(' ')];
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
      span(cols?: number, rows?: number) {
        if (cols !== undefined || rows !== undefined) {
          markWrite(address);
          sheet.setSpan(
            address,
            cols === undefined ? d.span.cols : Number(cols) || 1,
            rows === undefined ? d.span.rows : Number(rows) || 1,
          );
        }
        return { cols: d.span.cols, rows: d.span.rows };
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
    ctx.guard();
    const resolved = sheet.resolve(String(address));
    if (!resolved) throw new Error(`"${address}" is not a cell address (try something like B7)`);
    track(resolved);
    return makeRef(resolved);
  };

  const range = (text: string) => {
    ctx.guard();
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
    span(c?: number, r?: number): { cols: number; rows: number };
    clear(): unknown;
    show(...v: unknown[]): unknown;
  };

  // Any access to `game.*` is treated as a read of the synthetic __game__ node, since aggregate
  // state (phase/turn/winner/history) isn't tied to one address.
  const trackedGame = new Proxy(game, {
    get(target, prop, receiver) {
      track(GAME_NODE);
      return Reflect.get(target, prop, receiver);
    },
  });

  /** Runs a timer tick or event handler for this cell; one at a time, errors land on the cell. */
  const callback = (fn: (...args: unknown[]) => unknown, stop: () => void) => {
    let busy = false;
    let again: unknown[] | null = null;
    const run = async (...args: unknown[]): Promise<void> => {
      if (ctx.cancelled) return;
      if (busy) {
        again = args;
        return;
      }
      busy = true;
      try {
        await fn(...args);
      } catch (err) {
        if (!(err instanceof CancelError)) {
          data.error = err instanceof Error ? err.message : String(err);
          stop();
        }
      } finally {
        busy = false;
      }
      if (ctx.cancelled) return;
      sheet.notifyChanged(data.address);
      if (again) {
        const next = again;
        again = null;
        void run(...next);
      }
    };
    return run;
  };

  const every = (first: unknown, second?: unknown): (() => void) => {
    ctx.guard();
    const fn = typeof first === 'function' ? first : second;
    if (typeof fn !== 'function') throw new Error("every needs a function: every('1s', () => { ... })");
    const ms = Math.max(MIN_INTERVAL_MS, parseInterval(typeof first === 'function' ? undefined : first));
    let count = 0;
    let id = 0;
    let forget = () => {};
    const stop = () => {
      window.clearInterval(id);
      forget();
    };
    const tick = callback(fn as (...args: unknown[]) => unknown, stop);
    id = window.setInterval(() => void tick(++count), ms);
    forget = ctx.addTask(stop);
    return stop;
  };

  const after = (first: unknown, second?: unknown): (() => void) => {
    ctx.guard();
    const fn = typeof first === 'function' ? first : second;
    if (typeof fn !== 'function') throw new Error("after needs a function: after('5s', () => { ... })");
    const ms = Math.max(0, parseInterval(typeof first === 'function' ? undefined : first));
    let id = 0;
    let forget = () => {};
    const stop = () => {
      window.clearTimeout(id);
      forget();
    };
    const fire = callback(fn as (...args: unknown[]) => unknown, stop);
    id = window.setTimeout(() => {
      forget();
      void fire();
    }, ms);
    forget = ctx.addTask(stop);
    return stop;
  };

  const on = (target: unknown, fn: unknown): (() => void) => {
    ctx.guard();
    if (typeof fn !== 'function') throw new Error("on needs a function: on('B7', (cell) => { ... })");
    let nodes: string[];
    if (target === 'game') {
      nodes = [GAME_NODE];
    } else {
      const text = typeof target === 'object' && target !== null ? String((target as { address?: string }).address) : String(target);
      nodes = sheet.resolveRange(text);
      if (nodes.length === 0) {
        const one = sheet.resolve(text);
        if (one) nodes = [one];
      }
      if (nodes.length === 0) throw new Error(`"${text}" is not a cell, a range or 'game' (try on('B7', ...))`);
    }
    let unsubscribe = () => {};
    let forget = () => {};
    const stop = () => {
      unsubscribe();
      forget();
    };
    const run = callback(fn as (...args: unknown[]) => unknown, stop);
    unsubscribe = sheet.subscribe(nodes, (node) => void run(node === GAME_NODE ? trackedGame : makeRef(node)));
    forget = ctx.addTask(stop);
    return stop;
  };

  return {
    cell: self,
    print: (...values: unknown[]) => void self.print(...values),
    view: (text: string) => void self.view(text),
    color: (fill: string) => void self.color(fill),
    clear: () => void self.clear(),
    show: (...values: unknown[]) => void self.show(...values),
    span: (cols?: number, rows?: number) => self.span(cols, rows),
    every,
    after,
    on,
    stop: () => ctx.stopTasks(),
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
    sleep: (time?: number | string) =>
      new Promise<void>((resolve, reject) => {
        ctx.guard();
        const id = window.setTimeout(() => {
          forget();
          resolve();
        }, Math.max(0, parseInterval(time, 0)));
        const forget = ctx.addTransient(() => {
          window.clearTimeout(id);
          reject(new CancelError());
        });
      }),
    log: (...values: unknown[]) => {
      console.log(`[${data.address}]`, ...values);
      self.print(...values);
    },
  };
}
