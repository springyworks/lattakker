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
import { colToLetters, lettersToCol } from '../sheet/address';
import { McpError, router } from '../mcp/router';
import { callers, currentCaller, outsideTrace, participant, throughChannel } from './entry';
import { showSubtitle } from '../ui/subtitles';
import { README_URL, isOriented, markOriented, orientation, readReadme } from './orientation';
import MMS_GUIDE from 'virtual:readme-mms';
import { docUrls, askRules } from '../aichat/docs';
import { bellOn, machineRunning, soundSources } from '../aichat/bell';

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

const LEGEND_BLUE =
  'Legend (seen as Blue): B10 = your own Blue piece of rank 10 (B1..B10; BS = Blue Spy, rank 1; BB = Blue Bomb; BF = Blue Flag). ' +
  'R? = hidden Red piece (rank unknown). r5 = Red piece revealed by combat, rank 5 (rS = spy, rB = bomb, rF = flag). ' +
  '~~ = lake (nobody can enter). .. = empty square. Columns A-J left to right, rows 1-10 top to bottom: ' +
  "row 1 is Blue's back row, Blue moves down the board.";

type Side = 'red' | 'blue';

/** What mms.help() returns: chapter 11.3.5 of the README, the one home of this guide (cut out of it when the app is built). */
const HELP = `LATTAKKER SHEET - window.mms guide. This is chapter 11.3.5 of the README (${README_URL}), the place of truth.\n\n${MMS_GUIDE}\n`;


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

  /** One square as text, seen from `as`: your own pieces show their rank, the other side's only once combat revealed them. */
  function tokenFor(row: number, col: number, as: Side = 'red'): string {
    if (isLake(row, col)) return '~~';
    const p: Piece | null = game().board[row]?.[col] ?? null;
    if (!p) return '..';
    if (p.color === as) return `${as === 'red' ? 'R' : 'B'}${rankGlyph(p.rank)}`;
    const other = as === 'red' ? 'b' : 'r';
    return p.revealed ? `${other}${rankGlyph(p.rank)}` : `${other === 'b' ? 'B' : 'R'}?`;
  }

  function boardRows(as: Side = 'red'): string[] {
    const rows: string[] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      const tokens: string[] = [];
      for (let c = 0; c < BOARD_COLS; c++) tokens.push(tokenFor(r, c, as).padEnd(3));
      rows.push(tokens.join(' ').trimEnd());
    }
    return rows;
  }

  function boardText(as: Side = 'red'): string {
    const header = 'Columns: ' + [...COLUMNS].map((c) => c.padEnd(3)).join(' ').trimEnd();
    const lines = boardRows(as).map((row, i) => `${`Row ${i + 1}:`.padEnd(7)} ${row}`);
    return [header, ...lines].join('\n');
  }

  /** Set while an outside AI plays Blue (see takeOverBlue); calling it hands Blue back to the built-in player. */
  let blueRelease: (() => void) | null = null;

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
      bluePlayer: view.bluePlayer,
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

    /** The rules counter: a few words in, the matching sections of the rules and the standing directives out. */
    askRules(query?: unknown): Result {
      try {
        return ok({ text: askRules(typeof query === 'string' ? query : '', typeof query === 'string' && query.trim() ? 4000 : 20000), wholeFile: docUrls().rules });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },

    /** The tool finder of the router: a few words in, the best few tools of every server out. */
    async findTools(query?: unknown): Promise<Result> {
      try {
        const r = (await router.request('ai', 'router', 'tools/call', { name: 'find_tools', arguments: { query: typeof query === 'string' ? query : '' } }, outsideTrace())) as { structuredContent?: Record<string, unknown> };
        return ok({ ...(r.structuredContent ?? {}), how: "Use a hit with mcp_request: server, method 'tools/call', params { name: tool, arguments: ... } (the arguments_json of a hit shows which arguments it needs)." });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },

    state: (): Result => ok(stateData()),

    board(as?: unknown): Result {
      const side: Side = typeof as === 'string' && as.trim().toLowerCase() === 'blue' ? 'blue' : 'red';
      if (side === 'blue' && !blueRelease) return fail("Blue's point of view is for the player of Blue: call takeOverBlue() first.");
      return ok({ rows: boardRows(side), columns: [...COLUMNS], legend: side === 'blue' ? LEGEND_BLUE : LEGEND, text: boardText(side), as: side });
    },

    legalMoves(fromOrColor: unknown): Result {
      if (typeof fromOrColor !== 'string') return fail("pass 'red' or a Red square such as 'B7'");
      const key = fromOrColor.trim();
      const lower = key.toLowerCase();
      if (lower === 'blue' && !blueRelease) return fail("Blue's moves are hidden. Ask for 'red' or a Red square, or take Blue over (takeOverBlue) to play Blue yourself.");
      if (lower === 'red' || lower === 'blue') {
        const moves = game()
          .allLegalMoves(lower)
          .map((m) => ({ from: view.addrOf(m.from), to: view.addrOf(m.to) }));
        return ok({ moves, note: game().phase === 'play' ? undefined : 'No moves until the battle starts (call start).' });
      }
      const pos = view.posOf(key.toUpperCase());
      if (!pos) return fail(`"${key}" is not a board square (A1 to J10)`);
      const piece = game().at(pos);
      if (!piece) return ok({ moves: [], note: 'That square is empty.' });
      if (piece.color !== 'red' && !blueRelease) return fail("That is a Blue piece; Blue's moves are hidden.");
      return ok({ moves: game().legalMoves(pos).map((to) => ({ from: view.addrOf(pos), to: view.addrOf(to) })) });
    },

    async move(from: unknown, to: unknown, color?: unknown): Promise<Result> {
      if (typeof from !== 'string' || typeof to !== 'string') return fail('move(from, to) needs two squares like "B7", "B6"');
      const who = color === undefined || color === null || color === '' ? 'red' : typeof color === 'string' ? color.trim().toLowerCase() : '';
      if (who !== 'red' && who !== 'blue') return fail("the colour is 'red' (default) or 'blue'");
      if (who === 'blue' && !blueRelease) return fail('Blue is played by the built-in player. Call takeOverBlue() first, then move for Blue.');
      const message = view.codeMove(from.trim().toUpperCase(), to.trim().toUpperCase(), who);
      if (!message.startsWith('Moving')) return fail(message);
      const done = await waitForMoves();
      flush();
      return ok({ message, settled: done, state: stateData() });
    },

    /** An outside AI plays Blue: the built-in player keeps quiet until giveBackBlue() (or a reload). */
    takeOverBlue(): Result {
      if (!blueRelease) blueRelease = view.takeOverBlue();
      flush();
      return ok({ message: "You play Blue now. Make Blue's moves with move(from, to, 'blue'); see Blue's side with board('blue'). Call giveBackBlue() when you are done.", state: stateData() });
    },

    giveBackBlue(): Result {
      const had = blueRelease !== null;
      blueRelease?.();
      blueRelease = null;
      flush();
      return ok({ message: had ? 'The built-in Blue player plays again.' : 'The built-in Blue player was already playing.', state: stateData() });
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

    /** Which cells made the teletype sound lately (the culprits of a sound nobody can place); they flash once so you can see them. */
    sounds: (): Result => {
      const sources = soundSources();
      for (const src of sources) {
        const hit = workspace.resolve(src.path);
        if (!('error' in hit)) hit.tab.sheet.flash(hit.address);
      }
      return ok({ muted: !bellOn(), motorRunning: machineRunning(), sources, note: 'Cells that used teletype.print/key/cr/bell in the last 30 seconds, newest first. Stop one with its cell menu "Stop timers & watchers", or edit its code.' });
    },

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

    insertColumn(column: unknown, side: unknown = 'right', tab?: unknown): Result {
      if (typeof column !== 'string' || !/^[a-z]{1,2}$/i.test(column.trim())) return fail('column must be a column letter like "C"');
      if (side !== 'left' && side !== 'right') return fail("side must be 'left' or 'right' of that column");
      const found = workspace.get(typeof tab === 'string' && tab.trim() ? tab.trim().toLowerCase() : 'board');
      if (!found) return fail(`There is no tab "${String(tab)}".`);
      const col = lettersToCol(column.trim());
      if (col >= found.sheet.colCount) return fail(`${column.toUpperCase()} is beyond the last column (${colToLetters(found.sheet.colCount - 1)}) of ${found.id}.`);
      const after = side === 'left' ? col - 1 : col;
      const why = found.sheet.columnInsertProblem(after);
      if (why) return fail(why);
      found.select();
      found.sheet.insertColumn(after);
      found.sheet.reveal(null, after + 1, false);
      found.sheet.highlightColumn(after + 1);
      hud.say(`A new column ${colToLetters(after + 1)} was inserted. Everything to the right moved over; references in code are updated.`, 'good');
      flush();
      return ok({ tab: found.id, inserted: colToLetters(after + 1), columns: found.sheet.colCount, note: 'Cells from the old column onward moved one column right; address literals in code were rewritten.' });
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

    subtitle(text: unknown, seconds?: unknown): Result {
      if (typeof text !== 'string') return fail('subtitle(text, seconds?) needs a string (an empty one removes the subtitle)');
      const s = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), 60) : undefined;
      showSubtitle(text, s);
      return ok({ shown: text.trim().length > 0, seconds: s ?? 'a reading time' });
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
      name: 'ask_rules',
      description: 'Ask the rules a question: give a few words (like "write in somebody\'s cell" or "personal information") and get the sections of the rules for AI helpers that answer them, with the owner\'s standing directives and their strengths. Without a query, the whole rules text. One counter for every AI: the built-in helper reads the same file. Never blocked: you may ask the rules before anything else.',
      inputSchema: obj({ query: str('A few words about what you want to know. Leave out for the whole rules text.') }),
      readOnly: true,
      run: (a) => api.askRules(a.query),
    },
    {
      name: 'find_tools',
      description: 'Find the MCP tool you need by a few words (like "weather", "write cell code", "send a letter"). Gives the best few tools of all servers of this page: server, tool, one sentence on what it does and the call to copy. Never blocked: use it before anything else when you do not know what is possible.',
      inputSchema: obj({ query: str('A few words about what you want to do.') }, ['query']),
      readOnly: true,
      run: (a) => api.findTools(a.query),
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
        "Read the 10x10 board as text. R10 is a visible Red piece of rank 10, B? a hidden Blue piece, b5 a revealed Blue piece, ~~ a lake, .. an empty square. Columns A-J, rows 1-10 (row 1 is at the top, Blue side). Hidden Blue pieces stay hidden. After take_over_blue, as 'blue' shows the board from Blue's side (B10 your own Blue piece, R? a hidden Red piece).",
      inputSchema: obj({ as: str("'red' (default) or 'blue' (only after take_over_blue)") }),
      readOnly: true,
      run: (a) => api.board(a.as),
    },
    {
      name: 'legal_moves',
      description: "List legal moves for the player's Red army. Pass 'red' for every Red move, or one Red square such as 'B7' for that piece. Pass 'blue' (or a Blue square) only after take_over_blue. Only works once the battle has started.",
      inputSchema: obj({ from_or_color: str("'red' or a Red square like 'B7' ('blue' after take_over_blue)") }, ['from_or_color']),
      readOnly: true,
      run: (a) => api.legalMoves(a.from_or_color),
    },
    {
      name: 'make_move',
      description:
        "Move a Red piece from one square to another during the battle (for example from B7 to B6). Pieces move one square up, down, left or right; Scouts (rank 2) can slide any distance. Waits for Blue to answer, then returns the new state. With color 'blue' (only after take_over_blue) it moves a Blue piece instead, and nobody answers: you play both sides. If the move is not allowed you get a kid-friendly reason to explain.",
      inputSchema: obj({ from: str('Square to move from, e.g. B7'), to: str('Square to move to, e.g. B6'), color: str("'red' (default) or 'blue' (only after take_over_blue)") }, ['from', 'to']),
      readOnly: false,
      run: (a) => api.move(a.from, a.to, a.color),
    },
    {
      name: 'take_over_blue',
      description: "Play Blue yourself: the built-in Blue player stops answering, and make_move with color 'blue' makes Blue's moves. With it, two virtual players (two AIs, or you for both sides) can play each other. Blue goes back to the built-in player with give_back_blue (or when the page is reloaded).",
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.takeOverBlue(),
    },
    {
      name: 'give_back_blue',
      description: 'Hand Blue back to the built-in Blue player, which then answers again (at once when it is Blue\'s turn).',
      inputSchema: obj({}),
      readOnly: false,
      run: () => api.giveBackBlue(),
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
      name: 'list_sounds',
      description: 'Which cells made the ASR-33 teletype sound in the last 30 seconds (cells that call teletype.print, key, cr or bell), whether the motor runs and whether the speaker is muted. The cells flash once on screen. Use it to find the cell behind a sound.',
      inputSchema: obj({}),
      readOnly: true,
      run: () => api.sounds(),
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
      name: 'subtitle',
      description: 'Show a subtitle at the bottom of the screen, for a screen recording: it tells the viewer of the video what is going on. It goes away after a reading time (or after seconds; 0 = until the next one). An empty text removes it.',
      inputSchema: obj({ text: str('The subtitle (one or two short lines, at most 220 characters)'), seconds: { type: 'number', description: 'How long to show it (0 to 60; 0 = until the next subtitle). Default: a reading time.' } }, ['text']),
      readOnly: false,
      run: (a) => api.subtitle(a.text, a.seconds),
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
        "Send an MCP request to one of the page's tab servers (they are named like the tabs: 'board', 'lab') through the page's router. Tabs: board, lab and examples. Methods: initialize, resources/list, resources/read {uri}, resources/subscribe, tools/list, tools/call {name, arguments}. Tools of a tab: list_cells, get_cell, run_cell, set_code, click (triggers a cell's click event), flash, zoom (address | out | fit | scale), signal. Example: server 'lab', method 'tools/call', params { name: 'click', arguments: { address: 'J24' } }.",
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
    if (name === 'get_docs' || name === 'ask_rules') return 'cells';
    if (name === 'find_tools') return 'router';
    return 'board';
  };
  // First contact: an AI that came in from outside (the bridge, WebMCP) reads the README before its first call is carried out. The rules themselves are never locked.
  const OPEN = new Set(['read_readme', 'confirm_readme', 'introduce', 'ask_rules', 'find_tools']);
  for (const t of tools) {
    const run = t.run.bind(t);
    t.run = (args) => {
      const who = participant();
      if (who && !OPEN.has(t.name) && !isOriented(who)) return fail(`Read the README first (${README_URL}); your call to ${t.name} was not carried out.`, orientation(who, t.name));
      // Run-away: an outside AI that repeats a call (or makes far too many) is refused with words it can obey; the person's home square starts clean.
      const caller = who && !OPEN.has(t.name) ? currentCaller() : null;
      const refusal = caller ? router.admit(caller.origin, undefined, `${t.name} ${JSON.stringify(args ?? {}).slice(0, 120)}`) : null;
      if (refusal) return fail(refusal);
      return run(args);
    };
  }
  for (const t of tools) {
    if (t.name === 'mcp_request' || t.name === 'find_tools' || t.name.endsWith('_mail')) continue;
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
