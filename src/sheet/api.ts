import type { Sheet, SheetCellData, TileGrid } from './Sheet';
import type { GameView } from '../game/GameView';
import { isLake } from '../game/model';
import { GAME_NODE, MODE_NODE, describeNode, ROWS_NODE, COLS_NODE, clickNode, codeNode, enterNode, leaveNode, moduleNode, sizeNode } from './reactivity';
import { parseTilePath } from './address';
import { blurTiles, focusTiles, listenTileKeys, tilesHaveFocus } from './tileKeys';
import { workspace } from '../workspace';
import { router, type Traffic } from '../mcp/router';
import { SIGNAL } from '../mcp/tabServer';
import { CancelError, parseInterval, type RunContext } from './tasks';
import { cellOfSpecifier } from './cellModules';
import { makePlot, type PlotOptions } from './plot';
import { SvgScene, type SceneHost } from './svgScene';
import { svgAsset, svgAssetNames } from './svgAssets';
import { animAssetNames, loadClip, pickClip, type ClipHost } from './anim';
import { callers as outsideCallers } from '../ai/entry';
import { buildCatalog } from '../mcp/routerServer';
import { analyze as analyzeTraffic, ask as askTraffic, packets as trafficPackets } from '../mcp/analyze';
import { findPlaces, forecast as weatherForecast, summary as weatherSummary, weatherNow, type PlaceInput } from '../services/weather';
import { tabManager, type CreateTabOptions } from '../tabManager';
import { clack, noteSource, printChar, ringBell, touchMotor } from '../aichat/bell';
import { readSystem, summarize as systemSummary, systemSeries, type SeriesName } from '../services/system';
import { ollamaAsk, ollamaChat, ollamaModels, ollamaStatus, type OllamaMessage, type OllamaOptions } from '../services/ollama';
import { inputPanel, type ControlKind, type ControlSpec } from '../ui/InputPanel';
import type { PaperOptions } from './paper';
import { createRepl } from './repl';

const MIN_INTERVAL_MS = 10;
const MAX_OUTPUT_LINES = 300;
/** What g.text(...) understands. */
interface TextOptions {
  w?: number;
  fill?: string | null;
  ink?: string | null;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  snap?: boolean;
  mono?: boolean;
  size?: number;
}

/** Most tiles one block's grid may hold, and the most along one side. */
const MAX_TILES = 10000;
const MAX_TILE_SIDE = 200;
const MAX_LABELS = 2000;
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

