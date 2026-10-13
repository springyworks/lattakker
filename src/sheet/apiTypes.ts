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
  /** Fix the edges of the picture, so an animation does not jump around. Left out: the edge follows the data. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** false: draw only the lines (no numbers, grid or legend). */
  axes?: boolean;
}

/** One spreadsheet cell, addressed like A1, C7 or M14. */
interface CellRef {
  readonly address: string;
  /** The tab this cell is in: 'board' or 'lab'. */
  readonly tab: string;
  /** The cell's absolute path, e.g. '/lab/J24'. Works from every tab. */
  readonly path: string;
  /** The identity of the code in this cell (null when empty). It stays when the cell moves: at('@' + uid) finds it again. */
  readonly uid: string | null;
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

/** One tile in a block's grid. Tiles have their own coordinates (x across, y down, from 0) and no sheet address. */
interface Tile {
  readonly x: number;
  readonly y: number;
  /** The block this tile lives in, e.g. 'A16'. */
  readonly block: string;
  /** The tab that block is in. */
  readonly tab: string;
  /** The tile's absolute path, e.g. '/lab/A16/3,4'. at() with that path gets it from any tab. */
  readonly path: string;
  /** The tile's address inside its tab, e.g. 'A16/3,4'. */
  readonly address: string;
  /** Its colour, or null when blank. */
  readonly fill: string | null;
  /** Its text ('' when none). */
  readonly text: string;
  /** Colour the tile; color(null) makes it blank again. */
  color(fill: string | null): Tile;
  /** Put a short text (a number, an emoji) on the tile; show() with nothing removes it. */
  show(...values: unknown[]): Tile;
  clear(): Tile;
}

/** The tiles inside this cell's block. */
interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly address: string;
  /** The tile in column x, row y (both start at 0). */
  at(x: number, y: number): Tile;
  /** Run fn for every tile, row by row. */
  each(fn: (tile: Tile) => void): Grid;
  /** Colour every tile in one pass: g.paint((x, y) => alive(x, y) ? 'green' : null). */
  paint(fn: (x: number, y: number) => string | null | undefined): Grid;
  /** Colour every tile the same (null blanks them). */
  fill(color: string | null): Grid;
  /** Blank every tile and remove their text. */
  clear(): Grid;
}

/** One message that crossed the page's MCP router. */
interface McpMessage {
  n: number;
  /** Milliseconds since the page started. */
  time: number;
  /** Who sent it: a cell like 'board:A15', a tab like 'lab', or 'ai'. */
  from: string;
  to: string;
  kind: 'request' | 'response' | 'error' | 'notification';
  method: string;
  /** The parameters or the answer, shortened to one line. */
  detail: string;
}

/** A cell of any tab as a plain object, read over MCP. */
interface McpCell {
  tab: string;
  address: string;
  path: string;
  uid: string | null;
  code: string;
  text: string;
  output: string[];
  error: string | null;
  cols: number;
  rows: number;
  tiles: { cols: number; rows: number; painted: number } | null;
}

/**
 * Talk to the tabs of the page the way an outside AI helper would: over MCP, a small message protocol.
 * Everything here is asynchronous (use await). Every tab ('board', 'lab') is an MCP server.
 */
interface Mcp {
  /** The names of the servers: one per tab. */
  servers(): string[];
  /** Any MCP request, for example mcp.call('lab', 'resources/list'). */
  call(tab: string, method: string, params?: object): Promise<any>;
  /** One cell of any tab as a plain object. Reading is not a dependency: use watch() to follow changes. */
  read(path: string): Promise<McpCell>;
  /** The cells of a tab that hold code. */
  list(tab: string): Promise<any[]>;
  /** Ask a tab to do something. Tools: list_cells, get_cell, run_cell, set_code, click, flash, signal. */
  tool(tab: string, name: string, args?: object): Promise<any>;
  /** Trigger a cell's click event from anywhere, as if it had been clicked: mcp.click('/lab/J24'). */
  click(path: string): Promise<any>;
  /** fn(cell) runs now and every time that cell of any tab changes (the news arrives as an MCP notification). Returns a stop function. */
  watch(path: string, fn: (cell: McpCell) => unknown): () => void;
  /** Tell every listening cell in every tab something: mcp.emit('wave', 3). */
  emit(name: string, data?: unknown): void;
  /** Hear what mcp.emit() sends from any tab: fn(data, from). Returns a stop function. */
  on(name: string, fn: (data: any, from: string) => unknown): () => void;
  /** The last n messages that crossed the router (who asked whom, and what). */
  recent(n?: number): McpMessage[];
  /** fn(message) runs for every message as it happens. Returns a stop function. */
  tap(fn: (message: McpMessage) => unknown): () => void;
  /**
   * What the router has counted since the page started: messages, errors, messages per second, who asked what.
   * Not a dependency: read it again from every('1s', ...). The same numbers are the MCP tool mcp.tool('router', 'stats').
   * every('1s', () => plot(mcp.stats().perSecond))     messages per second over the last minute
   */
  stats(): RouterStats;
  /** Start the router's counters again from zero. */
  resetStats(): void;
  /** Everything this app can do over MCP: every server, what it is for, its tools. Start here when you do not know what exists. */
  catalog(): Promise<McpCatalogEntry[]>;
  /** The tools of one server: await mcp.tools('weather'). */
  tools(server: string): Promise<Array<{ name: string; description: string; inputSchema: object }>>;
}

