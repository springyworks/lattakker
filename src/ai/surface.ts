import { Codec, ImageExport, SvgCanvas2D, registerAllCodecs, xmlUtils } from '@maxgraph/core';
import type { Sheet, SheetCellData } from '../sheet/Sheet';
import type { GameView } from '../game/GameView';
import type { Hud } from '../ui/Hud';
import type { CellEditor } from '../editor/CellEditor';
import { modelFor } from '../editor/monaco';
import { isAnswered, replyBlock, requestAt } from './requests';
import { BOARD_COLS, BOARD_ROWS, isLake, rankGlyph, type Piece } from '../game/model';
import { installMcpBridge } from './bridge';
import { workspace, type WorkspaceTab } from '../workspace';
import { McpError, router } from '../mcp/router';
import { callers, currentCaller, outsideTrace, participant, throughChannel } from './entry';
import { README_URL, isOriented, markOriented, orientation, readReadme } from './orientation';
import { docUrls } from '../aichat/docs';

/**
 * Makes the page usable by external AI agents: a visually-hidden text mirror of the game, window.mms,
 * WebMCP tools, and (with ?mcp, see bridge.ts) the same tools over the dev server's /mcp endpoint. All local.
 */

export interface AiSurfaceDeps {
  sheet: Sheet;
  view: GameView;
  hud: Hud;
  editor: CellEditor;
}

type Json = Record<string, unknown>;
type Result = Json & ({ ok: true } | { ok: false; error: string });

const ok = (extra: Json = {}): Result => ({ ok: true, ...extra }) as Result;
const fail = (error: string, extra: Json = {}): Result => ({ ok: false, error, ...extra }) as Result;

const COLUMNS = 'ABCDEFGHIJ';
const MAX_CODE_CHARS = 20000;
const WAIT_MS = 15000;

const LEGEND =
  'Legend: R10 = visible Red piece of rank 10 (R1..R10; RS = Red Spy, which is rank 1; RB = Red Bomb; RF = Red Flag). ' +
  'B? = hidden Blue piece (rank unknown). b5 = Blue piece revealed by combat, rank 5 (bS = spy, bB = bomb, bF = flag). ' +
  '~~ = lake (nobody can enter). .. = empty square. Columns A-J left to right, rows 1-10 top to bottom: ' +
  "row 1 is Blue's back row, row 10 is Red's back row. Red (the player, and the AI helping them) moves up the board.";

const HELP = `LATTAKKER SHEET - window.mms guide (everything runs locally in this page; free, no tracking, no network unless the player starts a Share session or sets up the optional built-in helper, the 🤖 AI button)

FIRST, BEFORE ANYTHING ELSE: read the README, the place of truth: ${README_URL}
(raw text: https://raw.githubusercontent.com/springyworks/lattakker/main/README.md). If you cannot open links, call the tool read_readme (it fetches it from GitHub, part 1, 2 ...) or confirm_readme with one sentence on what you learned. An AI that comes in over /mcp or WebMCP has its first call answered with the rules until it has done so. Everything you do through the router is recorded (who started it, through whom, what it changed): see the router tools trace, history, change.

The page is a Lattakker board that is also a spreadsheet. Red is the child/player, Blue is the computer. Cells below the board (A12, E12, ...) hold TypeScript that runs live.
Every mms method returns plain JSON. Errors never throw: you get { ok: false, error: "..." }. Success is { ok: true, ... }.
Methods marked (async) return a Promise: await them.

CELL PATHS (tabs: board, lab, examples). Cells are named like files, with / meaning "inside":
  J24            a cell of the board tab (or of the tab you pass as a second argument/option: { tab: 'lab' })
  /lab/J24       absolute: tab first, so it works from anywhere (/board/A12 for the board)
  /lab/J24/3,4   tile x=3, y=4 of the grid inside block J24
  @c-1a2b3c4d    a cell by its identity (uid); it follows the code when cells move, from any tab
  lattakker:///lab/J24   the same absolute path written as a URI
  Every result that names a cell carries { tab, address, path, uid }. Write it back the same way: the path field is always safe to pass in.

READ
  mms.help()                 this guide
  mms.docs()                 { ok, urls: {...} } where to read the rules, the API typings (cell-api.d.ts), every example cell, and the README; fetch them like a coder reads a project
  mms.mcp('lab', 'resources/list' | 'tools/call' ..., params) (async)   send an MCP request to a tab's server through the page's router; mms.mcpLog(20) shows the last messages that crossed it
  mms.tabs()                 { current, tabs: [{ id, title, path, mode, codeCells, rows, columns }], paths } the tabs that hold code cells and which one the player sees
  mms.state()                { phase: 'setup'|'play'|'over', turn, winner, moveCount, lastMove, message, busy, redPieces, bluePieces }
  mms.board()                { rows: [10 strings, row 1 first], legend, text }. Hidden Blue pieces stay hidden (B?).
  mms.legalMoves(x)          x = 'red' or a Red square like 'B7' -> [{from,to}]. Only Red is shown (Blue stays secret).
  mms.cells('board'|'lab'|'all')  cells holding code: [{uid, tab, address, path, code, output, error, mode}]; board by default
  mms.getCell('A12')         one cell: { uid, tab, address, path, code, output, error, text, mode, ... }. Also accepts a path ('/lab/J24'), a uid, or a tab: mms.getCell('J24', 'lab').
  mms.resolve('@c-1a2b3c4d') where a cell is now: { tab, address, path, uid, hasCode }. Takes an address, a path or a uid.
  mms.exportSvg()            SVG string snapshot of the maxGraph canvas
  mms.exportModelXml()       maxGraph model as XML (large)

ACT
  mms.shuffle()              setup phase only: re-deal Red's army randomly
  mms.start()                setup -> play (Red moves first)
  mms.move('B7','B6') (async)  Red moves one square (Scouts: any distance in a line); waits for Blue's reply. Returns the new state.
  mms.pause() / mms.resume() pause or continue the battle (nobody moves while paused)
  mms.newGame()              back to setup with new armies
  mms.undo()                 take back Red's last move and Blue's answer
  mms.setCode('A12', code, { run: true, tab: 'board' }) (async)   put TypeScript in a cell (a path like '/lab/J24' works too); run:false returns immediately (it still runs in the background)
  mms.runCell('A12' | '/lab/J24') (async) re-run a cell, wait. Success { ok: true, address, uid, output, text }; failure { ok: false, error, address, uid, output }.
                             error is a plain string: "line 6: '}' expected." for the first syntax error, just the message for a runtime error, never an object or code.
  mms.clearCell('A12')       empty a cell
  mms.setMode('run'|'view')  cells show output (run) or their code (view)
  mms.say('Nice move!')      show a message to the player in the speech bubble
  mms.writeCodeLive('A12', code) (async)   open the cell's editor and type the code in slowly; the player presses Esc or Restart & close to keep and run it
  mms.requests()             questions the player wrote as "// AI: ..." comment lines: { requests: [{address, uid, line, text, answered, unsaved}] }
  mms.waitForRequest(15) (async)   wait up to 20 s for a new question, then return like requests()
  mms.replyToRequest('A12', line, 'text')   write your answer as "// ↳ AI: ..." right below the question (a fresh "// " line follows for the next one)

IDENTITY: every code cell has a uid such as c-1a2b3c4d. The uid stays with its content when cells move, swap or rows are inserted; the address changes. Keep the uid to find code again later; mms.resolve(uid) gives the current address.

WebMCP: if the browser supports it, the same actions are registered as tools: get_state, get_board, legal_moves, make_move, shuffle_army, start_battle, pause_battle, resume_battle, undo_move, new_game, list_tabs, list_cells, get_cell, resolve_cell, set_cell_code, write_code_live, get_requests, wait_for_request, reply_to_request, run_cell, set_mode, say_to_player, check_mail, read_mail, send_mail, mcp_request, mcp_log, export_svg. mms.webmcp tells you what was registered.
An outside AI chat can use the same tools over MCP: run the dev server, open this page with ?mcp added to the URL, and connect to http://localhost:5178/mcp (see the README, section 11.3).
The page also keeps an accessible text mirror in #mms-text (board grid, captured pieces, last move, code cells with output and errors). Each code cell is one list item: "A12: code: <first 3 lines, max 200 chars> | output: ... | error: ..."; use getCell for the whole code.

CELL CODE (TypeScript, async allowed, re-runs when things it reads change)
  print(...values)   add a line of output           view(text)      text shown in view mode
  color('#ecdcd8')   cell background                span(cols,rows) merge cells (not over the board)
  at('B7')           another cell: .text .code .piece .color(c) .print(...) .flash()
  range('A1:J10')    array of cells with .color(c) and .print(...)
  game.phase game.turn game.winner game.moveCount game.lastMove game.history
  game.pieces('red') game.captured('blue') game.pieceAt('B7') game.legalMoves('B7'|'red')
  game.move('B7','B6') game.say('hi')
  sheet.mode sheet.cols sheet.rows   mode   sleep(ms|'2s')   log(...)
  show(...) replace output   clear()   span() read size, span(4) keep rows
  plot(Math.sin, {from:0,to:6.28,title:'wave'})  XY plot as output; also plot([1,4,9]), plot([[0,1],[1,3]]), plot({a: f, b: g})
  grid(10, 8) tiles inside this block (after span(10, 8)): g.at(x,y).color('#3f8f5a') .show('7'), g.paint((x,y) => colour|null), g.fill(c), on(g,'click', tile => ...); tiles use their own x,y from 0, other cells read at('A16/3,4').fill
  every('1s', n => ...)  after('5s', fn)  on('B7' | 'A1:J10' | 'game', fn)  stop()   (timers die when the cell re-runs)
  on('I18', 'size' | 'code' | 'click', fn)  on('sheet', 'rows' | 'mode', fn)   events; also cell.cols/rows, at(x).code, sheet.rows/mode are reactive when read at top level
  memory (notebook that survives re-runs)  run.reason ('edit'|'moved'|'update')  run.count
  mcp.catalog() / mcp.tools(server) / mcp.stats() / mcp.recent(n)   what the MCP ecosystem offers, and the router's counters (perSecond is ready for plot)
  mcp.packets(filter, n) / mcp.analyze(filter) / mcp.ask('any errors?') / mcp.callers()   the traffic by type with a display filter, counted, and answered in words
  await weather.now('Amsterdam') / weather.forecast(place, days) / weather.find(name)   weather from open-meteo.com (also the MCP server 'weather')
  await ollama.status() (never throws, says what is missing) / ollama.ask(prompt) / ollama.models()   the model on this computer (also the MCP server 'ollama')
  await input.ask(q) / input.confirm(q) / input.choose(q, options); input.slider(label,{min,max,value},fn) .number .text .checkbox .select .button; input.onKey((key) => ...)
  cell.usedBy / cell.reads  addresses that read this cell / that this cell read
  Moving, swapping or inserting rows rewrites address literals in all code ('B7', 'A1:B3', 'C32-55') so they follow their cells; a range split by a move is only reported. Keep addresses as plain literals ('E' + n is not followed).
  Hidden Blue pieces have rank '?'. Board squares are A1:J10; put code in A12 or below.

EXAMPLES
  await mms.setCode('A12', "print('Red pieces: ' + game.pieces('red').length)")
  mms.shuffle(); mms.start(); await mms.move('A7','A6')
  await mms.setCode('E12', "for (const sq of range('A7:J7')) sq.color('#ecdcd8')")
  await mms.runCell('E12')
`;

