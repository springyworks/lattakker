import type { Sheet, SheetCellData, TileGrid } from './Sheet';
import { COLS } from './Sheet';
import type { GameView } from '../game/GameView';
import { isLake } from '../game/model';
import { GAME_NODE, MODE_NODE, describeNode, ROWS_NODE, clickNode, codeNode, sizeNode } from './reactivity';
import { parseTilePath } from './address';
import { workspace } from '../workspace';
import { CancelError, parseInterval, type RunContext } from './tasks';
import { makePlot, type PlotOptions } from './plot';

const MIN_INTERVAL_MS = 10;
const MAX_OUTPUT_LINES = 300;
/** Most tiles one block's grid may hold, and the most along one side. */
const MAX_TILES = 10000;
const MAX_TILE_SIDE = 200;
/** An on() handler that wakes up more often than this is stuck in a loop and gets stopped. */
const MAX_FIRES_PER_SECOND = 50;

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
  hud: { say(text: string, tone?: 'info' | 'good' | 'bad'): void },
  data: SheetCellData,
  ctx: RunContext,
): Record<string, unknown> {
  const refs = new Map<string, object>();
  // Only the top level of a cell makes dependencies; timers and handlers read freely.
  const track = (dep: string): void => {
    if (ctx.tracking && !ctx.cancelled) sheet.trackRead(data.address, dep);
  };
  /** What a cell looks like, to tell afterwards whether a write really changed it. */
  const signature = (address: string): string => {
    const d = sheet.dataAt(address);
    return d ? JSON.stringify([d.output, d.plot, d.tiles, d.viewText, d.codeVisual, d.error, d.span]) : '';
  };
  const markWrite = (target: string): void => {
    ctx.guard();
    sheet.trackWrite(data.address, target);
    if (!ctx.touched.has(target)) ctx.touched.set(target, signature(target));
  };
  // Tells the readers of every cell this context really changed (a timer writing into B4 wakes B4's readers).
  ctx.flush = () => {
    const entries = [...ctx.touched];
    ctx.touched.clear();
    for (const [address, before] of entries) if (signature(address) !== before) sheet.notifyChanged(address);
  };

  // ------------------------------------------------- cells in another tab (read-only)

  /** A cell in another tab can be read, and this cell runs again when it changes; it cannot be written. */
  const foreignSubs = new Set<string>();
  const trackForeign = (owner: Sheet, node: string): void => {
    if (!ctx.tracking || ctx.cancelled) return;
    const key = `${owner.id}|${node}`;
    if (foreignSubs.has(key)) return;
    foreignSubs.add(key);
    const stop = owner.subscribe([node], () => {
      sheet.markDirty([data.address]);
      sheet.requestRun();
    });
    ctx.addTransient(stop);
  };
  const foreignRefs = new Map<string, object>();
  const makeForeignRef = (owner: Sheet, address: string) => {
    const key = `${owner.id}/${address}`;
    const existing = foreignRefs.get(key);
    if (existing) return existing;
    const d = owner.dataAt(address);
    if (!d) throw new Error(`Unknown cell ${key}`);
    const path = workspace.pathOf(owner.id, address);
    const readOnly = (): never => {
      throw new Error(`${path} is in another tab: this cell can read it, but only its own tab's code can change it`);
    };
    const ref = {
      address,
      tab: owner.id,
      path,
      col: d.col,
      row: d.row,
      get text() {
        return owner.displayText(d);
      },
      get code() {
        trackForeign(owner, codeNode(address));
        return d.code;
      },
      get piece() {
        return owner.isBoardAddress(address) ? view.pieceInfoAt(address) : null;
      },
      get cols() {
        trackForeign(owner, sizeNode(address));
        return d.span.cols;
      },
      get rows() {
        trackForeign(owner, sizeNode(address));
        return d.span.rows;
      },
      get isBoard() {
        return owner.isBoardAddress(address);
      },
      span(cols?: number, rows?: number) {
        if (cols !== undefined || rows !== undefined) readOnly();
        trackForeign(owner, sizeNode(address));
        return { cols: d.span.cols, rows: d.span.rows };
      },
      print: readOnly,
      clear: readOnly,
      show: readOnly,
      plot: readOnly,
      view: readOnly,
      color: readOnly,
      textColor: readOnly,
      flash: readOnly,
      toString() {
        return path;
      },
    };
    foreignRefs.set(key, ref);
    return ref;
  };

  const makeRef = (address: string) => {
    const existing = refs.get(address);
    if (existing) return existing;
    const d = sheet.dataAt(address);
    if (!d) throw new Error(`Unknown cell ${address}`);
    const ref = {
      address,
      /** Which tab this cell is in and its absolute path, like '/lab/J24'. */
      tab: sheet.id,
      path: workspace.pathOf(sheet.id, address),
      col: d.col,
      row: d.row,
      get text() {
        return sheet.displayText(d);
      },
      get code() {
        track(codeNode(address));
        return d.code;
      },
      get piece() {
        return sheet.isBoardAddress(address) ? view.pieceInfoAt(address) : null;
      },
      get cols() {
        track(sizeNode(address));
        return d.span.cols;
      },
      get rows() {
        track(sizeNode(address));
        return d.span.rows;
      },
      get usedBy() {
        return sheet.dependentsOf(address);
      },
      get reads() {
        return sheet.readsOf(address).map(describeNode);
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
        d.plot = null;
        d.tiles = null;
        sheet.refreshCell(address);
        return ref;
      },
      show(...values: unknown[]) {
        markWrite(address);
        d.output = [values.map(fmt).join(' ')];
        sheet.refreshCell(address);
        return ref;
      },
      plot(data: unknown, options?: PlotOptions) {
        markWrite(address);
        d.plot = makePlot(data, options);
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
        // Only reading the size makes a dependency; span(4, 2) is a decision, not a read.
        if (cols === undefined && rows === undefined) track(sizeNode(address));
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


  // ------------------------------------------------------------ tiles inside a block

  const newTiles = (cols: number, rows: number): TileGrid => ({
    cols,
    rows,
    fills: new Array<string | null>(cols * rows).fill(null),
    texts: new Array<string | null>(cols * rows).fill(null),
  });

  /** One tile of a block's grid: it is addressed by its own x,y inside the block, never by a sheet address. */
  const makeTile = (block: SheetCellData, x: number, y: number, ensure: () => TileGrid, owner: Sheet = sheet) => {
    const grid = ensure();
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) {
      throw new Error(`Tile ${x},${y} is outside the ${grid.cols}×${grid.rows} grid in ${block.address} (x goes 0 to ${grid.cols - 1}, y goes 0 to ${grid.rows - 1})`);
    }
    const i = y * grid.cols + x;
    const read = (): TileGrid => {
      if (owner !== sheet) trackForeign(owner, block.address);
      else if (block.address !== data.address) track(block.address);
      return ensure();
    };
    const write = (): TileGrid => {
      if (owner !== sheet) throw new Error(`${workspace.pathOf(owner.id, block.address)} is in another tab: this cell can read its tiles, but only its own tab's code can change them`);
      markWrite(block.address);
      return ensure();
    };
    const tile = {
      x,
      y,
      block: block.address,
      tab: owner.id,
      address: `${block.address}/${x},${y}`,
      path: workspace.pathOf(owner.id, block.address, { x, y }),
      get fill() {
        return read().fills[i];
      },
      get text() {
        return read().texts[i] ?? '';
      },
      color(fill: string | null) {
        write().fills[i] = fill === null || fill === undefined ? null : String(fill);
        sheet.refreshSoon(block.address);
        return tile;
      },
      show(...values: unknown[]) {
        write().texts[i] = values.length ? values.map(fmt).join(' ') : null;
        sheet.refreshSoon(block.address);
        return tile;
      },
      clear() {
        const g = write();
        g.fills[i] = null;
        g.texts[i] = null;
        sheet.refreshSoon(block.address);
        return tile;
      },
      toString() {
        return tile.address;
      },
    };
    return tile;
  };

  /** grid(cols, rows) gives this cell's block a tile grid of its own; tiles are reached with g.at(x, y). */
  const grid = (cols: number, rows?: number) => {
    ctx.guard();
    const c = Math.floor(Number(cols));
    const r = Math.floor(Number(rows ?? cols));
    if (!(c >= 1 && r >= 1) || c > MAX_TILE_SIDE || r > MAX_TILE_SIDE || c * r > MAX_TILES) {
      throw new Error(`grid(${cols}, ${rows ?? cols}): use whole numbers from 1 up to ${MAX_TILE_SIDE} (at most ${MAX_TILES} tiles)`);
    }
    // If something cleared the block meanwhile, a tile write quietly makes the grid again at this size.
    const ensure = (): TileGrid => (data.tiles ??= newTiles(c, r));
    markWrite(data.address);
    data.tiles = newTiles(c, r);
    sheet.refreshSoon(data.address);
    const tileAt = (x: number, y: number) => makeTile(data, x, y, ensure);
    const g = {
      isGrid: true,
      address: data.address,
      cols: c,
      rows: r,
      at: tileAt,
      each(fn: (tile: ReturnType<typeof tileAt>) => void) {
        for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) fn(tileAt(x, y));
        return g;
      },
      /** paint((x, y) => colour): one colour per tile in a single pass; null or undefined leaves a tile blank. */
      paint(fn: (x: number, y: number) => string | null | undefined) {
        markWrite(data.address);
        const tiles = ensure();
        for (let y = 0; y < r; y++) {
          for (let x = 0; x < c; x++) {
            const fill = fn(x, y);
            tiles.fills[y * c + x] = fill === null || fill === undefined ? null : String(fill);
          }
        }
        sheet.refreshSoon(data.address);
        return g;
      },
      fill(color: string | null) {
        return g.paint(() => color);
      },
      clear() {
        markWrite(data.address);
        const tiles = ensure();
        tiles.fills.fill(null);
        tiles.texts.fill(null);
        sheet.refreshSoon(data.address);
        return g;
      },
    };
    return g;
  };

  /** at('A16/3,4') or at('/lab/A16/3,4'): a tile of a block's grid, reached through the block's address and the tile's own x,y. */
  const tileByPath = (blockAddress: string, x: number, y: number, owner: Sheet = sheet) => {
    const blockData = owner.dataAt(blockAddress);
    if (!blockData) throw new Error(`"${blockAddress}" is not a cell address`);
    if (owner !== sheet) trackForeign(owner, blockAddress);
    else if (blockAddress !== data.address) track(blockAddress);
    return makeTile(
      blockData,
      x,
      y,
      () => {
        if (!blockData.tiles) throw new Error(`${workspace.pathOf(owner.id, blockAddress)} has no grid yet (its code calls grid(cols, rows))`);
        return blockData.tiles;
      },
      owner,
    );
  };

  /** Text that names a cell with an absolute path, an identity or a URI instead of a plain address. */
  const isGlobalPath = (text: string): boolean => /^(\/|@|lattakker:|c-[0-9a-f]{8}(\/|$))/i.test(text.trim());

  const at = (address: string) => {
    ctx.guard();
    const text = String(address);
    if (isGlobalPath(text)) {
      const found = workspace.resolve(text, sheet.id);
      if ('error' in found) throw new Error(found.error);
      const owner = found.tab.sheet;
      if (found.tile) return tileByPath(found.address, found.tile.x, found.tile.y, owner);
      if (owner === sheet) {
        track(found.address);
        return makeRef(found.address);
      }
      trackForeign(owner, found.address);
      return makeForeignRef(owner, found.address);
    }
    const path = parseTilePath(text);
    if (path) return tileByPath(sheet.resolve(path.block) ?? path.block, path.x, path.y);
    const resolved = sheet.resolve(text);
    if (!resolved) throw new Error(`"${address}" is not a cell address (try something like B7, or a path like /lab/J24)`);
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
    plot(d: unknown, o?: PlotOptions): unknown;
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
          ctx.touched.set(data.address, '');
        }
      } finally {
        busy = false;
      }
      if (ctx.cancelled) return;
      ctx.flush();
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

  const sheetApi = {
    get mode() {
      track(MODE_NODE);
      return sheet.mode;
    },
    cell: at,
    range,
    cols: COLS,
    get rows() {
      track(ROWS_NODE);
      return sheet.rowCount;
    },
  };

  const EVENT_NODES: Record<string, (address: string) => string> = {
    change: (address) => address,
    size: sizeNode,
    code: codeNode,
    click: clickNode,
  };

  /** on(target, fn) or on(target, event, fn); event is 'change' (default), 'size', 'code' or 'click'. */
  const on = (target: unknown, second: unknown, third?: unknown): (() => void) => {
    ctx.guard();
    const fn = typeof second === 'function' ? second : third;
    const event = typeof second === 'function' ? 'change' : String(second);
    if (typeof fn !== 'function') throw new Error("on needs a function: on('B7', (cell) => { ... }) or on('B7', 'size', (cell) => { ... })");
    let nodes: string[];
    let label: string;
    // The sheet whose cells are watched: this one, or another tab's when the target is an absolute path.
    let owner: Sheet = sheet;
    const gridBlock = typeof target === 'object' && target !== null && (target as { isGrid?: boolean }).isGrid ? (target as { address: string }).address : null;
    if (gridBlock) {
      label = `${gridBlock} grid`;
      if (event !== 'click') throw new Error("on(grid, ...) only has the 'click' event: on(g, 'click', (tile) => { ... })");
      nodes = [clickNode(gridBlock)];
    } else if (target === 'sheet') {
      label = 'sheet';
      if (event === 'rows') nodes = [ROWS_NODE];
      else if (event === 'mode') nodes = [MODE_NODE];
      else throw new Error(`on('sheet', ...) understands 'rows' and 'mode', not '${event}'`);
    } else if (target === 'game') {
      label = 'game';
      if (event !== 'change') throw new Error("on('game', ...) only has the 'change' event");
      nodes = [GAME_NODE];
    } else {
      const text = typeof target === 'object' && target !== null ? String((target as { path?: string; address?: string }).path ?? (target as { address?: string }).address) : String(target);
      label = text;
      const nodeFor = EVENT_NODES[event];
      if (!nodeFor) throw new Error(`Unknown event '${event}'. Try 'change', 'size', 'code' or 'click'`);
      let addresses: string[] = [];
      if (isGlobalPath(text)) {
        const found = workspace.resolve(text, sheet.id);
        if ('error' in found) throw new Error(found.error);
        owner = found.tab.sheet;
        addresses = [found.address];
      } else {
        addresses = sheet.resolveRange(text);
        if (addresses.length === 0) {
          const one = sheet.resolve(text);
          if (one) addresses = [one];
        }
      }
      if (addresses.length === 0) throw new Error(`"${text}" is not a cell, a range, 'game' or 'sheet' (try on('B7', ...) or on('/lab/J24', ...))`);
      nodes = addresses.map(nodeFor);
    }
    let unsubscribe = () => {};
    let forget = () => {};
    const stop = () => {
      unsubscribe();
      forget();
    };
    const run = callback(fn as (...args: unknown[]) => unknown, stop);
    const stamps: number[] = [];
    unsubscribe = owner.subscribe(nodes, (node) => {
      // A cell never wakes itself up by writing to itself.
      if (event === 'change' && owner === sheet && node === data.address) return;
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      stamps.push(now);
      if (stamps.length > MAX_FIRES_PER_SECOND) {
        data.error = `on('${label}', '${event}') woke up over ${MAX_FIRES_PER_SECOND} times in a second, so it was stopped. Does its function change what it watches?`;
        stop();
        sheet.notifyChanged(data.address);
        return;
      }
      if (gridBlock) {
        const t = sheet.takeTileClick(gridBlock);
        const blockData = sheet.dataAt(gridBlock);
        if (t && blockData?.tiles) void run(makeTile(blockData, t.x, t.y, () => blockData.tiles ?? newTiles(t.x + 1, t.y + 1)));
      } else if (node === GAME_NODE) void run(trackedGame);
      else if (node === ROWS_NODE || node === MODE_NODE) void run(sheetApi);
      else {
        const watched = node.includes(':') ? node.slice(node.indexOf(':') + 1) : node;
        void run(owner === sheet ? makeRef(watched) : makeForeignRef(owner, watched));
      }
    });
    forget = ctx.addTask(stop);
    return stop;
  };

  const runInfo = Object.freeze({ reason: data.runReason, count: data.runCount });

  return {
    cell: self,
    print: (...values: unknown[]) => void self.print(...values),
    view: (text: string) => void self.view(text),
    plot: (data: unknown, options?: PlotOptions) => void self.plot(data, options),
    color: (fill: string) => void self.color(fill),
    clear: () => void self.clear(),
    show: (...values: unknown[]) => void self.show(...values),
    span: (cols?: number, rows?: number) => self.span(cols, rows),
    grid,
    every,
    after,
    on,
    stop: () => ctx.stopTasks(),
    memory: data.memory,
    run: runInfo,
    at,
    range,
    sheet: sheetApi,
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
