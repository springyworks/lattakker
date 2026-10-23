/** Type declarations that Monaco shows while editing a cell. Keep in sync with runtime.ts / main.ts. */
export const CELL_API_DTS = `
/** A piece on the board, as seen by code. Hidden Blue pieces report rank '?' unless peeked. */
interface PieceInfo {
  /** Whose piece it is. */
  color: 'red' | 'blue';
  /** 1 (Spy) .. 10 (Marshal), 'B' bomb, 'F' flag, or '?' when hidden */
  rank: number | 'B' | 'F' | '?';
  /** The piece's name, like 'Marshal' or 'Bomb' ('?' for a hidden Blue piece). */
  name: string;
  /** true once the piece has been seen by the other side (it attacked or was attacked). */
  revealed: boolean;
  /** true once the piece has moved at least once (bombs and flags never move). */
  moved: boolean;
}

/** What plot() can draw: numbers (plotted against 0, 1, 2, ...), [x, y] pairs, {x, y} points, or a function of x. */
type PlotSeries = number[] | number[][] | Array<[number, number]> | Array<{ x: number; y: number }> | ((x: number) => number);
type PlotData = PlotSeries | Record<string, PlotSeries>;
interface PlotOptions {
  /** A title above the picture. */
  title?: string;
  /** A label under the x axis. */
  xLabel?: string;
  /** A label beside the y axis. */
  yLabel?: string;
  /** For a function: the first and last x (default -10 and 10). */
  from?: number;
  /** For a function: the last x to calculate (default 10). */
  to?: number;
  /** For a function: how many points to calculate (default 200). */
  steps?: number;
  /** Draw a dot on every point. */
  dots?: boolean;
  /** Line colour (one series only). */
  color?: string;
  /** Fix the edges of the picture, so an animation does not jump around. Left out: the edge follows the data. */
  xMin?: number;
  /** Fix the right edge of the picture. */
  xMax?: number;
  /** Fix the bottom edge of the picture. */
  yMin?: number;
  /** Fix the top edge of the picture. */
  yMax?: number;
  /** false: draw only the lines (no numbers, grid or legend). */
  axes?: boolean;
}

/** One spreadsheet cell, addressed like A1, C7 or M14. */
interface CellRef {
  /** The cell's address in its tab, like 'A12'. */
  readonly address: string;
  /** The tab this cell is in: 'board' or 'lab'. */
  readonly tab: string;
  /** The cell's absolute path, e.g. '/lab/J24'. Works from every tab. */
  readonly path: string;
  /** The identity of the code in this cell (null when empty). It stays when the cell moves: at('@' + uid) finds it again. */
  readonly uid: string | null;
  /** The column number, counting from 0 (A is 0, B is 1 ...). */
  readonly col: number;
  /** The row number, counting from 0 (row 1 is 0). */
  readonly row: number;
  /** Text currently shown in the cell (output, or code in view mode). */
  readonly text: string;
  /** Source code of the cell, if any. */
  readonly code: string;
  /** Piece standing on this square (board cells A1:J10 only). */
  readonly piece: PieceInfo | null;
  /** true for the squares of the game board (A1:J10). */
  readonly isBoard: boolean;
  /** true for the lake squares of the board, where no piece can stand. */
  readonly isLake: boolean;
  /** Append a line of text to this cell (shown in run mode). The newest lines stay in view; the wheel winds back. '\x1b[2J' or '\x1b[H' in the text starts again at the top. */
  print(...values: unknown[]): CellRef;
  /** Replace the text shown in view mode (default: the code itself). */
  view(text: string): CellRef;
  /** Background colour, e.g. '#ffd6d6' or 'lightgreen'. */
  color(fill: string): CellRef;
  /** Print this cell's text like an old teletype on a roll of paper: a TTY font (the font is only ink), plain unyellowed roll paper as the cell's own fill, and the newest lines at the bottom; when the text is longer than the cell the mouse wheel winds the paper back. The paper has a faint grain and the text is typed at the pace of the real machine: 10 characters a second, a line feed takes two (speed: 0 shows it at once). A print head (a pale block) shows the column where the next letter is struck. A newline is carriage return and line feed in one; \\r is a carriage return alone (the head goes back to the left margin and what follows strikes over the old text), \\b moves the head one column back, \\v (or \\f) feeds the paper one line and keeps the column. A small speaker in the cell's corner switches the ASR-33 sound on (it is off until somebody clicks it). The ink gets paler the more lines are printed (clear() makes it fresh). paper({font:'tty33'|'tty28'|'tty35', tint:'#f5f4ef', wear:0..1, speed:10}); paper(false) turns it off. Like color(), call it in the code that prints. */
  paper(options?: { font?: 'tty33' | 'tty28' | 'tty35'; tint?: string; wear?: number; speed?: number } | boolean): CellRef;
  /** The teletype paper types everything that is still waiting at once and goes quiet (what Ctrl-C does to a long printout). */
  skipPaper(): CellRef;
  /** Text colour. */
  textColor(color: string): CellRef;
  /** The size this cell wants by default: merge it over cols x rows neighbours (not over the board). Leave one out to keep it. No arguments: just read the size. If the person resizes the block (green handles) or makes it from picked cells, their size is kept and a plain "span(4, 2)" line is rewritten to match; change the numbers in the code and the code's size wins again. With no span() at all the block keeps the shape it has (1x1 for a new cell). */
  span(cols?: number, rows?: number): { cols: number; rows: number };
  /** How many columns / rows this cell covers now. Reading them makes your cell re-run when this cell is resized. */
  readonly cols: number;
  /** How many rows this cell covers now (see cols). */
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
  /** Colour the background of every cell in the range. */
  color(fill: string): CellRange;
  /** Print the same line in every cell of the range. */
  print(...values: unknown[]): CellRange;
}

interface MoveInfo {
  /** The square the piece started on, like 'B7'. */
  from: string;
  /** The square it moved to. */
  to: string;
  /** Who moved. */
  color: 'red' | 'blue';
  /** The name of the piece that moved. */
  piece: string;
  /** The name of the piece that was attacked, or null when it was a plain move. */
  defender: string | null;
  /** A fight from the attacker's side: 'win', 'lose' or 'draw' (both pieces go); null when there was no fight. */
  outcome: 'win' | 'lose' | 'draw' | null;
  /** true when this move captured the flag, which ends the game. */
  flagCaptured: boolean;
}

interface GameApi {
  /** 'setup' while the armies are arranged, 'play' during the battle, 'over' when somebody won. */
  readonly phase: 'setup' | 'play' | 'over';
  /** Whose turn it is. */
  readonly turn: 'red' | 'blue';
  /** Who won, or null while the game goes on. */
  readonly winner: 'red' | 'blue' | null;
  /** How many moves have been played. */
  readonly moveCount: number;
  /** The latest move (see MoveInfo), or null before the first one. Swaps made while arranging the army are not moves. */
  readonly lastMove: MoveInfo | null;
  /** Every move of the battle so far, oldest first. */
  readonly history: MoveInfo[];
  /** All pieces still on the board (optionally one colour). */
  pieces(color?: 'red' | 'blue'): Array<PieceInfo & { address: string }>;
  /** Pieces that have been captured, per colour. */
  captured(color: 'red' | 'blue'): PieceInfo[];
  /** Piece on a square. peek:true shows hidden Blue ranks (cheating, but handy for bots). */
  pieceAt(address: string, options?: { peek?: boolean }): PieceInfo | null;
  /** true while pieces are still moving on the screen: a move made now would be refused. */
  readonly busy: boolean;
  /** Who makes Blue's moves: 'builtin' (the player that comes with the page) or 'virtual' (code has taken Blue over, see takeOverBlue). */
  readonly bluePlayer: 'builtin' | 'virtual';
  /** Legal moves for one square or for a whole colour ('red' or 'blue'). */
  legalMoves(addressOrColor: string): Array<{ from: string; to: string }>;
  /** Move a piece of that colour (default 'red'), only during that colour's turn. Blue only moves after takeOverBlue(). Returns a message; it starts with "Moving" when the move was made. */
  move(from: string, to: string, color?: 'red' | 'blue'): string;
  /** Play Blue from code: the built-in Blue player keeps quiet and game.move(from, to, 'blue') makes Blue's moves, so two virtual players can play each other. Blue goes back to the built-in player by itself when this cell stops, is edited or runs again (or call giveBackBlue()). */
  takeOverBlue(): void;
  /** Hand Blue back to the built-in player. */
  giveBackBlue(): void;
  /** Show a message in the game bubble. */
  say(text: string): void;
}

/** One tile in a block's grid. Tiles have their own coordinates (x across, y down, from 0) and no sheet address. */
interface Tile {
  /** The tile's column inside its block's grid, counting from 0. */
  readonly x: number;
  /** The tile's row inside its block's grid, counting from 0. */
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
  /** The colour of the tile's text, or null for the default dark. */
  readonly textColor: string | null;
  /** true when the tile's text is bold. */
  readonly isBold: boolean;
  /** Colour the tile's text; ink(null) makes it dark again. */
  ink(color: string | null): Tile;
  /** Bold text on the tile (bold(false) turns it off). */
  bold(on?: boolean): Tile;
  /** Blank this tile: no colour, no text, default ink. */
  clear(): Tile;
}

/** What g.text(...) understands. */
interface TextOptions {
  /** How many tiles wide the line is (it is clipped there). Default: to the end of the row. */
  w?: number;
  /** Colour the tiles under the line. */
  fill?: string | null;
  /** The text colour. */
  ink?: string | null;
  /** Bold letters. */
  bold?: boolean;
  /** Where the text sits in its stretch of tiles (flowing text only). Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /** One letter in every tile, in a monospace font: a terminal. Without it the text flows smoothly across the tiles. */
  snap?: boolean;
  /** A monospace font for flowing text (snap always has one). */
  mono?: boolean;
  /** The letters' height as a fraction of a tile's height (default 0.62, or 0.8 with snap). */
  size?: number;
}

/** What the keyboard tells about a key while a grid has it. */
interface GridKeyInfo {
  /** true while Shift is held. */
  shift: boolean;
  /** true while Ctrl (or Cmd) is held. The browser keeps keys like Ctrl+R for itself. */
  ctrl: boolean;
  /** true while Alt is held. */
  alt: boolean;
  /** True while the key is held down and repeating. */
  repeat: boolean;
}

/** The tiles inside this cell's block. */
interface Grid {
  /** How many tiles there are across. */
  readonly cols: number;
  /** How many tiles there are down. */
  readonly rows: number;
  /** The address of the block this grid lives in, like 'A16'. */
  readonly address: string;
  /** The tile in column x, row y (both start at 0). */
  at(x: number, y: number): Tile;
  /** Run fn for every tile, row by row. */
  each(fn: (tile: Tile) => void): Grid;
  /** Colour every tile in one pass: g.paint((x, y) => alive(x, y) ? 'green' : null). */
  paint(fn: (x: number, y: number) => string | null | undefined): Grid;
  /** Colour every tile the same (null blanks them). */
  fill(color: string | null): Grid;
  /** Colour a rectangle of tiles: x, y is its top-left tile, w and h are its size in tiles (null blanks them). */
  box(x: number, y: number, w: number, h: number, color: string | null): Grid;
  /**
   * One line of text over a stretch of tiles, starting at tile x, y. Flowing text (the default) is smooth and may be
   * wider than a tile; with { snap: true } every letter sits in its own tile, in a monospace font, so a grid of
   * 80 by 20 tiles is a terminal of 80 letters by 20 lines. Text with the same x, y replaces the earlier line; '' removes it.
   * g.text(1, 0, 'Hello', { ink: 'white', fill: '#234', bold: true })
   * g.text(0, 3, '> ' + typed, { snap: true, ink: '#7ee787' })
   */
  text(x: number, y: number, text: unknown, options?: TextOptions): Grid;
  /** Blank every tile and remove their text, colours and lines of text. */
  clear(): Grid;
  /** The grid takes the keyboard (typing, Backspace, Enter, arrows ...): on(g, 'key', ...) hears them. A click anywhere else takes the keyboard away again, so call this from a click handler. */
  focus(): Grid;
  /** The grid lets go of the keyboard. */
  blur(): Grid;
  /** true while the grid has the keyboard. */
  readonly focused: boolean;
}

/** One message that crossed the page's MCP router. */
interface McpMessage {
  /** A running number, in the order the messages crossed the router. */
  n: number;
  /** Milliseconds since the page started. */
  time: number;
  /** The moment of the initiative that started the chain this message belongs to: Unix time in milliseconds (Date.now()); the same for every message of a chain, answers included. */
  startedAt: number;
  /** The moment this message was sent (Unix ms), and the moment by which the asker stops waiting for the answer (Unix ms). */
  sentAt: number;
  /** The moment (Unix ms) after which an unanswered request becomes a timeout error. */
  deadline: number;
  /** Who sent it: a cell like 'board:A15', a tab like 'lab', or 'ai'. */
  from: string;
  /** Who receives it: a tab like 'lab', a server like 'weather', or a cell. */
  to: string;
  /** 'request' (a question), 'response' (its answer), 'error' (a failed answer) or 'notification' (news that needs no answer). */
  kind: 'request' | 'response' | 'error' | 'notification';
  /** What is asked, like 'tools/call' or 'resources/read'. */
  method: string;
  /** The parameters or the answer, shortened to one line. */
  detail: string;
  /** How long an answer took, in milliseconds. */
  ms?: number;
  /** The id of this message (unique across pages), who started the chain it belongs to, and the message that caused it (null at the start). */
  id: string;
  /** Who started the chain this message belongs to. */
  origin: string;
  /** The id of the message that made this one happen, or null at the start of a chain. */
  cause: string | null;
  /** The way it went, from the one who started it to the receiver: ['you', 'ai-chat', 'router', 'board']. */
  hops: string[];
}

/** A message as the traffic analyser sees it: a McpMessage with a type (the kind of traffic), who asked whom, and the tool. */
interface McpPacket {
  /** A running number, in the order the messages crossed the router. */
  n: number;
  /** The id of the message (unique across pages). */
  id: string;
  /** Milliseconds since the page started. */
  time: number;
  /** The moment of the initiative (Unix time in milliseconds), see McpMessage. */
  startedAt: number;
  /** Who started the chain this message belongs to. */
  origin: string;
  /** Who sent it. */
  from: string;
  /** Who receives it. */
  to: string;
  /** Who asked: for an answer that is the receiver. */
  asker: string;
  /** Who was asked: for an answer that is the sender. */
  asked: string;
  /** 'request', 'response', 'error' or 'notification'. */
  kind: 'request' | 'response' | 'error' | 'notification';
  /** What is asked, like 'tools/call'. */
  method: string;
  /** The kind of traffic: heartbeat (the regular I am alive), discovery (what do you have), read, subscribe, news, signal, tool (a tool call), change (a cell was changed) or other. */
  type: 'heartbeat' | 'discovery' | 'read' | 'subscribe' | 'news' | 'signal' | 'tool' | 'change' | 'other';
  /** The tool of a tools/call (also on its answer), or ''. */
  tool: string;
  /** The parameters or the answer, shortened to one line. */
  info: string;
  /** How long an answer took, in milliseconds. */
  ms?: number;
  /** The id of the message that made this one happen, or null. */
  cause: string | null;
}

/** An outside AI that called in, as far as the page knows. Its messages have the origin outside-ai:<client>@<model>. */
interface McpCaller {
  /** The name this caller's messages carry as their origin. */
  origin: string;
  /** The program (clientInfo.name, X-MCP-Client, or the HTTP user agent). */
  client?: string;
  /** The version of the program, when it said. */
  version?: string;
  /** The AI model behind it, when it said (X-MCP-Model, _meta.model, clientInfo.model, or the introduce tool). */
  model?: string;
  /** The name of the agent, when it said. */
  agent?: string;
  /** The MCP protocol version it speaks. */
  protocol?: string;
  /** A note the caller left about itself (the introduce tool). */
  note?: string;
  /** How it came in: 'mcp-bridge' (the dev server's /mcp) or 'webmcp'. */
  via: string;
  /** How many calls it has made. */
  calls: number;
  /** When its first call came in (Unix ms). */
  first: number;
  /** When its latest call came in (Unix ms). */
  last: number;
}

/** A request that was sent and has no answer yet (mcp.pending()). */
interface McpPending {
  /** The id of the request. */
  id: string;
  /** Who asked. */
  from: string;
  /** Who was asked. */
  to: string;
  /** What is asked: 'tools/call forecast'. */
  what: string;
  /** Who started the chain the request belongs to. */
  origin: string;
  /** Unix ms: the initiative, this request's sending, and the deadline after which it is an error (-32001). */
  startedAt: number;
  /** When this request was sent (Unix ms). */
  sentAt: number;
  /** When it becomes a timeout error (Unix ms). */
  deadline: number;
  /** How long it has been waiting. */
  elapsedMs: number;
  /** How long until the deadline. */
  remainingMs: number;
  /** How many "still working" progress notifications it has had. */
  acknowledged: number;
  /** How much longer it is worth waiting: wait waitMs and p (0 to 1) of the similar earlier answers were in by then. History, not a promise; null when there is too little of it. */
  waitMs: number | null;
  /** How likely it is that an answer is in by waitMs, from 0 to 1 (null when there is too little history). */
  p: number | null;
  /** How many earlier similar answers this guess is based on. */
  basis: number;
  /** How long similar requests usually took, or null. */
  typicalMs: number | null;
}

/** What mcp.analyze() found. */
interface McpAnalysis {
  /** The filter that was analysed: give it to mcp.packets() to see the messages. */
  filter: string;
  /** How many messages were looked at. */
  scanned: number;
  /** How many of them matched the filter. */
  matched: number;
  /** How many seconds of traffic the matching messages span. */
  seconds: number;
  /** The traffic split by type, with each type's share (0 to 1) and what it means. */
  byType: Array<{ type: string; count: number; share: number; meaning: string }>;
  /** How many requests, responses, errors and notifications there were. */
  byKind: Record<string, number>;
  /** Who talked to whom: messages, errors, average answer time, and the types of traffic. */
  conversations: Array<{ asker: string; asked: string; messages: number; errors: number; avgMs: number; types: string[] }>;
  /** Every party with how many times it asked and how many times it answered. */
  talkers: Array<{ party: string; asked: number; answered: number }>;
  /** The slowest answers. */
  slowest: Array<{ id: string; asker: string; asked: string; method: string; tool: string; ms: number }>;
  /** The requests that failed. */
  errors: Array<{ id: string; asker: string; asked: string; method: string; info: string }>;
  /** The result in plain sentences. */
  story: string[];
}

/** What mcp.ask() answers. */
interface McpAnswer {
  /** The question as it was asked. */
  question: string;
  /** The answer in plain words. */
  answer: string;
  /** The filter behind the answer: give it to mcp.packets() to see the messages. */
  filter: string;
  /** The messages the answer is based on. */
  packets: McpPacket[];
  /** false when the question was not one it knows (the answer then lists what it can do). */
  understood: boolean;
}

/** One recorded change made over MCP: who, through which message, and the code before and after. */
interface McpChange {
  /** A running number of the recorded changes. */
  n: number;
  /** When it happened, as readable text. */
  at: string;
  /** The moment of the initiative that led to the change: Unix time in milliseconds. */
  startedAt: number;
  /** What changed: 'lab/J24'. */
  subject: string;
  /** The tool that did it, like 'set_code'. */
  action: string;
  /** Who started the chain (a cell, 'you', 'ai-chat', 'outside-ai:...'), the parties it passed through, and the message that carried it. */
  by: string;
  /** The parties the request passed through, in order. */
  lineage: string[];
  /** The id of the message that carried the change. */
  msg: string;
  /** The id of the message that caused that one, or null. */
  cause: string | null;
  /** A short fingerprint of the code before the change. */
  beforeHash: string;
  /** A short fingerprint of the code after the change. */
  afterHash: string;
  /** The code before and after (shortened to 4000 characters): put "before" back to undo it. */
  before?: string;
  /** The code after the change (shortened to 4000 characters). */
  after?: string;
}

/** A cell of any tab as a plain object, read over MCP. */
interface McpCell {
  /** The tab the cell is in. */
  tab: string;
  /** The cell's address in its tab. */
  address: string;
  /** The cell's absolute path, like '/lab/J24'. */
  path: string;
  /** The identity of the code (stays when the cell moves), or null when empty. */
  uid: string | null;
  /** The cell's source code. */
  code: string;
  /** The text the cell shows. */
  text: string;
  /** The lines the cell printed. */
  output: string[];
  /** The error message, or null when it ran well. */
  error: string | null;
  /** How many columns the block covers. */
  cols: number;
  /** How many rows the block covers. */
  rows: number;
  /** The size of the tile grid in the block and how many tiles are coloured, or null when it has no grid. */
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
  /** Ask a tab to do something. Tools: list_cells, get_cell, run_cell, set_code, click, insert_column, flash, zoom, signal. */
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
  /** How many messages crossed the router. */
  messages: number;
  /** How many of them were requests. */
  requests: number;
  /** How many of them were errors. */
  errors: number;
  /** How many of them were notifications. */
  notifications: number;
  /** Messages per second, averaged over the last 10 seconds. */
  ratePerSecond: number;
  /** Messages in each of the last 60 seconds, oldest first: ready for plot(). */
  perSecond: number[];
  /** How many servers (tabs and services) can be asked. */
  serverCount: number;
  /** How many parties listen for notifications. */
  listeners: number;
  /** Who was asked, busiest first. */
  servers: Array<{ name: string; requests: number; errors: number; avgMs: number; maxMs: number }>;
  /** Who asked (a cell like 'lab:A16', 'ai-chat' ...), busiest first. */
  clients: Array<{ name: string; requests: number; errors: number }>;
  /** What was asked, busiest first. */
  methods: Array<{ method: string; count: number; errors: number; avgMs: number }>;
  /** The slowest answer so far, or null. */
  slowest: { to: string; method: string; ms: number } | null;
}

interface McpCatalogEntry {
  /** The server's name, like 'weather' or 'lab'. */
  server: string;
  /** What the server is for. */
  description: string;
  /** The tools it offers, each with a description. */
  tools: Array<{ name: string; description: string }>;
  /** How many resources (cells) it offers, or null when it has none to count. */
  resources: number | null;
}

/** A place on Earth. */
interface WeatherPlace {
  /** The name of the place. */
  name: string;
  /** The country. */
  country: string;
  /** The region or state. */
  region: string;
  /** Latitude in degrees (north is positive). */
  lat: number;
  /** Longitude in degrees (east is positive). */
  lon: number;
  /** The time zone, like 'Europe/Amsterdam'. */
  timezone: string;
}

interface WeatherNow {
  /** Local time at the place, e.g. '2026-10-13T08:30'. */
  time: string;
  /** °C */
  temperature: number;
  /** How warm it feels, in °C, with the wind and the humidity counted in. */
  feelsLike: number;
  /** % */
  humidity: number;
  /** km/h */
  wind: number;
  /** The direction the wind comes from, in degrees (0 is north, 90 east). */
  windDegrees: number;
  /** Compass point the wind comes from: 'N', 'NE', ... */
  windFrom: string;
  /** mm in the last hour */
  rain: number;
  /** % of the sky covered */
  clouds: number;
  /** true in the daytime, false at night. */
  isDay: boolean;
  /** WMO weather code, with a short text ('Light rain') and an emoji ('🌧'). */
  code: number;
  /** A short description like 'Light rain'. */
  text: string;
  /** An emoji for the weather, like a rain cloud. */
  icon: string;
}

interface WeatherDay {
  /** The day, like '2026-10-13'. */
  date: string;
  /** The lowest temperature of the day, in °C. */
  min: number;
  /** The highest temperature of the day, in °C. */
  max: number;
  /** How much rain falls in the day, in mm. */
  rain: number;
  /** The chance of rain in percent, or null when it is not known. */
  rainChance: number | null;
  /** The strongest wind of the day, in km/h. */
  wind: number;
  /** The highest UV index of the day. */
  uv: number;
  /** When the sun comes up (local time). */
  sunrise: string;
  /** When the sun goes down (local time). */
  sunset: string;
  /** The WMO weather code. */
  code: number;
  /** A short description like 'Light rain'. */
  text: string;
  /** An emoji for the weather. */
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
  /** The weather right now at a place: await weather.now('Amsterdam'). */
  now(place: WeatherPlaceInput): Promise<WeatherNow & { place: WeatherPlace }>;
  /** The weather now and for the coming days (default 7): await weather.forecast('Paris, France', 5). */
  forecast(place: WeatherPlaceInput, days?: number): Promise<{ place: WeatherPlace; now: WeatherNow; days: WeatherDay[] }>;
  /** Looks up places by name: await weather.find('Paris', 5) gives up to 5 matches with their coordinates. */
  find(query: string, count?: number): Promise<WeatherPlace[]>;
  /** One sentence for print(): '🌧 Rain, 11°C (feels 9°C), wind 14 km/h from SW, humidity 88%'. */
  text(place: WeatherPlaceInput): Promise<string>;
}

interface SystemInfo {
  /** 'dev-server' when the dev server measured it (real load and temperatures), 'browser' on the published page (only what the browser tells; the rest is null). */
  source: 'dev-server' | 'browser';
  /** When it was measured (Unix ms). */
  time: number;
  /** The processor: load in percent, number of cores, model name, temperature (null when not known). */
  cpu: { load: number | null; cores: number; model: string; temp: number | null };
  /** Memory in use and in total, in MB, or null when not known. */
  memory: { totalMb: number | null; usedMb: number | null } | null;
  /** The graphics card: name, load, temperature, memory, power and fan, or null when there is none. */
  gpu: { name: string; load: number | null; temp: number | null; memUsedMb: number | null; memTotalMb: number | null; powerW: number | null; fanPercent: number | null } | null;
  /** All the temperature sensors, in °C. */
  temps: { name: string; celsius: number }[];
  /** The system load over the last 1, 5 and 15 minutes. */
  loadAverage: number[];
  /** How long the computer has been on, in seconds, or null. */
  uptimeSeconds: number | null;
  /** What the browser knows: frames per second, memory it uses, online or not, network type, battery level and charging. */
  browser: { fps: number | null; heapMb: number | null; online: boolean; network: string | null; battery: number | null; charging: boolean | null };
}

/**
 * How this computer is doing: CPU load, memory, temperatures, the graphics card.
 * Measured when the dev server runs; on the published page only browser facts (cores, fps, battery) are there.
 * every('1s', async () => { const s = await system.read(); plot(system.series('cpu')) })
 */
interface TeletypeApi {
  /** One key of the teletype clacks, softly. Give the letter you print and that letter always sounds the same, a little different from the others (like the AI chat's keys). The motor starts and keeps running for a while (8 s). Does nothing when the speaker is muted or sound is not allowed yet (a click on the cell allows it). */
  key(char?: string): void;
  /** The carriage return at the end of a line. */
  cr(): void;
  /** The machine prints one letter, with the real recorded sound of an ASR-33: the motor hums, the print head chatters while letters come (spaces are quieter), and "\n" is the carriage return. Letters wait in a queue, because the real machine printed 10 a second at most; the motor stops by itself a few seconds after the last letter. Does nothing when muted. */
  print(char: string): void;
  /** The bell, once, softly. */
  bell(): void;
}
interface SystemApi {
  /** Measures now: await system.read(). */
  read(): Promise<SystemInfo>;
  /** The last readings of one value, oldest first, ready for plot(). Fills while somebody calls read(). */
  series(name: 'cpu' | 'cpuTemp' | 'gpu' | 'gpuTemp' | 'memory' | 'fps', count?: number): number[];
  /** One line for print(): 'CPU 31% 57°C, memory 24%, GPU 27% 28°C'. */
  text(): Promise<string>;
}

interface TabInfo {
  /** The tab's id, used in paths like /plots/A1. */
  id: string;
  /** The name on the tab. */
  title: string;
  /** The emoji on the tab. */
  icon: string;
  /** The page's own tabs (board, lab, examples, monitor) cannot be renamed or closed. */
  builtin: boolean;
  /** true for the tab on show. */
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
  /** All the tabs, built-in ones included. */
  list(): TabInfo[];
  /** A new tab every time it runs. Prefer ensure() in a cell that can run again. */
  create(title: string, options?: CreateTabOptions): TabInfo;
  /** Makes the tab with this id if it is not there yet, and returns it. Safe to run again. */
  ensure(id: string, title?: string, options?: Omit<CreateTabOptions, 'id'>): TabInfo;
  /** Gives a tab a new title. */
  rename(id: string, title: string): TabInfo;
  /** Closes a tab you made and throws away its cells (the built-in tabs cannot be closed). */
  close(id: string): { closed: string; cells: number };
  /** Brings a tab to the front. */
  select(id: string): TabInfo;
}

interface OllamaStatus {
  /** Something answers at the address from the helper settings (default localhost:11434). */
  running: boolean;
  /** true when the server that answers really is Ollama. */
  isOllama: boolean;
  /** The address of the server. */
  server: string;
  /** The server's version, or null when it did not say. */
  version: string | null;
  /** Installed models, and the ones that are in memory right now. */
  models: string[];
  /** The models that are in memory now. */
  loaded: string[];
  /** One line per model in memory: size, share on the GPU, window, how long it stays. */
  memory: string[];
  /** The model that ask() will use. */
  selected: string;
  /** ask() can work. */
  ready: boolean;
  /** What is wrong and what to do about it, or a short "Ready". */
  message: string;
}

interface OllamaModel {
  /** The model's name, like 'qwen3:8b'. */
  name: string;
  /** How big the model is, in GB. */
  sizeGB: number;
  /** The family it belongs to. */
  family: string;
  /** How many parameters it has, like '8B'. */
  parameters: string;
  /** How compressed it is, like 'Q4_K_M'. */
  quantization: string;
  /** true while the model is in memory. */
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
  /** The installed models. */
  models(): Promise<OllamaModel[]>;
  /** Asks the model one question and returns its answer as text: print(await ollama.ask('Say hi')). */
  ask(prompt: string, options?: OllamaOptions): Promise<string>;
  /** Sends a whole conversation (a list of messages from the user and the assistant) and returns the next answer. */
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
 * const give = input.claimKeys(() => print('keys lost'))         a terminal takes Enter, Delete, Space, the letters and Ctrl-C / Ctrl-D for itself
 */
interface InputApi {
  /** Shows a question card with a text box and returns what the person typed, or null when they cancelled: const name = await input.ask('Your name?'). */
  ask(question: string, initial?: string): Promise<string | null>;
  /** Shows a yes or no question and returns true or false. */
  confirm(question: string): Promise<boolean>;
  /** Shows a question with buttons, one per option, and returns the one that was picked (null when cancelled). */
  choose(question: string, options: string[]): Promise<string | null>;
  /** A slider in the Inputs panel. fn(value) runs whenever it moves. The control keeps its value when the cell runs again. */
  slider(label: string, options?: { min?: number; max?: number; step?: number; value?: number }, fn?: (value: number) => unknown): InputControl<number>;
  /** A number box in the Inputs panel; fn(value) runs when it changes. */
  number(label: string, value?: number, fn?: (value: number) => unknown): InputControl<number>;
  /** A text box in the Inputs panel; fn(value) runs when it changes. */
  text(label: string, value?: string, fn?: (value: string) => unknown): InputControl<string>;
  /** A tick box in the Inputs panel; fn(true or false) runs when it changes. */
  checkbox(label: string, value?: boolean, fn?: (value: boolean) => unknown): InputControl<boolean>;
  /** A drop-down list in the Inputs panel; fn(value) runs when another option is chosen. */
  select(label: string, options: string[], fn?: (value: string) => unknown): InputControl<string>;
  /** A button in the Inputs panel; fn() runs when it is pressed. */
  button(label: string, fn: () => unknown): InputControl<undefined>;
  /** fn(key, { shift, ctrl, alt, repeat, text }): keys are named 'a', 'ArrowLeft', 'Enter', 'Space'; text is the typed character with its case ('A' with Caps Lock). Returns a stop function. */
  onKey(fn: (key: string, info: { shift: boolean; ctrl: boolean; alt: boolean; repeat: boolean; text: string }) => unknown): () => void;
  /** fn(text) runs when text is pasted into this cell's input: the cell menu's Paste item sends the clipboard here (not into the code) for a cell that has this, like a terminal. Returns a stop function. */
  onPaste(fn: (text: string) => unknown): () => void;
  /** Takes the typing keys for this cell, like a terminal: Enter, Delete, Space, arrows and letters stop reaching the sheet's shortcuts (Enter no longer opens the editor). A click anywhere takes them away and calls lost(), unless { steady: true } (the cell holds them while the mouse is over it and lets go itself, on(cell, 'leave', ...)). Shift+Enter stays the sheet's. Returns a function that gives them back. Use it together with onKey. */
  claimKeys(lost?: () => unknown, options?: { steady?: boolean }): () => void;
  /** Is this key held down right now? */
  isDown(key: string): boolean;
}

interface SheetApi {
  /** 'run' or 'view'. Reading it makes the cell re-run when the mode changes. */
  readonly mode: 'run' | 'view';
  /** Another cell by address or path (the same as at()). */
  cell(address: string): CellRef;
  /** A range of cells (the same as range()). */
  range(text: string): CellRange;
  /** How many columns the sheet has. */
  readonly cols: number;
  /** How many rows the sheet has. Reading it makes your cell run again when a row is inserted. */
  readonly rows: number;
}

/** The cell this code lives in. */
declare const cell: CellRef;
/**
 * Short for cell.print(...). Each call adds a line; when there are more lines than the cell is tall, the newest stay in view and the mouse wheel
 * winds back to the older ones. Start again at the top with print.top('first line'), or put the terminal codes in the text:
 * print('\x1b[2J\x1b[H' + 'a new page') (clear screen + home; '\x1b[H' alone and '\x1bc' do the same). Other escape codes (colours) are removed.
 */
declare function print(...values: unknown[]): void;
declare namespace print {
  /** Drops everything printed so far and prints these values at the top, like clear + print (show() does the same with one line). */
  function top(...values: unknown[]): void;
}
/** Short for cell.view(text) */
declare function view(text: string): void;
/** Short for cell.color(fill) */
declare function color(fill: string): void;
/** Short for cell.paper(options): print this cell's text like a teletype on old paper (fonts 'tty33', 'tty28', 'tty35'; wear 0..1 grows with the lines printed; speed in characters a second, default 10, 0 = at once). */
declare function paper(options?: { font?: 'tty33' | 'tty28' | 'tty35'; tint?: string; wear?: number; speed?: number } | boolean): void;
/** Short for cell.skipPaper(): the teletype paper types all that is waiting at once. */
declare function skipPaper(): void;
/** Short for cell.span(cols, rows): the size this cell wants by default. span(4) keeps the rows; span() just returns the current size. A size the person gave the block by hand wins until you change these numbers. */
declare function span(cols?: number, rows?: number): { cols: number; rows: number };
/**
 * Give this cell's block a grid of tiles, whatever its size: span(4, 2) then grid(10, 8) makes 80 tiles that fill the block.
 * Tiles are addressed inside the block (x across, y down, from 0), so the code keeps working when the block moves.
 * const g = grid(10, 8)
 * g.at(3, 4).color('green')                 paint one tile
 * g.paint((x, y) => (x + y) % 2 ? '#333' : '#eee')   paint them all
 * on(g, 'click', (tile) => tile.color('red'))          which tile was clicked
 * g.text(0, 0, 'Hi', { snap: true })   g.box(0, 0, 5, 2, 'navy')   lines of text and rectangles; grid(80, 20, { lines: false }) has no seams
 * on(g, 'click', () => g.focus())   on(g, 'key', (key) => ...)    a grid that takes the keyboard: a terminal, a text field
 * Other cells reach a tile by its path: at('A16/3,4').fill
 */
declare function grid(cols: number, rows?: number, options?: { lines?: boolean }): Grid;
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
type CellEventName = 'change' | 'size' | 'code' | 'click' | 'enter' | 'leave';
/**
 * Watch something: fn runs after it happens. Returns a stop function. Stops by itself when the cell runs again.
 * on('B7', (b7) => ...)            B7's text or piece changed
 * on('B7', 'size', (b7) => ...)    B7 was merged or resized (b7.cols, b7.rows)
 * on('B7', 'code', (b7) => ...)    someone edited B7's code, or moved code in or out of it
 * on('B7', 'enter', (b7) => ...)   the mouse came over B7 ('leave': it went off again)
 * on('B7', 'click', (b7) => ...)   B7 was clicked (a range works too: on('A20:C20', 'click', ...))
 * on('game', (g) => ...)           anything in the game changed
 * on('sheet', 'rows', (s) => ...)  a row was inserted      on('sheet', 'cols', (s) => ...)  a column was inserted      on('sheet', 'mode', (s) => ...)  Show code / Show output was pressed
 */
declare function on(target: string | CellRef, fn: (changed: CellRef) => unknown): () => void;
declare function on(target: string | CellRef, event: CellEventName, fn: (changed: CellRef) => unknown): () => void;
declare function on(target: Grid, event: 'click', fn: (tile: Tile) => unknown): () => void;
/** A key typed while the grid has the keyboard (g.focus()): 'a', 'A', 'Enter', 'Backspace', 'ArrowUp', 'Escape' ... Every key arrives, none is skipped. */
declare function on(target: Grid, event: 'key', fn: (key: string, info: GridKeyInfo) => unknown): () => void;
/** The grid got or lost the keyboard (a click elsewhere takes it away). */
declare function on(target: Grid, event: 'focus' | 'blur', fn: () => unknown): () => void;
declare function on(target: 'game', fn: (game: GameApi) => unknown): () => void;
declare function on(target: 'sheet', event: 'rows' | 'cols' | 'mode', fn: (sheet: SheetApi) => unknown): () => void;
/** How an animation moves: linear, in (slow start), out (slow end), inOut (the default), bounce, elastic, back. */
type SvgEase = 'linear' | 'in' | 'out' | 'inOut' | 'bounce' | 'elastic' | 'back';
interface SvgAnimateOptions {
  /** How long one play takes: 500, '500ms' or '2s'. Default 500 ms. */
  time?: number | string;
  /** How the movement speeds up and slows down. */
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
  /** Ends the animation early, where it is. */
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
  /** Sets the part's fill colour. */
  fill(color: string): SvgEl;
  /** Sets the colour (and optionally the width) of the part's outline. */
  stroke(color: string, width?: number): SvgEl;
  /** How see-through the part is: 1 is solid, 0 is invisible. */
  opacity(value: number): SvgEl;
  /** Makes the part visible again. */
  show(): SvgEl;
  /** Hides the part. */
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
  /** Takes the part out of the drawing. */
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
  /** The height of one frame, in pixels. */
  readonly height: number;
  /** How many frames the picture has. */
  readonly frameCount: number;
  /** How long each frame shows, in milliseconds. */
  readonly durations: readonly number[];
  /** The frame that is showing now (0 is the first), and whether it is playing. */
  readonly frame: number;
  /** true while it is playing. */
  readonly playing: boolean;
  /** Length of one run in milliseconds, and where in it we are. */
  readonly duration: number;
  /** Where in the run we are, in milliseconds. */
  readonly time: number;
  /** true: start again at the end (the default). false: stop at the last frame. */
  loop: boolean;
  /** 1 is the speed of the file; 2 twice as fast, 0.5 half, -1 backwards. */
  speed: number;
  /** The canvas that holds the current frame (with its transparency). */
  readonly canvas: HTMLCanvasElement;
  /** Starts playing. */
  play(): AnimClip;
  /** Pauses on the current frame. */
  pause(): AnimClip;
  /** Plays when paused, pauses when playing. */
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
/**
 * The sounds of an ASR-33 teletype, as quiet as in the AI chat (same speaker button). A printing cell calls teletype.print(letter) for
 * every letter (and teletype.print('\n') at the end of a line); teletype.key(letter) is a single key of the keyboard; the real machine printed about 10 letters a second.
 */
declare const teletype: TeletypeApi;
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
declare function at(path: \`\${string},\${number}\`): Tile;
/**
 * Another cell by address or by path. A plain address is a cell of this tab: at('A1').
 * A path starting with / names a tab first, so it works from anywhere: at('/lab/J24'), at('/board/A12').
 * @c-1a2b3c4d is a cell's identity, which stays with its code when it moves. Cells of another tab can be read
 * (and this cell runs again when they change) but only their own tab's code can change them.
 */
declare function at(address: string): CellRef;
/** A range of cells, e.g. range('A1:J10') or range('C32-55') */
declare function range(text: string): CellRange;
/** The sheet this cell lives in: its mode (run or view), its columns and rows, and cell() and range() to reach other cells. */
declare const sheet: SheetApi;
/** The game: whose turn it is, the pieces (game.pieces('red')), the moves, and game.move('B7', 'B6') to play (game.takeOverBlue() lets code play Blue too). Everything about the battle is in here. */
declare const game: GameApi;
/** 'run' or 'view' */
declare const mode: 'run' | 'view';
/** Wait a bit: await sleep(500) or await sleep('2s'). Other cells keep running meanwhile. */
declare function sleep(time?: Interval): Promise<void>;
/** A TypeScript read-eval-print loop that keeps its variables between lines. const ts = repl(); await ts('const x = 6 * 7'); await ts('x + 1') gives '43'. Every line is compiled by the editor's own compiler, so it is TypeScript, and the cell API (print, at, mcp ...) is in reach. Expressions give their value (as text; errors start with '??'; the optional object replaces names of the cell API, repl({ print: (...v) => paper.add(v) }), so print can go somewhere else); const, let, var, function and class declarations stay for the next lines. */
declare function repl(overrides?: Record<string, unknown>): (line: string) => Promise<string>;
/** console.log that also shows up in the cell */
declare function log(...values: unknown[]): void;

/** Options of every wait (acquire, send, receive, lock ...). */
interface WaitOptions {
  /** Give up after this long ('2s' or 500): the wait fails with an error named TimeoutError. */
  timeout?: Interval;
  /** Give up when this signal aborts. */
  signal?: AbortSignal;
}
/** What acquire() gives you. release() gives it back once; "using p = await sem.acquire()" does it at the end of the block, also after an error, and it goes back by itself when the run of the cell that holds it is cancelled (the cell was edited or run again). */
interface Permit {
  readonly released: boolean;
  release(): void;
  [Symbol.dispose](): void;
}
/** A counting semaphore (Dijkstra, 1965): value = how many permits are free. P = acquire waits while there are none, V = release gives them back. Value 1 is a Mutex, value 0 at the start is a signal ("wait until somebody calls release()"). The line is first come, first served. A cell run again leaves the line by itself. */
declare class Semaphore {
  constructor(value?: number, name?: string);
  /** How many permits are free. */
  value: number;
  readonly name: string;
  /** How many are waiting in line. */
  readonly waiting: number;
  /** P: take n permits or wait in line. using p = await sem.acquire() or p.release(). { timeout: '2s' } gives up waiting. */
  acquire(n?: number, opts?: WaitOptions): Promise<Permit>;
  /** Take n permits only when they are free right now; null when they are not. Never waits. */
  tryAcquire(n?: number): Permit | null;
  /** V: give n permits back (or add new ones) and wake the ones in line that can go now. */
  release(n?: number): void;
  /** Acquire, run fn, always release, even when fn throws. */
  use<T>(fn: () => T | Promise<T>, n?: number, opts?: WaitOptions): Promise<T>;
}
/** A Semaphore with one permit: one at a time. */
declare class Mutex extends Semaphore {
  constructor(name?: string);
  readonly locked: boolean;
}
/** Many readers or one writer, first come first served (a waiting writer is not overtaken by new readers). */
declare class RWLock {
  constructor(name?: string);
  readonly readers: number;
  readonly writing: boolean;
  readonly waiting: number;
  /** Read together with other readers: using p = await rw.read() */
  read(opts?: WaitOptions): Promise<Permit>;
  /** Write alone: using p = await rw.write() */
  write(opts?: WaitOptions): Promise<Permit>;
  useRead<T>(fn: () => T | Promise<T>, opts?: WaitOptions): Promise<T>;
  useWrite<T>(fn: () => T | Promise<T>, opts?: WaitOptions): Promise<T>;
}
/** A queue between cells that passes messages instead of sharing things. capacity = how many may wait inside: send waits when it is full (back-pressure), receive waits when it is empty. Capacity 0 = a hand-over. After close() the messages inside can still be received; "for await (const m of channel)" then ends. */
declare class Channel<T> implements AsyncIterable<T> {
  constructor(capacity?: number, name?: string);
  readonly capacity: number;
  /** Messages waiting inside. */
  readonly size: number;
  /** Senders and receivers waiting. */
  readonly waiting: number;
  readonly closed: boolean;
  send(value: T, opts?: WaitOptions): Promise<void>;
  /** Send only when there is room or a receiver waits right now; false when it would have to wait. */
  trySend(value: T): boolean;
  /** The oldest message; waits for one. Fails with ChannelClosedError when closed and empty. */
  receive(opts?: WaitOptions): Promise<T>;
  /** { value } when a message is there right now, else undefined. */
  tryReceive(): { value: T } | undefined;
  /** No more sending; those waiting to send fail, those waiting to receive are told there is nothing more. */
  close(): void;
  [Symbol.asyncIterator](): AsyncGenerator<T, void, undefined>;
}
/** A lock by name, the same one in every cell, with nothing to import (like the Web Locks API of the browser, between cells): using l = await lock('printer'). mode 'shared' ones go in together, 'exclusive' (the default) is alone. */
declare function lock(name: string, opts?: WaitOptions & { mode?: 'shared' | 'exclusive' }): Promise<Permit>;
`;