const APP_LABEL =
  'Lattakker sheet: a Lattakker board that is also a spreadsheet where cells hold TypeScript. ' +
  'AI helpers: call window.mms.help(), or read the text version of the game in the region named "Game state as text".';

const WEBMCP_PERMISSION_NOTE = 'WebMCP not available in this browser';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
  readOnly: boolean;
  run(args: Json): Promise<Result> | Result;
}

const str = (description: string): Json => ({ type: 'string', description });
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required, additionalProperties: false });
const ADDR =
  'A cell address like A12 (in the board tab unless `tab` says otherwise; code cells live below the board, row 12 or lower), a path starting with the tab like /lab/J24, or a cell identity like @c-1a2b3c4d (it follows the content when cells move and works from every tab).';
const TAB_PROP = { type: 'string', description: "Which tab a plain address like J24 belongs to: 'board' (default), 'lab' or 'examples'. Not needed when the address is a path like /lab/J24 or an identity." };

export function installAiSurface({ sheet, view, hud }: AiSurfaceDeps) {
  // ------------------------------------------------------------ helpers

  const game = () => view.game;
  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  function tokenFor(row: number, col: number): string {
    if (isLake(row, col)) return '~~';
    const p: Piece | null = game().board[row]?.[col] ?? null;
    if (!p) return '..';
    if (p.color === 'red') return `R${rankGlyph(p.rank)}`;
    return p.revealed ? `b${rankGlyph(p.rank)}` : 'B?';
  }

  function boardRows(): string[] {
    const rows: string[] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      const tokens: string[] = [];
      for (let c = 0; c < BOARD_COLS; c++) tokens.push(tokenFor(r, c).padEnd(3));
      rows.push(tokens.join(' ').trimEnd());
    }
    return rows;
  }

  function boardText(): string {
    const header = 'Columns: ' + [...COLUMNS].map((c) => c.padEnd(3)).join(' ').trimEnd();
    const lines = boardRows().map((row, i) => `${`Row ${i + 1}:`.padEnd(7)} ${row}`);
    return [header, ...lines].join('\n');
  }

  function describeMove(m: ReturnType<GameView['moveInfo']>): string {
    const who = m.color === 'red' ? 'Red' : 'Blue';
    const fight = m.defender ? ` attacked ${m.defender}: ${m.outcome === 'win' ? 'attacker won' : m.outcome === 'lose' ? 'attacker lost' : 'both removed'}${m.flagCaptured ? ' (flag captured)' : ''}` : '';
    return `${who} ${m.piece} ${m.from} -> ${m.to}${fight}`;
  }

  function phaseText(): string {
    const g = game();
    if (g.phase === 'setup') return "setup (Red is arranging the army; shuffle then start, or the player swaps pieces by hand)";
    if (g.phase === 'over') return `over (${g.winner === 'red' ? 'Red won' : 'Blue won'})`;
    if (view.isPaused()) return 'play (paused: nobody can move until resume() is called)';
    return `play (${g.turn === 'red' ? "Red's turn" : "Blue's turn, Blue is thinking"})`;
  }

  function stateData(): Json {
    const g = game();
    const openEditor = workspace.list().find((t) => t.editor.isOpen);
    return {
      phase: g.phase,
      turn: g.turn,
      winner: g.winner,
      moveCount: g.moveCount,
      lastMove: g.lastMove ? view.moveInfo(g.lastMove) : null,
      message: hud.lastMessage.text,
      busy: view.isBusy(),
      paused: view.isPaused(),
      redPieces: g.pieces('red').length,
      bluePieces: g.pieces('blue').length,
      tab: workspace.current,
      editorOpenOn: openEditor ? (openEditor.id === 'board' ? openEditor.editor.address : workspace.pathOf(openEditor.id, openEditor.editor.address!)) : null,
      editorChars: openEditor ? openEditor.editor.valueLength : null,
      sheetMode: sheet.mode,
    };
  }

  /** The cell a request names: a plain address (in `tabId`, 'board' when not given), an absolute path like /lab/J24 or an identity. */
  interface Target {
    address: string;
    tab: WorkspaceTab;
    sheet: Sheet;
    editor: CellEditor;
    path: string;
  }

  function validCodeAddress(raw: unknown, tabId?: unknown): Target | { error: string } {
    if (typeof raw !== 'string' || !raw.trim()) return { error: 'address must be a string like "A12", a path like "/lab/J24" or a cell identity like "@c-1a2b3c4d"' };
    const from = typeof tabId === 'string' && tabId.trim() ? tabId.trim().toLowerCase() : 'board';
    const found = workspace.resolve(raw, from);
    if ('error' in found) return { error: found.error };
    const path = workspace.pathOf(found.tab.id, found.address);
    if (found.tile) return { error: `"${raw}" names a tile inside a block. Use the block's own path, ${path}.` };
    return { address: found.address, tab: found.tab, sheet: found.tab.sheet, editor: found.tab.editor, path };
  }

  const boardTab = (): WorkspaceTab => workspace.get('board')!;

  function cellData(d: SheetCellData, tab: WorkspaceTab = boardTab()): Json {
    return {
      uid: d.uid || null,
      tab: tab.id,
      address: d.address,
      path: workspace.pathOf(tab.id, d.address),
      code: d.code,
      output: d.output.join('\n'),
      error: d.error,
      mode: tab.sheet.mode,
    };
  }

  // ------------------------------------------------------- text region

  const region = document.createElement('section');
  region.id = 'mms-text';
  region.className = 'sr-only';
  region.setAttribute('aria-label', 'Game state as text');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'false');
  const parts = new Map<string, HTMLElement>();
  const part = (key: string, tag: string): HTMLElement => {
    let el = parts.get(key);
    if (!el) {
      el = document.createElement(tag);
      el.id = `mms-${key}`;
      parts.set(key, el);
      region.appendChild(el);
    }
    return el;
  };
  const setText = (key: string, tag: string, text: string) => {
    const el = part(key, tag);
    if (el.textContent !== text) el.textContent = text;
  };

  function renderText(): void {
    const g = game();
    setText('title', 'h2', 'Lattakker sheet: game state as text');
    setText('phase', 'p', `Phase: ${phaseText()}. Moves played: ${g.moveCount}.${g.winner ? ` Winner: ${g.winner}.` : ''}`);
    setText('message', 'p', `Message to the player: ${hud.lastMessage.text || '(none yet)'}`);
    setText('board-title', 'h3', 'Board (rows 1-10, columns A-J)');
    setText('board', 'pre', `${boardText()}\n${LEGEND}`);
    const cap = (c: 'red' | 'blue') => g.captured[c].map((p) => view.pieceInfo(p, true).name).join(', ') || 'none';
    setText('captured', 'p', `Captured Red pieces: ${cap('red')}. Captured Blue pieces: ${cap('blue')}.`);
    setText('cockpit', 'p', `Cockpit (grid cells L1:Q10): ${hud.snapshot().buttons.map((b) => `${b.address} ${b.label}${b.enabled ? '' : ' (unavailable)'}`).join('; ')}.`);
    setText('last', 'p', `Last move: ${g.lastMove ? describeMove(view.moveInfo(g.lastMove)) : 'none yet'}.`);
    setText('cells-title', 'h3', `Code cells (mode: ${sheet.mode === 'run' ? 'showing output' : 'showing code'})`);
    const list = part('cells', 'ul');
    const cells = sheet.codeCells();
    const sig = JSON.stringify(cells.map((d) => [d.address, d.code, d.output, d.error]));
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.textContent = '';
      for (const d of cells) {
        const li = document.createElement('li');
        const head = d.code.split('\n').slice(0, 3).join(' / ').slice(0, 200);
        li.textContent = `${d.address}: code: ${head}${d.code.split('\n').length > 3 ? ' ...' : ''} | output: ${d.output.join(' / ') || '(none)'} | error: ${d.error ?? 'none'}`;
        list.appendChild(li);
      }
      if (!cells.length) list.textContent = 'No code cells yet.';
    }
    // Other tabs (the Lab, ...): the same list, each cell named by its absolute path.
    for (const tab of workspace.list()) {
      if (tab.id === 'board') continue;
      setText(`cells-title-${tab.id}`, 'h3', `Code cells in the ${tab.id} tab (${tab.title}; cell paths start with /${tab.id}/, mode: ${tab.sheet.mode === 'run' ? 'showing output' : 'showing code'})`);
      const tabList = part(`cells-${tab.id}`, 'ul');
      const tabCells = tab.sheet.codeCells();
      const tabSig = JSON.stringify(tabCells.map((d) => [d.address, d.code, d.output, d.error]));
      if (tabList.dataset.sig !== tabSig) {
        tabList.dataset.sig = tabSig;
        tabList.textContent = '';
        for (const d of tabCells) {
          const li = document.createElement('li');
          const head = d.code.split('\n').slice(0, 3).join(' / ').slice(0, 200);
          li.textContent = `${workspace.pathOf(tab.id, d.address)}: code: ${head}${d.code.split('\n').length > 3 ? ' ...' : ''} | output: ${d.output.join(' / ') || '(none)'} | error: ${d.error ?? 'none'}`;
          tabList.appendChild(li);
        }
        if (!tabCells.length) tabList.textContent = 'No code cells yet.';
      }
    }
    setText('footer', 'p', 'AI helpers: window.mms.help() describes every method. Cell code is TypeScript.');
  }

  let timer: number | null = null;
  const schedule = () => {
    if (timer !== null) return;
    // Rebuilding the text of every cell is costly, and cells that animate change it all the time: a few times a second is plenty for a screen reader.
    timer = window.setTimeout(() => {
      timer = null;
      renderText();
    }, 600);
  };
  const flush = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    renderText();
  };

  const prevOnChange = view.onChange;
  view.onChange = () => {
    prevOnChange?.();
    schedule();
  };
  for (const tab of workspace.list()) {
    tab.sheet.onAfterRun(schedule);
    tab.sheet.onCodeChanged(schedule);
    tab.sheet.onModeChange(schedule);
  }
  hud.onSay(schedule);

  document.body.appendChild(region);
  renderText();

  const app = sheet.container;
  app.setAttribute('role', 'application');
  app.setAttribute('aria-label', APP_LABEL);
  app.setAttribute('aria-describedby', 'ai-guide');

  // ----------------------------------------------------- run / settle

  const idle = (target: Sheet): boolean => {
    const s = target as unknown as { running?: boolean; runPending?: boolean; runTimer?: number | null };
    return !s.running && !s.runPending && !s.runTimer;
  };

  async function settle(target: Sheet = sheet): Promise<boolean> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(30);
      if (idle(target)) {
        await sleep(30);
        if (idle(target)) return true;
      }
    }
    return false;
  }

  async function waitForMoves(): Promise<boolean> {
    const deadline = Date.now() + WAIT_MS;
    await sleep(30);
    while (view.isBusy() && Date.now() < deadline) await sleep(50);
    return !view.isBusy();
  }

  // ------------------------------------------------------------- API

  let listeningUntil = 0;
  for (const tab of workspace.list()) tab.editor.aiListening = () => performance.now() < listeningUntil;

  const collectRequests = (includeAnswered: boolean) => {
    const found: Array<{ tab: string; address: string; path: string; uid: string | null; line: number; text: string; answered: boolean; unsaved: boolean }> = [];
    for (const tab of workspace.list()) {
      const addresses = new Set(tab.sheet.codeCells().map((d) => d.address));
      if (tab.editor.isOpen && tab.editor.address) addresses.add(tab.editor.address);
      for (const address of addresses) {
        const d = tab.sheet.dataAt(address);
        if (!d) continue;
        const live = tab.editor.isOpen && tab.editor.address === address;
        const lines = (live ? tab.editor.valueText ?? '' : d.code).split('\n');
        lines.forEach((_l, i) => {
          const text = requestAt(lines, i);
          if (!text) return;
          const answered = isAnswered(lines, i);
          if (answered && !includeAnswered) return;
          found.push({ tab: tab.id, address, path: workspace.pathOf(tab.id, address), uid: d.uid || null, line: i + 1, text, answered, unsaved: live });
        });
      }
    }
    return found;
  };

  const api = {
    help: (): string => HELP,
    docs: (): Result => ok({ urls: docUrls(), order: ['rules', 'api', 'examples', 'labDemos', 'readme'], howTo: 'Read rules first, look up exact names in api, find a similar cell in examples or labDemos and follow its style. The urls under "index" and "everything" bundle them.' }),

    state: (): Result => ok(stateData()),

    board: (): Result => ok({ rows: boardRows(), columns: [...COLUMNS], legend: LEGEND, text: boardText() }),

    legalMoves(fromOrColor: unknown): Result {
      if (typeof fromOrColor !== 'string') return fail("pass 'red' or a Red square such as 'B7'");
      const key = fromOrColor.trim();
      if (key.toLowerCase() === 'blue') return fail("Blue's moves are secret. Ask for 'red' or a Red square.");
      if (key.toLowerCase() === 'red') {
        const moves = game()
          .allLegalMoves('red')
          .map((m) => ({ from: view.addrOf(m.from), to: view.addrOf(m.to) }));
        return ok({ moves, note: game().phase === 'play' ? undefined : 'No moves until the battle starts (call start).' });
      }
      const pos = view.posOf(key.toUpperCase());
      if (!pos) return fail(`"${key}" is not a board square (A1 to J10)`);
      const piece = game().at(pos);
      if (!piece) return ok({ moves: [], note: 'That square is empty.' });
      if (piece.color !== 'red') return fail("That is a Blue piece; Blue's moves are secret.");
      return ok({ moves: game().legalMoves(pos).map((to) => ({ from: view.addrOf(pos), to: view.addrOf(to) })) });
    },

    async move(from: unknown, to: unknown): Promise<Result> {
      if (typeof from !== 'string' || typeof to !== 'string') return fail('move(from, to) needs two squares like "B7", "B6"');
      const message = view.codeMove(from.trim().toUpperCase(), to.trim().toUpperCase());
      if (!message.startsWith('Moving')) return fail(message);
      const done = await waitForMoves();
      flush();
      return ok({ message, settled: done, state: stateData() });
    },

    shuffle(): Result {
      if (game().phase !== 'setup') return fail('Shuffling only works before the battle starts (phase is "setup").');
      view.shuffle();
      flush();
      return ok({ board: boardRows() });
    },

    start(): Result {
      if (game().phase !== 'setup') return fail(`The battle already started (phase is "${game().phase}"). Use newGame() to restart.`);
      view.start();
      flush();
      return ok({ state: stateData() });
    },

    pause(): Result {
      if (game().phase !== 'play') return fail('Only a running battle can be paused (phase is "' + game().phase + '").');
      view.setPaused(true);
      flush();
      return ok({ state: stateData() });
    },

    resume(): Result {
      if (game().phase !== 'play') return fail('Only a running battle can be continued (phase is "' + game().phase + '").');
      view.setPaused(false);
      flush();
      return ok({ state: stateData() });
    },

    undo(): Result {
      if (!game().canUndo) return fail('Nothing to undo yet.');
      view.undo();
      flush();
      return ok({ state: stateData() });
    },

    newGame(): Result {
      view.newGame();
      flush();
      return ok({ state: stateData() });
    },

    /** Code cells of the board (default), of one tab, or of every tab with tab 'all'. Each cell carries its tab and absolute path. */
    cells(tab?: unknown): Result {
      const want = typeof tab === 'string' && tab.trim() ? tab.trim().toLowerCase() : 'board';
      const chosen = want === 'all' ? workspace.list() : [workspace.get(want)].filter((t): t is WorkspaceTab => !!t);
      if (!chosen.length) return fail(`There is no tab "${want}". Tabs: ${workspace.list().map((t) => t.id).join(', ')} (or 'all').`);
      return ok({ cells: chosen.flatMap((t) => t.sheet.codeCells().map((d) => cellData(d, t))) });
    },

    /** The tabs that hold a sheet, which one the player is looking at, and how to write a cell path. */
    tabs: (): Result =>
      ok({
        current: workspace.current,
        tabs: workspace.list().map((t) => ({
          id: t.id,
          title: t.title,
          path: `/${t.id}`,
          mode: t.sheet.mode,
          codeCells: t.sheet.codeCells().length,
          rows: t.sheet.rowCount,
          columns: t.sheet.colCount,
        })),
        paths: "A cell is named /tab/ADDRESS, e.g. /lab/J24, or /tab/ADDRESS/x,y for tile x,y of the grid inside that cell. @c-1a2b3c4d names a cell by its identity from any tab. A plain address like J24 means the board tab unless a `tab` argument says otherwise.",
      }),

    resolve(addressOrUid: unknown, tab?: unknown): Result {
      const a = validCodeAddress(addressOrUid, tab);
      if ('error' in a) return fail(a.error);
      const d = a.sheet.dataAt(a.address)!;
      return ok({ tab: a.tab.id, address: a.address, path: a.path, uid: d.uid || null, hasCode: d.code.trim() !== '' });
    },

    getCell(address: unknown, tab?: unknown): Result {
      const a = validCodeAddress(address, tab);
      if ('error' in a) return fail(a.error);
      const d = a.sheet.dataAt(a.address)!;
      const isBoard = a.sheet.isBoardAddress(a.address);
      return ok({
        ...cellData(d, a.tab),
        text: a.sheet.displayText(d),
        isBoard,
        piece: isBoard ? view.pieceInfoAt(a.address) : null,
        token: isBoard ? tokenFor(d.row, d.col) : null,
      });
    },

    async setCode(address: unknown, code: unknown, options?: { run?: boolean; tab?: string }): Promise<Result> {
      const a = validCodeAddress(address, options?.tab);
      if ('error' in a) return fail(a.error);
      if (typeof code !== 'string') return fail('code must be a string of TypeScript');
      if (code.length > MAX_CODE_CHARS) return fail(`code is too long (max ${MAX_CODE_CHARS} characters)`);
      if (a.sheet.isBoardAddress(a.address)) return fail(`${a.address} is a board square. Put code in row 12 or lower, e.g. A12.`);
      modelFor(a.address, code, a.sheet.id);
      a.sheet.setCode(a.address, code);
      if (!code.trim()) {
        flush();
        return ok({ tab: a.tab.id, address: a.address, path: a.path, cleared: true });
      }
      if (options?.run === false) {
        flush();
        return ok({ tab: a.tab.id, address: a.address, path: a.path, uid: a.sheet.dataAt(a.address)!.uid, started: true });
      }
      return api.runCell(a.path);
    },

    async runCell(address: unknown, tab?: unknown): Promise<Result> {
      const a = validCodeAddress(address, tab);
      if ('error' in a) return fail(a.error);
      const d = a.sheet.dataAt(a.address)!;
      if (!d.code.trim()) return fail(`${a.path} has no code to run. Use setCode first.`);
      a.sheet.markDirty([a.address]);
      a.sheet.requestRun();
      const finished = await settle(a.sheet);
      flush();
      const output = d.output.join('\n');
      const where = { tab: a.tab.id, address: a.address, path: a.path, uid: d.uid };
      if (!finished) return fail('Timed out waiting for the cell to finish (is it waiting on sleep() or looping?)', { ...where, output });
      if (d.error) return fail(d.error, { ...where, output });
      return ok({ ...where, output, text: a.sheet.displayText(d) });
    },

    async writeCodeLive(address: unknown, code: unknown, tab?: unknown): Promise<Result> {
      const a = validCodeAddress(address, tab);
      if ('error' in a) return fail(a.error);
      if (typeof code !== 'string' || !code.trim()) return fail('code must be a non-empty string of TypeScript');
      if (code.length > MAX_CODE_CHARS) return fail(`code is too long (max ${MAX_CODE_CHARS} characters)`);
      if (a.sheet.isBoardAddress(a.address)) return fail(`${a.address} is a board square. Put code in row 12 or lower, e.g. A12.`);
      const geo = a.sheet.geometryOf(a.address);
      if (!geo) return fail(`${a.path} is not on the sheet`);
      const target = a.sheet.dataAt(a.address)!;
      // The player must see it happen, so bring that tab to the front first.
      a.tab.select();
      a.sheet.reveal(target.row, target.col, false);
      a.editor.open(a.address);
      hud.say(`The assistant is writing code in ${a.path} ✍`, 'info');
      const finished = await a.editor.typeCode(code);
      if (!finished) return fail(`The editor on ${a.path} was closed before the code was typed.`, { address: a.address, path: a.path });
      hud.say(`Code for ${a.path} is ready. Read it, then press Esc (or Restart & close) to keep it and run it.`, 'good');
      return ok({ tab: a.tab.id, address: a.address, path: a.path, uid: a.sheet.dataAt(a.address)!.uid || null, typed: code.length, editorOpen: true, next: 'Waiting for the player to close the editor. Poll get_state until editorOpenOn is null, then get_cell to read the output.' });
    },

    requests(includeAnswered = false): Result {
      return ok({ requests: collectRequests(includeAnswered), howToAnswer: 'Call reply_to_request with the address, the line number and your reply. The reply is written as a comment right below the request.' });
    },

    async waitForRequest(seconds: unknown): Promise<Result> {
      const limit = Math.min(20, Math.max(1, typeof seconds === 'number' && isFinite(seconds) ? seconds : 15));
      const started = performance.now();
      listeningUntil = started + limit * 1000 + 6000;
      for (;;) {
        const open = collectRequests(false);
        const waited = Math.round((performance.now() - started) / 100) / 10;
        if (open.length > 0) return ok({ requests: open, waited });
        if (waited >= limit) return ok({ requests: [], waited, note: 'Nobody asked anything yet. Call wait_for_request again to keep listening.' });
        await new Promise((r) => setTimeout(r, 400));
      }
    },

    replyToRequest(address: unknown, line: unknown, reply: unknown, tab?: unknown): Result {
      const a = validCodeAddress(address, tab);
      if ('error' in a) return fail(a.error);
      if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return fail('line must be a positive whole number (use the line from get_requests)');
      if (typeof reply !== 'string' || !reply.trim()) return fail('reply must be a non-empty string');
      if (reply.length > 600) return fail('reply is too long (max 600 characters). Keep it short and friendly.');
      const live = a.editor.isOpen && a.editor.address === a.address;
      const code = live ? a.editor.valueText! : a.sheet.dataAt(a.address)!.code;
      const lines = code.split('\n');
      if (!requestAt(lines, line - 1)) return fail(`Line ${line} of ${a.path} is not an AI request any more (the text may have moved). Call get_requests again.`, { address: a.address, path: a.path });
      if (isAnswered(lines, line - 1)) return fail(`The request on line ${line} of ${a.path} already has an answer.`, { address: a.address, path: a.path });
      const block = replyBlock(reply.trim());
      if (live) {
        if (!a.editor.insertAfterLine(line, block)) return fail('The editor closed while answering. Call get_requests again.');
      } else {
        lines.splice(line, 0, ...block.split('\n'));
        a.sheet.setCode(a.address, lines.join('\n'));
        flush();
      }
      hud.say(`The assistant answered in ${a.path} ✍`, 'info');
      return ok({ tab: a.tab.id, address: a.address, path: a.path, line, answeredInEditor: live });
    },

    clearCell(address: unknown, tab?: unknown): Result {
      const a = validCodeAddress(address, tab);
      if ('error' in a) return fail(a.error);
      if (a.sheet.isBoardAddress(a.address)) return fail(`${a.address} is a board square, not a code cell.`);
      modelFor(a.address, '', a.sheet.id);
      a.sheet.setCode(a.address, '');
      flush();
      return ok({ tab: a.tab.id, address: a.address, path: a.path });
    },

    setMode(mode: unknown): Result {
      if (mode !== 'run' && mode !== 'view') return fail("mode must be 'run' (show output) or 'view' (show code)");
      if (sheet.mode !== mode) {
        sheet.setMode(mode);
        hud.setButtonLabel('btn:mode', mode === 'run' ? 'Show code' : 'Show output', mode === 'run' ? 'Cells show output' : 'Cells show code');
        hud.say(mode === 'view' ? 'View mode: code cells show their TypeScript 👁' : 'Run mode: code cells show what they print ▶', 'info');
      }
      flush();
      return ok({ mode: sheet.mode });
    },

    /** Talk to a tab's MCP server through the page's router, the way a cell's mcp global does. */
    async mcp(server: unknown, method: unknown, params?: unknown): Promise<Result> {
      if (typeof server !== 'string' || typeof method !== 'string') return fail("mcp(server, method, params) needs two strings, for example mcp('lab', 'resources/list')");
      const args = typeof params === 'object' && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
      try {
        return ok({ server, method, result: await router.request('ai', server, method, args, outsideTrace()) });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), { code: err instanceof McpError ? err.code : undefined });
      }
    },

    /** The page's internal mail, for an outside AI: the same `mail` server everybody uses, asked as the outside AI. */
    async mail(tool: string, args: Record<string, unknown>): Promise<Result> {
      try {
        const answer = (await router.request('ai', 'mail', 'tools/call', { name: tool, arguments: args }, outsideTrace())) as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> };
        if (answer.structuredContent) return ok(answer.structuredContent);
        let detail: unknown = answer.content?.[0]?.text;
        try {
          detail = JSON.parse(String(detail));
        } catch {
          // plain text stays as it is
        }
        return fail(`mail ${tool} failed`, { detail });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), { code: err instanceof McpError ? err.code : undefined });
      }
    },

    /** The last messages that crossed the page's MCP router: who asked whom, and what. */
    mcpLog(count?: unknown): Result {
      return ok({ servers: router.names(), messages: router.recent(typeof count === 'number' && isFinite(count) ? count : 20) });
    },

    say(text: unknown): Result {
      if (typeof text !== 'string' || !text.trim()) return fail('say(text) needs a non-empty string');
      hud.say(text.slice(0, 500), 'info');
      flush();
      return ok();
    },

    exportSvg(): Result {
      try {
        const graph = sheet.graph;
        const gview = graph.getView();
        const bounds = graph.getGraphBounds();
        const doc = xmlUtils.createXmlDocument();
        const NS = 'http://www.w3.org/2000/svg';
        const root = doc.createElementNS(NS, 'svg') as unknown as SVGSVGElement;
        root.setAttribute('xmlns', NS);
        root.setAttribute('width', String(Math.ceil(bounds.width)));
        root.setAttribute('height', String(Math.ceil(bounds.height)));
        root.setAttribute('viewBox', `0 0 ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}`);
        const canvas = new SvgCanvas2D(root, false);
        canvas.translate(-bounds.x, -bounds.y);
        const rootCell = graph.getDataModel().getRoot();
        const state = rootCell ? gview.getState(rootCell) : null;
        if (!state) return fail('The canvas has not been drawn yet.');
        new ImageExport().drawState(state, canvas);
        const svg = new XMLSerializer().serializeToString(root);
        return ok({ svg, length: svg.length, method: 'maxGraph ImageExport + SvgCanvas2D (whole sheet)' });
      } catch (err) {
        return fail(`SVG export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    exportModelXml(): Result {
      try {
        registerAllCodecs();
        const node = new Codec().encode(sheet.graph.getDataModel());
        if (!node) return fail('The model could not be encoded.');
        const xml = xmlUtils.getXml(node);
        return ok({ xml, length: xml.length, method: 'maxGraph Codec.encode of the graph model' });
      } catch (err) {
        return fail(`Model export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };

  // ------------------------------------------------------- WebMCP tools

  const tools: ToolDef[] = [
    {
      name: 'get_docs',
      description: 'Where to read the documents like a human coder: the rules for helpers, the TypeScript API a cell can use (cell-api.d.ts), every example cell and Lab demo with comments, and the README on GitHub. Returns the addresses (URLs). Read them before writing cell code.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.docs(),
    },
    {
      name: 'get_state',
      description:
        'Read the Lattakker game status: phase (setup = arranging armies, play = battle, over), whose turn, winner, move count, the last move, and the message the player currently sees. Call this first and after every action.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.state(),
    },
    {
      name: 'get_board',
      description:
        'Read the 10x10 board as text. R10 is a visible Red piece of rank 10, B? a hidden Blue piece, b5 a revealed Blue piece, ~~ a lake, .. an empty square. Columns A-J, rows 1-10 (row 1 is at the top, Blue side). Hidden Blue pieces stay hidden.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.board(),
    },
    {
      name: 'legal_moves',
      description: "List legal moves for the player's Red army. Pass 'red' for every Red move, or one Red square such as 'B7' for that piece. Only works once the battle has started.",
      inputSchema: obj({ from_or_color: str("'red' or a Red square like 'B7'") }, ['from_or_color']),
      readOnly: true,
      run: (a) => api.legalMoves(a.from_or_color),
    },
    {
      name: 'make_move',
      description:
        'Move a Red piece from one square to another during the battle (for example from B7 to B6). Pieces move one square up, down, left or right; Scouts (rank 2) can slide any distance. Waits for Blue to answer, then returns the new state. If the move is not allowed you get a kid-friendly reason to explain.',
      inputSchema: obj({ from: str('Square to move from, e.g. B7'), to: str('Square to move to, e.g. B6') }, ['from', 'to']),
      readOnly: false,
      run: (a) => api.move(a.from, a.to),
    },
    {
      name: 'shuffle_army',
      description: "Before the battle starts, re-deal Red's army at random (flag on the back row guarded by bombs). Only works in the setup phase.",
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.shuffle(),
    },
    {
      name: 'start_battle',
      description: 'Finish setup and start the battle. Red moves first. Only works in the setup phase.',
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.start(),
    },
    {
      name: 'pause_battle',
      description: 'Pause the running battle. Nobody can move, not even Blue, until resume_battle is called.',
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.pause(),
    },
    {
      name: 'resume_battle',
      description: 'Continue a paused battle.',
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.resume(),
    },
    {
      name: 'undo_move',
      description: "Take back Red's last move together with Blue's answer. Fails when there is nothing to undo.",
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.undo(),
    },
    {
      name: 'new_game',
      description: 'Throw the current game away and begin a new one in the setup phase with fresh armies. Code cells are kept.',
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.newGame(),
    },
    {
      name: 'list_tabs',
      description:
        "List the tabs that hold a sheet of code cells (the game board's, and the Lab's), which one the player is looking at, and how cell paths are written (/lab/J24). Call this once to learn where cells can live.",
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.tabs(),
    },
    {
      name: 'list_cells',
      description:
        "List the spreadsheet cells that contain TypeScript code, with tab, address, absolute path, uid, code, printed output and error message (if any). Use this to see what the child has written and why it may be failing. By default only the board tab is listed; pass tab 'lab' for the Lab's demos or 'all' for every tab.",
      inputSchema: obj({ tab: { type: 'string', description: "'board' (default), 'lab' or 'all'" } }),
      readOnly: true,
      run: (a) => api.cells(a.tab),
    },
    {
      name: 'get_cell',
      description: `Read one cell: its code, output, error and shown text. ${ADDR}`,
      inputSchema: obj({ address: str(ADDR), tab: TAB_PROP }, ['address']),
      readOnly: true,
      run: (a) => api.getCell(a.address, a.tab),
    },
    {
      name: 'resolve_cell',
      description: `Find where a cell is now. Pass an address, a path or a uid (c-xxxxxxxx); returns { tab, address, path, uid, hasCode }. A uid stays with its code when cells move, swap or rows are inserted, so store uids, not addresses. ${ADDR}`,
      inputSchema: obj({ address_or_uid: str(ADDR), tab: TAB_PROP }, ['address_or_uid']),
      readOnly: true,
      run: (a) => api.resolve(a.address_or_uid, a.tab),
    },
    {
      name: 'set_cell_code',
      description:
        "Write TypeScript into a cell (replacing what was there) and run it. Use row 12 or lower, e.g. A12; board squares A1:J10 cannot hold code. Cell code can use print('text'), color('#ecdcd8'), game.pieces('red'), at('B7'), range('A1:J10'), game.move('B7','B6'); call mms.help() or read llms.txt for the full list. Returns the printed output or the error message so you can explain it in plain words. Empty code clears the cell.",
      inputSchema: obj(
        { address: str(ADDR), tab: TAB_PROP, code: str('TypeScript source for the cell'), run: { type: 'boolean', description: 'Wait for the result (default true).' } },
        ['address', 'code'],
      ),
      readOnly: false,
      run: (a) => api.setCode(a.address, a.code, { run: a.run !== false, tab: typeof a.tab === 'string' ? a.tab : undefined }),
    },
    {
      name: 'write_code_live',
      description:
        "Show the player how code is written: opens the floating code editor on a cell and types your TypeScript into it so the player watches it appear. Nothing is saved or run yet; the player reads it and closes the editor (Esc or Restart & close), which keeps and runs the code. Prefer this over set_cell_code when the player is watching or learning. Afterwards poll get_state until editorOpenOn is null, then get_cell for the output.",
      inputSchema: obj({ address: str(ADDR), tab: TAB_PROP, code: str('TypeScript source to type into the editor') }, ['address', 'code']),
      readOnly: false,
      run: (a) => api.writeCodeLive(a.address, a.code, a.tab),
    },
    {
      name: 'read_readme',
      description:
        `Read the README of this project, the place of truth, fetched from GitHub (${README_URL}). Everybody starts here: until you have read it (or called confirm_readme), your first call is answered with the rules instead of being carried out. Part 1 comes first and begins with the table of contents; call again with part 2, 3 ... for the rest.`,
      inputSchema: obj({ part: { type: 'integer', description: 'Which part, from 1 (default 1).' } }),
      readOnly: true,
      run: async (a) => {
        // Who is calling is known only until the first await.
        const who = participant();
        try {
          const r = await readReadme(typeof a.part === 'number' ? a.part : 1);
          if (who) markOriented(who);
          return ok({ ...r, next: r.part < r.parts ? `call read_readme with part ${r.part + 1}` : 'that was the last part' });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    },
    {
      name: 'confirm_readme',
      description: `Say that you read the README (${README_URL}) by opening it yourself, with one sentence on what you learned from it. This lets your calls through, like read_readme does.`,
      inputSchema: obj({ summary: { type: 'string', description: 'One sentence: what the README says this app is and how you should behave.' } }, ['summary']),
      readOnly: true,
      run: (a) => {
        const summary = typeof a.summary === 'string' ? a.summary.trim() : '';
        if (summary.length < 20) return fail('Say in a sentence what you learned from the README (at least 20 characters). If you have not read it, call read_readme.');
        const who = participant();
        if (who) markOriented(who);
        router.notify('ai', 'router', 'ai/readme-confirmed', { summary: summary.slice(0, 200) }, outsideTrace());
        return ok({ welcome: 'Thank you. Your calls go through now.', summary: summary.slice(0, 200) });
      },
    },
    {
      name: 'introduce',
      description: 'Say who you are, so the page can show it in the router traffic and the history of changes: your client program, its version, the AI model behind you, and a note. Optional but welcome: the more the page knows, the better it can help you and the person watching. You can also say it when you connect: clientInfo.name/version (and clientInfo.model or _meta.model) in initialize, or the HTTP headers X-MCP-Client and X-MCP-Model. Your messages then show as origin outside-ai:<client>@<model>. Returns what the page knows about you.',
      inputSchema: obj({ client: str('The program you run in, e.g. claude-code, copilot-chat, my-script'), model: str('The model behind you, e.g. claude-opus-4, gpt-5'), version: str('Version of the client'), note: str('One line about what you are here to do') }),
      readOnly: true,
      run: () => {
        const me = currentCaller();
        return ok({ you: me, origin: me?.origin ?? 'console-or-webmcp', everyoneSeen: callers().map((c) => ({ origin: c.origin, calls: c.calls })) });
      },
    },
    {
      name: 'get_requests',
      description:
        "List the questions the player wrote to you inside cells. A request is a comment line that starts with `// AI:` (or `// @ai`, `//ai`, `//help`), for example `// AI: make this cell blue`; a bare `//ai` or `//help` means: look at my code here and help me. This also reads text the player is still typing in the open editor (unsaved: true). By default only unanswered requests are returned; each has address, uid, line and text. Answer with reply_to_request.",
      inputSchema: obj({ include_answered: { type: 'boolean', description: 'Also return requests that already have an answer (default false).' } }),
      readOnly: true,
      run: (a) => api.requests(a.include_answered === true),
    },
    {
      name: 'wait_for_request',
      description:
        "Listen for the player. Returns as soon as an unanswered `// AI:` comment exists in any cell (including unsaved text in the open editor), or after `seconds` (max 20) with an empty list. The page cannot call you, so call this again and again to keep listening, answer each request with reply_to_request, and read the cell with get_cell before you change its code.",
      inputSchema: obj({ seconds: { type: 'number', description: 'How long to wait, 1 to 20 (default 15).' } }),
      readOnly: true,
      run: (a) => api.waitForRequest(a.seconds),
    },
    {
      name: 'reply_to_request',
      description:
        "Answer a request from get_requests: writes your reply as a short comment (`// ↳ AI: ...`) right below the player's `// AI:` line. If the editor is open on that cell the reply appears there while the player watches. Use the line number from get_requests. Keep it short and friendly; to change code, use write_code_live.",
      inputSchema: obj({ address: str(ADDR), tab: TAB_PROP, line: { type: 'number', description: 'Line number of the request, from get_requests.' }, reply: str('Your answer, a few friendly sentences at most.') }, ['address', 'line', 'reply']),
      readOnly: false,
      run: (a) => api.replyToRequest(a.address, a.line, a.reply, a.tab),
    },
    {
      name: 'run_cell',
      description: 'Run a code cell again and return its printed output, or its error message if the code is wrong.',
      inputSchema: obj({ address: str(ADDR), tab: TAB_PROP }, ['address']),
      readOnly: false,
      run: (a) => api.runCell(a.address, a.tab),
    },
    {
      name: 'set_mode',
      description: "Switch every code cell between showing what it printed ('run') and showing its source code ('view').",
      inputSchema: obj({ mode: { type: 'string', enum: ['run', 'view'], description: "'run' shows output, 'view' shows code" } }, ['mode']),
      readOnly: false,
      run: (a) => api.setMode(a.mode),
    },
    {
      name: 'say_to_player',
      description: "Show a short, friendly message to the player in the game's speech bubble (max 500 characters).",
      inputSchema: obj({ text: str('The message to show') }, ['text']),
      readOnly: false,
      run: (a) => api.say(a.text),
    },
    {
      name: 'mcp_request',
      description:
        "Send an MCP request to one of the page's tab servers (they are named like the tabs: 'board', 'lab') through the page's router. Tabs: board, lab and examples. Methods: initialize, resources/list, resources/read {uri}, resources/subscribe, tools/list, tools/call {name, arguments}. Tools of a tab: list_cells, get_cell, run_cell, set_code, click (triggers a cell's click event), flash, signal. Example: server 'lab', method 'tools/call', params { name: 'click', arguments: { address: 'J24' } }.",
      inputSchema: obj({ server: str("'board', 'lab' or 'examples'"), method: str('The MCP method, for example resources/read or tools/call'), params: { type: 'object', description: 'The parameters of the method', additionalProperties: true } }, ['server', 'method']),
      readOnly: false,
      run: (a) => api.mcp(a.server, a.method, a.params),
    },
    {
      name: 'check_mail',
      description: 'The internal mail: how many unread letters wait for you (letters from the player, the helper or cells). Cheap: call it now and then, then read_mail. To write: send_mail.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.mail('check', {}),
    },
    {
      name: 'read_mail',
      description: 'The internal mail. Without an id: your inbox (id, from, subject, first words; unread_only=true for the new ones). With an id (like "m-3"): that whole letter and its conversation.',
      inputSchema: obj({ id: str('A letter id like "m-3". Leave out to list the inbox.'), unread_only: { type: 'boolean', description: 'Only letters not read yet.' } }),
      readOnly: false,
      run: (a) => (typeof a.id === 'string' && a.id ? api.mail('read', { id: a.id }) : api.mail('inbox', { unread_only: a.unread_only === true })),
    },
    {
      name: 'send_mail',
      description: 'The internal mail: write a letter. to is "you" (the player, who reads it under the ✉ button), "ai-chat" (the helper in the sidebar), "lab:A16" (a cell) or several with commas. Or answer a letter: give reply_to (its id) and a body. Example: {"to":"you","subject":"Hi","body":"Try cell A12!"}',
      inputSchema: obj({ to: str('Who gets it. Leave out when you give reply_to.'), body: str('The letter (at most 4000 characters)'), subject: str('A few words (optional)'), reply_to: str('The id of the letter you answer (optional)') }, ['body']),
      readOnly: false,
      run: (a) => (typeof a.reply_to === 'string' && a.reply_to ? api.mail('reply', { id: a.reply_to, body: a.body }) : api.mail('send', { to: a.to, subject: a.subject, body: a.body })),
    },
    {
      name: 'mcp_log',
      description: "The last messages that crossed the page's MCP router (who asked whom, what the answer was, how long it took). Use it to see what the cells and tabs are saying to each other.",
      inputSchema: obj({ count: { type: 'number', description: 'How many messages, newest last (default 20, at most 400)' } }),
      readOnly: true,
      run: (a) => api.mcpLog(a.count),
    },
    {
      name: 'export_svg',
      description: 'Get an SVG picture (as text) of the whole board and sheet as drawn right now.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.exportSvg(),
    },
  ];

  // An outside AI (over the dev server's /mcp, or WebMCP) drives the page with these tools. Most of them never touch the router, so each call
  // is announced on it as coming from "ai": the router drawing then shows the outside AI's work too. (mcp_request is a real router request already.)
  const targetOf = (name: string, args: Json): string => {
    const tab = typeof args.tab === 'string' ? args.tab : typeof args.address === 'string' && args.address.startsWith('/') ? args.address.split('/')[1] : '';
    if (/cell|code|^run_cell$/.test(name)) return tab && tab !== 'all' ? tab : 'board';
    if (/request|reply/.test(name)) return 'helper';
    if (name === 'list_tabs' || name === 'mcp_log') return 'router';
    if (name === 'get_docs') return 'cells';
    return 'board';
  };
  // First contact: an AI that came in from outside (the bridge, WebMCP) reads the README before its first call is carried out.
  const OPEN = new Set(['read_readme', 'confirm_readme', 'introduce']);
  for (const t of tools) {
    const run = t.run.bind(t);
    t.run = (args) => {
      const who = participant();
      if (who && !OPEN.has(t.name) && !isOriented(who)) return fail(`Read the README first (${README_URL}); your call to ${t.name} was not carried out.`, orientation(who, t.name));
      return run(args);
    };
  }
  for (const t of tools) {
    if (t.name === 'mcp_request' || t.name.endsWith('_mail')) continue;
    const run = t.run.bind(t);
    t.run = (args) => {
      router.notify('ai', targetOf(t.name, args), `tools/${t.name}`, args, outsideTrace());
      return run(args);
    };
  }

  const webmcp: { available: boolean; api: string | null; registered: string[]; errors: string[]; note?: string } = {
    available: false,
    api: null,
    registered: [],
    errors: [],
  };

  // Current spec (Chrome 149 origin trial): document.modelContext.registerTool(tool, { signal }) returning a Promise,
  // execute(args, { signal }) fulfilling with any JSON-able value. Older drafts: navigator.modelContext.registerTool,
  // results shaped { content: [{ type: 'text', text }] }.
  function registerWebMcp(): void {
    try {
      const doc = document as unknown as { modelContext?: ModelContextLike };
      const nav = navigator as unknown as { modelContext?: ModelContextLike };
      const legacy = !doc.modelContext;
      const mc = doc.modelContext ?? nav.modelContext;
      if (!mc || typeof mc.registerTool !== 'function') {
        webmcp.note = WEBMCP_PERMISSION_NOTE;
        return;
      }
      webmcp.available = true;
      webmcp.api = legacy ? 'navigator.modelContext' : 'document.modelContext';
      const w = window as unknown as { __mmsWebMcpAbort?: AbortController };
      w.__mmsWebMcpAbort?.abort();
      const controller = new AbortController();
      w.__mmsWebMcpAbort = controller;
      for (const t of tools) {
        const tool = {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly },
          async execute(args: unknown): Promise<unknown> {
            const input = (args && typeof args === 'object' ? args : {}) as Json;
            let result: Result;
            try {
              result = await throughChannel('webmcp', undefined, () => t.run(input));
            } catch (err) {
              result = fail(err instanceof Error ? err.message : String(err));
            }
            const text = JSON.stringify(result);
            return legacy ? { content: [{ type: 'text', text }] } : text;
          },
        };
        try {
          Promise.resolve(mc.registerTool(tool, { signal: controller.signal })).then(
            () => webmcp.registered.push(t.name),
            (err: unknown) => webmcp.errors.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`),
          );
        } catch (err) {
          webmcp.errors.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      webmcp.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  registerWebMcp();

  Object.assign(window as unknown as Record<string, unknown>, {
    mms: { ...api, webmcp, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), version: 2 },
  });
  installMcpBridge(tools);
  // The in-page AI helper (see aichat/) uses the same actions as an outside assistant would.
  return api;
}

interface ModelContextLike {
  registerTool(tool: unknown, options?: { signal: AbortSignal }): unknown;
}
