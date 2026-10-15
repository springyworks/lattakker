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
  /** The size this cell wants by default: merge it over cols x rows neighbours (not over the board). Leave one out to keep it. No arguments: just read the size. If the person resizes the block (green handles) or makes it from picked cells, their size is kept and a plain "span(4, 2)" line is rewritten to match; change the numbers in the code and the code's size wins again. With no span() at all the block keeps the shape it has (1x1 for a new cell). */
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
  /** The moment of the initiative that started the chain this message belongs to: Unix time in milliseconds (Date.now()); the same for every message of a chain, answers included. */
  startedAt: number;
  /** The moment this message was sent (Unix ms), and the moment by which the asker stops waiting for the answer (Unix ms). */
  sentAt: number;
  deadline: number;
  /** Who sent it: a cell like 'board:A15', a tab like 'lab', or 'ai'. */
  from: string;
  to: string;
  kind: 'request' | 'response' | 'error' | 'notification';
  method: string;
  /** The parameters or the answer, shortened to one line. */
  detail: string;
  /** The id of this message (unique across pages), who started the chain it belongs to, and the message that caused it (null at the start). */
  id: string;
  origin: string;
  cause: string | null;
  /** The way it went, from the one who started it to the receiver: ['you', 'ai-chat', 'router', 'board']. */
  hops: string[];
}

/** A message as the traffic analyser sees it: a McpMessage with a type (the kind of traffic), who asked whom, and the tool. */
interface McpPacket {
  n: number;
  id: string;
  time: number;
  /** The moment of the initiative (Unix time in milliseconds), see McpMessage. */
  startedAt: number;
  origin: string;
  from: string;
  to: string;
  /** Who asked: for an answer that is the receiver. */
  asker: string;
  asked: string;
  kind: 'request' | 'response' | 'error' | 'notification';
  method: string;
  type: 'heartbeat' | 'discovery' | 'read' | 'subscribe' | 'news' | 'signal' | 'tool' | 'change' | 'other';
  /** The tool of a tools/call (also on its answer), or ''. */
  tool: string;
  info: string;
  ms?: number;
  cause: string | null;
}

/** An outside AI that called in, as far as the page knows. Its messages have the origin outside-ai:<client>@<model>. */
interface McpCaller {
  origin: string;
  /** The program (clientInfo.name, X-MCP-Client, or the HTTP user agent). */
  client?: string;
  version?: string;
  /** The AI model behind it, when it said (X-MCP-Model, _meta.model, clientInfo.model, or the introduce tool). */
  model?: string;
  agent?: string;
  protocol?: string;
  note?: string;
  /** How it came in: 'mcp-bridge' (the dev server's /mcp) or 'webmcp'. */
  via: string;
  calls: number;
  first: number;
  last: number;
}

/** A request that was sent and has no answer yet (mcp.pending()). */
interface McpPending {
  id: string;
  from: string;
  to: string;
  /** What is asked: 'tools/call forecast'. */
  what: string;
  origin: string;
  /** Unix ms: the initiative, this request's sending, and the deadline after which it is an error (-32001). */
  startedAt: number;
  sentAt: number;
  deadline: number;
  elapsedMs: number;
  remainingMs: number;
  /** How many "still working" progress notifications it has had. */
  acknowledged: number;
  /** How much longer it is worth waiting: wait waitMs and p (0 to 1) of the similar earlier answers were in by then. History, not a promise; null when there is too little of it. */
  waitMs: number | null;
  p: number | null;
  basis: number;
  typicalMs: number | null;
}

/** What mcp.analyze() found. */
interface McpAnalysis {
  filter: string;
  scanned: number;
  matched: number;
  seconds: number;
  byType: Array<{ type: string; count: number; share: number; meaning: string }>;
  byKind: Record<string, number>;
  conversations: Array<{ asker: string; asked: string; messages: number; errors: number; avgMs: number; types: string[] }>;
  talkers: Array<{ party: string; asked: number; answered: number }>;
  slowest: Array<{ id: string; asker: string; asked: string; method: string; tool: string; ms: number }>;
  errors: Array<{ id: string; asker: string; asked: string; method: string; info: string }>;
  /** The result in plain sentences. */
  story: string[];
}