/** When a cell was last woken up by a cell of another tab, per reader and watched cell (see trackForeign). */
const wakeStamps = new Map<string, number[]>();

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
    const changed: string[] = [];
    for (const [address, before] of entries) if (signature(address) !== before) changed.push(address);
    // The cells that changed are redrawn in one update.
    sheet.graph.batchUpdate(() => changed.forEach((address) => sheet.notifyChanged(address)));
  };

  // ------------------------------------------------- cells in another tab (read-only)

  /** A cell in another tab can be read, and this cell runs again when it changes; it cannot be written. */
  const foreignSubs = new Set<string>();
  const trackForeign = (owner: Sheet, node: string): void => {
    if (!ctx.tracking || ctx.cancelled) return;
    const key = `${owner.id}|${node}`;
    if (foreignSubs.has(key)) return;
    foreignSubs.add(key);
    // Two tabs that keep changing each other never settle: more than this many wake-ups in a second stops the reader.
    // Every run of the cell makes a new subscription, so the count is kept per reader and watched cell, not per run.
    const stampKey = `${sheet.id}:${data.address}|${owner.id}|${node}`;
    const stamps = wakeStamps.get(stampKey) ?? [];
    wakeStamps.set(stampKey, stamps);
    const stop = owner.subscribe([node], () => {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      stamps.push(now);
      if (stamps.length > MAX_FIRES_PER_SECOND) {
        data.error = `${describeNode(node)} in the ${owner.id} tab woke this cell up over ${MAX_FIRES_PER_SECOND} times in a second, so it was stopped. Do two tabs keep changing each other?`;
        stop();
        sheet.notifyChanged(data.address);
        return;
      }
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
      get uid() {
        return d.uid || null;
      },
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
      skipPaper() {
        sheet.skipTyping(address);
        return ref;
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
      paper: readOnly,
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
      /** The identity of the code in this cell: it stays when the cell moves. at('@' + uid) finds it again. */
      get uid() {
        return d.uid || null;
      },
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
        sheet.refreshSoon(address);
        return ref;
      },
      clear() {
        markWrite(address);
        d.output = [];
        d.plot = null;
        d.tiles = null;
        sheet.refreshSoon(address);
        return ref;
      },
      show(...values: unknown[]) {
        markWrite(address);
        d.output = [values.map(fmt).join(' ')];
        sheet.refreshSoon(address);
        return ref;
      },
      plot(data: unknown, options?: PlotOptions) {
        markWrite(address);
        d.plot = makePlot(data, options);
        sheet.refreshSoon(address);
        return ref;
      },
      view(text: string) {
        markWrite(address);
        d.viewText = String(text);
        sheet.refreshSoon(address);
        return ref;
      },
      color(fill: string) {
        markWrite(address);
        d.codeVisual = { ...d.codeVisual, fill: String(fill) };
        sheet.refreshSoon(address);
        return ref;
      },
      textColor(color: string) {
        markWrite(address);
        d.codeVisual = { ...d.codeVisual, fontColor: String(color) };
        sheet.refreshSoon(address);
        return ref;
      },
      paper(options?: PaperOptions | boolean) {
        markWrite(address);
        const { paper: _old, ...rest } = d.codeVisual;
        d.codeVisual = options === false ? rest : { ...rest, paper: typeof options === 'object' && options ? { ...options } : {} };
        sheet.refreshSoon(address);
        return ref;
      },
      span(cols?: number, rows?: number) {
        if (cols !== undefined || rows !== undefined) {
          markWrite(address);
          // A default size: the person's own (handles, a selection) wins until these numbers change; see sheet/shape.ts.
          sheet.requestSpan(
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

  const newTiles = (cols: number, rows: number, lines = true): TileGrid => ({
    cols,
    rows,
    fills: new Array<string | null>(cols * rows).fill(null),
    texts: new Array<string | null>(cols * rows).fill(null),
    inks: new Array<string | null>(cols * rows).fill(null),
    bolds: new Array<boolean>(cols * rows).fill(false),
    labels: [],
    lines,
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
      get textColor() {
        return read().inks[i];
      },
      get isBold() {
        return read().bolds[i];
      },
      show(...values: unknown[]) {
        write().texts[i] = values.length ? values.map(fmt).join(' ') : null;
        sheet.refreshSoon(block.address);
        return tile;
      },
      /** The colour of this tile's text; ink(null) is the default dark. */
      ink(color: string | null) {
        write().inks[i] = color === null || color === undefined ? null : String(color);
        sheet.refreshSoon(block.address);
        return tile;
      },
      bold(on = true) {
        write().bolds[i] = !!on;
        sheet.refreshSoon(block.address);
        return tile;
      },
      clear() {
        const g = write();
        g.fills[i] = null;
        g.texts[i] = null;
        g.inks[i] = null;
        g.bolds[i] = false;
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
  const grid = (cols: number, rows?: number, options?: { lines?: boolean }) => {
    ctx.guard();
    const c = Math.floor(Number(cols));
    const r = Math.floor(Number(rows ?? cols));
    if (!(c >= 1 && r >= 1) || c > MAX_TILE_SIDE || r > MAX_TILE_SIDE || c * r > MAX_TILES) {
      throw new Error(`grid(${cols}, ${rows ?? cols}): use whole numbers from 1 up to ${MAX_TILE_SIDE} (at most ${MAX_TILES} tiles)`);
    }
    // If something cleared the block meanwhile, a tile write quietly makes the grid again at this size.
    const lines = options?.lines !== false;
    const ensure = (): TileGrid => (data.tiles ??= newTiles(c, r, lines));
    markWrite(data.address);
    data.tiles = newTiles(c, r, lines);
    sheet.refreshSoon(data.address);
    const tileAt = (x: number, y: number) => makeTile(data, x, y, ensure);
    const tileKeyId = `${sheet.id}:${data.address}`;
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
      /** box(x, y, w, h, colour): colours a rectangle of tiles (the part outside the grid is left out); null blanks it. */
      box(x: number, y: number, w: number, h: number, color: string | null) {
        markWrite(data.address);
        const tiles = ensure();
        const fill = color === null || color === undefined ? null : String(color);
        for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(r, Math.floor(y) + Math.floor(h)); yy++) {
          for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(c, Math.floor(x) + Math.floor(w)); xx++) tiles.fills[yy * c + xx] = fill;
        }
        sheet.refreshSoon(data.address);
        return g;
      },
      /** text(x, y, 'words', options): one line of text over a stretch of tiles. Empty text removes the line that starts at x, y. */
      text(x: number, y: number, text: unknown, options: TextOptions = {}) {
        markWrite(data.address);
        const tiles = ensure();
        const x0 = Math.floor(Number(x));
        const y0 = Math.floor(Number(y));
        if (!Number.isInteger(x0) || !Number.isInteger(y0) || x0 < 0 || y0 < 0 || x0 >= c || y0 >= r) {
          throw new Error(`g.text(${x}, ${y}, ...) starts outside the ${c}×${r} grid (x goes 0 to ${c - 1}, y goes 0 to ${r - 1})`);
        }
        const opts = options ?? {};
        const content = fmt(text).replace(/\s*\n\s*/g, ' ');
        tiles.labels = tiles.labels.filter((l) => !(l.x === x0 && l.y === y0));
        if (!content) {
          sheet.refreshSoon(data.address);
          return g;
        }
        const w = Math.max(1, Math.min(c - x0, Math.floor(Number(opts.w ?? c - x0))));
        if (tiles.labels.length >= MAX_LABELS) throw new Error(`A grid can hold ${MAX_LABELS} lines of text: use g.clear() to start again`);
        if (opts.fill !== undefined) g.box(x0, y0, w, 1, opts.fill);
        tiles.labels.push({
          x: x0,
          y: y0,
          w,
          text: content,
          ink: opts.ink === undefined || opts.ink === null ? null : String(opts.ink),
          bold: !!opts.bold,
          align: opts.align === 'center' || opts.align === 'right' ? opts.align : 'left',
          snap: !!opts.snap,
          mono: !!opts.mono || !!opts.snap,
          size: typeof opts.size === 'number' && opts.size > 0 ? opts.size : null,
        });
        sheet.refreshSoon(data.address);
        return g;
      },
      clear() {
        markWrite(data.address);
        const tiles = ensure();
        tiles.fills.fill(null);
        tiles.texts.fill(null);
        tiles.inks.fill(null);
        tiles.bolds.fill(false);
        tiles.labels = [];
        sheet.refreshSoon(data.address);
        return g;
      },
      /** focus(): this grid takes the keyboard; on(g, 'key', ...) hears the keys. A click anywhere else takes it away again. */
      focus() {
        focusTiles(tileKeyId);
        return g;
      },
      blur() {
        blurTiles(tileKeyId);
        return g;
      },
      get focused() {
        return tilesHaveFocus(tileKeyId);
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

  /** Blue taken over by this run of this cell: handed back to the built-in player when the cell stops, is edited or runs again. */
  let blueHeld: { release: () => void; forget: () => void } | null = null;
  const giveBackBlue = (): void => {
    const held = blueHeld;
    if (!held) return;
    blueHeld = null;
    held.forget();
    held.release();
  };

  const game = {
    get phase() {
      return view.game.phase;
    },
    get busy() {
      return view.isBusy();
    },
    get bluePlayer() {
      return view.bluePlayer;
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
    move(from: string, to: string, color: 'red' | 'blue' = 'red') {
      if (color !== 'red' && color !== 'blue') throw new Error(`game.move: the colour is 'red' or 'blue', not "${String(color)}"`);
      return view.codeMove(String(from).toUpperCase(), String(to).toUpperCase(), color);
    },
    takeOverBlue() {
      ctx.guard();
      if (blueHeld) return;
      blueHeld = { release: view.takeOverBlue(), forget: ctx.addTask(giveBackBlue) };
    },
    giveBackBlue,
    say(text: string) {
      hud.say(String(text), 'info');
    },
  };

  const self = makeRef(data.address) as {
    print(...v: unknown[]): unknown;
    view(t: string): unknown;
    plot(d: unknown, o?: PlotOptions): unknown;
    color(f: string): unknown;
    paper(o?: PaperOptions | boolean): unknown;
    skipPaper(): unknown;
    span(c?: number, r?: number): { cols: number; rows: number };
    clear(): unknown;
    show(...v: unknown[]): unknown;
  };

  // Any access to `game.*` is treated as a read of the synthetic __game__ node, since aggregate
  // state (phase/turn/winner/history) isn't tied to one address.
  // Doing something (moving, taking Blue over) is not reading the game: a cell that only plays must not re-run after every move.
  const ACTIONS = new Set<string | symbol>(['move', 'say', 'takeOverBlue', 'giveBackBlue']);
  const trackedGame = new Proxy(game, {
    get(target, prop, receiver) {
      if (!ACTIONS.has(prop)) track(GAME_NODE);
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

  /**
   * svg(markup) shows a drawing in this cell (or block) that the code can find the parts of and animate; see svgScene.ts.
   * svg() is a blank drawing, svg.asset('stickman') a drawing that comes with the app.
   */
  const svgApi = (() => {
    const host: SceneHost = {
      guard: () => ctx.guard(),
      addTask: (stop) => ctx.addTask(stop),
      wrap: (fn, stop) => callback(fn, stop),
      changed: () => sheet.refreshSoon(data.address),
    };
    const make = (markup?: string | { width?: number; height?: number }): SvgScene => {
      ctx.guard();
      markWrite(data.address);
      const scene = new SvgScene(markup, host);
      data.scene = scene;
      data.plot = null;
      data.tiles = null;
      sheet.refreshCell(data.address);
      return scene;
    };
    return Object.assign(make, { asset: (name: string) => svgAsset(name), assets: () => svgAssetNames() });
  })();

  /** anim.load('bouncer') cuts an animated WebP, GIF or APNG into frames that the code can play, pause and step through; see anim.ts. */
  const animApi = (() => {
    const host: ClipHost = {
      guard: () => ctx.guard(),
      addTask: (stop) => ctx.addTask(stop),
      wrap: (fn, stop) => callback(fn, stop),
      changed: () => sheet.refreshSoon(data.address),
      newScene: (width, height) => svgApi({ width, height }),
    };
    return { load: (src: string | Blob | ArrayBuffer | Uint8Array) => loadClip(src, host), pick: () => pickClip(host), assets: () => animAssetNames() };
  })();

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
    get cols() {
      track(COLS_NODE);
      return sheet.colCount;
    },
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
    enter: enterNode,
    leave: leaveNode,
  };

  /** on(target, fn) or on(target, event, fn); event is 'change' (default), 'size', 'code', 'click', 'enter' or 'leave' (the mouse came over the cell or went off it). */
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
      if (event === 'key' || event === 'focus' || event === 'blur') {
        let off = () => {};
        let forgetKeys = () => {};
        const stopKeys = (): void => {
          off();
          forgetKeys();
        };
        // The keys come one after the other, none is skipped, so they do not go through the one-at-a-time callback.
        const hear = async (...args: unknown[]): Promise<void> => {
          if (ctx.cancelled) return;
          try {
            await (fn as (...a: unknown[]) => unknown)(...args);
          } catch (err) {
            if (err instanceof CancelError) return;
            data.error = err instanceof Error ? err.message : String(err);
            stopKeys();
            ctx.touched.set(data.address, '');
          }
          if (!ctx.cancelled) ctx.flush();
        };
        off = listenTileKeys(`${sheet.id}:${gridBlock}`, event === 'key' ? { key: (k, i) => void hear(k, i) } : event === 'focus' ? { focus: () => void hear() } : { blur: () => void hear() });
        forgetKeys = ctx.addTask(stopKeys);
        return stopKeys;
      }
      if (event !== 'click') throw new Error("on(grid, ...) understands 'click' (a tile was clicked), 'key' (a key was typed while the grid has the keyboard), 'focus' and 'blur': on(g, 'click', (tile) => { ... })");
      nodes = [clickNode(gridBlock)];
    } else if (target === 'sheet') {
      label = 'sheet';
      if (event === 'rows') nodes = [ROWS_NODE];
      else if (event === 'cols') nodes = [COLS_NODE];
      else if (event === 'mode') nodes = [MODE_NODE];
      else throw new Error(`on('sheet', ...) understands 'rows', 'cols' and 'mode', not '${event}'`);
    } else if (target === 'game') {
      label = 'game';
      if (event !== 'change') throw new Error("on('game', ...) only has the 'change' event");
      nodes = [GAME_NODE];
    } else {
      const text = typeof target === 'object' && target !== null ? String((target as { path?: string; address?: string }).path ?? (target as { address?: string }).address) : String(target);
      label = text;
      const nodeFor = EVENT_NODES[event];
      if (!nodeFor) throw new Error(`Unknown event '${event}'. Try 'change', 'size', 'code', 'click', 'enter' or 'leave'`);
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
      else if (node === ROWS_NODE || node === COLS_NODE || node === MODE_NODE) void run(sheetApi);
      else {
        const watched = node.includes(':') ? node.slice(node.indexOf(':') + 1) : node;
        void run(owner === sheet ? makeRef(watched) : makeForeignRef(owner, watched));
      }
    });
    forget = ctx.addTask(stop);
    // The mouse may already be over the cell (this run came from an edit or a restart): that counts as entering.
    if (event === 'enter' && !gridBlock && nodes.includes(enterNode(owner.hoveredAddress))) owner.pulse(enterNode(owner.hoveredAddress));
    return stop;
  };


  // ------------------------------------------------------------------ talking to tabs over MCP

  const caller = `${sheet.id}:${data.address}`;

  /** What a path or a tab name points at: the server to ask, and for a cell its resource uri. */
  const aim = (text: unknown): { server: string; uri: string | null; address: string | null } => {
    const t = String(text).trim();
    if (/^[a-z][a-z0-9-]*$/.test(t) && router.names().includes(t)) return { server: t, uri: null, address: null };
    const found = workspace.resolve(t, sheet.id);
    if ('error' in found) throw new Error(found.error);
    return { server: found.tab.id, uri: `lattakker:///${found.tab.id}/${found.address}`, address: found.address };
  };

  /** More than this many wake-ups in a second means a loop between tabs: the watcher is stopped. */
  const rateGuard = (label: string, stop: () => void): (() => boolean) => {
    const stamps: number[] = [];
    return () => {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      stamps.push(now);
      if (stamps.length <= MAX_FIRES_PER_SECOND) return true;
      data.error = `${label} woke up over ${MAX_FIRES_PER_SECOND} times in a second, so it was stopped. Do two tabs keep changing each other?`;
      stop();
      sheet.notifyChanged(data.address);
      return false;
    };
  };

  const mcpRead = async (path: string): Promise<Record<string, unknown>> => {
    const t = aim(path);
    if (!t.uri) throw new Error(`mcp.read needs a cell path like '/lab/J24', not a tab`);
    const result = (await router.request(caller, t.server, 'resources/read', { uri: t.uri })) as { contents: Array<{ text: string }> };
    return JSON.parse(result.contents[0].text) as Record<string, unknown>;
  };

  const mcpTool = async (target: string, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const t = aim(target);
    const result = (await router.request(caller, t.server, 'tools/call', { name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    if (result.isError) throw new Error(result.content[0]?.text ?? `${name} failed`);
    return result.structuredContent ?? {};
  };

  const mcp = {
    /** The MCP servers of the page: one per tab. */
    servers: (): string[] => router.names(),
    /** Any MCP request: mcp.call('lab', 'resources/list'). The answer arrives later, so await it. */
    call: async (target: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      ctx.guard();
      return router.request(caller, aim(target).server, method, params);
    },
    /** One cell of any tab as a plain object (code, text, output, error, size ...). Not a dependency: use watch() to follow it. */
    read: async (path: string) => {
      ctx.guard();
      return mcpRead(path);
    },
    /** The cells of a tab that hold code. */
    list: async (tab: string) => {
      ctx.guard();
      const result = (await router.request(caller, aim(tab).server, 'resources/list')) as { resources: unknown[] };
      return result.resources;
    },
    /** Ask a tab to do something: mcp.tool('lab', 'flash', { address: 'J24' }). Returns the tool's answer. */
    tool: async (target: string, name: string, args: Record<string, unknown> = {}) => {
      ctx.guard();
      return mcpTool(target, name, args);
    },
    /** Trigger a cell's click event from anywhere, as if somebody had clicked it. */
    click: async (path: string) => {
      ctx.guard();
      const t = aim(path);
      if (!t.address) throw new Error(`mcp.click needs a cell path like '/lab/J24'`);
      return mcpTool(t.server, 'click', { address: t.address });
    },
    /**
     * Follow a cell of any tab: fn(cell) runs once now and again every time that cell changes. The updates
     * arrive as MCP notifications (resources/updated), so they are a little later than at() would be.
     */
    watch: (path: string, fn: (cell: Record<string, unknown>) => unknown): (() => void) => {
      ctx.guard();
      const t = aim(path);
      if (!t.uri) throw new Error(`mcp.watch needs a cell path like '/lab/J24', not a tab`);
      const uri = t.uri;
      let stopped = false;
      let stopListening = () => {};
      let forget = () => {};
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        stopListening();
        forget();
        void router.request(caller, t.server, 'resources/unsubscribe', { uri }).catch(() => {});
      };
      const allowed = rateGuard(`mcp.watch('${path}')`, stop);
      const run = callback(fn as (...args: unknown[]) => unknown, stop);
      const refresh = (): void => {
        if (stopped || ctx.cancelled) return;
        void mcpRead(path).then((cell) => {
          if (!stopped && !ctx.cancelled) void run(cell);
        }, () => {});
      };
      stopListening = router.listen(caller, (_from, method, params) => {
        if (method === 'notifications/resources/updated' && params.uri === uri && allowed()) refresh();
      });
      void router.request(caller, t.server, 'resources/subscribe', { uri }).then(refresh, (err) => {
        data.error = err instanceof Error ? err.message : String(err);
        stop();
      });
      forget = ctx.addTask(stop);
      return stop;
    },
    /** Tell every cell in every tab that listens: mcp.emit('wave', 3). */
    emit: (name: string, payload?: unknown): void => {
      ctx.guard();
      router.broadcast(caller, SIGNAL, { name: String(name), data: payload ?? null, from: caller });
    },
    /** Listen for what mcp.emit() sends (from any tab): fn(data, from). */
    on: (name: string, fn: (payload: unknown, from: string) => unknown): (() => void) => {
      ctx.guard();
      let forget = () => {};
      let stopListening = () => {};
      const stop = (): void => {
        stopListening();
        forget();
      };
      const allowed = rateGuard(`mcp.on('${name}')`, stop);
      const run = callback(fn as (...args: unknown[]) => unknown, stop);
      stopListening = router.listen(caller, (_from, method, params) => {
        if (method === SIGNAL && params.name === name && allowed()) void run(params.data, String(params.from ?? ''));
      });
      forget = ctx.addTask(stop);
      return stop;
    },
    /** The last n messages that crossed the router (who asked whom, and what). */
    recent: (n = 10): Traffic[] => router.recent(n),
    /** Follows a message by its id: where it went, what led to it and what it led to (see router.ts, Trace). */
    trace: (id: string) => {
      const message = router.message(String(id));
      return message ? { message, path: message.hops.join(' → '), because: router.chain(message.id).slice(0, -1), ledTo: router.effects(message.id) } : null;
    },
    /** Who changed cells over MCP (a cell's code replaced ...), with the code before and after; oldest first. */
    history: (subject?: string) => router.history(subject === undefined ? undefined : String(subject)),
    /** What the router has counted: messages, errors, rate, per second (last 60 s), and per server, client and method. */
    stats: () => router.stats(),
    /** The traffic as a packet list with a display filter (see mcp/analyze.ts): mcp.packets('type==tool && ms>20', 10). */
    packets: (filter = '', n = 30) => trafficPackets(router.recent(400), String(filter), n),
    /** Counts what a filter picks: kinds of traffic, who talks to whom, slowest, errors, and a story in words. */
    analyze: (filter = '') => analyzeTraffic(router.recent(400), String(filter)),
    /** Ask the router about its traffic in plain words: mcp.ask('any errors?'). */
    ask: (question: string) => askTraffic(router.recent(400), String(question)),
    /** Outside AIs that called in: client, version, model, user agent, how they came in, how many calls. */
    callers: () => outsideCallers(),
    /** The requests that were sent and are not answered yet: since when, the deadline (Unix ms) and how much longer it is worth waiting ({ waitMs, p } from the history of similar answers). */
    pending: () => router.pending(),
    /** Start the router's counters again from zero. */
    resetStats: (): void => {
      ctx.guard();
      router.resetStats();
    },
    /** Every server with what it is for, its tools and how many resources it holds: what can be done in this app. */
    catalog: async () => {
      ctx.guard();
      return buildCatalog(router, caller);
    },
    /** The tools of one server: [{ name, description, inputSchema }]. */
    tools: async (server: string) => {
      ctx.guard();
      const result = (await router.request(caller, aim(server).server, 'tools/list')) as { tools?: unknown[] };
      return result.tools ?? [];
    },
    /** Watch every message as it happens: fn(message). */
    tap: (fn: (message: Traffic) => unknown): (() => void) => {
      ctx.guard();
      let forget = () => {};
      const stop = router.tap((message) => {
        if (!ctx.cancelled) void fn(message);
      });
      const stopAll = (): void => {
        stop();
        forget();
      };
      forget = ctx.addTask(stopAll);
      return stopAll;
    },
  };

  /** Runs something that may take a while (a web request, the local model) so that it ends with this run: a cell that runs again cancels it. */
  const cancellable = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    ctx.guard();
    const abort = new AbortController();
    const forget = ctx.addTransient(() => abort.abort());
    try {
      const result = await work(abort.signal);
      ctx.guard();
      return result;
    } catch (err) {
      if (ctx.cancelled) throw new CancelError();
      throw err;
    } finally {
      forget();
    }
  };

  const weather = {
    /** The weather right now in a place ("Amsterdam", "Paris, France", "52.37,4.89" or { lat, lon }). */
    now: (place: PlaceInput) => cancellable(() => weatherNow(place)),
    /** The weather now and the next 1 to 7 days. */
    forecast: (place: PlaceInput, days = 3) => cancellable(() => weatherForecast(place, days)),
    /** Places that fit a name, best first. */
    find: (query: string, count = 5) => cancellable(() => findPlaces(query, count)),
    /** One sentence about the weather now, for print(). */
    text: (place: PlaceInput) => cancellable(async () => weatherSummary((await weatherNow(place)))),
  };

  const system = {
    /** How this computer is doing now (CPU, memory, temperatures, graphics card). Asking twice within a moment gives the same answer. */
    read: () => cancellable(() => readSystem()),
    /** The last readings of one value, ready for plot(): 'cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'memory' or 'fps'. Fills while somebody calls read(). */
    series: (name: SeriesName, count = 60) => systemSeries(name, count),
    /** One line for print(): 'CPU 31% 57°C, memory 24%, GPU 27% 28°C'. */
    text: () => cancellable(async () => systemSummary(await readSystem())),
  };

  /** A stopped cell (its timers were stopped) makes no more sound; every call is noted, so "which cell is that?" has an answer. */
  const heard = (): boolean => {
    if (ctx.cancelled) return false;
    noteSource(workspace.pathOf(sheet.id, data.address));
    return true;
  };

  const teletype = {
    /** One key of the teletype clacks (soft). Silent when the speaker is muted or the browser has not allowed sound yet (a click allows it). */
    key: (char?: string) => heard() && (void clack('key', char), touchMotor()),
    /** The carriage return at the end of a line. */
    cr: () => heard() && (void clack('cr'), touchMotor()),
    /** The machine prints one letter: its motor hums, the print head chatters (a space is quieter), "\n" is the carriage return. */
    print: (char: string) => heard() && printChar(char),
    /** The bell, once and softly. */
    bell: () => heard() && (void ringBell(), touchMotor()),
  };

  const tabs = {
    /** The tabs, left to right: { id, title, icon, builtin, active, cells }. */
    list: () => tabManager().list(),
    /** A new tab with a sheet of its own. Its cells are named /<id>/A1. Careful: every run makes another one; tabs.ensure() does not. */
    create: (title: string, options?: CreateTabOptions) => tabManager().create(title, options),
    /** The tab with this id; made only when it is not there yet, so a cell that runs again does not pile up tabs. */
    ensure: (id: string, title?: string, options?: Omit<CreateTabOptions, 'id'>) => tabManager().ensure(id, title, options),
    rename: (id: string, title: string) => tabManager().rename(id, title),
    /** Closes a tab of your own and deletes its cells. */
    close: (id: string) => tabManager().close(id),
    /** Brings a tab to the front. */
    select: (id: string) => tabManager().select(id),
  };

  const ollama = {
    /** Is the model server there, which models, and what to do when something is missing. Never throws. */
    status: () => cancellable(() => ollamaStatus()),
    /** The installed models. */
    models: () => cancellable(() => ollamaModels()),
    /** One question to the model on this computer; the answer arrives later (await it). */
    ask: (prompt: string, options?: OllamaOptions) => cancellable((signal) => ollamaAsk(prompt, options, signal)),
    /** A conversation: ollama.chat([{ role: 'user', content: 'Hi' }, ...]). */
    chat: (messages: OllamaMessage[], options?: OllamaOptions) => cancellable((signal) => ollamaChat(messages, options, signal)),
  };

  const ownerLabel = workspace.pathOf(sheet.id, data.address);

  /** A control in the input panel; `fn` runs (as an event handler of this cell) when the person changes it. */
  const control = (kind: ControlKind, label: string, spec: Omit<ControlSpec, 'kind' | 'onChange'>, fn?: unknown) => {
    ctx.guard();
    if (fn !== undefined && typeof fn !== 'function') throw new Error(`input.${kind}(label, ..., fn): fn must be a function`);
    let handle: ReturnType<typeof inputPanel.add> | null = null;
    let forget = () => {};
    const stop = (): void => {
      handle?.remove();
      forget();
    };
    const run = fn ? callback(fn as (...args: unknown[]) => unknown, stop) : null;
    handle = inputPanel.add(caller, ownerLabel, String(label), {
      ...spec,
      kind,
      onChange: (value) => {
        if (run && !ctx.cancelled) void run(...(kind === 'button' ? [] : [value]));
      },
    });
    forget = ctx.addTask(stop);
    const made = handle;
    return {
      get value() {
        return made.value;
      },
      set: (value: unknown) => made.set(value),
      remove: stop,
    };
  };

  /** A question card; resolves with the answer, or null when cancelled. */
  const question = async (kind: 'ask' | 'confirm' | 'choose', text: string, extra: { initial?: string; options?: string[] } = {}) => {
    ctx.guard();
    const q = inputPanel.question({ kind, text: String(text), ...extra });
    const forget = ctx.addTransient(() => q.cancel());
    try {
      const answer = await q.answer;
      ctx.guard();
      return answer;
    } finally {
      forget();
    }
  };

  const input = {
    /** Ask for a text: const name = await input.ask('Your name?'). Returns null when the person cancels. */
    ask: (text: string, initial = '') => question('ask', text, { initial: String(initial) }) as Promise<string | null>,
    /** Ask yes or no: if (await input.confirm('Start over?')) ... */
    confirm: async (text: string) => (await question('confirm', text)) === true,
    /** Pick one of some words: const colour = await input.choose('Colour?', ['red', 'blue']). Returns null when cancelled. */
    choose: (text: string, options: string[]) => {
      if (!Array.isArray(options) || !options.length) throw new Error("input.choose needs a list of words: input.choose('Colour?', ['red', 'blue'])");
      return question('choose', text, { options: options.map(String) }) as Promise<string | null>;
    },
    slider: (label: string, options: { min?: number; max?: number; step?: number; value?: number } = {}, fn?: unknown) => control('slider', label, options, fn),
    number: (label: string, value = 0, fn?: unknown) => control('number', label, { value }, fn),
    text: (label: string, value = '', fn?: unknown) => control('text', label, { value }, fn),
    checkbox: (label: string, value = false, fn?: unknown) => control('checkbox', label, { value }, fn),
    select: (label: string, options: string[], fn?: unknown) => {
      if (!Array.isArray(options) || !options.length) throw new Error("input.select needs a list of words: input.select('Colour', ['red', 'blue'])");
      return control('select', label, { options: options.map(String), value: options[0] }, fn);
    },
    button: (label: string, fn: unknown) => control('button', label, {}, fn),
    /** fn(key, { shift, ctrl, alt, repeat, text }) runs when a key is pressed (not while typing in a box or the editor). Keys: 'a', 'ArrowLeft', 'Enter', 'Space'. */
    onKey: (fn: (key: string, info: { shift: boolean; ctrl: boolean; alt: boolean; repeat: boolean; text: string }) => unknown): (() => void) => {
      ctx.guard();
      if (typeof fn !== 'function') throw new Error('input.onKey needs a function: input.onKey((key) => { ... })');
      let forget = () => {};
      let off = () => {};
      const stop = (): void => {
        off();
        forget();
      };
      const run = callback(fn as (...args: unknown[]) => unknown, stop);
      off = inputPanel.onKey((key, info) => {
        if (!ctx.cancelled) void run(key, info);
      });
      forget = ctx.addTask(stop);
      return stop;
    },
    /** fn(text) runs when text is pasted into this cell's input: the menu item Paste on a cell that has this (a terminal) sends the clipboard here instead of making it the cell's code. Returns a stop function. */
    onPaste: (fn: (text: string) => unknown): (() => void) => {
      ctx.guard();
      if (typeof fn !== 'function') throw new Error('input.onPaste needs a function: input.onPaste((text) => { ... })');
      let forget = () => {};
      let off = () => {};
      const stop = (): void => {
        off();
        forget();
      };
      const run = callback(fn as (...args: unknown[]) => unknown, stop);
      off = inputPanel.onPaste(sheet.id, () => data.address, (text) => {
        if (!ctx.cancelled) void run(text);
      });
      forget = ctx.addTask(stop);
      return stop;
    },
    /** Takes the typing keys for this cell, like a terminal: Enter, Delete, Space, arrows and letters stop reaching the sheet's shortcuts (Enter no longer opens the editor). A click anywhere takes them away (unless { steady: true }, for a cell that holds them while the mouse is over it); lost() is told. Shift+Enter stays the sheet's. Returns the way to give them back. */
    claimKeys: (lost?: () => unknown, options?: { steady?: boolean }): (() => void) => {
      ctx.guard();
      let forget = () => {};
      let off = () => {};
      const stop = (): void => {
        off();
        forget();
      };
      const told = typeof lost === 'function' ? callback(lost as (...args: unknown[]) => unknown, stop) : null;
      off = inputPanel.claimKeys(() => {
        if (!ctx.cancelled && told) void told();
      }, { steady: !!options?.steady });
      forget = ctx.addTask(stop);
      return stop;
    },
    /** Is this key held down right now? input.isDown('ArrowLeft') */
    isDown: (key: string): boolean => inputPanel.isDown(key),
  };

  const runInfo = Object.freeze({ reason: data.runReason, count: data.runCount });

  // import { f } from './B2' (see cellModules.ts): `__cell` fetches the exports of another cell of this tab, `__exports` is where this cell publishes its own.
  const latest = sheet.modules.current(data.address);
  const published = latest?.ctx === ctx ? latest : undefined;
  const importCell = async (spec: string): Promise<Record<string, unknown>> => {
    const address = cellOfSpecifier(String(spec));
    if (!address) {
      throw new Error(`Cannot import "${spec}": a cell is imported like  import { name } from './B2'  (a cell of this tab; the other tabs are read with at('/lab/J24'))`);
    }
    if (!sheet.dataAt(address)) throw new Error(`Cannot import "${spec}": there is no cell ${address} in this tab`);
    // The importer runs again when the other cell does (and after it).
    track(moduleNode(address));
    return sheet.modules.load(data.address, address, () => sheet.probeModule(address));
  };

  const api: Record<string, unknown> = {
    __cell: importCell,
    __exports: published?.exports ?? {},
    cell: self,
    print: (...values: unknown[]) => void self.print(...values),
    view: (text: string) => void self.view(text),
    plot: (data: unknown, options?: PlotOptions) => void self.plot(data, options),
    color: (fill: string) => void self.color(fill),
    paper: (options?: PaperOptions | boolean) => void self.paper(options),
    skipPaper: () => void self.skipPaper(),
    clear: () => void self.clear(),
    show: (...values: unknown[]) => void self.show(...values),
    span: (cols?: number, rows?: number) => self.span(cols, rows),
    grid,
    svg: svgApi,
    anim: animApi,
    mcp,
    weather,
    system,
    teletype,
    tabs,
    ollama,
    input,
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
    /** A TypeScript read-eval-print loop that keeps its variables: `const ts = repl()`, then `await ts('const x = 6 * 7')` and `await ts('x + 1')`. */
    repl: (overrides: Record<string, unknown> = {}) =>
      createRepl(
        async (source) => (await import('../editor/monaco')).transpile(data.address, source, sheet.id),
        () => ({ ...api, ...overrides }),
      ),
  };
  return api;
}
