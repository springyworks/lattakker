import { Codec, ImageExport, SvgCanvas2D, registerAllCodecs, xmlUtils } from '@maxgraph/core';
import type { Sheet, SheetCellData } from '../sheet/Sheet';
import type { GameView } from '../game/GameView';
import type { Hud } from '../ui/Hud';
import type { CellEditor } from '../editor/CellEditor';
import { modelFor } from '../editor/monaco';
import { BOARD_COLS, BOARD_ROWS, isLake, rankGlyph, type Piece } from '../game/model';

/**
 * Makes the page usable by external AI agents (browser extensions, MCP-in-browser agents):
 * a visually-hidden text mirror of the game, window.mms, and WebMCP tools. All local, no network.
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

const HELP = `LATTAKKER SHEET - window.mms guide (everything runs locally in this page; free, no network, no tracking)

The page is a Lattakker board that is also a spreadsheet. Red is the child/player, Blue is the computer. Cells below the board (A12, E12, ...) hold TypeScript that runs live.
Every mms method returns plain JSON. Errors never throw: you get { ok: false, error: "..." }. Success is { ok: true, ... }.
Methods marked (async) return a Promise: await them.

READ
  mms.help()                 this guide
  mms.state()                { phase: 'setup'|'play'|'over', turn, winner, moveCount, lastMove, message, busy, redPieces, bluePieces }
  mms.board()                { rows: [10 strings, row 1 first], legend, text }. Hidden Blue pieces stay hidden (B?).
  mms.legalMoves(x)          x = 'red' or a Red square like 'B7' -> [{from,to}]. Only Red is shown (Blue stays secret).
  mms.cells()                all cells holding code: [{address, code, output, error, mode}]
  mms.getCell('A12')         one cell: { code, output, error, text, mode, ... }
  mms.exportSvg()            SVG string snapshot of the maxGraph canvas
  mms.exportModelXml()       maxGraph model as XML (large)

ACT
  mms.shuffle()              setup phase only: re-deal Red's army randomly
  mms.start()                setup -> play (Red moves first)
  mms.move('B7','B6') (async)  Red moves one square (Scouts: any distance in a line); waits for Blue's reply. Returns the new state.
  mms.pause() / mms.resume() pause or continue the battle (nobody moves while paused)
  mms.newGame()              back to setup with new armies
  mms.undo()                 take back Red's last move and Blue's answer
  mms.setCode('A12', code, { run: true }) (async)   put TypeScript in a cell; run:false returns immediately (it still runs in the background)
  mms.runCell('A12') (async) re-run a cell, wait, return { output, error }
  mms.clearCell('A12')       empty a cell
  mms.setMode('run'|'view')  cells show output (run) or their code (view)
  mms.say('Nice move!')      show a message to the player in the speech bubble

WebMCP: if the browser supports it, the same actions are registered as tools: get_state, get_board, legal_moves, make_move, shuffle_army, start_battle, pause_battle, resume_battle, undo_move, new_game, list_cells, get_cell, set_cell_code, run_cell, set_mode, say_to_player, export_svg. mms.webmcp tells you what was registered.
The page also keeps an accessible text mirror in #mms-text (board grid, captured pieces, last move, code cells with output and errors).

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
  every('1s', n => ...)  after('5s', fn)  on('B7' | 'A1:J10' | 'game', fn)  stop()   (timers die when the cell re-runs)
  cell.usedBy / cell.reads  addresses that read this cell / that this cell read
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
const ADDR = 'A cell address like A12 (code cells live below the board, row 12 or lower) or a board square like B7.';

export function installAiSurface({ sheet, view, hud, editor }: AiSurfaceDeps): void {
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
      editorOpenOn: editor.isOpen ? editor.address : null,
      sheetMode: sheet.mode,
    };
  }

  function validCodeAddress(raw: unknown): { address: string } | { error: string } {
    if (typeof raw !== 'string' || !raw.trim()) return { error: 'address must be a string like "A12"' };
    const address = sheet.resolve(raw.trim().toUpperCase());
    if (!address) return { error: `"${raw}" is not a cell address (try something like A12; columns A-Z, rows 1-${sheet.rowCount})` };
    return { address };
  }

  function cellData(d: SheetCellData): Json {
    return {
      address: d.address,
      code: d.code,
      output: d.output.join('\n'),
      error: d.error,
      mode: sheet.mode,
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
    setText('footer', 'p', 'AI helpers: window.mms.help() describes every method. Cell code is TypeScript.');
  }

  let timer: number | null = null;
  const schedule = () => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      renderText();
    }, 150);
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
  sheet.onAfterRun(schedule);
  sheet.onCodeChanged(schedule);
  sheet.onModeChange(schedule);
  hud.onSay(schedule);

  document.body.appendChild(region);
  renderText();

  const app = sheet.container;
  app.setAttribute('role', 'application');
  app.setAttribute('aria-label', APP_LABEL);
  app.setAttribute('aria-describedby', 'ai-guide');

  // ----------------------------------------------------- run / settle

  const idle = (): boolean => {
    const s = sheet as unknown as { running?: boolean; runPending?: boolean; runTimer?: number | null };
    return !s.running && !s.runPending && !s.runTimer;
  };

  async function settle(): Promise<boolean> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(30);
      if (idle()) {
        await sleep(30);
        if (idle()) return true;
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

  const api = {
    help: (): string => HELP,

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

    cells: (): Result => ok({ cells: sheet.codeCells().map(cellData) }),

    getCell(address: unknown): Result {
      const a = validCodeAddress(address);
      if ('error' in a) return fail(a.error);
      const d = sheet.dataAt(a.address)!;
      const isBoard = sheet.isBoardAddress(a.address);
      return ok({
        ...cellData(d),
        text: sheet.displayText(d),
        isBoard,
        piece: isBoard ? view.pieceInfoAt(a.address) : null,
        token: isBoard ? tokenFor(d.row, d.col) : null,
      });
    },

    async setCode(address: unknown, code: unknown, options?: { run?: boolean }): Promise<Result> {
      const a = validCodeAddress(address);
      if ('error' in a) return fail(a.error);
      if (typeof code !== 'string') return fail('code must be a string of TypeScript');
      if (code.length > MAX_CODE_CHARS) return fail(`code is too long (max ${MAX_CODE_CHARS} characters)`);
      if (sheet.isBoardAddress(a.address)) return fail(`${a.address} is a board square. Put code in row 12 or lower, e.g. A12.`);
      modelFor(a.address, code);
      sheet.setCode(a.address, code);
      if (options?.run === false) {
        flush();
        return ok({ address: a.address, started: true });
      }
      return api.runCell(a.address);
    },

    async runCell(address: unknown): Promise<Result> {
      const a = validCodeAddress(address);
      if ('error' in a) return fail(a.error);
      const d = sheet.dataAt(a.address)!;
      if (!d.code.trim()) return fail(`${a.address} has no code to run. Use setCode first.`);
      sheet.markDirty([a.address]);
      sheet.requestRun();
      const finished = await settle();
      flush();
      const output = d.output.join('\n');
      if (!finished) return fail('Timed out waiting for the cell to finish (is it waiting on sleep() or looping?)', { address: a.address, output });
      if (d.error) return fail(d.error, { address: a.address, output });
      return ok({ address: a.address, output, text: sheet.displayText(d) });
    },

    clearCell(address: unknown): Result {
      const a = validCodeAddress(address);
      if ('error' in a) return fail(a.error);
      if (sheet.isBoardAddress(a.address)) return fail(`${a.address} is a board square, not a code cell.`);
      modelFor(a.address, '');
      sheet.setCode(a.address, '');
      flush();
      return ok({ address: a.address });
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
      name: 'list_cells',
      description:
        'List every spreadsheet cell that contains TypeScript code, with its address, code, printed output and error message (if any). Use this to see what the child has written and why it may be failing.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.cells(),
    },
    {
      name: 'get_cell',
      description: `Read one cell: its code, output, error and shown text. ${ADDR}`,
      inputSchema: obj({ address: str(ADDR) }, ['address']),
      readOnly: true,
      run: (a) => api.getCell(a.address),
    },
    {
      name: 'set_cell_code',
      description:
        "Write TypeScript into a cell (replacing what was there) and run it. Use row 12 or lower, e.g. A12; board squares A1:J10 cannot hold code. Cell code can use print('text'), color('#ecdcd8'), game.pieces('red'), at('B7'), range('A1:J10'), game.move('B7','B6'); call mms.help() or read llms.txt for the full list. Returns the printed output or the error message so you can explain it in plain words.",
      inputSchema: obj(
        { address: str(ADDR), code: str('TypeScript source for the cell'), run: { type: 'boolean', description: 'Wait for the result (default true).' } },
        ['address', 'code'],
      ),
      readOnly: false,
      run: (a) => api.setCode(a.address, a.code, { run: a.run !== false }),
    },
    {
      name: 'run_cell',
      description: 'Run a code cell again and return its printed output, or its error message if the code is wrong.',
      inputSchema: obj({ address: str(ADDR) }, ['address']),
      readOnly: false,
      run: (a) => api.runCell(a.address),
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
      name: 'export_svg',
      description: 'Get an SVG picture (as text) of the whole board and sheet as drawn right now.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.exportSvg(),
    },
  ];

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
              result = await t.run(input);
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
    mms: { ...api, webmcp, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), version: 1 },
  });
}

interface ModelContextLike {
  registerTool(tool: unknown, options?: { signal: AbortSignal }): unknown;
}