/** What mcp.ask() answers. */
interface McpAnswer {
  question: string;
  answer: string;
  /** The filter behind the answer: give it to mcp.packets() to see the messages. */
  filter: string;
  packets: McpPacket[];
  /** false when the question was not one it knows (the answer then lists what it can do). */
  understood: boolean;
}

/** One recorded change made over MCP: who, through which message, and the code before and after. */
interface McpChange {
  n: number;
  at: string;
  /** The moment of the initiative that led to the change: Unix time in milliseconds. */
  startedAt: number;
  /** What changed: 'lab/J24'. */
  subject: string;
  /** The tool that did it, like 'set_code'. */
  action: string;
  /** Who started the chain (a cell, 'you', 'ai-chat', 'outside-ai:...'), the parties it passed through, and the message that carried it. */
  by: string;
  lineage: string[];
  msg: string;
  cause: string | null;
  beforeHash: string;
  afterHash: string;
  /** The code before and after (shortened to 4000 characters): put "before" back to undo it. */
  before?: string;
  after?: string;
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
   * Follows a message by its id (see recent()): the way it went, the messages that led to it (oldest first), and the ones it led to.
   * Every message says who started its chain (origin) and which message caused it (cause), so what happened can be followed back.
   * const m = mcp.recent(1)[0]; print(mcp.trace(m.id)?.path)       'lab:A16 → router → weather'
   */
  trace(id: string): { message: McpMessage; path: string; because: McpMessage[]; ledTo: McpMessage[] } | null;
  /** Who changed cells over MCP, oldest first, with the code before and after (all of them, or only one cell: mcp.history('lab/J24')). */
  history(subject?: string): McpChange[];
  /**
   * What the router has counted since the page started: messages, errors, messages per second, who asked what.
   * Not a dependency: read it again from every('1s', ...). The same numbers are the MCP tool mcp.tool('router', 'stats').
   * every('1s', () => plot(mcp.stats().perSecond))     messages per second over the last minute
   */
  stats(): RouterStats;
  /** Start the router's counters again from zero. */
  resetStats(): void;
  /** The requests sent and not answered yet, with their deadline and an estimate of how much longer to wait (see McpPending). */
  pending(): McpPending[];
  /** Outside AIs that called in (client, version, model, user agent, how they came in, how many calls), newest first. The same as the MCP tool mcp.tool('router', 'callers'). */
  callers(): McpCaller[];
  /**
   * The traffic as a packet list, a little like Wireshark: each message with its type (what kind of traffic it is), who asked whom, the tool.
   * A display filter picks messages: type==tool && ms>20   from~ai   kind==error   asked==weather and !heartbeat   origin~lab
   * Fields: n id time ms from to asker asked origin kind type method tool info cause. Operators: == != ~ (contains) !~ > >= < <=; && || ! ( ).
   * A lone word searches every text field. A filter that cannot be read throws an error that says why.
   * for (const p of mcp.packets('type==tool', 10)) print(p.asker, '→', p.asked, p.tool, p.ms)
   */
  packets(filter?: string, n?: number): McpPacket[];
  /** Counts what a filter picks (default: everything in the log): kinds of traffic, who talks to whom, slowest, errors, and a short story in words. The same as the MCP tool mcp.tool('router', 'analyze'). */
  analyze(filter?: string): McpAnalysis;
  /** Ask the router about its own traffic in plain words: 'what is going on?', 'any errors?', 'who is busiest?', 'what does ai-chat do?'. Keyword matching over the real log, not a model; the answer says which filter it used. */
  ask(question: string): McpAnswer;
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

interface SystemInfo {
  /** 'dev-server' when the dev server measured it (real load and temperatures), 'browser' on the published page (only what the browser tells; the rest is null). */
  source: 'dev-server' | 'browser';
  time: number;
  cpu: { load: number | null; cores: number; model: string; temp: number | null };
  memory: { totalMb: number | null; usedMb: number | null } | null;
  gpu: { name: string; load: number | null; temp: number | null; memUsedMb: number | null; memTotalMb: number | null; powerW: number | null; fanPercent: number | null } | null;
  temps: { name: string; celsius: number }[];
  loadAverage: number[];
  uptimeSeconds: number | null;
  browser: { fps: number | null; heapMb: number | null; online: boolean; network: string | null; battery: number | null; charging: boolean | null };
}

/**
 * How this computer is doing: CPU load, memory, temperatures, the graphics card.
 * Measured when the dev server runs; on the published page only browser facts (cores, fps, battery) are there.
 * every('1s', async () => { const s = await system.read(); plot(system.series('cpu')) })
 */
interface SystemApi {
  read(): Promise<SystemInfo>;
  /** The last readings of one value, oldest first, ready for plot(). Fills while somebody calls read(). */
  series(name: 'cpu' | 'cpuTemp' | 'gpu' | 'gpuTemp' | 'memory' | 'fps', count?: number): number[];
  /** One line for print(): 'CPU 31% 57°C, memory 24%, GPU 27% 28°C'. */
  text(): Promise<string>;
}

interface TabInfo {
  id: string;
  title: string;
  icon: string;
  /** The page's own tabs (board, lab, examples, monitor) cannot be renamed or closed. */
  builtin: boolean;
  active: boolean;
  /** How many cells hold code. */
  cells: number;
}

interface CreateTabOptions {
  /** Lowercase letters, digits and "-" (default: made from the title). */
  id?: string;
  /** One emoji, default 📄. */
  icon?: string;
  /** Starting cells: { A1: 'print(1)', C1: '...' }. */
  cells?: Record<string, string>;
  /** Bring the new tab to the front (default true). */
  select?: boolean;
}

/**
 * The tabs of the page. A new tab is a sheet of its own: cells, blocks, the whole cell API. Its cells are named
 * with the tab id: /plots/A1. Tabs are remembered by the browser.
 * tabs.ensure('plots', 'Plots', { icon: '📈', cells: { A1: 'plot([1, 4, 9])' } })   // made once, safe to run again
 * const t = tabs.create('Scratch'); print(t.id)   // 'scratch'
 */
interface TabsApi {
  list(): TabInfo[];
  /** A new tab every time it runs. Prefer ensure() in a cell that can run again. */
  create(title: string, options?: CreateTabOptions): TabInfo;
  ensure(id: string, title?: string, options?: Omit<CreateTabOptions, 'id'>): TabInfo;
  rename(id: string, title: string): TabInfo;
  close(id: string): { closed: string; cells: number };
  select(id: string): TabInfo;
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
/** Short for cell.span(cols, rows): the size this cell wants by default. span(4) keeps the rows; span() just returns the current size. A size the person gave the block by hand wins until you change these numbers. */
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
/** How an animation moves: linear, in (slow start), out (slow end), inOut (the default), bounce, elastic, back. */
type SvgEase = 'linear' | 'in' | 'out' | 'inOut' | 'bounce' | 'elastic' | 'back';
interface SvgAnimateOptions {
  /** How long one play takes: 500, '500ms' or '2s'. Default 500 ms. */
  time?: number | string;
  ease?: SvgEase;
  /** Wait this long before starting. */
  delay?: number | string;
  /** true: for ever. A number: that many plays. */
  loop?: boolean | number;
  /** Play backwards on every second play, so a loop swings to and fro. */
  yoyo?: boolean;
  /** For along: start at the end of the path. */
  reverse?: boolean;
}
/** What animate() returns: await it to wait until the animation is done; stop() ends it early. */
interface SvgAnimation extends Promise<void> {
  stop(): void;
}
/** One part of a drawing. */
interface SvgEl {
  /** The SVG element itself, for anything these methods do not cover. */
  readonly node: SVGElement;
  /** attr('r') reads an attribute, attr('r', 20) sets it, attr({ r: 20, fill: 'red' }) sets several. */
  attr(name: string): string | null;
  attr(name: string, value: string | number): SvgEl;
  attr(map: Record<string, string | number>): SvgEl;
  /** The words of a text element: text() reads, text('hi') sets. */
  text(): string;
  text(value: unknown): SvgEl;
  fill(color: string): SvgEl;
  stroke(color: string, width?: number): SvgEl;
  opacity(value: number): SvgEl;
  show(): SvgEl;
  hide(): SvgEl;
  /** The part's box in its own coordinates. */
  bbox(): { x: number; y: number; width: number; height: number };
  /** Moves the part by (x, y) from where it was drawn. */
  move(x: number, y: number): SvgEl;
  /** Turns the part by this many degrees around its pivot. */
  rotate(degrees: number): SvgEl;
  /** Grows the part around its pivot: scale(2) is twice as big. */
  scale(sx: number, sy?: number): SvgEl;
  /** Where the part turns and grows from: 'center' (default), 'top', 'bottom', 'left', 'right', 'topleft' ... or a point: pivot(100, 86). A drawing can say it with data-pivot="100 86". */
  pivot(where: string | number, y?: number): SvgEl;
  /** Where the part is now: { x, y, rotate, scale }. */
  readonly state: { x: number; y: number; rotate: number; scale: number };
  /** Adds a child: g.add('circle', { cx: 10, cy: 10, r: 5 }). */
  add(tag: string, attrs?: Record<string, string | number>): SvgEl;
  remove(): void;
  /** fn(event) runs when the part gets this event ('click', 'pointerdown', 'pointerover' ...). Returns a stop function; it also stops when the cell runs again. */
  on(event: string, fn: (event: Event) => unknown): () => void;
  /**
   * Changes properties smoothly. x and y MOVE the part, rotate turns it (degrees), scale grows it, opacity fades it.
   * Any other name is an attribute (r, cx, cy, width, fill, stroke ...): numbers and colours both work.
   * along moves the part's centre along a path: { along: '#link-board' }.
   * await arm.animate({ rotate: 40 }, { time: '300ms', ease: 'bounce' })
   * dot.animate({ cx: 150, fill: 'tomato' }, { time: '1s', yoyo: true, loop: true })
   */
  animate(props: Record<string, number | string | SvgEl>, options?: SvgAnimateOptions): SvgAnimation;
}
/** A drawing shown in this cell. */
interface SvgScene {
  /** The SVG element of the drawing. */
  readonly svg: SVGSVGElement;
  /** The ids in the drawing: what el() can find. */
  readonly ids: string[];
  /** The part with this id (el('sun') or el('#sun')) or matching this selector (el('.leg'), el('circle')). Says which ids exist when there is none. */
  el(selector: string | SvgEl): SvgEl;
  /** Every part that matches a selector. */
  all(selector: string): SvgEl[];
  /** Adds a part to the drawing: pic.add('circle', { cx: 50, cy: 50, r: 10, fill: 'tomato' }). */
  add(tag: string, attrs?: Record<string, string | number>): SvgEl;
  /** Writes words into the drawing: pic.write(10, 20, 'Score: 3'). */
  write(x: number, y: number, words: unknown, attrs?: Record<string, string | number>): SvgEl;
  /** Sets the words of several parts at once: pic.set({ score: 'Score: 3' }). */
  set(texts: Record<string, unknown>): SvgScene;
  /** The visible part of the drawing: pic.viewBox(0, 0, 200, 100). */
  viewBox(x: number, y: number, width: number, height: number): SvgScene;
  /** Takes everything out of the drawing. */
  clear(): SvgScene;
  /** fn(seconds, secondsSinceLastFrame) runs for every frame of the screen (about 60 times a second). Returns a stop function; it also stops when the cell runs again. */
  frame(fn: (seconds: number, delta: number) => unknown): () => void;
}
interface SvgApi {
  /** Shows a drawing in this cell or block, given as SVG text: svg('<svg viewBox="0 0 100 100">...</svg>'). Its parts can be found and animated. svg() alone is a blank drawing; svg({ width: 400, height: 300 }) sets its size. */
  (markup?: string | { width?: number; height?: number }): SvgScene;
  /** A drawing that comes with the app, as SVG text: svg(svg.asset('stickman')). */
  asset(name: string): string;
  /** The names of the drawings that come with the app: 'stickman', 'tvman', 'router-architecture'. */
  assets(): string[];
}
/**
 * Animated drawings. Give a cell some SVG, find its parts by id, move, turn, recolour and animate them.
 * const pic = svg(svg.asset('stickman'))
 * await pic.el('armR').pivot('top').animate({ rotate: -140 }, { time: '300ms' })
 */
declare const svg: SvgApi;
/** An animated picture (WebP, GIF or APNG) cut into frames, with controls. Made by anim.load(). */
interface AnimClip {
  /** Size of one frame in pixels, and how many frames there are. */
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  /** How long each frame shows, in milliseconds. */
  readonly durations: readonly number[];
  /** The frame that is showing now (0 is the first), and whether it is playing. */
  readonly frame: number;
  readonly playing: boolean;
  /** Length of one run in milliseconds, and where in it we are. */
  readonly duration: number;
  readonly time: number;
  /** true: start again at the end (the default). false: stop at the last frame. */
  loop: boolean;
  /** 1 is the speed of the file; 2 twice as fast, 0.5 half, -1 backwards. */
  speed: number;
  /** The canvas that holds the current frame (with its transparency). */
  readonly canvas: HTMLCanvasElement;
  play(): AnimClip;
  pause(): AnimClip;
  toggle(): AnimClip;
  /** Goes this many frames on (negative: back), going round at the ends, and pauses. clip.step() is one frame on. */
  step(count?: number): AnimClip;
  /** Shows frame number i. */
  seek(i: number): AnimClip;
  /** Shows the frame that is on screen this many milliseconds after the start. */
  seekTime(ms: number): AnimClip;
  /** fn(frame) runs every time the frame changes. Returns a stop function. */
  onFrame(fn: (frame: number) => unknown): () => void;
  /** fn() runs when a clip with loop = false reaches its end. */
  onEnd(fn: () => unknown): () => void;
  /**
   * Shows the picture in this cell as a drawing, with a bar of buttons and a slider under it.
   * clip.show({ controls: false }) is only the picture. clip.show({ scene: pic, x: 20, y: 10, width: 120 }) puts it
   * into a drawing you made with svg(), so shapes can go behind and in front of it. Add into: pic.el('screen') and the picture sits INSIDE that
   * part of the drawing (x and y are the part's own), so it moves, turns and fades with it: a screen in a robot's belly.
   */
  show(options?: { scene?: SvgScene; into?: SvgEl; x?: number; y?: number; width?: number; controls?: boolean }): SvgScene;
}
interface AnimApi {
  /**
   * Loads an animated picture: the name of one that comes with the app ('bouncer', 'spinner', 'truck', 'truck.gif'), a web address,
   * or a File. Transparency is kept. WebP, GIF and APNG work.
   */
  load(source: string | Blob | ArrayBuffer | Uint8Array): Promise<AnimClip>;
  /** Opens the "choose a file" window and loads that picture. It only works inside a click: input.button('Choose', async () => { const clip = await anim.pick(); clip.show() }). */
  pick(): Promise<AnimClip>;
  /** The names of the pictures that come with the app. */
  assets(): string[];
}
/**
 * Animated pictures you can control. A browser plays a WebP or GIF but cannot pause it or step through it; this can.
 * const clip = await anim.load('bouncer')
 * clip.show()                     the picture with play / step / slider controls
 * clip.speed = 0.5                half speed (negative runs backwards)
 * clip.step(1)                    one frame on, and pause
 * clip.onFrame((n) => print(n))   know which frame is showing
 */
declare const anim: AnimApi;
/** Talk to other tabs over MCP (asynchronous): read their cells, watch them, click them, send them signals. */
declare const mcp: Mcp;
/** The weather anywhere (open-meteo.com). await weather.now('Amsterdam'). */
declare const weather: WeatherApi;
/** The page's tabs: tabs.ensure('plots', 'Plots') makes a sheet of its own once; tabs.list(), rename, close, select. */
declare const tabs: TabsApi;
/** How this computer is doing: await system.read() (CPU, memory, temperatures, graphics card); system.series('cpu') to plot. */
declare const system: SystemApi;
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