/** What the router has counted. */
interface RouterStats {
  /** Seconds since the page started (or the last resetStats). */
  uptimeSeconds: number;
  messages: number;
  requests: number;
  errors: number;
  notifications: number;
  /** Messages per second, averaged over the last 10 seconds. */
  ratePerSecond: number;
  /** Messages in each of the last 60 seconds, oldest first: ready for plot(). */
  perSecond: number[];
  serverCount: number;
  /** How many parties listen for notifications. */
  listeners: number;
  /** Who was asked, busiest first. */
  servers: Array<{ name: string; requests: number; errors: number; avgMs: number; maxMs: number }>;
  /** Who asked (a cell like 'lab:A16', 'ai-chat' ...), busiest first. */
  clients: Array<{ name: string; requests: number; errors: number }>;
  /** What was asked, busiest first. */
  methods: Array<{ method: string; count: number; errors: number; avgMs: number }>;
  slowest: { to: string; method: string; ms: number } | null;
}

interface McpCatalogEntry {
  server: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
  resources: number | null;
}

/** A place on Earth. */
interface WeatherPlace {
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
}

interface WeatherNow {
  /** Local time at the place, e.g. '2026-10-13T08:30'. */
  time: string;
  /** °C */
  temperature: number;
  feelsLike: number;
  /** % */
  humidity: number;
  /** km/h */
  wind: number;
  windDegrees: number;
  /** Compass point the wind comes from: 'N', 'NE', ... */
  windFrom: string;
  /** mm in the last hour */
  rain: number;
  /** % of the sky covered */
  clouds: number;
  isDay: boolean;
  /** WMO weather code, with a short text ('Light rain') and an emoji ('🌧'). */
  code: number;
  text: string;
  icon: string;
}

interface WeatherDay {
  date: string;
  min: number;
  max: number;
  rain: number;
  rainChance: number | null;
  wind: number;
  uv: number;
  sunrise: string;
  sunset: string;
  code: number;
  text: string;
  icon: string;
}

/** A place: a name ('Amsterdam', 'Paris, France'), coordinates as text ('52.37,4.89') or { lat, lon }. */
type WeatherPlaceInput = string | { lat: number; lon: number; name?: string };

/**
 * The weather anywhere, from open-meteo.com (free). A lookup sends the place name there; a grown-up can switch it
 * off in the helper settings. Answers are kept for 10 minutes, so asking often is fine but pointless.
 * const w = await weather.now('Amsterdam'); print(w.icon, w.temperature + '°C', w.text)
 * const f = await weather.forecast('Paris, France', 5); plot(f.days.map(d => d.max))
 */
interface WeatherApi {
  now(place: WeatherPlaceInput): Promise<WeatherNow & { place: WeatherPlace }>;
  forecast(place: WeatherPlaceInput, days?: number): Promise<{ place: WeatherPlace; now: WeatherNow; days: WeatherDay[] }>;
  find(query: string, count?: number): Promise<WeatherPlace[]>;
  /** One sentence for print(): '🌧 Rain, 11°C (feels 9°C), wind 14 km/h from SW, humidity 88%'. */
  text(place: WeatherPlaceInput): Promise<string>;
}

interface OllamaStatus {
  /** Something answers at the address from the helper settings (default localhost:11434). */
  running: boolean;
  isOllama: boolean;
  server: string;
  version: string | null;
  /** Installed models, and the ones that are in memory right now. */
  models: string[];
  loaded: string[];
  /** The model chosen in the helper settings ('' when none). */
  selected: string;
  /** ask() can work. */
  ready: boolean;
  /** What is wrong and what to do about it, or a short "Ready". */
  message: string;
}

interface OllamaModel {
  name: string;
  sizeGB: number;
  family: string;
  parameters: string;
  quantization: string;
  loaded: boolean;
}

interface OllamaOptions {
  /** Which model (default: the one chosen in the helper settings, else the first installed). */
  model?: string;
  /** How the model should behave. */
  system?: string;
}

/**
 * The model on this computer (Ollama, or LM Studio): nothing leaves the computer.
 * const s = await ollama.status(); if (!s.ready) print(s.message)
 * print(await ollama.ask('Explain a loop to a child in two sentences.'))
 * Ask one thing at a time (await it); the first question can be slow while the model loads.
 */
interface OllamaApi {
  /** Never throws: it describes the problem (server not found, model missing ...) in plain words. */
  status(): Promise<OllamaStatus>;
  models(): Promise<OllamaModel[]>;
  ask(prompt: string, options?: OllamaOptions): Promise<string>;
  chat(messages: Array<{ role: 'user' | 'assistant'; content: string }>, options?: OllamaOptions): Promise<string>;
}

