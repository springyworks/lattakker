import {
  Cell,
  CellOverlay,
  EventObject,
  Geometry,
  Graph,
  ImageBox,
  InternalEvent,
  InternalMouseEvent,
  PanningHandler,
  PopupMenuHandler,
  Point,
  SelectionCellsHandler,
  SelectionHandler,
  TooltipHandler,
  VertexHandler,
  type CellStyle,
  type MouseListenerSet,
} from '@maxgraph/core';
import {
  type BlockMove,
  type RefRewrite,
  blockMoveRewrite,
  colToLetters,
  expandRange,
  formatAddress,
  mapAddressLiterals,
  movedTo,
  parseAddress,
  parseRange,
  rowInsertRewrite,
  colInsertRewrite,
} from './address';
import { THEME } from '../theme';
import { DependencyGraph, MODE_NODE, ROWS_NODE, COLS_NODE, codeNode, enterNode, leaveNode, moduleNode, sizeNode } from './reactivity';
import { CancelError, RunContext } from './tasks';
import { CellModules, type Probe } from './cellModules';
import { Spring } from './spring';
import { decideSpan, emptyShape, readSpanCall, rewriteSpanCall, type ShapeState, type Size } from './shape';
import { SheetCellHandler } from './cellHandler';
import { Overlays } from './overlays';
import { plotSvg, tilesSvg, type PlotSpec } from './plot';
import { advance, feedMs, PAPER_CPS, paperFontReady, paperLayout, paperSpeed, paperStyle, printStep, settle, type PaperLayout, type PaperOptions, type PrintState } from './paper';
import { registerPaperShape } from './paperShape';
import { bellOn, primeBell, printChar, setBell } from '../aichat/bell';
import type { SvgScene } from './svgScene';

/** The height of one line of printed text (12px at 1.3, see .cell-text.out) and the room a cell's frame and padding take from its height. */
const TEXT_LINE_PX = 15.6;
const TEXT_PAD_Y = 8;

/** A cell that takes longer than this is moved to the background so the others can run. */
const RUN_SLICE_MS = 150;

export const COLS = 26;
export const ROWS = 60;
/** Hard ceilings for auto-grow: addresses stay at most two letters and three digits (ZZ999-style). */
export const MAX_COLS = 52;
/** On the board tab, the last column of the game panel (Q): code shifted with columns must stay clear of it. */
const BOARD_LAST_COL = 16;
export const MAX_ROWS = 999;
export const CW = 60;
export const CH = 60;
export const HDR_W = 44;
export const HDR_H = 26;
/** The furthest the sheet zooms out; far enough to see a whole tall sheet at once. */
export const MIN_SCALE = 0.15;
export const ORIGIN_X = HDR_W;
export const ORIGIN_Y = HDR_H;

export type Mode = 'run' | 'view';

/** Visual properties that can be layered on a cell. */
export interface CellVisual {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontColor?: string;
  fontSize?: number;
  label?: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Print the text like a teletype on old paper (set by `paper()` in cell code). */
  paper?: PaperOptions;
}

/** What a move, swap or row insert did to the addresses written inside code. */
export interface ReferenceReport {
  /** How many address literals were rewritten. */
  count: number;
  /** The cells (at their new addresses) whose code changed. */
  cells: string[];
  /** Plain-language notes about references that could not safely be followed. */
  warnings: string[];
}

/** A grid of tiles that lives inside one cell block: its own coordinates (x across, y down, from 0). */
export interface TileGrid {
  cols: number;
  rows: number;
  /** Row-major; null leaves the block's own colour showing. */
  fills: Array<string | null>;
  texts: Array<string | null>;
  /** Text colour per tile (null: the default dark ink). */
  inks: Array<string | null>;
  /** Bold text per tile. */
  bolds: boolean[];
  /** Runs of text that flow across several tiles (g.text(...)). */
  labels: TileLabel[];
  /** A thin white line between the tiles (grid(cols, rows, { lines: false }) leaves it out, for a smooth surface). */
  lines: boolean;
}

/** A line of text laid over a stretch of tiles. */
export interface TileLabel {
  x: number;
  y: number;
  /** How many tiles wide it is. */
  w: number;
  text: string;
  ink: string | null;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  /** One letter per tile (a terminal), instead of flowing text. */
  snap: boolean;
  mono: boolean;
  /** The letters' height as a fraction of a tile's height. */
  size: number | null;
}

/** Where a sheet is looking: zoom and scroll position. */
export interface SheetView {
  scale: number;
  left: number;
  top: number;
}

export interface SheetCellData {
  address: string;
  col: number;
  row: number;
  /** Stable id of the code: kept through edits, moves and row inserts, '' when the cell is empty. */
  uid: string;
  code: string;
  output: string[];
  /** An XY plot drawn in the cell (plot(...)), or null. */
  plot: PlotSpec | null;
  /** A tile grid painted inside this block (grid(w, h) in the cell's code), or null. */
  tiles: TileGrid | null;
  /** A live animated drawing shown in this block (svg(...) in the cell's code), or null. */
  scene: SvgScene | null;
  viewText: string | null;
  codeVisual: CellVisual;
  span: { cols: number; rows: number };
  /** Who decided the size: the person (handles, a selection) and/or the code (span(...)); see shape.ts. Moves with the code. */
  shape: ShapeState;
  error: string | null;
  /** Survives re-runs and moves with the code; the cell's own notebook (see `memory` in the API). */
  memory: Record<string, unknown>;
  /** How many times this code has run since it was written or last moved. */
  runCount: number;
  /** Why the last run started: 'edit' (code written), 'moved' (block or row moved) or 'update'. */
  runReason: RunReason;
}

export type RunReason = 'edit' | 'moved' | 'update';

/** More than this many passes in RUNAWAY_WINDOW_MS means cells are triggering each other in a loop. */
const RUNAWAY_PASSES = 400;
const RUNAWAY_WINDOW_MS = 2000;

export interface SheetListeners {
  onCellClick(address: string, evt: MouseEvent): void;
  onCellDoubleClick(address: string): void;
  /** Ctrl + double-click: zoom in on this cell (null: on nothing in particular, so on what is selected). */
  onZoomRequest?(address: string | null): void;
  onOtherClick(id: string, cell: Cell, evt: MouseEvent): void;
  tooltipFor?(id: string, cell: Cell): string | null;
}

interface ContentDragState {
  address: string;
  cell: Cell;
  size: { width: number; height: number };
  origin: { x: number; y: number };
  /** Where inside the cell the press happened (model units), so a big block keeps its grip point. */
  grab: { x: number; y: number };
  startX: number;
  startY: number;
  moved: boolean;
  spring: Spring;
}

const DRAG_THRESHOLD = 4;
const SHIFT_MS = 650;
const SHIFT_STAGGER_MS = 90;

/** What a move had to do to make room. `shifts` lists the blocks that stepped aside, by address. */
export interface RoomInfo {
  displaced: number;
  addedCols: number;
  addedRows: number;
  shifts: Array<{ from: string; to: string }>;
}

/** A block changed shape: by the person (handles, a selection) or because its code asked for another size. */
export interface ShapeChange {
  address: string;
  size: Size;
  byPerson: boolean;
  /** The person asked for more than fits (code or the board is in the way): the size that was possible was used. */
  limited: boolean;
  /** The `span(...)` line in the code was rewritten to the new numbers. */
  rewrote: boolean;
}

/** A block that is about to step aside: how it looked and where it was, in model units. */
interface ShiftGhost {
  from: string;
  to: string;
  fill: string;
  text: string;
  box: { x: number; y: number; width: number; height: number };
  dest?: { x: number; y: number; width: number; height: number };
}

const BOARD_RE = /^[A-J](10|[1-9])$/;

export function svgUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const PAPER_SOUND_KEY = 'lattakker:paper-sound';