/** A control in the input panel. */
interface InputControl<T> {
  /** What the person set it to. */
  readonly value: T;
  /** Change it from code. */
  set(value: T): void;
  /** Take it out of the panel. */
  remove(): void;
}

/**
 * Answers from the person. Questions appear as a card, controls in the "Inputs" panel (bottom left), grouped by cell.
 * A control keeps the value the person gave it when the cell runs again. Put the code that uses a value inside the function.
 * const name = await input.ask('Your name?')                      text (null when cancelled)
 * const speed = input.slider('speed', { min: 1, max: 10, value: 3 }, (v) => print('speed', v))
 * input.button('reset', () => seed())
 * input.onKey((key) => { if (key === 'ArrowLeft') ... })           keys, while not typing in a box or the editor
 */
interface InputApi {
  ask(question: string, initial?: string): Promise<string | null>;
  confirm(question: string): Promise<boolean>;
  choose(question: string, options: string[]): Promise<string | null>;
  slider(label: string, options?: { min?: number; max?: number; step?: number; value?: number }, fn?: (value: number) => unknown): InputControl<number>;
  number(label: string, value?: number, fn?: (value: number) => unknown): InputControl<number>;
  text(label: string, value?: string, fn?: (value: string) => unknown): InputControl<string>;
  checkbox(label: string, value?: boolean, fn?: (value: boolean) => unknown): InputControl<boolean>;
  select(label: string, options: string[], fn?: (value: string) => unknown): InputControl<string>;
  button(label: string, fn: () => unknown): InputControl<undefined>;
  /** fn(key, { shift, ctrl, alt, repeat }): keys are named 'a', 'ArrowLeft', 'Enter', 'Space'. Returns a stop function. */
  onKey(fn: (key: string, info: { shift: boolean; ctrl: boolean; alt: boolean; repeat: boolean }) => unknown): () => void;
  /** Is this key held down right now? */
  isDown(key: string): boolean;
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
/**
 * Give this cell's block a grid of tiles, whatever its size: span(4, 2) then grid(10, 8) makes 80 tiles that fill the block.
 * Tiles are addressed inside the block (x across, y down, from 0), so the code keeps working when the block moves.
 * const g = grid(10, 8)
 * g.at(3, 4).color('green')                 paint one tile
 * g.paint((x, y) => (x + y) % 2 ? '#333' : '#eee')   paint them all
 * on(g, 'click', (tile) => tile.color('red'))          which tile was clicked
 * Other cells reach a tile by its path: at('A16/3,4').fill
 */
declare function grid(cols: number, rows?: number): Grid;
/** Short for cell.show(...): replaces the output instead of adding a line. */
declare function show(...values: unknown[]): void;
/**
 * Draw an XY plot in this cell (call it again to redraw; clear() removes it; print/show text becomes the caption).
 * plot([3, 1, 4, 1, 5])                            numbers against 0, 1, 2, ...
 * plot([[0, 0], [1, 2], [2, 4]])                   [x, y] pairs
 * plot(Math.sin, { from: 0, to: 6.28 })            a function of x
 * plot({ sin: Math.sin, cos: Math.cos })           several lines with a legend (a name that starts with _ stays out of the legend)
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
declare function on(target: Grid, event: 'click', fn: (tile: Tile) => unknown): () => void;
declare function on(target: 'game', fn: (game: GameApi) => unknown): () => void;
declare function on(target: 'sheet', event: 'rows' | 'mode', fn: (sheet: SheetApi) => unknown): () => void;
/** Talk to other tabs over MCP (asynchronous): read their cells, watch them, click them, send them signals. */
declare const mcp: Mcp;
/** The weather anywhere (open-meteo.com). await weather.now('Amsterdam'). */
declare const weather: WeatherApi;
/** The model on this computer (Ollama). await ollama.ask('...'); await ollama.status() says what is missing. */
declare const ollama: OllamaApi;
/** Answers from the person: await input.ask('Name?'), input.slider(...), input.button(...), input.onKey(...). */
declare const input: InputApi;
/** This cell's notebook: survives re-runs and moves with the cell's code. Use it for counters and "what did I see last time". */
declare const memory: Record<string, any>;
/** Why this run started. reason: 'edit' (code was written or Run pressed), 'moved' (block or row moved) or 'update' (something this cell reads changed). count: runs since the code was written. */
declare const run: { readonly reason: 'edit' | 'moved' | 'update'; readonly count: number };
/** Stop all timers and watchers this cell started. */
declare function stop(): void;
/**
 * A tile inside a block's grid, by path: at('A16/3,4') is the tile in column 3, row 4 of the grid in A16;
 * at('/lab/A16/3,4') is the same kind of tile in another tab. Tiles of another tab can be read, not changed.
 */
declare function at(path: \`\${string}/\${number},\${number}\`): Tile;
/**
 * Another cell by address or by path. A plain address is a cell of this tab: at('A1').
 * A path starting with / names a tab first, so it works from anywhere: at('/lab/J24'), at('/board/A12').
 * @c-1a2b3c4d is a cell's identity, which stays with its code when it moves. Cells of another tab can be read
 * (and this cell runs again when they change) but only their own tab's code can change them.
 */
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