function loadPaperSound(): Set<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(PAPER_SOUND_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePaperSound(keys: Set<string>): void {
  try {
    localStorage.setItem(PAPER_SOUND_KEY, JSON.stringify([...keys]));
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
}

/** The little speaker on a paper cell: waves when the sound is on, a cross when it is off. */
function speakerSvg(on: boolean): string {
  const ink = on ? '#2b2b30' : '#77767a';
  const mark = on
    ? `<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>`
    : `<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="#f5f4ef" fill-opacity="0.88" stroke="#c8c6bd"/><path d="M4 9.5v5h3.5l4.5 3.5V6L7.5 9.5H4z" fill="${ink}"/>${mark}</svg>`;
}

export function newUid(): string {
  const words = crypto.getRandomValues(new Uint32Array(1));
  return 'c-' + words[0].toString(16).padStart(8, '0');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A spreadsheet rendered entirely with maxGraph cells: a grid with spreadsheet headers that stay
 * visible while scrolling, three layers (sheet, pieces, ui), per-cell code with live output,
 * merged ("spanned") cells, highlights, overlays and tooltips.
 */
export class Sheet {
  readonly graph: Graph;
  readonly container: HTMLElement;
  readonly sheetLayer: Cell;
  readonly pieceLayer: Cell;
  readonly uiLayer: Cell;
  /** Pictures drawn over the cells by maxGraph itself: the rubber band, address tags, id badges, the glide of blocks making room. */
  readonly overlays: Overlays;
  readonly cells = new Map<string, Cell>();
  /** Set by whoever draws the hover hint of a cell itself (CellHover), so maxGraph's own tooltip stays out of the way. */
  externalCellHints = false;
  readonly data = new Map<string, SheetCellData>();
  mode: Mode = 'run';
  /** Grows by 1 every insertRow(); start seeded from the ROWS constant. */
  rowCount = ROWS;
  colCount = COLS;

  private baseVisual = new Map<string, CellVisual>();
  private selectionVisual = new Map<string, CellVisual>();
  private flashVisual = new Map<string, CellVisual>();
  private coveredBy = new Map<string, string>();
  private colHeaderGroup!: Cell;
  private rowHeaderGroup!: Cell;
  private corner!: Cell;
  private listeners: SheetListeners | null = null;
  private runner: ((data: SheetCellData, ctx: RunContext) => Promise<void>) | null = null;
  private contexts = new Map<string, RunContext>();
  private subscriptions = new Set<{ nodes: Set<string>; fire: (node: string) => void }>();
  private tickTouched = new Set<string>();
  private nextReason = new Map<string, RunReason>();
  private passTimes: number[] = [];
  private running = false;
  private runPending = false;
  private runTimer: number | null = null;
  private modeChangeHandlers: Array<(mode: Mode) => void> = [];
  private rowsInsertedHandlers: Array<(afterRowIndex: number) => void> = [];
  private colsInsertedHandlers: Array<(afterColIndex: number) => void> = [];
  private roomMadeHandlers: Array<(info: RoomInfo) => void> = [];
  private contentMovedHandlers: Array<(from: string, to: string) => void> = [];
  /** The cells the person picked (a click, a rubber band, Shift/Ctrl-click): the address of each block's owner. */
  private picked = new Set<string>();
  /** Where a Shift-click range starts. */
  private pickAnchor: string | null = null;
  private pickHandlers: Array<(picked: string[]) => void> = [];
  private rubber: { startX: number; startY: number; active: boolean; additive: boolean; base: Set<string>; box: Cell | null } | null = null;
  /** When the last rubber band ended: the click that follows it is not a click on a cell. */
  private rubberEndedAt = 0;
  /** A press on a picked group of empty cells: dragging it makes the group one block and carries it. */
  private groupPress: { first: string; cols: number; rows: number; startX: number; startY: number; grab: { x: number; y: number } } | null = null;
  /** Asked before the code of a cell is rewritten (its editor may be open on it). */
  private codeLocked: (address: string) => boolean = () => false;
  private shapeHandlers: Array<(change: ShapeChange) => void> = [];
  private codeChangedHandlers: Array<(address: string) => void> = [];
  private referencesHandlers: Array<(report: ReferenceReport) => void> = [];
  private afterRunHandlers: Array<() => void> = [];
  private contentDrag: ContentDragState | null = null;
  private contentDragBusy = false;
  private pointerCancelHandlers: Array<() => void> = [];
  /** Set by ui/touch.ts: true while a double-tap-and-hold "grab" is active on a touch screen. */
  grabArmed: () => boolean = () => false;
  /** Tracks recent clicks per cell id to detect double-clicks ourselves (see CLICK listener below). */
  private lastClickInfo: { id: string; time: number } | null = null;
  private depGraph = new DependencyGraph();
  /** What the cells of this tab export to each other (import { f } from './B2'); see cellModules.ts. */
  readonly modules = new CellModules();
  /** The cells of the current pass that have not started yet: an import of one of them waits for its new run. */
  private queued = new Set<string>();

  /** What an importer needs to know about the cell it waits for. */
  probeModule(address: string): Probe {
    return { hasCode: !!this.data.get(address)?.code.trim(), pending: this.queued.has(address) || this.depGraph.isDirty(address) };
  }
  /** cell id -> a live DOM node to host as that cell's label (e.g. the Monaco editor frame). */
  private nodeLabels = new Map<string, HTMLElement>();
  private refreshQueue = new Set<string>();
  /** How far each teletype paper is wound back (lines from the newest), and how many lines it had when last drawn. */
  private paperView = new Map<string, { back: number; total: number }>();
  /** The same for plain printed text: lines wound back from the newest, and how many lines there were when last drawn. */
  private textView = new Map<string, { back: number; total: number }>();
  /** How much each teletype paper has typed so far (it types at the pace of the real machine), and the timer for the next letters. */
  private paperPrint = new Map<string, { state: PrintState; timer: number }>();
  /** Paper cells in the middle of a line feed: when it began, how long it takes, and how far the slide has got (0..1). */
  private paperFeed = new Map<string, { start: number; ms: number; t: number }>();
  /** The little speaker on a paper cell: the cell it sits on and whether it shows "on". */
  private paperIcons = new Map<string, { cell: Cell; overlay: CellOverlay; on: boolean }>();
  /** Which paper cells have their ASR-33 sound switched on (off unless somebody clicked the speaker). Kept in this browser. */
  private paperSound = loadPaperSound();
  private foreignRewriter: ((rewrite: RefRewrite) => void) | null = null;
  private lastTileClick: { address: string; x: number; y: number; time: number } | null = null;

  /** Only the main tab has the Lattakker board (A1:J10) and the reserved rows below it. */
  private readonly board: boolean;
  /** A tab that lays its own columns out (the Examples notebook) does not take inserted columns. */
  private readonly fixedColumns: boolean;
  /** Names this sheet apart from the others ('' for the game board's sheet): it scopes the editor models. */
  readonly id: string;
  private suspended = false;
  private pendingRefresh = new Set<string>();

  constructor(container: HTMLElement, options: { board?: boolean; id?: string; fixedColumns?: boolean } = {}) {
    this.container = container;
    this.fixedColumns = options.fixedColumns ?? false;
    this.board = options.board ?? false;
    this.id = options.id ?? '';
    // SelectionCellsHandler must be registered before SelectionHandler: mouse listeners fire in
    // plugin-registration order, and VertexHandler's resize-handle hit-test (owned by
    // SelectionCellsHandler) needs first refusal on a mousedown, or SelectionHandler consumes it
    // as a plain cell-move before the handle ever gets a look (matches maxGraph's own default order).
    registerPaperShape();
    this.graph = new Graph(container, undefined, [TooltipHandler, SelectionCellsHandler, SelectionHandler, PanningHandler, PopupMenuHandler]);
    const graph = this.graph;
    const model = graph.getDataModel();

    graph.setHtmlLabels(true);
    graph.setCellsEditable(false);
    graph.setCellsResizable(false);
    graph.setCellsDisconnectable(false);
    graph.setCellsCloneable(false);
    graph.setCellsDeletable(false);
    graph.setCellsBendable(false);
    graph.setConnectable(false);
    graph.setDropEnabled(false);
    graph.setAllowDanglingEdges(false);
    graph.setTooltips(true);
    graph.setPanning(true);
    const panning = graph.getPlugin<PanningHandler>('PanningHandler');
    if (panning) panning.useLeftButtonForPanning = false;
    const selection = graph.getPlugin<SelectionHandler>('SelectionHandler');
    if (selection) selection.setMoveEnabled(true);
    // A picked code block wears maxGraph's own resize handles (see cellHandler.ts); carrying a block around stays the job of the content drag below.
    graph.getPlugin<SelectionCellsHandler>('SelectionCellsHandler')?.setVertexHandlerFactory((state) =>
      (state.cell.getId() ?? '').startsWith('sheet:') ? new SheetCellHandler(state, { width: CW, height: CH }) : new VertexHandler(state),
    );
    const movable = graph.isCellMovable.bind(graph);
    graph.isCellMovable = (cell: Cell) => !(cell.getId() ?? '').startsWith('sheet:') && movable(cell);
    graph.addListener(InternalEvent.CELLS_RESIZED, (_sender: unknown, evt: EventObject) => {
      for (const c of (evt.getProperty('cells') as Cell[] | undefined) ?? []) {
        const id = c.getId() ?? '';
        if (id.startsWith('sheet:')) this.resizedByHand(id.slice(6));
      }
    });
    // The picked cells stay on their cells when content moves or rows shift.
    this.onContentMoved((from, to) => this.remapPicked((a) => (a === from ? to : a)));
    this.onRowsInserted((after) =>
      this.remapPicked((a) => {
        const p = parseAddress(a);
        return p && p.row > after ? formatAddress(p.col, p.row + 1) : a;
      }),
    );
    this.onColumnsInserted((after) =>
      this.remapPicked((a) => {
        const p = parseAddress(a);
        return p && p.col > after ? formatAddress(p.col + 1, p.row) : a;
      }),
    );
    this.onRoomMade((info) => {
      const to = new Map(info.shifts.map((s) => [s.from, s.to]));
      this.remapPicked((a) => to.get(a) ?? a);
    });
    container.style.overflow = 'auto';
    container.style.position = 'relative';

    this.registerStyles();

    const root = model.getRoot()!;
    this.sheetLayer = root.getChildAt(0);
    this.pieceLayer = model.add(root, new Cell())!;
    this.uiLayer = model.add(root, new Cell())!;
    this.overlays = new Overlays(graph, this.uiLayer);

    graph.getLabel = (cell?: Cell | null) => this.labelFor(cell ?? null);
    graph.isHtmlLabel = (cell: Cell) => {
      const id = cell.getId() ?? '';
      if (id.startsWith('sheet:')) return !this.paperOf(id.slice(6));
      return id.startsWith('hud:') || id.startsWith('btn:') || id.startsWith('ed:') || id.startsWith('help:') || id.startsWith('ctx:live:');
    };
    graph.getCursorForCell = (cell: Cell) => {
      const id = cell.getId() ?? '';
      if (id.startsWith('piece:') || id.startsWith('btn:') || id.startsWith('ed:btn') || id === 'hdr:corner' || id.startsWith('ctx:row:') || id.startsWith('ctx:livebar:')) return 'pointer';
      if (id.startsWith('sheet:')) return 'cell';
      if (id === 'ed:frame') return 'move';
      if (id.startsWith('hdr:')) return 'grab';
      return null;
    };
    const tooltips = graph.getPlugin<TooltipHandler>('TooltipHandler');
    if (tooltips) {
      tooltips.delay = 350;
      tooltips.getTooltipForCell = (cell: Cell) => {
        const id = cell.getId() ?? '';
        const custom = this.listeners?.tooltipFor?.(id, cell);
        if (custom != null) return custom;
        // With external hints (ui/CellHover.ts) a cell shows its own hint box and its address in the corner instead.
        if (id.startsWith('sheet:') && this.externalCellHints) return '';
        if (id.startsWith('sheet:')) {
          const addr = id.slice(6);
          const d = this.data.get(addr);
          if (d?.code) return `${addr} · code cell (double-click to edit)`;
          return `${addr} · double-click to write TypeScript here`;
        }
        return '';
      };
    }

    model.batchUpdate(() => {
      this.buildGrid();
      this.buildHeaders();
    });

    // The wheel winds a teletype paper back and forth while it has lines to show; otherwise the sheet scrolls as usual.
    container.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey || !e.deltaY) return;
        const rect = container.getBoundingClientRect();
        const hit = graph.getCellAt(e.clientX - rect.left + container.scrollLeft, e.clientY - rect.top + container.scrollTop);
        const id = hit?.getId() ?? '';
        if (!id.startsWith('sheet:')) return;
        const lines = Math.sign(-e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
        if (this.scrollPaper(id.slice(6), lines) || this.scrollText(id.slice(6), lines)) e.preventDefault();
      },
      { passive: false },
    );
    graph.addListener(InternalEvent.CLICK, (_sender: unknown, evt: EventObject) => {
      const cell = evt.getProperty('cell') as Cell | null | undefined;
      const me = evt.getProperty('event') as MouseEvent;
      if (!cell || !this.listeners || this.contentDragBusy || performance.now() - this.rubberEndedAt < 200) return;
      const id = cell.getId() ?? '';
      // Clicking a cell can restyle it (selection outline/flash), which makes maxGraph tear down
      // and recreate its label DOM node. That breaks the browser's native double-click detection
      // (the second click lands on a fresh element), so double-clicks are detected here instead,
      // from the timing between two ordinary clicks on the same cell id.
      const now = performance.now();
      const isDouble = !!this.lastClickInfo && this.lastClickInfo.id === id && now - this.lastClickInfo.time < 400;
      this.lastClickInfo = isDouble ? null : { id, time: now };
      if (id.startsWith('sheet:')) {
        const tile = this.tileAt(id.slice(6), me);
        this.lastTileClick = tile && { address: id.slice(6), ...tile, time: performance.now() };
        this.listeners.onCellClick(id.slice(6), me);
        if (isDouble) {
          if (me.ctrlKey || me.metaKey) this.listeners.onZoomRequest?.(id.slice(6));
          else this.listeners.onCellDoubleClick(id.slice(6));
        }
      } else {
        this.listeners.onOtherClick(id, cell, me);
      }
    });
    graph.addListener(InternalEvent.DOUBLE_CLICK, (_sender: unknown, evt: EventObject) => {
      const cell = evt.getProperty('cell') as Cell | null | undefined;
      const me = evt.getProperty('event') as MouseEvent | undefined;
      if (!this.listeners) return;
      const zoom = !!me && (me.ctrlKey || me.metaKey);
      const id = cell?.getId() ?? '';
      if (zoom) {
        this.listeners.onZoomRequest?.(id.startsWith('sheet:') ? id.slice(6) : null);
        evt.consume();
        return;
      }
      if (!cell) return;
      if (id.startsWith('sheet:')) this.listeners.onCellDoubleClick(id.slice(6));
      evt.consume();
    });
    const contentDragListener: MouseListenerSet = {
      mouseDown: (_sender, me) => this.onContentMouseDown(me),
      mouseMove: (_sender, me) => {
        this.hoverOn(me.getCell()?.getId() ?? '');
        this.onRubberMove(me);
        this.onContentMouseMove(me);
      },
      mouseUp: (_sender, me) => this.onContentMouseUp(me),
    };
    graph.addMouseListener(contentDragListener);
    // A touch that the browser takes over for scrolling ends in pointercancel; maxGraph ignores that,
    // which would leave a half-finished drag hanging.
    container.addEventListener('pointerleave', () => this.hoverOn(''));
    // The speaker switches on the press, not on the click: while a paper types, its cell is redrawn all the time, and a click needs the same element at the press and at the release.
    container.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        if (e.button !== 0 || !(e.target instanceof Node)) return;
        for (const [address, icon] of this.paperIcons) {
          const node = this.graph.getView().getState(icon.cell)?.overlays.get(icon.overlay)?.node;
          if (!node || !node.contains(e.target)) continue;
          e.preventDefault();
          e.stopPropagation();
          this.togglePaperSound(address);
          return;
        }
      },
      true,
    );
    container.addEventListener('pointercancel', () => {
      this.cancelContentDrag();
      this.cancelRubber();
      this.pointerCancelHandlers.forEach((h) => h());
    });

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        this.updateStickyHeaders();
      });
    };
    container.addEventListener('scroll', onScroll);
    graph.getView().addListener(InternalEvent.SCALE, onScroll);
    graph.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, onScroll);
    graph.getView().addListener(InternalEvent.TRANSLATE, onScroll);
    // Zooming by hand (wheel, pinch, buttons) ends the "zoom back out" promise: the old view is no longer where you came from.
    graph.getView().addListener(InternalEvent.SCALE, () => {
      if (this.zoomFlying || !this.zoomReturn) return;
      this.zoomReturn = null;
      this.zoomedOn = null;
      this.zoomListeners.forEach((l) => l());
    });
    this.updateStickyHeaders();
  }

  // ------------------------------------------------------------------ setup

  private registerStyles(): void {
    const ss = this.graph.getStylesheet();
    const dv = ss.getDefaultVertexStyle();
    dv.movable = false;
    dv.resizable = false;
    dv.editable = false;
    dv.rotatable = false;
    dv.cloneable = false;
    dv.deletable = false;
    dv.fontFamily = 'system-ui, sans-serif';

    ss.putCellStyle('sheet', {
      shape: 'rectangle',
      fillColor: THEME.cellFill,
      strokeColor: THEME.cellStroke,
      strokeWidth: 1,
      fontColor: THEME.ink,
      fontSize: 11,
      align: 'left',
      verticalAlign: 'top',
      whiteSpace: 'wrap',
      overflow: 'hidden',
      spacing: 3,
      spacingLeft: 4,
    });
    ss.putCellStyle('header', {
      shape: 'rectangle',
      fillColor: THEME.headerFill,
      strokeColor: THEME.headerStroke,
      strokeWidth: 1,
      fontColor: THEME.headerInk,
      fontSize: 12,
      fontStyle: 1,
      align: 'center',
      verticalAlign: 'middle',
    });
    ss.putCellStyle('group', {
      shape: 'rectangle',
      fillColor: 'none',
      strokeColor: 'none',
      pointerEvents: false,
    });
    ss.putCellStyle('hud', {
      shape: 'rectangle',
      rounded: true,
      arcSize: 6,
      fillColor: THEME.hudFill,
      strokeColor: THEME.hudStroke,
      strokeWidth: 1,
      fontColor: THEME.ink,
      fontSize: 14,
      align: 'left',
      verticalAlign: 'top',
      whiteSpace: 'wrap',
      overflow: 'hidden',
      spacing: 6,
      spacingLeft: 10,
      spacingTop: 6,
    });
    ss.putCellStyle('button', {
      shape: 'rectangle',
      rounded: true,
      arcSize: 20,
      fillColor: THEME.primary,
      strokeColor: THEME.primaryDark,
      strokeWidth: 1,
      fontColor: '#ffffff',
      fontSize: 14,
      fontStyle: 1,
      align: 'center',
      verticalAlign: 'middle',
      whiteSpace: 'wrap',
      overflow: 'hidden',
    });
    ss.putCellStyle('piece', {
      shape: 'pieceTile',
      strokeWidth: 1.5,
      fontColor: THEME.tileInk,
      fontSize: 21,
      fontStyle: 1,
      align: 'center',
      verticalAlign: 'top',
      spacingTop: 4,
    });
  }

  private buildGrid(): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) this.makeCell(c, r);
    }
  }

  private makeCell(c: number, r: number): void {
    const address = formatAddress(c, r);
    const cell = this.graph.insertVertex({
      parent: this.sheetLayer,
      id: `sheet:${address}`,
      value: '',
      position: [ORIGIN_X + c * CW, ORIGIN_Y + r * CH],
      size: [CW, CH],
      style: { baseStyleNames: ['sheet'] },
    });
    this.cells.set(address, cell);
    this.data.set(address, {
      address,
      col: c,
      row: r,
      uid: '',
      code: '',
      output: [],
      plot: null,
      tiles: null,
      scene: null,
      viewText: null,
      codeVisual: {},
      span: { cols: 1, rows: 1 },
      shape: emptyShape(),
      error: null,
      memory: {},
      runCount: 0,
      runReason: 'edit',
    });
  }

  /** Grows the sheet to the right: new cells for every row plus their column headers. */
  addColumns(n: number): void {
    if (n <= 0) return;
    const model = this.graph.getDataModel();
    model.batchUpdate(() => {
      const from = this.colCount;
      this.colCount += n;
      for (let c = from; c < this.colCount; c++) {
        for (let r = 0; r < this.rowCount; r++) this.makeCell(c, r);
        this.graph.insertVertex({
          parent: this.colHeaderGroup,
          id: `hdr:c${c}`,
          value: colToLetters(c),
          position: [ORIGIN_X + c * CW, 0],
          size: [CW, HDR_H],
          style: { baseStyleNames: ['header'] },
        });
      }
      const cg = this.colHeaderGroup.getGeometry()!;
      model.setGeometry(this.colHeaderGroup, new Geometry(cg.x, cg.y, ORIGIN_X + this.colCount * CW, cg.height));
    });
    this.raiseHeaders();
  }

  private buildHeaders(): void {
    const { graph } = this;
    this.colHeaderGroup = graph.insertVertex({
      parent: this.uiLayer,
      id: 'hdr:cols',
      position: [0, 0],
      size: [ORIGIN_X + COLS * CW, HDR_H],
      style: { baseStyleNames: ['group'] },
    });
    for (let c = 0; c < COLS; c++) {
      graph.insertVertex({
        parent: this.colHeaderGroup,
        id: `hdr:c${c}`,
        value: colToLetters(c),
        position: [ORIGIN_X + c * CW, 0],
        size: [CW, HDR_H],
        style: { baseStyleNames: ['header'] },
      });
    }
    this.rowHeaderGroup = graph.insertVertex({
      parent: this.uiLayer,
      id: 'hdr:rows',
      position: [0, 0],
      size: [HDR_W, ORIGIN_Y + ROWS * CH],
      style: { baseStyleNames: ['group'] },
    });
    for (let r = 0; r < ROWS; r++) {
      graph.insertVertex({
        parent: this.rowHeaderGroup,
        id: `hdr:r${r}`,
        value: String(r + 1),
        position: [0, ORIGIN_Y + r * CH],
        size: [HDR_W, CH],
        style: { baseStyleNames: ['header'] },
      });
    }
    this.corner = graph.insertVertex({
      parent: this.uiLayer,
      id: 'hdr:corner',
      value: '⌂',
      position: [0, 0],
      size: [HDR_W, HDR_H],
      style: { baseStyleNames: ['header'], fontSize: 15, fontStyle: 1 },
    });
  }

  /** Keeps the row/column headers pinned to the visible edge of the scrolled container. */
  updateStickyHeaders(): void {
    const view = this.graph.getView();
    const s = view.getScale();
    const t = view.getTranslate();
    const sx = this.container.scrollLeft / s - t.x;
    const sy = this.container.scrollTop / s - t.y;
    const model = this.graph.getDataModel();
    const cg = this.colHeaderGroup.getGeometry()!;
    const rg = this.rowHeaderGroup.getGeometry()!;
    if (Math.abs(cg.y - sy) < 0.01 && Math.abs(rg.x - sx) < 0.01) return;
    model.batchUpdate(() => {
      model.setGeometry(this.colHeaderGroup, new Geometry(0, sy, cg.width, cg.height));
      model.setGeometry(this.rowHeaderGroup, new Geometry(sx, 0, rg.width, rg.height));
      model.setGeometry(this.corner, new Geometry(sx, sy, HDR_W, HDR_H));
    });
  }

  /** Brings the headers (and whatever else should float) to the front of the ui layer. */
  raiseHeaders(): void {
    this.graph.orderCells(false, [this.colHeaderGroup, this.rowHeaderGroup, this.corner]);
  }

  setListeners(listeners: SheetListeners): void {
    this.listeners = listeners;
  }

  setRunner(runner: (data: SheetCellData, ctx: RunContext) => Promise<void>): void {
    this.runner = runner;
  }

  onModeChange(handler: (mode: Mode) => void): void {
    this.modeChangeHandlers.push(handler);
  }

  onRowsInserted(handler: (afterRowIndex: number) => void): void {
    this.rowsInsertedHandlers.push(handler);
  }

  onColumnsInserted(handler: (afterColIndex: number) => void): void {
    this.colsInsertedHandlers.push(handler);
  }

  /** Fired whenever an address's .code changes (direct edit, drag-move, or row insertion shift). */
  onCodeChanged(handler: (address: string) => void): void {
    this.codeChangedHandlers.push(handler);
  }

  /** Fired once after every completed run pass (viewText/error/output may have changed). */
  onAfterRun(handler: () => void): void {
    this.afterRunHandlers.push(handler);
  }

  // ------------------------------------------------------------ addressing

  isBoardAddress(address: string): boolean {
    return this.board && BOARD_RE.test(address);
  }

  cellAt(address: string): Cell | undefined {
    return this.cells.get(address);
  }

  dataAt(address: string): SheetCellData | undefined {
    return this.data.get(address);
  }

  addressOfUid(uid: string): string | null {
    for (const d of this.data.values()) if (d.uid === uid) return d.address;
    return null;
  }

  resolve(text: string): string | null {
    const p = parseAddress(text);
    if (!p || p.col < 0 || p.col >= this.colCount || p.row < 0 || p.row >= this.rowCount) return null;
    return formatAddress(p.col, p.row);
  }

  resolveRange(text: string): string[] {
    const r = parseRange(text);
    if (!r) return [];
    r.c1 = Math.max(0, r.c1);
    r.r1 = Math.max(0, r.r1);
    r.c2 = Math.min(this.colCount - 1, r.c2);
    r.r2 = Math.min(this.rowCount - 1, r.r2);
    if (r.c1 > r.c2 || r.r1 > r.r2) return [];
    return expandRange(r);
  }

  geometryOf(address: string): Geometry | null {
    return this.cells.get(address)?.getGeometry() ?? null;
  }

  // --------------------------------------------------------------- visuals

  setBaseVisual(address: string, visual: CellVisual | null): void {
    if (visual) this.baseVisual.set(address, visual);
    else this.baseVisual.delete(address);
    this.applyStyle(address);
  }

  setSelectionVisual(address: string, visual: CellVisual | null): void {
    if (visual) this.selectionVisual.set(address, visual);
    else this.selectionVisual.delete(address);
    this.applyStyle(address);
  }

  clearSelectionVisuals(): void {
    const addrs = [...this.selectionVisual.keys()];
    this.selectionVisual.clear();
    this.graph.batchUpdate(() => addrs.forEach((a) => this.applyStyle(a)));
  }

  /** Short colour pulse so every click has a visible result. */
  flash(address: string, color: string = THEME.flash, ms = 240): void {
    this.flashVisual.set(address, { fill: color });
    this.applyStyle(address);
    window.setTimeout(() => {
      if (this.flashVisual.get(address)?.fill === color) {
        this.flashVisual.delete(address);
        this.applyStyle(address);
      }
    }, ms);
  }

  /** Fades a coloured band across a whole row (0-based), header included, so a new row is hard to miss. */
  highlightRow(rowIndex: number, ms = 500, rgb: [number, number, number] = [143, 209, 163]): void {
    if (rowIndex < 0 || rowIndex >= this.rowCount) return;
    const steps = 10;
    const model = this.graph.getDataModel();
    const header = model.getCell(`hdr:r${rowIndex}`);
    let step = 0;
    const paint = (): void => {
      const t = step / steps;
      const color = '#' + rgb.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('');
      this.graph.batchUpdate(() => {
        for (let c = 0; c < this.colCount; c++) {
          const address = formatAddress(c, rowIndex);
          if (step >= steps) this.flashVisual.delete(address);
          else this.flashVisual.set(address, { fill: color });
          this.applyStyle(address);
        }
        if (header) model.setStyle(header, step >= steps ? { baseStyleNames: ['header'] } : { baseStyleNames: ['header'], fillColor: color });
      });
      if (step++ < steps) window.setTimeout(paint, ms / steps);
    };
    paint();
  }

  /** Fades a coloured band down a whole column (0-based), header included, so a new column is hard to miss. */
  highlightColumn(colIndex: number, ms = 500, rgb: [number, number, number] = [143, 209, 163]): void {
    if (colIndex < 0 || colIndex >= this.colCount) return;
    const steps = 10;
    const model = this.graph.getDataModel();
    const header = model.getCell(`hdr:c${colIndex}`);
    let step = 0;
    const paint = (): void => {
      const t = step / steps;
      const color = '#' + rgb.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('');
      this.graph.batchUpdate(() => {
        for (let r = 0; r < this.rowCount; r++) {
          const address = formatAddress(colIndex, r);
          if (step >= steps) this.flashVisual.delete(address);
          else this.flashVisual.set(address, { fill: color });
          this.applyStyle(address);
        }
        if (header) model.setStyle(header, step >= steps ? { baseStyleNames: ['header'] } : { baseStyleNames: ['header'], fillColor: color });
      });
      if (step++ < steps) window.setTimeout(paint, ms / steps);
    };
    paint();
  }

  /** Scrolls so that the row (and column, if given) is on screen; does nothing when it already is. A null row leaves the vertical scroll alone. */
  reveal(rowIndex: number | null, colIndex?: number, smooth = true): void {
    const view = this.graph.getView();
    const s = view.getScale();
    const t = view.getTranslate();
    const c = this.container;
    const options: ScrollToOptions = { behavior: smooth ? 'smooth' : 'auto' };
    if (rowIndex !== null) {
      const top = (ORIGIN_Y + rowIndex * CH + t.y) * s;
      const h = CH * s;
      if (top - HDR_H * s < c.scrollTop || top + h > c.scrollTop + c.clientHeight) {
        options.top = Math.max(0, top - c.clientHeight / 2 + h / 2);
      }
    }
    if (colIndex !== undefined) {
      const left = (ORIGIN_X + colIndex * CW + t.x) * s;
      const w = CW * s;
      if (left - HDR_W * s < c.scrollLeft || left + w > c.scrollLeft + c.clientWidth) {
        options.left = Math.max(0, left - c.clientWidth / 2 + w / 2);
      }
    }
    if (options.top !== undefined || options.left !== undefined) c.scrollTo(options);
  }

  setOverlay(address: string, overlay: CellOverlay | null): void {
    const cell = this.cells.get(address);
    if (!cell) return;
    this.graph.removeCellOverlays(cell);
    if (overlay) {
      this.graph.addCellOverlay(cell, overlay);
      // maxGraph fires overlay clicks on the overlay itself, never on the graph, so the
      // graph-level CLICK listener above never sees them — wire it through by hand.
      overlay.addListener(InternalEvent.CLICK, (_sender: unknown, evt: EventObject) => {
        const me = evt.getProperty('event') as MouseEvent;
        this.listeners?.onCellClick(address, me);
      });
    }
  }

  clearOverlays(addresses: Iterable<string>): void {
    for (const a of addresses) {
      const cell = this.cells.get(a);
      if (cell) this.graph.removeCellOverlays(cell);
    }
  }

  makeDotOverlay(color: string, tooltip: string): CellOverlay {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="${color}" stroke="#ffffff" stroke-width="2.5"/></svg>`;
    return new CellOverlay(new ImageBox(svgUri(svg), 22, 22), tooltip, 'center', 'middle', new Point(0, 0), 'pointer');
  }

  makeSwordsOverlay(tooltip: string): CellOverlay {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="${THEME.attackStroke}" stroke="#ffffff" stroke-width="2"/><path d="M8 8 L18 18 M18 8 L8 18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    return new CellOverlay(new ImageBox(svgUri(svg), 26, 26), tooltip, 'right', 'top', new Point(-6, 6), 'pointer');
  }

  private labelFor(cell: Cell | null): string {
    if (!cell) return '';
    const id = cell.getId() ?? '';
    const node = this.nodeLabels.get(id);
    // maxGraph hosts a real DOM node as a label as-is when isNode(value) is true (TextShape.updateValue);
    // the declared getLabel() return type is string, but the runtime check only cares about isNode().
    if (node) return node as unknown as string;
    if (id.startsWith('sheet:')) {
      const d = this.data.get(id.slice(6));
      if (!d) return '';
      const paper = this.paperOf(d.address);
      if (paper) return this.paperLayoutOf(d.address)?.label ?? '';
      // A drawing is a live DOM node (its animations keep running in it); everything else is drawn from text.
      if (d.scene && !d.error && !(d.code && this.mode === 'view')) {
        d.scene.setCaption(d.output.join('\n'));
        // The label box has no height of its own, so the drawing is given the size of the cell (like a plot).
        const geo = cell.getGeometry();
        if (geo) {
          d.scene.element.style.width = `${Math.round(geo.width)}px`;
          d.scene.element.style.height = `${Math.round(geo.height)}px`;
        }
        return d.scene.element as unknown as string;
      }
      return this.outputHtml(d.address);
    }
    const value = cell.getValue();
    return value == null ? '' : String(value);
  }

  /** What a cell shows, as HTML: its text, or its plot with the text as a caption. Sized by the cell unless a size is given. */
  outputHtml(address: string, size?: { width: number; height: number }, forceOutput = false): string {
    const d = this.data.get(address);
    if (!d) return '';
    const base = this.baseVisual.get(address);
    const showCode = d.code && this.mode === 'view' && !forceOutput;
    if (d.plot && !d.error && !showCode) {
      const geo = this.cells.get(address)?.getGeometry();
      const w = size?.width ?? geo?.width ?? 200;
      const h = size?.height ?? geo?.height ?? 100;
      const caption = d.output.length ? `<div class="cell-text out plot-caption">${escapeHtml(d.output.join('\n'))}</div>` : '';
      return `<div class="cell-plot">${plotSvg(d.plot, w, h)}${caption}</div>`;
    }
    if (d.scene && !d.error && !showCode) {
      const caption = d.output.length ? `<div class="cell-text out svg-caption">${escapeHtml(d.output.join('\n'))}</div>` : '';
      // A snapshot: the canvas of an animated picture (anim) would serialize empty, so it becomes a still image of its current frame.
      const copy = d.scene.svg.cloneNode(true) as SVGSVGElement;
      const live = d.scene.svg.querySelectorAll('canvas');
      copy.querySelectorAll('canvas').forEach((c, i) => {
        const still = document.createElement('img');
        still.src = live[i].toDataURL();
        still.style.cssText = 'width:100%;height:100%;display:block';
        c.replaceWith(still);
      });
      return `<div class="cell-svg">${new XMLSerializer().serializeToString(copy)}${caption}</div>`;
    }
    if (d.tiles && !d.error && !showCode) {
      const geo = this.cells.get(address)?.getGeometry();
      const w = size?.width ?? geo?.width ?? 200;
      const h = size?.height ?? geo?.height ?? 100;
      const caption = d.output.length ? `<div class="cell-text out tiles-caption">${escapeHtml(d.output.join('\n'))}</div>` : '';
      return `<div class="cell-tiles">${tilesSvg(d.tiles, w, h)}${caption}</div>`;
    }
    const text = forceOutput ? (d.error ? `⚠ ${d.error}` : d.output.join('\n')) : this.displayText(d);
    if (!text) return base?.label ? `<div class="cell-text out">${escapeHtml(base.label)}</div>` : '';
    const cls = showCode && d.viewText === null ? 'cell-text code' : 'cell-text out';
    if (!size && !forceOutput && !d.error && !(d.code && this.mode === 'view')) return this.tailHtml(address, d.output);
    return `<div class="${cls}">${escapeHtml(text)}</div>`;
  }

  /**
   * Printed text like on a terminal: when there are more lines than the cell is tall the newest stay in view (the box is anchored at the bottom,
   * so a wrapped line pushes the older text up and out), and the wheel winds back to the older lines (see scrollText).
   */
  private tailHtml(address: string, output: string[]): string {
    const geo = this.cells.get(address)?.getGeometry();
    if (!geo) return `<div class="cell-text out">${escapeHtml(output.join('\n'))}</div>`;
    const height = Math.max(8, Math.round(geo.height - TEXT_PAD_Y));
    const fit = Math.max(1, Math.floor(height / TEXT_LINE_PX));
    const seen = this.textView.get(address) ?? { back: 0, total: 0 };
    const total = output.length;
    const grown = total - seen.total;
    const maxBack = Math.max(0, total - fit);
    // A wound-back view keeps its place while new lines arrive; a shorter output (cleared, started again at the top) goes back to the newest.
    const back = Math.max(0, Math.min(maxBack, grown < 0 ? 0 : grown > 0 && seen.back > 0 ? seen.back + grown : seen.back));
    this.textView.set(address, { back, total });
    const shown = back ? output.slice(0, total - back) : output;
    let thumb = '';
    if (maxBack > 0) {
      const h = Math.max(10, Math.round((height * fit) / total));
      const top = Math.round((height - h) * (1 - back / maxBack));
      thumb = `<div class="cell-tail-thumb" style="top:${top}px;height:${h}px"></div>`;
    }
    return `<div class="cell-tail" style="height:${height}px"><div class="cell-text out">${escapeHtml(shown.join('\n'))}</div>${thumb}</div>`;
  }

  /** Winds a cell's printed text by whole lines (positive = towards older lines). Returns false when the text fits or there was nowhere to go. */
  scrollText(address: string, lines: number): boolean {
    const d = this.data.get(address);
    const geo = this.cells.get(address)?.getGeometry();
    if (!d || !geo || d.error || d.plot || d.tiles || d.scene || (d.code && this.mode === 'view')) return false;
    const fit = Math.max(1, Math.floor(Math.max(8, geo.height - TEXT_PAD_Y) / TEXT_LINE_PX));
    const maxBack = Math.max(0, d.output.length - fit);
    const seen = this.textView.get(address) ?? { back: 0, total: d.output.length };
    const next = Math.max(0, Math.min(maxBack, seen.back + lines));
    if (next === seen.back) return false;
    this.textView.set(address, { back: next, total: d.output.length });
    this.refreshCell(address);
    return true;
  }

  /** Which tile of a block's grid a mouse event landed on (x across, y down, from 0), or null. */
  tileAt(address: string, evt: MouseEvent): { x: number; y: number } | null {
    const tiles = this.data.get(address)?.tiles;
    const cell = this.cells.get(address);
    const state = cell ? this.graph.getView().getState(cell) : null;
    if (!tiles || !state || state.width <= 0 || state.height <= 0) return null;
    const c = this.container;
    const rect = c.getBoundingClientRect();
    const fx = (evt.clientX - rect.left + c.scrollLeft - state.x) / state.width;
    const fy = (evt.clientY - rect.top + c.scrollTop - state.y) / state.height;
    if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
    return { x: Math.floor(fx * tiles.cols), y: Math.floor(fy * tiles.rows) };
  }

  /** A click on a block's grid that did not come through the sheet's own canvas (the Examples notebook shows the output in a page of its own). */
  noteTileClick(address: string, x: number, y: number): void {
    this.lastTileClick = { address, x, y, time: performance.now() };
  }

  /** The tile of the latest click on a block, if it was that recent (the click event reads it as it fires). */
  takeTileClick(address: string): { x: number; y: number } | null {
    const t = this.lastTileClick;
    return t && t.address === address && performance.now() - t.time < 1000 ? { x: t.x, y: t.y } : null;
  }

  /** The fill a cell is drawn with right now (error, its own colour, or the plain code fill). */
  fillOf(address: string): string {
    const d = this.data.get(address);
    if (!d) return THEME.codeFill;
    if (d.error) return THEME.errorFill;
    return d.codeVisual.fill ?? this.baseVisual.get(address)?.fill ?? THEME.codeFill;
  }

  displayText(d: SheetCellData): string {
    if (d.error) return `⚠ ${d.error}`;
    if (d.code && this.mode === 'view') return d.viewText ?? d.code;
    return d.output.join('\n');
  }

  applyStyle(address: string): void {
    const cell = this.cells.get(address);
    const d = this.data.get(address);
    if (!cell || !d) return;
    const base = this.baseVisual.get(address) ?? {};
    const code = d.codeVisual;
    const sel = this.selectionVisual.get(address) ?? {};
    const flash = this.flashVisual.get(address) ?? {};
    // A picked cell wears the amber frame; in a group, the empty ones are tinted too, so the whole area reads as one.
    const pick: CellVisual = this.picked.has(address) ? { stroke: THEME.select, strokeWidth: 3, ...(this.picked.size > 1 && !d.code ? { fill: THEME.pickFill } : {}) } : {};
    const paper = this.paperOf(address);
    let scrolled = 0;
    let headCol = -1;
    if (paper) {
      const lay = this.paperLayoutOf(address);
      const feed = this.paperFeed.get(address)?.t;
      if (lay) scrolled = lay.total - lay.back - (feed === undefined || lay.back > 0 ? 0 : 1 - feed);
      if (lay && lay.back === 0) headCol = lay.col;
    }
    const style: CellStyle = { baseStyleNames: ['sheet'], ...(paper ? paperStyle(paper, d.output.length, this.paperFeed.get(address)?.t, scrolled, headCol) : {}) };
    // The paper brings its own fill and ink; only what the code or the pointer chose on top of it is kept.
    const under: CellVisual = paper ? { ...base, fill: undefined, fontColor: undefined, fontSize: undefined, align: undefined, verticalAlign: undefined } : base;
    const merged: CellVisual = { ...under, ...code, ...pick, ...sel, ...flash };
    if (merged.fill) style.fillColor = merged.fill;
    if (merged.stroke) style.strokeColor = merged.stroke;
    if (merged.strokeWidth) style.strokeWidth = merged.strokeWidth;
    // The cell under attention: its frame is see-through, so the cell's own content stays readable beneath it.
    if (this.picked.has(address) && !this.selectionVisual.has(address)) style.strokeOpacity = 55;
    if (merged.fontColor) style.fontColor = merged.fontColor;
    if (merged.fontSize) style.fontSize = merged.fontSize;
    if (merged.align) style.align = merged.align;
    if (merged.verticalAlign) style.verticalAlign = merged.verticalAlign;
    if (d.error) {
      style.fillColor = THEME.errorFill;
      style.fontColor = THEME.errorInk;
    }
    if (d.code && !merged.fill && !d.error && !paper) style.fillColor = THEME.codeFill;
    this.graph.getDataModel().setStyle(cell, style);
    this.syncPaperIcon(address, !!paper);
  }

  private paperSoundKey(address: string): string {
    return `${this.id}/${this.data.get(address)?.uid || address}`;
  }

  private paperSoundOn(address: string): boolean {
    return this.paperSound.has(this.paperSoundKey(address));
  }

  /** The speaker on a paper cell: there while the cell prints on paper, drawn "on" or "off". */
  private syncPaperIcon(address: string, onPaper: boolean): void {
    const cell = this.cells.get(address);
    const have = this.paperIcons.get(address);
    const on = onPaper ? this.paperSoundOn(address) : null;
    if (have && (!cell || on === null || have.cell !== cell || have.on !== on)) {
      this.graph.removeCellOverlay(have.cell, have.overlay);
      this.paperIcons.delete(address);
    } else if (have) return;
    if (!cell || on === null) return;
    const tip = on ? 'ASR-33 sound is on. Click to switch it off.' : 'ASR-33 sound is off. Click to switch it on.';
    const overlay = new CellOverlay(new ImageBox(svgUri(speakerSvg(on)), 20, 20), tip, 'right', 'bottom', new Point(-14, -9), 'pointer');
    this.graph.addCellOverlay(cell, overlay);
    this.paperIcons.set(address, { cell, overlay, on });
  }

  /** The speaker was clicked: switches this paper's ASR-33 sound. A click is also what lets the browser play sound at all. */
  togglePaperSound(address: string): void {
    const key = this.paperSoundKey(address);
    const on = !this.paperSound.has(key);
    if (on) this.paperSound.add(key);
    else this.paperSound.delete(key);
    savePaperSound(this.paperSound);
    if (on) {
      primeBell();
      if (!bellOn()) setBell(true);
    }
    this.applyStyle(address);
  }

  /** The part of the text the printer has typed so far. While there is more to type, a timer carries on at the pace of the real machine. */
  private paperTyped(address: string, paper: PaperOptions, full: string): string {
    const entry = this.paperPrint.get(address) ?? { state: { shown: 0, head: '' }, timer: 0 };
    const known = this.paperPrint.has(address);
    entry.state = settle(known ? entry.state : undefined, full, paperSpeed(paper) <= 0);
    this.paperPrint.set(address, entry);
    if (entry.state.shown < full.length && !entry.timer) {
      const sound = this.paperSoundOn(address) && bellOn();
      const step = printStep(full, entry.state.shown, sound ? Math.min(PAPER_CPS, paperSpeed(paper)) : paperSpeed(paper), sound);
      entry.timer = window.setTimeout(() => this.typeMore(address), step.wait);
    }
    return full.slice(0, entry.state.shown);
  }

  private typeMore(address: string): void {
    const entry = this.paperPrint.get(address);
    if (!entry) return;
    entry.timer = 0;
    const d = this.data.get(address);
    const paper = this.paperOf(address);
    if (!d || !paper) {
      this.paperPrint.delete(address);
      return;
    }
    const full = d.output.join('\n');
    const state = settle(entry.state, full, paperSpeed(paper) <= 0 || this.suspended);
    const sound = this.paperSoundOn(address) && bellOn() && !this.suspended;
    // The sound plays at the pace of the real machine (10 letters a second) however fast the cell asks to type, so the paper keeps to it too and stops when the sound does.
    const step = printStep(full, state.shown, sound ? Math.min(PAPER_CPS, paperSpeed(paper)) : paperSpeed(paper), sound);
    const shown = Math.min(full.length, state.shown + step.take);
    if (sound) for (const ch of full.slice(state.shown, shown)) printChar(ch);
    entry.state = advance(full, shown);
    const feeding = !this.suspended && paperSpeed(paper) > 0 && full.slice(state.shown, shown).includes('\n') && (this.paperView.get(address)?.back ?? 0) === 0;
    if (feeding) this.startFeed(address, feedMs(paperSpeed(paper)));
    this.refreshCell(address);
  }

  /** The paper types everything that is waiting at once (and so goes quiet): what Ctrl-C does to a long printout. */
  skipTyping(address: string): void {
    const entry = this.paperPrint.get(address);
    const d = this.data.get(address);
    if (!entry || !d) return;
    window.clearTimeout(entry.timer);
    entry.timer = 0;
    entry.state = advance(d.output.join('\n'), d.output.join('\n').length);
    this.paperFeed.delete(address);
    this.refreshCell(address);
  }

  /** A line feed: the paper slides up one line over a short time instead of jumping. */
  private startFeed(address: string, ms: number): void {
    const running = this.paperFeed.has(address);
    this.paperFeed.set(address, { start: performance.now(), ms, t: 0 });
    if (running) return;
    const tick = (): void => {
      const f = this.paperFeed.get(address);
      if (!f) return;
      f.t = Math.min(1, (performance.now() - f.start) / f.ms);
      if (f.t >= 1) this.paperFeed.delete(address);
      this.refreshCell(address);
      if (this.paperFeed.has(address)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** The paper options when this cell prints like a teletype right now (text output, not code view, not an error), else null. */
  private paperOf(address: string): PaperOptions | null {
    const d = this.data.get(address);
    const o = d?.codeVisual.paper;
    if (!d || !o || d.error || d.plot || d.tiles || d.scene || (d.code && this.mode === 'view')) return null;
    return o;
  }

  /** What is in view on a paper cell, keeping a wound-back sheet where it is while new lines are printed. */
  private paperLayoutOf(address: string): PaperLayout | null {
    const d = this.data.get(address);
    const paper = this.paperOf(address);
    const geo = this.cells.get(address)?.getGeometry();
    if (!d || !paper || !geo) return null;
    if (!paperFontReady(paper, () => this.refreshSoon(address))) return null;
    const seen = this.paperView.get(address) ?? { back: 0, total: 0 };
    const text = this.paperTyped(address, paper, d.output.join('\n'));
    const extra = this.paperFeed.has(address) && seen.back === 0 ? 1 : 0;
    const first = paperLayout(text, geo.width, geo.height, paper, seen.back, extra);
    const grown = first.total - seen.total;
    const back = grown > 0 && seen.back > 0 ? seen.back + grown : grown < 0 ? 0 : seen.back;
    const layout = grown === 0 ? first : paperLayout(text, geo.width, geo.height, paper, back, extra);
    this.paperView.set(address, { back: layout.back, total: layout.total });
    return layout;
  }

  /** Winds a paper cell's roll by whole lines (positive = towards older lines). Returns false when there was nowhere to go. */
  scrollPaper(address: string, lines: number): boolean {
    const layout = this.paperLayoutOf(address);
    if (!layout) return false;
    const next = Math.max(0, Math.min(layout.maxBack, layout.back + lines));
    if (next === layout.back) return false;
    this.paperView.set(address, { back: next, total: layout.total });
    this.refreshCell(address);
    return true;
  }

  /** A sheet on a hidden tab keeps running but does not redraw its cells until it is shown again. */
  setSuspended(on: boolean): void {
    if (this.suspended === on) return;
    this.suspended = on;
    if (on) return;
    const pending = [...this.pendingRefresh];
    this.pendingRefresh.clear();
    for (const address of pending) this.refreshCell(address);
  }

  refreshCell(address: string): void {
    if (this.suspended) {
      this.pendingRefresh.add(address);
      return;
    }
    const cell = this.cells.get(address);
    if (!cell) return;
    // One update for the value and the style: maxGraph revalidates the view once, not twice.
    this.graph.batchUpdate(() => {
      // A hosted live node (e.g. a mounted inline Monaco editor) must not be detached/reattached
      // mid-keystroke, so skip the forced-relabel toggle for it; just reapply colours/etc.
      if (!this.nodeLabels.has(cell.getId() ?? '')) {
        // Changing the value forces the label to be re-read through getLabel.
        this.graph.getDataModel().setValue(cell, (cell.getValue() ?? 0) === 0 ? 1 : 0);
      }
      this.applyStyle(address);
    });
  }

  /** Redraws a cell once after the current burst of writes (painting 80 tiles is one redraw, not 80). */
  refreshSoon(address: string): void {
    if (this.refreshQueue.size === 0) {
      queueMicrotask(() => {
        const addresses = [...this.refreshQueue];
        this.refreshQueue.clear();
        this.graph.batchUpdate(() => addresses.forEach((a) => this.refreshCell(a)));
      });
    }
    this.refreshQueue.add(address);
  }

  /** Hosts (or clears) a live DOM node as the label of an arbitrary cell id, e.g. an editor frame. */
  setNodeLabel(id: string, node: HTMLElement | null): void {
    if (node) this.nodeLabels.set(id, node);
    else this.nodeLabels.delete(id);
    const cell = this.graph.getDataModel().getCell(id);
    if (!cell) return;
    this.graph.getDataModel().setValue(cell, (cell.getValue() ?? 0) === 0 ? 1 : 0);
  }

  // ------------------------------------------------------------------ spans

  /** Merges a cell over `cols` x `rows` neighbours (like merged spreadsheet cells). */
  setSpan(address: string, cols: number, rows: number): void {
    const d = this.data.get(address);
    const cell = this.cells.get(address);
    if (!d || !cell) return;
    // A block never lies over another block or the board: it would hide it, and the mouse could not reach it any more.
    ({ cols, rows } = this.fitFree(d, { cols: Math.max(1, Math.floor(cols) || 1), rows: Math.max(1, Math.floor(rows) || 1) }));
    if (d.span.cols === cols && d.span.rows === rows) return;
    const model = this.graph.getDataModel();
    model.batchUpdate(() => {
      // release previously covered cells
      for (const [covered, owner] of [...this.coveredBy]) {
        if (owner === address) {
          this.coveredBy.delete(covered);
          const c = this.cells.get(covered);
          if (c) model.setVisible(c, true);
        }
      }
      d.span = { cols, rows };
      for (let r = d.row; r < d.row + rows; r++) {
        for (let c = d.col; c < d.col + cols; c++) {
          const a = formatAddress(c, r);
          if (a === address || this.isBoardAddress(a)) continue;
          const other = this.cells.get(a);
          if (!other || this.coveredBy.has(a)) continue;
          this.coveredBy.set(a, address);
          model.setVisible(other, false);
        }
      }
      const geo = cell.getGeometry()!;
      model.setGeometry(cell, new Geometry(geo.x, geo.y, cols * CW, rows * CH));
      this.graph.orderCells(false, [cell]);
    });
    this.depGraph.markDirty(sizeNode(address));
    this.requestRun();
  }

  // ------------------------------------------------------------------ shape

  /**
   * What a block's code asks for with span(cols, rows): a default size. The person's own size (resize handles, or
   * cells turned into a block) wins until the code's numbers change; see shape.ts for the rule.
   */
  requestSpan(address: string, cols: number, rows: number): void {
    const d = this.data.get(address);
    if (!d) return;
    const request = { cols: Math.max(1, Math.floor(cols) || 1), rows: Math.max(1, Math.floor(rows) || 1) };
    const decision = decideSpan(d.shape, request, readSpanCall(d.code));
    d.shape = decision.shape;
    const before = d.span;
    this.setSpan(address, decision.apply.cols, decision.apply.rows);
    const got = d.span;
    // The code asked for more room than there is: say so once (a timer cell asks again at every tick, and gets the same answer).
    if ((got.cols !== decision.apply.cols || got.rows !== decision.apply.rows) && (got.cols !== before.cols || got.rows !== before.rows)) {
      this.flash(address, THEME.flashBad);
      this.shapeHandlers.forEach((h) => h({ address, size: got, byPerson: false, limited: true, rewrote: false }));
    }
    if (decision.rewriteTo) this.rewriteSpanLine(address, decision.rewriteTo);
  }

  /**
   * Blocks that an older version let lie under another block (hidden, and out of the mouse's reach) come back out:
   * the block on top shrinks to the biggest size that leaves the others alone. Returns the blocks that were shrunk.
   */
  freeBuried(): string[] {
    const shrunk: string[] = [];
    for (const [covered, owner] of [...this.coveredBy]) {
      const buried = this.data.get(covered);
      const top = this.data.get(owner);
      if (!top || !buried || !(buried.code.trim() || buried.span.cols > 1 || buried.span.rows > 1) || shrunk.includes(owner)) continue;
      const fit = this.fitFree(top, top.span, { cols: 1, rows: 1 });
      this.forceSpan(owner, fit.cols, fit.rows);
      if (top.shape.user) top.shape = { ...top.shape, user: fit };
      if (top.code.trim()) this.rewriteSpanLine(owner, fit);
      shrunk.push(owner);
    }
    return shrunk;
  }

  /** The size the person gave this block, or null when nobody did. */
  userSize(address: string): Size | null {
    return this.data.get(address)?.shape.user ?? null;
  }

  /** Brings back a size the person chose (from a saved sheet). The code is not touched. */
  restoreUserSize(address: string, size: Size): void {
    const d = this.data.get(address);
    if (!d) return;
    const user = { cols: Math.max(1, Math.floor(size.cols) || 1), rows: Math.max(1, Math.floor(size.rows) || 1) };
    d.shape = { ...d.shape, user };
    this.setSpan(address, user.cols, user.rows);
  }

  /** The block goes back to one cell and forgets what anyone said about its size (an empty block nobody wrote in). */
  resetShape(address: string): void {
    const d = this.data.get(address);
    if (!d) return;
    d.shape = emptyShape();
    this.forceSpan(address, 1, 1);
  }

  /** Listens for blocks changing shape because the person resized them (handles, a selection) or the code asked for another size. */
  onShapeChange(handler: (change: ShapeChange) => void): void {
    this.shapeHandlers.push(handler);
  }

  /** Tells the sheet when a cell's code must not be rewritten (its editor is open on it). */
  setCodeLocked(isLocked: (address: string) => boolean): void {
    this.codeLocked = isLocked;
  }

  /**
   * The person gives a block a size: a resize handle, or cells turned into a block. Other code and the board limit it
   * (the biggest size that fits is used). A plain span(...) line in the code is rewritten to the new numbers, so the
   * code never disagrees with the screen; code without one is left alone (the shape is simply remembered).
   */
  setUserSize(address: string, cols: number, rows: number): Size | null {
    const d = this.data.get(address);
    if (!d || this.isBoardAddress(address)) return null;
    const wanted = { cols: Math.max(1, Math.floor(cols) || 1), rows: Math.max(1, Math.floor(rows) || 1) };
    const fit = this.fitFree(d, wanted);
    this.forceSpan(address, fit.cols, fit.rows);
    d.shape = { ...d.shape, user: fit };
    const rewrote = d.code.trim() ? this.rewriteSpanLine(address, fit) : false;
    this.shapeHandlers.forEach((h) => h({ address, size: fit, byPerson: true, limited: fit.cols !== wanted.cols || fit.rows !== wanted.rows, rewrote }));
    // The new size is part of what is saved: tell whoever saves.
    if (!rewrote && d.code.trim()) this.codeChangedHandlers.forEach((h) => h(address));
    this.syncHandles();
    return fit;
  }

  /** The biggest size not larger than `want` that does not run over other code, merged blocks or the board. */
  private fitFree(d: SheetCellData, want: Size, floor: Size = d.span): Size {
    let { cols, rows } = want;
    cols = Math.min(cols, this.colCount - d.col);
    rows = Math.min(rows, this.rowCount - d.row);
    const free = (c: number, r: number): boolean => {
      const rect = { c1: d.col, r1: d.row, c2: d.col + c - 1, r2: d.row + r - 1 };
      for (let rr = rect.r1; rr <= rect.r2; rr++) for (let cc = rect.c1; cc <= rect.c2; cc++) if (this.isBoardAddress(formatAddress(cc, rr))) return false;
      return this.occupantsOf(rect, d.address).length === 0;
    };
    // Shrink the side that grew until it fits.
    while (!free(cols, rows)) {
      if (cols > floor.cols && cols >= rows) cols--;
      else if (rows > floor.rows) rows--;
      else if (cols > floor.cols) cols--;
      else break;
    }
    return { cols: Math.max(1, cols), rows: Math.max(1, rows) };
  }

  /** setSpan, and the block's frame is put back on the grid even when its cell count did not change (a handle drag leaves it between lines). */
  private forceSpan(address: string, cols: number, rows: number): void {
    const d = this.data.get(address);
    const cell = this.cells.get(address);
    if (!d || !cell) return;
    this.setSpan(address, cols, rows);
    const geo = cell.getGeometry()!;
    const width = d.span.cols * CW;
    const height = d.span.rows * CH;
    if (geo.width !== width || geo.height !== height) this.graph.getDataModel().setGeometry(cell, new Geometry(ORIGIN_X + d.col * CW, ORIGIN_Y + d.row * CH, width, height));
  }

  /** Rewrites the numbers of the code's plain `span(...)` line. False when there is none, nothing would change, or the code is being edited. */
  private rewriteSpanLine(address: string, size: Size): boolean {
    const d = this.data.get(address);
    if (!d || this.codeLocked(address)) return false;
    const next = rewriteSpanCall(d.code, size.cols, size.rows);
    if (next === null || next === d.code) return false;
    d.code = next;
    d.shape = { ...d.shape, code: size };
    this.refreshCell(address);
    this.codeChangedHandlers.forEach((h) => h(address));
    return true;
  }

  /** A resize handle was let go: the block takes the shape that is nearest on the grid. */
  private resizedByHand(address: string): void {
    const d = this.data.get(address);
    const cell = this.cells.get(address);
    if (!d || !cell) return;
    const geo = cell.getGeometry()!;
    this.setUserSize(address, Math.round(geo.width / CW), Math.round(geo.height / CH));
  }

  // -------------------------------------------------------------- picking

  /** The owner of the block a cell belongs to (the cell itself when it is not covered by a bigger one). */
  ownerOf(address: string): string {
    return this.coveredBy.get(address) ?? address;
  }

  getPicked(): string[] {
    return [...this.picked];
  }

  isPicked(address: string): boolean {
    return this.picked.has(address);
  }

  get pickedAnchor(): string | null {
    return this.pickAnchor;
  }

  /** Listens for the picked cells changing. */
  onPickChange(handler: (picked: string[]) => void): void {
    this.pickHandlers.push(handler);
  }

  /** The bounding box of the picked blocks in cells, or null when nothing is picked. */
  pickedBounds(): { col: number; row: number; cols: number; rows: number } | null {
    let c1 = Infinity;
    let r1 = Infinity;
    let c2 = -1;
    let r2 = -1;
    for (const a of this.picked) {
      const d = this.data.get(a);
      if (!d) continue;
      c1 = Math.min(c1, d.col);
      r1 = Math.min(r1, d.row);
      c2 = Math.max(c2, d.col + d.span.cols - 1);
      r2 = Math.max(r2, d.row + d.span.rows - 1);
    }
    return c2 < 0 ? null : { col: c1, row: r1, cols: c2 - c1 + 1, rows: r2 - r1 + 1 };
  }

  /** Replaces the picked cells. `anchor` is where a Shift-click range starts (default: the first one). Board squares are never picked. */
  pick(addresses: Iterable<string>, anchor?: string | null): void {
    const next = new Set<string>();
    for (const a of addresses) {
      const owner = this.ownerOf(a);
      if (this.data.has(owner) && !this.isBoardAddress(owner)) next.add(owner);
    }
    const before = this.picked;
    this.picked = next;
    if (anchor !== undefined) this.pickAnchor = anchor ? this.ownerOf(anchor) : null;
    else if (!this.pickAnchor || !next.has(this.pickAnchor)) this.pickAnchor = [...next][0] ?? null;
    // Every cell of the group is restyled: the tint of the empty ones depends on how many are picked.
    this.graph.batchUpdate(() => {
      for (const a of new Set([...before, ...next])) this.applyStyle(a);
    });
    this.syncHandles();
    this.pickHandlers.forEach((h) => h([...next]));
  }

  /** Ctrl-click: one more cell in the group, or one less. */
  togglePick(address: string): void {
    const owner = this.ownerOf(address);
    const next = new Set(this.picked);
    if (!next.delete(owner)) next.add(owner);
    this.pick(next, next.has(owner) ? owner : undefined);
  }

  /** Shift-click: every cell in the rectangle from the anchor to `address`. */
  pickRange(address: string): void {
    const to = this.data.get(this.ownerOf(address));
    const from = this.data.get(this.pickAnchor ?? this.ownerOf(address));
    if (!to || !from) return;
    this.pick(
      this.ownersIn(Math.min(from.col, to.col), Math.min(from.row, to.row), Math.max(from.col + from.span.cols - 1, to.col + to.span.cols - 1), Math.max(from.row + from.span.rows - 1, to.row + to.span.rows - 1)),
      from.address,
    );
  }

  /** The blocks (by owner) that touch a rectangle of cells; board squares are left out. */
  ownersIn(c1: number, r1: number, c2: number, r2: number): string[] {
    const owners = new Set<string>();
    for (let r = Math.max(0, r1); r <= Math.min(r2, this.rowCount - 1); r++) {
      for (let c = Math.max(0, c1); c <= Math.min(c2, this.colCount - 1); c++) {
        const a = formatAddress(c, r);
        if (!this.isBoardAddress(a)) owners.add(this.ownerOf(a));
      }
    }
    return [...owners];
  }

  /** Keeps the picked cells on their cells when content moves or rows shift. */
  private remapPicked(map: (address: string) => string): void {
    const next = [...this.picked].map(map);
    const anchor = this.pickAnchor ? map(this.pickAnchor) : null;
    if (next.every((a, i) => a === [...this.picked][i]) && anchor === this.pickAnchor) return;
    this.pick(next, anchor);
  }

  /** True for the one picked code block: the only sheet cell that wears resize handles. */
  hasHandles(cell: Cell): boolean {
    const id = cell.getId() ?? '';
    if (!id.startsWith('sheet:')) return false;
    const address = id.slice(6);
    return this.picked.size === 1 && this.picked.has(address) && !!this.data.get(address)?.code.trim();
  }

  /** Puts maxGraph's resize handles on the one picked code block, and takes them off everything else. */
  syncHandles(): void {
    const only = this.picked.size === 1 ? [...this.picked][0] : null;
    const cell = only && this.data.get(only)?.code.trim() ? this.cells.get(only) : undefined;
    const now = this.graph.getSelectionCells();
    const mine = now.filter((c) => (c.getId() ?? '').startsWith('sheet:'));
    if (cell) {
      if (!(now.length === 1 && now[0] === cell)) this.graph.setSelectionCell(cell);
    } else if (mine.length) {
      this.graph.setSelectionCells(now.filter((c) => !mine.includes(c)));
    }
  }

  // ------------------------------------------------------------ content drag

  /** Called after a move, swap or row insert rewrote the cell addresses written in code. */
  onReferencesUpdated(handler: (report: ReferenceReport) => void): void {
    this.referencesHandlers.push(handler);
  }

  /** Set by the workspace: after this sheet's cells moved, other tabs' code that names them by absolute path is rewritten too. */
  setForeignRewriter(fn: (rewrite: RefRewrite) => void): void {
    this.foreignRewriter = fn;
  }

  /**
   * Another tab's cells moved: follow them in the code written here that names that tab by absolute path
   * ("/lab/J24"). Plain addresses in this code mean this tab and are not touched.
   */
  rewriteForeign(tabId: string, rewrite: RefRewrite): void {
    const cells: string[] = [];
    const warnings: string[] = [];
    let count = 0;
    for (const d of this.data.values()) {
      if (!d.code) continue;
      const result = mapAddressLiterals(d.code, (ends, literal, tab) => (tab === tabId ? rewrite(ends, literal) : null));
      if (result.count > 0) {
        d.code = result.code;
        count += result.count;
        cells.push(d.address);
      }
      for (const literal of result.kept) warnings.push(`${d.address} still says "${literal}", but cells there moved. Check that it points where you mean.`);
    }
    this.announceReferences({ count, cells, warnings });
  }

  /** Rewrites address literals in every cell's code at once; `relocate` says where each cell's code will live afterwards. */
  private rewriteReferences(rewrite: RefRewrite, relocate: (address: string) => string): ReferenceReport {
    const cells: string[] = [];
    const warnings: string[] = [];
    let count = 0;
    // A literal that names another tab ("/lab/J24") is that tab's business; here only this tab's own addresses move.
    const own: RefRewrite = (ends, literal, tab) => (tab && tab !== this.id ? null : rewrite(ends, literal));
    for (const d of this.data.values()) {
      if (!d.code) continue;
      const result = mapAddressLiterals(d.code, own);
      if (result.count > 0) {
        d.code = result.code;
        count += result.count;
        cells.push(relocate(d.address));
      }
      for (const literal of result.kept) {
        warnings.push(`${relocate(d.address)} still says "${literal}", but cells there moved. Check that it points where you mean.`);
      }
    }
    this.foreignRewriter?.(rewrite);
    return { count, cells, warnings };
  }

  /** Wakes the cells whose code was rewritten (so timers and watchers pick up the new addresses) and tells the UI. */
  private announceReferences(report: ReferenceReport): void {
    for (const address of report.cells) {
      this.depGraph.markDirty(address);
      this.depGraph.markDirty(codeNode(address));
    }
    if (report.count === 0 && report.warnings.length === 0) return;
    this.requestRun();
    for (const address of report.cells) this.codeChangedHandlers.forEach((h) => h(address));
    this.referencesHandlers.forEach((h) => h(report));
  }

  private blockRect(d: SheetCellData, cols: number, rows: number): BlockMove['from'] {
    return { c1: d.col, r1: d.row, c2: d.col + cols - 1, r2: d.row + rows - 1 };
  }

  onContentMoved(handler: (from: string, to: string) => void): void {
    this.contentMovedHandlers.push(handler);
  }

  onPointerCancel(handler: () => void): void {
    this.pointerCancelHandlers.push(handler);
  }

  /** Ctrl/Cmd held, or a double-tap-and-hold is active: the press means "grab and move", not "edit". */
  isGrabEvent(e: Event): boolean {
    const m = e as MouseEvent;
    return !!(m.ctrlKey || m.metaKey) || this.grabArmed();
  }

  /** A Ctrl-drag pan took over this press: drop the block drag or rubber band it started, and ignore the click that ends it. */
  beginPan(): void {
    this.cancelContentDrag();
    this.cancelRubber();
    this.rubberEndedAt = performance.now();
  }

  endPan(): void {
    this.rubberEndedAt = performance.now();
  }

  /** A finger that has not armed the grab gesture belongs to the browser (it scrolls the sheet). */
  fingerIsScrolling(me: InternalMouseEvent): boolean {
    return (me.getEvent() as PointerEvent).pointerType === 'touch' && !this.grabArmed();
  }

  private cancelContentDrag(): void {
    this.groupPress = null;
    const drag = this.contentDrag;
    if (!drag) return;
    this.contentDrag = null;
    if (!drag.moved) {
      drag.spring.stop();
      return;
    }
    this.contentDragBusy = true;
    void this.resolveContentDrop(drag, null);
  }

  private draggable(address: string): boolean {
    if (this.isBoardAddress(address)) return false;
    const d = this.data.get(address);
    if (!d || (!d.code.trim() && d.span.cols === 1 && d.span.rows === 1)) return false;
    if (this.coveredBy.has(address)) return false;
    return true;
  }

  /** Grows the sheet (columns on the right, rows at the bottom) so that square (c2, r2) exists. */
  private ensureRoom(c2: number, r2: number): { cols: number; rows: number } {
    let cols = 0;
    let rows = 0;
    if (c2 >= this.colCount) {
      cols = c2 + 1 - this.colCount;
      this.addColumns(cols);
    }
    while (this.rowCount <= r2) {
      this.insertRow(this.rowCount - 1);
      rows++;
    }
    return { cols, rows };
  }

  /** Owners of code or merged blocks that sit (even partly) inside `rect`, other than `except`. */
  private occupantsOf(rect: BlockMove['from'], except: string): string[] {
    const owners = new Set<string>();
    for (let r = rect.r1; r <= rect.r2 && r < this.rowCount; r++) {
      for (let c = rect.c1; c <= rect.c2 && c < this.colCount; c++) {
        const a = formatAddress(c, r);
        const owner = this.coveredBy.get(a) ?? a;
        if (owner === except) continue;
        const d = this.data.get(owner);
        if (d && (d.code.trim() || d.span.cols > 1 || d.span.rows > 1)) owners.add(owner);
      }
    }
    return [...owners];
  }

  private rectFree(c: number, r: number, cols: number, rows: number, avoid: Array<BlockMove['from']>): boolean {
    for (let rr = r; rr < r + rows; rr++) {
      for (let cc = c; cc < c + cols; cc++) {
        if (avoid.some((v) => cc >= v.c1 && cc <= v.c2 && rr >= v.r1 && rr <= v.r2)) return false;
        if (cc >= this.colCount) continue;
        if (rr >= this.rowCount) return false;
        const a = formatAddress(cc, rr);
        if (this.isBoardAddress(a) || this.coveredBy.has(a)) return false;
        const d = this.data.get(a);
        if (d && (d.code.trim() || d.span.cols > 1 || d.span.rows > 1)) return false;
      }
    }
    return true;
  }

  /**
   * The top-left cell of the first empty cols x rows spot, looking row by row from `fromRow` (0-based). It never
   * touches a cell that holds code, a merged block or a board square, so a helper writing on its own cannot
   * land on the person's work. Null when nothing fits.
   */
  findFreeBlock(cols: number, rows: number, fromRow = 0): string | null {
    const w = Math.max(1, Math.min(Math.floor(cols), this.colCount));
    const h = Math.max(1, Math.floor(rows));
    for (let r = Math.max(0, fromRow); r + h <= this.rowCount; r++) {
      for (let c = 0; c + w <= this.colCount; c++) if (this.rectFree(c, r, w, h, [])) return formatAddress(c, r);
    }
    return null;
  }

  /** First free spot for a cols x rows block on `row`, scanning right from `startCol` (columns beyond the sheet are always free). */
  private findSpot(row: number, cols: number, rows: number, startCol: number, avoid: Array<BlockMove['from']>): number | null {
    for (let c = startCol; c + cols <= MAX_COLS; c++) {
      if (this.rectFree(c, row, cols, rows, avoid)) return c;
    }
    return null;
  }

  /** Moves a block anywhere on the sheet: the sheet grows to fit and whatever sits in the way is shifted aside. */
  private moveBlock(fromAddress: string, pos: { col: number; row: number }): boolean {
    const from = this.data.get(fromAddress)!;
    const { cols, rows } = from.span;
    const dst = { c1: pos.col, r1: pos.row, c2: pos.col + cols - 1, r2: pos.row + rows - 1 };
    if (dst.c2 >= MAX_COLS || dst.r2 >= MAX_ROWS) return false;
    for (let r = dst.r1; r <= dst.r2; r++) {
      for (let c = dst.c1; c <= dst.c2; c++) if (this.isBoardAddress(formatAddress(c, r))) return false;
    }
    const grew = this.ensureRoom(dst.c2, dst.r2);
    const avoid = [dst, this.blockRect(from, cols, rows)];
    const plan: Array<{ address: string; col: number; row: number }> = [];
    for (const owner of this.occupantsOf(dst, fromAddress)) {
      const od = this.data.get(owner)!;
      const col = this.findSpot(od.row, od.span.cols, od.span.rows, dst.c2 + 1, avoid);
      if (col === null) return false;
      avoid.push({ c1: col, r1: od.row, c2: col + od.span.cols - 1, r2: od.row + od.span.rows - 1 });
      plan.push({ address: owner, col, row: od.row });
    }
    const shifts: ShiftGhost[] = [];
    for (const p of plan) {
      const od = this.data.get(p.address)!;
      const more = this.ensureRoom(p.col + od.span.cols - 1, p.row + od.span.rows - 1);
      grew.cols += more.cols;
      grew.rows += more.rows;
      const to = formatAddress(p.col, p.row);
      const ghost = this.captureGhost(p.address, to);
      this.moveBlockRaw(p.address, to);
      if (ghost) shifts.push(this.landGhost(ghost));
    }
    this.moveBlockRaw(fromAddress, formatAddress(pos.col, pos.row));
    if (plan.length > 0 || grew.cols > 0 || grew.rows > 0) {
      const info = { displaced: plan.length, addedCols: grew.cols, addedRows: grew.rows, shifts: shifts.map((g) => ({ from: g.from, to: g.to })) };
      this.playShifts(shifts, dst);
      this.roomMadeHandlers.forEach((h) => h(info));
    }
    return true;
  }

  /** Remembers how a block looks before it steps aside, so a ghost of it can glide to its new place. */
  private captureGhost(from: string, to: string): ShiftGhost | null {
    const geo = this.geometryOf(from);
    const d = this.data.get(from);
    if (!geo || !d) return null;
    const first = d.code.split('\n').find((l) => l.trim()) ?? '';
    return {
      from,
      to,
      fill: this.fillOf(from),
      text: first.replace(/^\s*\/\/\s*/, '').trim(),
      box: { x: geo.x, y: geo.y, width: geo.width, height: geo.height },
    };
  }

  private landGhost(ghost: ShiftGhost): ShiftGhost {
    const geo = this.geometryOf(ghost.to);
    if (geo) ghost.dest = { x: geo.x, y: geo.y, width: geo.width, height: geo.height };
    return ghost;
  }

  /**
   * Shows the make-room: the square the dropped block lands on pulses, and each block that had to
   * step aside slides (as a ghost on top of the sheet) from where it was to where it is now. Only a
   * picture: the cells themselves are already in their new places, so nothing depends on timing.
   */
  private playShifts(ghosts: ShiftGhost[], landing: { c1: number; r1: number; c2: number; r2: number }): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const total = SHIFT_MS + SHIFT_STAGGER_MS * ghosts.length;
    const first = this.geometryOf(formatAddress(landing.c1, landing.r1));
    if (first) {
      // The square the dropped block lands on pulses, then fades.
      const spot = this.overlays.add(
        { x: first.x, y: first.y, width: (landing.c2 - landing.c1 + 1) * CW, height: (landing.r2 - landing.r1 + 1) * CH },
        { fillColor: '#2e7d32', fillOpacity: 12, strokeColor: '#2e7d32', strokeWidth: 3, dashed: true, rounded: true, arcSize: 4 },
      );
      this.overlays.play(spot, total, 0, (p) => ({ opacity: p < 0.6 ? 0.9 : 0.9 * (1 - (p - 0.6) / 0.4) }));
    }

    ghosts.forEach((g, i) => {
      if (!g.dest) return;
      const from = g.box;
      const to = g.dest;
      const picture = this.overlays.add(from, {
        fillColor: g.fill === 'none' || !g.fill ? '#ffffff' : g.fill,
        strokeColor: '#d19a2a',
        strokeWidth: 2,
        rounded: true,
        arcSize: 6,
        fontColor: '#1f2933',
        fontSize: 11,
        align: 'left',
        verticalAlign: 'top',
        spacingLeft: 4,
        spacingTop: 3,
      }, `${g.from} → ${g.to}${g.text ? `\n${g.text.slice(0, 36)}` : ''}`);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const ms = Math.min(1500, SHIFT_MS + Math.hypot(dx, dy) * 0.5);
      // Ease in and out along the way, then fade at the end (the cells themselves are already in their new places).
      const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
      this.overlays.play(picture, ms, i * SHIFT_STAGGER_MS, (p) => {
        const m = ease(Math.max(0, Math.min(1, (p - 0.15) / 0.7)));
        return { rect: { x: from.x + dx * m, y: from.y + dy * m, width: from.width, height: from.height }, opacity: p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15 };
      });
      this.flash(g.to, THEME.flash, SHIFT_MS + 400);
    });
  }

  /** Called when a move had to shift other blocks aside or grow the sheet. */
  onRoomMade(handler: (info: RoomInfo) => void): void {
    this.roomMadeHandlers.push(handler);
  }

  /** Moves one block onto squares that are already free (or its own). */
  private moveBlockRaw(fromAddress: string, toAddress: string): void {
    const from = this.data.get(fromAddress)!;
    const to = this.data.get(toAddress)!;
    const { cols, rows } = from.span;
    const src = this.blockRect(from, cols, rows);
    const dst = this.blockRect(to, cols, rows);
    const overlapping = src.c1 <= dst.c2 && dst.c1 <= src.c2 && src.r1 <= dst.r2 && dst.r1 <= src.r2;
    // Where the blocks do not overlap this is a swap with empty squares, so references to the empty spot follow it back.
    const moves: BlockMove[] = overlapping ? [{ from: src, to: dst }] : [{ from: src, to: dst }, { from: dst, to: src }];
    const references = this.rewriteReferences(blockMoveRewrite(moves), (a) => {
      const p = this.data.get(a)!;
      const next = movedTo(moves, { col: p.col, row: p.row });
      return next ? formatAddress(next.col, next.row) : a;
    });
    const code = from.code;
    const uid = from.uid;
    const visual = from.codeVisual;
    const memory = from.memory;
    const shape = from.shape;
    const touched: string[] = [];
    for (const d of [from, to]) {
      for (let r = d.row; r < d.row + rows; r++) for (let c = d.col; c < d.col + cols; c++) touched.push(formatAddress(c, r));
    }
    this.graph.batchUpdate(() => {
      from.code = '';
      from.uid = '';
      from.codeVisual = {};
      from.memory = {};
      from.shape = emptyShape();
      from.runCount = 0;
      from.output = [];
      from.plot = null;
      from.tiles = null;
      from.scene = null;
      from.viewText = null;
      from.error = null;
      this.setSpan(fromAddress, 1, 1);
      to.code = code;
      to.uid = uid;
      to.memory = memory;
      to.shape = shape;
      to.codeVisual = visual;
      to.output = [];
      to.plot = null;
      to.tiles = null;
      to.scene = null;
      to.viewText = null;
      to.error = null;
      this.setSpan(toAddress, cols, rows);
      this.refreshCell(fromAddress);
      this.refreshCell(toAddress);
    });
    for (const a of new Set(touched)) this.depGraph.markDirty(a);
    this.nextReason.set(toAddress, 'moved');
    this.depGraph.markAllDirty([codeNode(fromAddress), codeNode(toAddress)]);
    this.requestRun();
    this.contentMovedHandlers.forEach((h) => h(fromAddress, toAddress));
    this.codeChangedHandlers.forEach((h) => {
      h(fromAddress);
      h(toAddress);
    });
    this.announceReferences(references);
  }

  /** Moves/swaps one cell's code (and derived visual) with another, Excel-drag style. */
  moveCellContent(fromAddress: string, toAddress: string): boolean {
    if (fromAddress === toAddress) return false;
    if (!this.draggable(fromAddress)) return false;
    if (this.isBoardAddress(toAddress)) return false;
    const pos = parseAddress(toAddress);
    const from = this.data.get(fromAddress);
    if (!pos || pos.col < 0 || pos.row < 0 || !from) return false;
    const to = this.data.get(toAddress);
    const plain = from.span.cols === 1 && from.span.rows === 1 && to && to.span.cols === 1 && to.span.rows === 1 && !this.coveredBy.has(toAddress);
    if (!plain) return this.moveBlock(fromAddress, pos);
    return this.swapCells(fromAddress, toAddress);
  }

  private swapCells(fromAddress: string, toAddress: string): boolean {
    const from = this.data.get(fromAddress)!;
    const to = this.data.get(toAddress)!;
    // A swap: references to either cell follow its content to the other square.
    const here = this.blockRect(from, 1, 1);
    const there = this.blockRect(to, 1, 1);
    const references = this.rewriteReferences(blockMoveRewrite([{ from: here, to: there }, { from: there, to: here }]), (a) =>
      a === fromAddress ? toAddress : a === toAddress ? fromAddress : a,
    );

    const fromCode = from.code;
    const fromUid = from.uid;
    const fromVisual = from.codeVisual;
    const toCode = to.code;
    const toUid = to.uid;
    const toVisual = to.codeVisual;
    const fromMemory = from.memory;
    const toMemory = to.memory;
    const fromShape = from.shape;
    const toShape = to.shape;
    const fromRuns = from.runCount;
    const toRuns = to.runCount;

    this.graph.batchUpdate(() => {
      to.code = fromCode;
      to.uid = fromUid;
      to.codeVisual = fromVisual;
      to.memory = fromMemory;
      to.shape = fromShape;
      to.runCount = fromRuns;
      to.output = [];
      to.plot = null;
      to.tiles = null;
      to.scene = null;
      to.viewText = null;
      to.error = null;
      from.code = toCode;
      from.uid = toUid;
      from.codeVisual = toVisual;
      from.memory = toMemory;
      from.shape = toShape;
      from.runCount = toRuns;
      from.output = [];
      from.plot = null;
      from.tiles = null;
      from.scene = null;
      from.viewText = null;
      from.error = null;
      this.refreshCell(fromAddress);
      this.refreshCell(toAddress);
    });
    this.depGraph.markDirty(fromAddress);
    this.depGraph.markDirty(toAddress);
    this.depGraph.markAllDirty([codeNode(fromAddress), codeNode(toAddress)]);
    this.nextReason.set(toAddress, 'moved');
    if (toCode.trim()) this.nextReason.set(fromAddress, 'moved');
    this.requestRun();
    this.contentMovedHandlers.forEach((h) => h(fromAddress, toAddress));
    this.codeChangedHandlers.forEach((h) => {
      h(fromAddress);
      h(toAddress);
    });
    this.announceReferences(references);
    return true;
  }

  /** Mouse position in model coordinates (maxGraph's getGraphX/Y are scaled pixels, wrong once zoomed). */
  modelPoint(me: InternalMouseEvent): { x: number; y: number } {
    const view = this.graph.getView();
    return { x: me.getGraphX() / view.scale - view.translate.x, y: me.getGraphY() / view.scale - view.translate.y };
  }

  /** Is this press on one of the green resize handles of the picked block? Then the handle owns the drag, not the content drag. */
  private onResizeHandle(me: InternalMouseEvent): boolean {
    const cell = this.graph.getSelectionCell();
    if (!cell || !(cell.getId() ?? '').startsWith('sheet:')) return false;
    const handler = this.graph.getPlugin<SelectionCellsHandler>('SelectionCellsHandler')?.getHandler(cell);
    return handler instanceof VertexHandler && handler.getHandleForEvent(me) != null;
  }

  private onContentMouseDown(me: InternalMouseEvent): void {
    if (this.contentDrag || this.rubber || this.onResizeHandle(me)) return;
    const id = me.getCell()?.getId() ?? '';
    if (!id.startsWith('sheet:')) return;
    const address = id.slice(6);
    const event = me.getEvent() as MouseEvent;
    const group = !event.altKey && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey ? this.pickedEmptyRect(address) : null;
    if (group && !this.fingerIsScrolling(me)) {
      const p = this.modelPoint(me);
      const origin = this.geometryOf(group.first)!;
      this.groupPress = { ...group, startX: me.getGraphX(), startY: me.getGraphY(), grab: { x: p.x - origin.x, y: p.y - origin.y } };
      return;
    }
    if (!this.draggable(address) || event.altKey) {
      // Not a block to carry (an empty cell, or Alt held): a press and drag here draws a rubber band around cells.
      if (event.button === 0 && !this.isBoardAddress(address) && !this.fingerIsScrolling(me)) {
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        this.rubber = { startX: me.getGraphX(), startY: me.getGraphY(), active: false, additive, base: new Set(this.picked), box: null };
      }
      return;
    }
    if (this.fingerIsScrolling(me)) return;
    const cell = this.cells.get(address)!;
    const geo = cell.getGeometry()!;
    const p = this.modelPoint(me);
    this.contentDrag = {
      address,
      cell,
      size: { width: geo.width, height: geo.height },
      origin: { x: geo.x, y: geo.y },
      grab: { x: p.x - geo.x, y: p.y - geo.y },
      startX: me.getGraphX(),
      startY: me.getGraphY(),
      moved: false,
      spring: new Spring({ x: geo.x + geo.width / 2, y: geo.y + geo.height / 2 }),
    };
  }

  /** The picked cells when they are two or more empty 1×1 cells that exactly fill a rectangle and include `address`. */
  private pickedEmptyRect(address: string): { first: string; cols: number; rows: number } | null {
    if (this.picked.size < 2 || !this.picked.has(address)) return null;
    for (const a of this.picked) {
      const d = this.data.get(a);
      if (!d || d.code.trim() || d.span.cols !== 1 || d.span.rows !== 1) return null;
    }
    const b = this.pickedBounds();
    if (!b || b.cols * b.rows !== this.picked.size) return null;
    return { first: formatAddress(b.col, b.row), cols: b.cols, rows: b.rows };
  }

  /** The press on a picked group turns into a block drag once the pointer has really moved. */
  private startGroupDrag(me: InternalMouseEvent): void {
    const press = this.groupPress;
    if (!press) return;
    if (Math.hypot(me.getGraphX() - press.startX, me.getGraphY() - press.startY) < DRAG_THRESHOLD) return;
    this.groupPress = null;
    const got = this.setUserSize(press.first, press.cols, press.rows);
    if (!got || (got.cols !== press.cols || got.rows !== press.rows)) {
      if (got) this.forceSpan(press.first, 1, 1);
      this.flash(press.first, THEME.flashBad);
      return;
    }
    this.pick([press.first], press.first);
    const cell = this.cells.get(press.first)!;
    const geo = cell.getGeometry()!;
    this.contentDrag = {
      address: press.first,
      cell,
      size: { width: geo.width, height: geo.height },
      origin: { x: geo.x, y: geo.y },
      grab: press.grab,
      startX: press.startX,
      startY: press.startY,
      moved: false,
      spring: new Spring({ x: geo.x + geo.width / 2, y: geo.y + geo.height / 2 }),
    };
  }

  private onContentMouseMove(me: InternalMouseEvent): void {
    this.startGroupDrag(me);
    const drag = this.contentDrag;
    if (!drag) return;
    const gx = me.getGraphX();
    const gy = me.getGraphY();
    if (!drag.moved) {
      if (Math.hypot(gx - drag.startX, gy - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.graph.orderCells(false, [drag.cell]);
      const model = this.graph.getDataModel();
      drag.spring.start(({ x, y }) => {
        model.setGeometry(drag.cell, new Geometry(x - drag.size.width / 2, y - drag.size.height / 2, drag.size.width, drag.size.height));
      });
    }
    const p = this.modelPoint(me);
    drag.spring.setTarget({ x: p.x - drag.grab.x + drag.size.width / 2, y: p.y - drag.grab.y + drag.size.height / 2 });
    me.consume();
  }

  /** The rubber band grows with the pointer and picks the cells it touches. */
  private onRubberMove(me: InternalMouseEvent): void {
    const band = this.rubber;
    if (!band) return;
    const gx = me.getGraphX();
    const gy = me.getGraphY();
    if (!band.active) {
      if (Math.hypot(gx - band.startX, gy - band.startY) < DRAG_THRESHOLD) return;
      band.active = true;
      band.box = this.overlays.add({ x: 0, y: 0, width: 1, height: 1 }, { fillColor: '#c58b1f', fillOpacity: 12, strokeColor: '#c58b1f', strokeWidth: 1, dashed: true });
    }
    const x1 = Math.min(band.startX, gx);
    const y1 = Math.min(band.startY, gy);
    const view = this.graph.getView();
    const toModel = (v: number, t: number): number => v / view.scale - t;
    const mx1 = toModel(x1, view.translate.x);
    const my1 = toModel(y1, view.translate.y);
    const mx2 = toModel(Math.max(band.startX, gx), view.translate.x);
    const my2 = toModel(Math.max(band.startY, gy), view.translate.y);
    this.overlays.place(band.box!, { x: mx1, y: my1, width: Math.max(1, mx2 - mx1), height: Math.max(1, my2 - my1) });
    const hit = this.ownersIn(Math.floor((mx1 - ORIGIN_X) / CW), Math.floor((my1 - ORIGIN_Y) / CH), Math.floor((mx2 - ORIGIN_X) / CW), Math.floor((my2 - ORIGIN_Y) / CH));
    this.pick(band.additive ? [...band.base, ...hit] : hit);
    me.consume();
  }

  private onRubberUp(me: InternalMouseEvent): void {
    const band = this.rubber;
    if (!band) return;
    this.rubber = null;
    this.overlays.remove(band.box);
    if (!band.active) return; // a plain click: the normal CLICK path handles it
    this.rubberEndedAt = performance.now();
    me.consume();
  }

  /** Stops a rubber band that the browser took away (a cancelled pointer, a lost focus). */
  private cancelRubber(): void {
    this.overlays.remove(this.rubber?.box);
    this.rubber = null;
  }

  private onContentMouseUp(me: InternalMouseEvent): void {
    this.groupPress = null;
    this.onRubberUp(me);
    const drag = this.contentDrag;
    if (!drag) return;
    this.contentDrag = null;
    if (!drag.moved) {
      drag.spring.stop();
      return; // indistinguishable from a click — let the normal CLICK path handle it
    }
    me.consume();
    this.contentDragBusy = true;
    void this.resolveContentDrop(drag, this.modelPoint(me));
  }

  /** `drop` is the pointer position in model units, or null when the drag was cancelled. */
  private async resolveContentDrop(drag: ContentDragState, drop: { x: number; y: number } | null): Promise<void> {
    // The block's top-left corner decides where it lands, so a wide block can be placed precisely.
    const rawCol = drop ? Math.round((drop.x - drag.grab.x - ORIGIN_X) / CW) : -9;
    const rawRow = drop ? Math.round((drop.y - drag.grab.y - ORIGIN_Y) / CH) : -9;
    // Dropping past the right or bottom edge grows the sheet; only a drop well outside the top/left cancels.
    const toAddress = rawCol >= -1 && rawRow >= -1 ? formatAddress(Math.max(0, Math.min(MAX_COLS - 1, rawCol)), Math.max(0, Math.min(MAX_ROWS - 1, rawRow))) : null;
    const moved = toAddress ? this.moveCellContent(drag.address, toAddress) : false;

    const settleAddress = moved ? toAddress! : drag.address;
    const anchor = this.geometryOf(settleAddress)!;
    await drag.spring.settle({ x: anchor.x + drag.size.width / 2, y: anchor.y + drag.size.height / 2 });
    drag.spring.stop();
    const model = this.graph.getDataModel();
    const now = this.data.get(drag.address);
    const w = now ? now.span.cols * CW : drag.size.width;
    const h = now ? now.span.rows * CH : drag.size.height;
    model.setGeometry(drag.cell, new Geometry(drag.origin.x, drag.origin.y, w, h));
    if (!moved && toAddress) this.flash(drag.address, THEME.flashBad);
    this.contentDragBusy = false;
  }

  // -------------------------------------------------------------- row insert

  /**
   * Inserts a blank row right after `afterRowIndex` (0-based), like a spreadsheet: everything from
   * that point down shifts down by one row, the sheet grows by one row at the bottom, and every code
   * cell's address-literal references are rewritten to match (see rowInsertRewrite). On the board
   * tab only allowed below row 11 (0-based index >= 11), since rows 0-9 are the Lattakker board.
   */
  insertRow(afterRowIndex: number): void {
    if (this.board && afterRowIndex < 11) return;
    const oldRowCount = this.rowCount;
    const newRowIndex = oldRowCount;
    const fromRow1Based = afterRowIndex + 2;

    // Rewrite address references in every code cell's source first (independent of where the code
    // currently lives — a cell anywhere may reference a row that's about to shift).
    const references = this.rewriteReferences(rowInsertRewrite(fromRow1Based, 1), (a) => {
      const p = this.data.get(a)!;
      return p.row > afterRowIndex ? formatAddress(p.col, p.row + 1) : a;
    });

    this.graph.batchUpdate(() => {
      // Append one fresh blank row at the bottom so there's a destination slot to shift into.
      for (let c = 0; c < this.colCount; c++) {
        const address = formatAddress(c, newRowIndex);
        const cell = this.graph.insertVertex({
          parent: this.sheetLayer,
          id: `sheet:${address}`,
          value: '',
          position: [ORIGIN_X + c * CW, ORIGIN_Y + newRowIndex * CH],
          size: [CW, CH],
          style: { baseStyleNames: ['sheet'] },
        });
        this.cells.set(address, cell);
        this.data.set(address, {
          address,
          col: c,
          row: newRowIndex,
          uid: '',
          code: '',
          output: [],
          plot: null,
          tiles: null,
          scene: null,
          viewText: null,
          codeVisual: {},
          span: { cols: 1, rows: 1 },
          shape: emptyShape(),
          error: null,
          memory: {},
          runCount: 0,
          runReason: 'edit',
        });
      }
      this.rowCount = oldRowCount + 1;

      const rg = this.rowHeaderGroup.getGeometry()!;
      this.graph.getDataModel().setGeometry(this.rowHeaderGroup, new Geometry(rg.x, rg.y, rg.width, rg.height + CH));
      this.graph.insertVertex({
        parent: this.rowHeaderGroup,
        id: `hdr:r${newRowIndex}`,
        value: String(newRowIndex + 1),
        position: [0, ORIGIN_Y + newRowIndex * CH],
        size: [HDR_W, CH],
        style: { baseStyleNames: ['header'] },
      });

      // Shift .code down one row at a time, from the new bottom row up to the insertion point;
      // everything else (output/error/visual/span) is left for the next run to rebuild.
      for (let r = newRowIndex; r > afterRowIndex + 1; r--) {
        for (let c = 0; c < this.colCount; c++) {
          const dst = this.data.get(formatAddress(c, r))!;
          const src = this.data.get(formatAddress(c, r - 1))!;
          dst.code = src.code;
          dst.uid = src.uid;
          dst.memory = src.memory;
          dst.shape = src.shape;
          dst.runCount = src.runCount;
        }
      }
      for (let c = 0; c < this.colCount; c++) {
        const fresh = this.data.get(formatAddress(c, afterRowIndex + 1))!;
        fresh.code = '';
        fresh.uid = '';
        fresh.memory = {};
        fresh.shape = emptyShape();
        fresh.runCount = 0;
      }

      // Clear transient per-cell state across the whole shifted band; it'll be rebuilt by requestRun().
      for (let r = afterRowIndex + 1; r <= newRowIndex; r++) {
        for (let c = 0; c < this.colCount; c++) {
          const addr = formatAddress(c, r);
          const d = this.data.get(addr)!;
          d.output = [];
          d.plot = null;
          d.tiles = null;
          d.scene = null;
          d.viewText = null;
          d.codeVisual = {};
          d.span = { cols: 1, rows: 1 };
          d.error = null;
          this.baseVisual.delete(addr);
          this.selectionVisual.delete(addr);
          this.flashVisual.delete(addr);
          const cell = this.cells.get(addr);
          if (cell) this.graph.getDataModel().setVisible(cell, true);
        }
      }
      for (const [covered, owner] of [...this.coveredBy]) {
        const coveredRow = this.data.get(covered)?.row ?? -1;
        const ownerRow = this.data.get(owner)?.row ?? -1;
        if (coveredRow > afterRowIndex || ownerRow > afterRowIndex) this.coveredBy.delete(covered);
      }
      for (let r = afterRowIndex + 1; r <= newRowIndex; r++) {
        for (let c = 0; c < this.colCount; c++) this.applyStyle(formatAddress(c, r));
      }
    });

    for (let r = afterRowIndex + 1; r < this.rowCount; r++) {
      for (let c = 0; c < this.colCount; c++) {
        const addr = formatAddress(c, r);
        this.depGraph.markDirty(addr);
        if (this.data.get(addr)?.code) this.nextReason.set(addr, 'moved');
        this.codeChangedHandlers.forEach((h) => h(addr));
      }
    }
    this.depGraph.markDirty(ROWS_NODE);
    this.rowsInsertedHandlers.forEach((h) => h(afterRowIndex));
    this.announceReferences(references);
    this.requestRun();
  }

  // ----------------------------------------------------------- column insert

  /** Why a column cannot go after `afterColIndex` (0-based; -1 is before column A), or null when it can. */
  columnInsertProblem(afterColIndex: number): string | null {
    if (this.fixedColumns) return 'This tab arranges its own columns, so none can be inserted here. Try the Lab or a sheet of your own.';
    if (this.colCount >= MAX_COLS) return `The sheet is already ${MAX_COLS} columns wide (${colToLetters(MAX_COLS - 1)}).`;
    // On the board tab the board (A-J) and the panel (L-Q) sit on rows that code never shifts with, so only columns to their right may be added.
    if (this.board && afterColIndex < BOARD_LAST_COL) return `On the board tab columns can only be added to the right of the panel (after column ${colToLetters(BOARD_LAST_COL)}).`;
    return null;
  }

  /**
   * Inserts a blank column right after `afterColIndex` (0-based), like a spreadsheet: everything from
   * that point right shifts right by one column, the sheet grows by one column on the right, and every
   * code cell's address-literal references are rewritten to match (see colInsertRewrite).
   */
  insertColumn(afterColIndex: number): boolean {
    if (this.columnInsertProblem(afterColIndex)) return false;
    const newColIndex = this.colCount;
    const references = this.rewriteReferences(colInsertRewrite(afterColIndex + 1, 1), (a) => {
      const p = this.data.get(a)!;
      return p.col > afterColIndex ? formatAddress(p.col + 1, p.row) : a;
    });

    this.graph.batchUpdate(() => {
      for (let r = 0; r < this.rowCount; r++) this.makeCell(newColIndex, r);
      this.colCount += 1;
      const cg = this.colHeaderGroup.getGeometry()!;
      this.graph.getDataModel().setGeometry(this.colHeaderGroup, new Geometry(cg.x, cg.y, cg.width + CW, cg.height));
      this.graph.insertVertex({
        parent: this.colHeaderGroup,
        id: `hdr:c${newColIndex}`,
        value: colToLetters(newColIndex),
        position: [ORIGIN_X + newColIndex * CW, 0],
        size: [CW, HDR_H],
        style: { baseStyleNames: ['header'] },
      });

      for (let c = newColIndex; c > afterColIndex + 1; c--) {
        for (let r = 0; r < this.rowCount; r++) {
          const dst = this.data.get(formatAddress(c, r))!;
          const src = this.data.get(formatAddress(c - 1, r))!;
          dst.code = src.code;
          dst.uid = src.uid;
          dst.memory = src.memory;
          dst.shape = src.shape;
          dst.runCount = src.runCount;
        }
      }
      for (let r = 0; r < this.rowCount; r++) {
        const fresh = this.data.get(formatAddress(afterColIndex + 1, r))!;
        fresh.code = '';
        fresh.uid = '';
        fresh.memory = {};
        fresh.shape = emptyShape();
        fresh.runCount = 0;
      }

      for (let c = afterColIndex + 1; c <= newColIndex; c++) {
        for (let r = 0; r < this.rowCount; r++) {
          const addr = formatAddress(c, r);
          const d = this.data.get(addr)!;
          d.output = [];
          d.plot = null;
          d.tiles = null;
          d.scene = null;
          d.viewText = null;
          d.codeVisual = {};
          d.span = { cols: 1, rows: 1 };
          d.error = null;
          this.baseVisual.delete(addr);
          this.selectionVisual.delete(addr);
          this.flashVisual.delete(addr);
          const cell = this.cells.get(addr);
          if (cell) this.graph.getDataModel().setVisible(cell, true);
        }
      }
      for (const [covered, owner] of [...this.coveredBy]) {
        const coveredCol = this.data.get(covered)?.col ?? -1;
        const ownerCol = this.data.get(owner)?.col ?? -1;
        if (coveredCol > afterColIndex || ownerCol > afterColIndex) this.coveredBy.delete(covered);
      }
      for (let c = afterColIndex + 1; c <= newColIndex; c++) {
        for (let r = 0; r < this.rowCount; r++) this.applyStyle(formatAddress(c, r));
      }
    });
    this.raiseHeaders();

    for (let c = afterColIndex + 1; c < this.colCount; c++) {
      for (let r = 0; r < this.rowCount; r++) {
        const addr = formatAddress(c, r);
        this.depGraph.markDirty(addr);
        if (this.data.get(addr)?.code) this.nextReason.set(addr, 'moved');
        this.codeChangedHandlers.forEach((h) => h(addr));
      }
    }
    this.depGraph.markDirty(COLS_NODE);
    this.colsInsertedHandlers.forEach((h) => h(afterColIndex));
    this.announceReferences(references);
    this.requestRun();
    return true;
  }

  // ------------------------------------------------------------------- code

  /** `uid` restores a saved identity; code written into a cell without one gets a fresh uid. */
  setCode(address: string, code: string, uid?: string): void {
    const d = this.data.get(address);
    if (!d) return;
    const changed = d.code !== code;
    d.code = code;
    if (!code.trim()) {
      d.uid = '';
      this.modules.forget(address);
    } else if (uid) d.uid = uid;
    else if (!d.uid) d.uid = newUid();
    d.error = null;
    d.runCount = 0;
    this.nextReason.set(address, 'edit');
    this.stopTasks(address);
    if (changed) this.depGraph.markDirty(codeNode(address));
    if (!code.trim()) {
      d.memory = {};
      d.shape = emptyShape();
      d.output = [];
      d.plot = null;
      d.tiles = null;
      d.scene = null;
      d.viewText = null;
      d.codeVisual = {};
      this.setSpan(address, 1, 1);
    }
    this.depGraph.markDirty(address);
    this.refreshCell(address);
    this.requestRun();
    this.codeChangedHandlers.forEach((h) => h(address));
  }

  /** Forwarded from api.ts's at()/range()/game access while a cell's code is running. */
  trackRead(address: string, dep: string): void {
    this.depGraph.trackRead(address, dep);
  }

  /** Forwarded from api.ts when a cell's code writes into another cell (print/color/view/...). */
  trackWrite(address: string, target: string): void {
    this.depGraph.trackWrite(address, target);
  }

  /** Cells whose code read `address` last time they ran. */
  dependentsOf(address: string): string[] {
    const all = [address, sizeNode(address), codeNode(address), moduleNode(address)].flatMap((n) => this.depGraph.dependentsOf(n));
    return [...new Set(all)];
  }

  /** What the code in `address` read last time it ran. */
  readsOf(address: string): string[] {
    return this.depGraph.readsOf(address);
  }

  /** Cancels timers, handlers and pending sleeps owned by a cell; the cell itself stays. */
  stopTasks(address: string): void {
    const ctx = this.contexts.get(address);
    if (!ctx) return;
    ctx.cancel();
    this.contexts.delete(address);
  }

  /** Stops every cell and takes the drawing apart (a tab was closed). The sheet cannot be used afterwards. */
  destroy(): void {
    for (const address of [...this.contexts.keys()]) this.stopTasks(address);
    this.setSuspended(true);
    this.graph.destroy();
  }

  /** How many timers and handlers a cell currently owns. */
  taskCount(address: string): number {
    return this.contexts.get(address)?.taskCount ?? 0;
  }

  /** Starts a fresh run for a cell: the previous run (and everything it started) is cancelled. */
  private startRun(address: string): RunContext {
    this.stopTasks(address);
    const ctx = new RunContext(address);
    this.contexts.set(address, ctx);
    this.modules.begin(address, ctx);
    this.depGraph.beginRun(address);
    return ctx;
  }

  /** A cell changed on its own (timer tick, late finish): refresh it and re-run what reads it. */
  notifyChanged(address: string): void {
    this.refreshCell(address);
    this.depGraph.markDependentsDirty(address);
    this.tickTouched.add(address);
    this.requestRun();
  }

  /** Calls `fire(node)` once after a pass in which any of `nodes` changed. Returns an unsubscribe. */
  subscribe(nodes: Iterable<string>, fire: (node: string) => void): () => void {
    const sub = { nodes: new Set(nodes), fire };
    this.subscriptions.add(sub);
    return () => {
      this.subscriptions.delete(sub);
    };
  }

  /** Marks addresses dirty for the next run without re-running immediately (e.g. board changes). */
  markDirty(addresses: Iterable<string>): void {
    this.depGraph.markAllDirty(addresses);
  }

  codeCells(): SheetCellData[] {
    return [...this.data.values()].filter((d) => d.code.trim().length > 0);
  }

  setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.graph.batchUpdate(() => {
      for (const d of this.data.values()) if (d.code) this.refreshCell(d.address);
    });
    this.depGraph.markDirty(MODE_NODE);
    this.requestRun();
    this.modeChangeHandlers.forEach((h) => h(mode));
  }

  private hovered = '';

  /** The address of the cell the mouse is over, '' when none. */
  get hoveredAddress(): string {
    return this.hovered;
  }

  /** The mouse is over the cell with this id (or over none): watchers of enter/leave on a cell hear it. */
  private hoverOn(id: string): void {
    const address = id.startsWith('sheet:') ? id.slice(6) : '';
    if (address === this.hovered) return;
    const was = this.hovered;
    this.hovered = address;
    if (was) this.pulse(leaveNode(was));
    if (address) this.pulse(enterNode(address));
  }

  /** Announces that something happened (a click on a cell, say); watchers of `node` wake up. */
  pulse(node: string): void {
    this.depGraph.markDirty(node);
    this.requestRun();
  }

  /** Re-runs every code cell soon (coalesces bursts of events). */
  requestRun(): void {
    if (this.runTimer !== null) return;
    this.runTimer = window.setTimeout(() => {
      this.runTimer = null;
      void this.runAll();
    }, 0);
  }

  private runsStarted = 0;
  private runsFinished = 0;

  /** How the cells are doing: how many hold code, and how many runs began and ended since the page started. */
  health(): { codeCells: number; started: number; finished: number } {
    return { codeCells: this.codeCells().length, started: this.runsStarted, finished: this.runsFinished };
  }

  async runAll(): Promise<void> {
    if (!this.runner) return;
    if (this.running) {
      this.runPending = true;
      return;
    }
    this.running = true;
    try {
      const universe = this.codeCells().map((d) => d.address);
      const live = new Set(universe);
      for (const address of [...this.contexts.keys()]) if (!live.has(address)) this.stopTasks(address);
      let order = this.depGraph.closure(universe);
      const touched = new Set([...this.depGraph.lastTouched, ...this.tickTouched]);
      this.tickTouched.clear();
      if (order.length) {
        const now = Date.now();
        this.passTimes = this.passTimes.filter((t) => now - t < RUNAWAY_WINDOW_MS);
        this.passTimes.push(now);
        if (this.passTimes.length > RUNAWAY_PASSES) {
          // Cells keep waking each other up (a loop). Stop the chain and say so on the cells involved.
          for (const address of order) {
            const d = this.data.get(address);
            if (d) d.error = 'Stopped: cells keep re-running each other in a loop. Does a cell change something it also reads or watches?';
            this.refreshCell(address);
          }
          this.passTimes = [];
          order = [];
        }
      }
      if (order.length) {
        const resetSet = new Set(order);
        this.queued = new Set(order);
        for (const w of this.depGraph.writeTargets(order)) resetSet.add(w);
        this.graph.batchUpdate(() => {
          for (const addr of resetSet) {
            const d = this.data.get(addr);
            if (!d) continue;
            d.output = [];
            d.plot = null;
            d.tiles = null;
            d.scene = null;
            if (d.code) d.viewText = null;
            d.error = null;
            d.codeVisual = {};
            this.applyStyle(d.address);
          }
        });
        for (const address of order) {
          const d = this.data.get(address);
          if (!d) continue;
          const ctx = this.startRun(address);
          this.queued.delete(address);
          d.runReason = this.nextReason.get(address) ?? 'update';
          this.nextReason.delete(address);
          d.runCount += 1;
          this.runsStarted++;
          const published = this.modules.current(address);
          const finished = Promise.resolve()
            .then(() => this.runner!(d, ctx))
            .catch((err) => {
              if (!(err instanceof CancelError)) d.error = err instanceof Error ? err.message : String(err);
            })
            .then(() => {
              ctx.tracking = false;
              this.runsFinished++;
              // The cell's top level is over: what it exports is ready for the cells that import it (or they hear why not).
              if (published) this.modules.settle(published, ctx.cancelled ? new Error('was stopped') : (d.error ?? undefined));
            });
          let slice = 0;
          const inTime = await Promise.race([
            finished.then(() => true),
            new Promise<boolean>((resolve) => {
              slice = window.setTimeout(() => resolve(false), RUN_SLICE_MS);
            }),
          ]);
          window.clearTimeout(slice);
          if (inTime) {
            ctx.touched.clear();
            this.refreshCell(address);
          } else {
            // A slow cell (a long await loop) must not hold up the others: let it carry on in the
            // background and tell whoever reads it once it is done.
            void finished.then(() => {
              if (this.contexts.get(address) !== ctx) return;
              ctx.flush();
              this.notifyChanged(address);
            });
          }
        }
        // cells that received prints from other cells need a refresh too
        this.graph.batchUpdate(() => {
          for (const addr of resetSet) {
            const d = this.data.get(addr);
            if (d && !d.code && (d.output.length || d.plot)) this.refreshCell(addr);
          }
        });
      }
      for (const sub of [...this.subscriptions]) {
        for (const node of sub.nodes) {
          if (touched.has(node)) {
            sub.fire(node);
            break;
          }
        }
      }
      this.afterRunHandlers.forEach((h) => h());
    } finally {
      this.running = false;
      this.queued.clear();
      if (this.runPending) {
        this.runPending = false;
        this.requestRun();
      }
    }
  }

  // ------------------------------------------------------------------- zoom

  /** The scale and scroll position right now, so that a view can be come back to. */
  viewState(): SheetView {
    return { scale: this.graph.getView().getScale(), left: this.container.scrollLeft, top: this.container.scrollTop };
  }

  private flight = 0;
  /** Where the view was before "zoom in on this cell", so the same button can zoom back out. */
  private zoomReturn: SheetView | null = null;
  private zoomedOn: string | null = null;
  private zoomFlying = false;
  private readonly zoomListeners: Array<() => void> = [];

  /** Is the sheet zoomed in on this cell by zoomInOn()? Then the next press zooms back out. */
  isZoomedOn(address: string): boolean {
    return this.zoomReturn !== null && this.zoomedOn === this.ownerOf(address);
  }

  onZoomState(listener: () => void): void {
    this.zoomListeners.push(listener);
  }

  /** Is the sheet zoomed in by zoomInOn() on any cell, so that zoomOut() has somewhere to go back to? */
  isZoomed(): boolean {
    return this.zoomReturn !== null;
  }

  /** Where to look to have the square (col, row) in the middle of the window at this zoom. */
  viewAround(col: number, row: number, scale: number): SheetView {
    const c = this.container;
    const t = this.graph.getView().getTranslate();
    const cx = (ORIGIN_X + col * CW + CW / 2 + t.x) * scale;
    const cy = (ORIGIN_Y + row * CH + CH / 2 + t.y) * scale;
    return { scale, left: Math.max(0, cx - c.clientWidth / 2), top: Math.max(0, cy - c.clientHeight / 2) };
  }

  /** Takes a view at once (no flight). */
  jumpTo(view: SheetView): void {
    this.flight++;
    this.graph.zoomTo(view.scale, false);
    this.container.scrollLeft = view.left;
    this.container.scrollTop = view.top;
    this.updateStickyHeaders();
  }

  /** Zooms in so the cell's block (or the blocks of several cells, together) fills the window with some room around it. The view it came from is kept for zoomOut(). */
  async zoomInOn(address: string | string[]): Promise<void> {
    const owners = [...new Set((Array.isArray(address) ? address : [address]).map((a) => this.ownerOf(a)))];
    const view = this.viewOfCells(owners);
    if (!view) return;
    this.zoomReturn ??= this.viewState();
    this.zoomedOn = owners[0];
    this.zoomListeners.forEach((l) => l());
    await this.flyingTo(view);
    for (const owner of owners) this.flash(owner, undefined, 600);
  }

  /** Back to the zoom and place from before zoomInOn(). */
  async zoomOut(): Promise<void> {
    const back = this.zoomReturn;
    this.zoomReturn = null;
    this.zoomedOn = null;
    this.zoomListeners.forEach((l) => l());
    if (back) await this.flyingTo(back);
  }

  private async flyingTo(view: SheetView): Promise<void> {
    this.zoomFlying = true;
    try {
      await this.flyTo(view);
    } finally {
      this.zoomFlying = false;
    }
  }

  /** Where to look to see a cell's block large: zoomed so that the block fills most of the window, centred. */
  viewOfCell(address: string): SheetView | null {
    return this.viewOfCells([address]);
  }

  /** The same for several blocks at once: the smallest rectangle that holds them all fills most of the window. */
  viewOfCells(addresses: string[]): SheetView | null {
    const blocks = addresses.map((a) => this.data.get(a)).filter((d): d is NonNullable<typeof d> => !!d);
    if (!blocks.length) return null;
    const c = this.container;
    const t = this.graph.getView().getTranslate();
    const x0 = Math.min(...blocks.map((d) => ORIGIN_X + d.col * CW));
    const y0 = Math.min(...blocks.map((d) => ORIGIN_Y + d.row * CH));
    const x1 = Math.max(...blocks.map((d) => ORIGIN_X + (d.col + d.span.cols) * CW));
    const y1 = Math.max(...blocks.map((d) => ORIGIN_Y + (d.row + d.span.rows) * CH));
    const fit = Math.min((c.clientWidth * 0.85) / (x1 - x0), (c.clientHeight * 0.85) / (y1 - y0));
    const scale = Math.min(2, Math.max(MIN_SCALE, blocks.length > 1 ? fit : Math.max(0.8, fit)));
    const cx = ((x0 + x1) / 2 + t.x) * scale;
    const cy = ((y0 + y1) / 2 + t.y) * scale;
    return { scale, left: Math.max(0, cx - c.clientWidth / 2), top: Math.max(0, cy - c.clientHeight / 2) };
  }

  /** Where the last fit-to-view flight ended, so that the next press knows this step of the chain has been shown. */
  private lastFit: { key: string; view: SheetView } | null = null;

  /** The view that shows a rectangle (model units) whole and centred, with a little room around it. */
  viewOfRect(r: { x: number; y: number; width: number; height: number }, maxScale = 2): SheetView {
    const c = this.container;
    const t = this.graph.getView().getTranslate();
    const scale = Math.min(maxScale, Math.max(MIN_SCALE, Math.min((c.clientWidth * 0.92) / r.width, (c.clientHeight * 0.92) / r.height)));
    const cx = (r.x + r.width / 2 + t.x) * scale;
    const cy = (r.y + r.height / 2 + t.y) * scale;
    return { scale, left: Math.max(0, cx - c.clientWidth / 2), top: Math.max(0, cy - c.clientHeight / 2) };
  }

  /**
   * Fit to view, at the pointer. What is under the pointer is shown whole: the code editor window, else the board, else the
   * block. Pressed again when it already fits, the thing that holds it is shown whole (the sheet's content), and once that fits
   * too, the view goes back to where it was before the first press. `only: 'editor'` is for the editor's own button.
   */
  async fitToView(client: { x: number; y: number } | null, only?: 'editor'): Promise<{ shown: 'editor' | 'board' | 'block' | 'content' | 'back' | 'none'; address?: string }> {
    const c = this.container;
    const view = this.graph.getView();
    const scale = view.getScale();
    const t = view.getTranslate();
    const rect = c.getBoundingClientRect();
    const at = client ? { x: (c.scrollLeft + client.x - rect.left) / scale - t.x, y: (c.scrollTop + client.y - rect.top) / scale - t.y } : null;
    const inside = (r: { x: number; y: number; width: number; height: number }): boolean => !!at && at.x >= r.x && at.x <= r.x + r.width && at.y >= r.y && at.y <= r.y + r.height;

    const steps: Array<{ shown: 'editor' | 'board' | 'block' | 'content'; key: string; rect: { x: number; y: number; width: number; height: number }; address?: string; maxScale?: number }> = [];
    const frame = this.graph.getDataModel().getCell('ed:frame')?.getGeometry();
    if (frame && (only === 'editor' || inside(frame))) steps.push({ shown: 'editor', key: 'ed:frame', rect: { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, maxScale: 2.5 });
    if (only !== 'editor') {
      const board = { x: ORIGIN_X, y: ORIGIN_Y, width: 10 * CW, height: 10 * CH };
      if (this.board && inside(board)) steps.push({ shown: 'board', key: 'board', rect: board });
      if (at && !steps.length) {
        const owner = this.ownerOf(formatAddress(Math.floor((at.x - ORIGIN_X) / CW), Math.floor((at.y - ORIGIN_Y) / CH)));
        const d = this.data.get(owner);
        if (d && !this.isBoardAddress(owner) && (d.code.trim() || d.span.cols > 1 || d.span.rows > 1)) {
          steps.push({ shown: 'block', key: owner, address: owner, rect: { x: ORIGIN_X + d.col * CW, y: ORIGIN_Y + d.row * CH, width: d.span.cols * CW, height: d.span.rows * CH } });
        }
      }
      const content = this.contentRect();
      if (content) steps.push({ shown: 'content', key: 'content', rect: content });
    }

    const now = this.viewState();
    const same = (a: SheetView, b: SheetView): boolean => Math.abs(Math.log(a.scale / b.scale)) < 0.03 && Math.abs(a.left - b.left) < c.clientWidth * 0.03 && Math.abs(a.top - b.top) < c.clientHeight * 0.03;
    for (const step of steps) {
      const target = this.viewOfRect(step.rect, step.maxScale);
      if (same(target, now) || (this.lastFit?.key === step.key && same(this.lastFit.view, now))) continue;
      this.zoomReturn ??= now;
      this.zoomedOn = step.address ?? null;
      this.zoomListeners.forEach((l) => l());
      await this.flyingTo(target);
      this.lastFit = { key: step.key, view: this.viewState() };
      if (step.address) this.flash(step.address, undefined, 600);
      return { shown: step.shown, address: step.address };
    }
    this.lastFit = null;
    if (this.zoomReturn) {
      await this.zoomOut();
      return { shown: 'back' };
    }
    return { shown: 'none' };
  }

  /** The rectangle (model units) around everything that is there: the board and every block with code, however far out. */
  contentRect(): { x: number; y: number; width: number; height: number } | null {
    let x0 = this.board ? ORIGIN_X : Infinity;
    let y0 = this.board ? ORIGIN_Y : Infinity;
    let x1 = this.board ? ORIGIN_X + 10 * CW : -Infinity;
    let y1 = this.board ? ORIGIN_Y + 10 * CH : -Infinity;
    for (const d of this.data.values()) {
      if (!d.code.trim() || this.coveredBy.has(d.address)) continue;
      x0 = Math.min(x0, ORIGIN_X + d.col * CW);
      y0 = Math.min(y0, ORIGIN_Y + d.row * CH);
      x1 = Math.max(x1, ORIGIN_X + (d.col + d.span.cols) * CW);
      y1 = Math.max(y1, ORIGIN_Y + (d.row + d.span.rows) * CH);
    }
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }

  /** Zooms out (as far as it takes) to show every non-empty cell and block at once, so nothing forgotten far away stays hidden. */
  async showAll(): Promise<boolean> {
    const r = this.contentRect();
    if (!r) return false;
    await this.fitRect(r);
    return true;
  }

  /** The blocks with code (by owner) in a whole row (`row`) or a whole column (`col`), and the rectangle (model units) around them. */
  lineBlocks(line: { row: number } | { col: number }): { owners: string[]; rect: { x: number; y: number; width: number; height: number } | null } {
    const owners = ('row' in line ? this.ownersIn(0, line.row, this.colCount - 1, line.row) : this.ownersIn(line.col, 0, line.col, this.rowCount - 1)).filter((a) => this.data.get(a)?.code.trim());
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const a of owners) {
      const d = this.data.get(a)!;
      x0 = Math.min(x0, ORIGIN_X + d.col * CW);
      y0 = Math.min(y0, ORIGIN_Y + d.row * CH);
      x1 = Math.max(x1, ORIGIN_X + (d.col + d.span.cols) * CW);
      y1 = Math.max(y1, ORIGIN_Y + (d.row + d.span.rows) * CH);
    }
    return { owners, rect: owners.length ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null };
  }

  /** Flies to show a rectangle (model units) whole; zooming out afterwards goes back to where it was. */
  async fitRect(r: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.zoomReturn ??= this.viewState();
    this.zoomedOn = null;
    this.zoomListeners.forEach((l) => l());
    await this.flyingTo(this.viewOfRect(r));
    this.lastFit = null;
  }

  /** A step back from where the pointer is: the point under it stays where it is, everything around goes further away. (Ctrl + right-click.) */
  async zoomAwayFrom(factor: number, clientX: number, clientY: number): Promise<void> {
    const from = this.viewState();
    const rect = this.container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const scale = Math.max(MIN_SCALE, from.scale / factor);
    if (scale === from.scale) return;
    const k = scale / from.scale;
    await this.flyTo({ scale, left: Math.max(0, (from.left + px) * k - px), top: Math.max(0, (from.top + py) * k - py) });
  }

  /**
   * Flies to a view. The motion has one job: to let the eye follow where the view went, so the person keeps their
   * sense of place. So it starts and ends gently (ease in and out; a quick start is what made it feel like a
   * jump), it takes longer for a longer way, and on a far jump it zooms out a little halfway so the way across
   * is seen before the zoom in. The point in the middle of the window moves in a straight line. A new flight
   * replaces a running one.
   */
  flyTo(target: SheetView, ms?: number): Promise<void> {
    const id = ++this.flight;
    const c = this.container;
    const from = this.viewState();
    const end = Math.min(2.5, Math.max(MIN_SCALE, target.scale));
    const hx = c.clientWidth / 2;
    const hy = c.clientHeight / 2;
    // The point in the middle of the window, in units that do not depend on the zoom.
    const a = { x: (from.left + hx) / from.scale, y: (from.top + hy) / from.scale };
    const b = { x: (target.left + hx) / target.scale, y: (target.top + hy) / target.scale };
    // How far, in widths of the window as seen at the lower of the two zooms.
    const far = Math.hypot(b.x - a.x, b.y - a.y) / (c.clientWidth / Math.min(from.scale, end));
    const duration = ms ?? Math.min(1500, 800 + 250 * far);
    const dip = Math.min(0.45, Math.max(0, (far - 0.6) * 0.3));
    const start = performance.now();
    return new Promise((resolve) => {
      const frame = (now: number): void => {
        if (id !== this.flight) return resolve();
        const p = Math.min(1, (now - start) / duration);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const s = Math.max(MIN_SCALE, from.scale * Math.pow(end / from.scale, e) * (1 - dip * Math.sin(Math.PI * e)));
        this.graph.zoomTo(s, false);
        c.scrollLeft = (a.x + (b.x - a.x) * e) * s - hx;
        c.scrollTop = (a.y + (b.y - a.y) * e) * s - hy;
        this.updateStickyHeaders();
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /** Flies to a cell's block (zooming in) and gives it a short pulse when it arrives. */
  async flyToCell(address: string, ms?: number): Promise<boolean> {
    const view = this.viewOfCell(address);
    if (!view) return false;
    await this.flyTo(view, ms);
    this.flash(address, undefined, 600);
    return true;
  }

  zoomBy(factor: number): void {
    const view = this.graph.getView();
    const next = Math.min(2.5, Math.max(MIN_SCALE, view.getScale() * factor));
    this.graph.zoomTo(next, false);
    this.updateStickyHeaders();
  }

  /** Zooms by `factor` while keeping the point under (clientX, clientY) where it is on screen. */
  zoomAround(factor: number, clientX: number, clientY: number): void {
    const view = this.graph.getView();
    const before = view.getScale();
    const next = Math.min(2.5, Math.max(MIN_SCALE, before * factor));
    if (next === before) return;
    const rect = this.container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const modelX = (this.container.scrollLeft + px) / before;
    const modelY = (this.container.scrollTop + py) / before;
    this.graph.zoomTo(next, false);
    this.container.scrollLeft = modelX * next - px;
    this.container.scrollTop = modelY * next - py;
    this.updateStickyHeaders();
  }

  zoomReset(): void {
    this.graph.zoomActual();
    this.updateStickyHeaders();
  }

  /** Visible area of the container expressed in graph (model) coordinates. */
  visibleRect(): { x: number; y: number; width: number; height: number } {
    const view = this.graph.getView();
    const s = view.getScale();
    const t = view.getTranslate();
    return {
      x: this.container.scrollLeft / s - t.x,
      y: this.container.scrollTop / s - t.y,
      width: this.container.clientWidth / s,
      height: this.container.clientHeight / s,
    };
  }
}
