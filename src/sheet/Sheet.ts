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
} from './address';
import { THEME } from '../theme';
import { DependencyGraph, MODE_NODE, ROWS_NODE, codeNode, sizeNode } from './reactivity';
import { CancelError, RunContext } from './tasks';
import { Spring } from './spring';
import { plotSvg, tilesSvg, type PlotSpec } from './plot';

/** A cell that takes longer than this is moved to the background so the others can run. */
const RUN_SLICE_MS = 150;

export const COLS = 26;
export const ROWS = 40;
/** Hard ceilings for auto-grow: addresses stay at most two letters and three digits (ZZ999-style). */
export const MAX_COLS = 52;
export const MAX_ROWS = 999;
export const CW = 60;
export const CH = 60;
export const HDR_W = 44;
export const HDR_H = 26;
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
  viewText: string | null;
  codeVisual: CellVisual;
  span: { cols: number; rows: number };
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
  readonly cells = new Map<string, Cell>();
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
  private roomMadeHandlers: Array<(info: RoomInfo) => void> = [];
  private contentMovedHandlers: Array<(from: string, to: string) => void> = [];
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
  /** cell id -> a live DOM node to host as that cell's label (e.g. the Monaco editor frame). */
  private nodeLabels = new Map<string, HTMLElement>();
  private refreshQueue = new Set<string>();
  private foreignRewriter: ((rewrite: RefRewrite) => void) | null = null;
  private lastTileClick: { address: string; x: number; y: number; time: number } | null = null;

  /** Only the main tab has the Lattakker board (A1:J10) and the reserved rows below it. */
  private readonly board: boolean;
  /** Names this sheet apart from the others ('' for the game board's sheet): it scopes the editor models. */
  readonly id: string;
  private suspended = false;
  private pendingRefresh = new Set<string>();

  constructor(container: HTMLElement, options: { board?: boolean; id?: string } = {}) {
    this.container = container;
    this.board = options.board ?? false;
    this.id = options.id ?? '';
    // SelectionCellsHandler must be registered before SelectionHandler: mouse listeners fire in
    // plugin-registration order, and VertexHandler's resize-handle hit-test (owned by
    // SelectionCellsHandler) needs first refusal on a mousedown, or SelectionHandler consumes it
    // as a plain cell-move before the handle ever gets a look (matches maxGraph's own default order).
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
    container.style.overflow = 'auto';
    container.style.position = 'relative';

    this.registerStyles();

    const root = model.getRoot()!;
    this.sheetLayer = root.getChildAt(0);
    this.pieceLayer = model.add(root, new Cell())!;
    this.uiLayer = model.add(root, new Cell())!;

    graph.getLabel = (cell?: Cell | null) => this.labelFor(cell ?? null);
    graph.isHtmlLabel = (cell: Cell) => {
      const id = cell.getId() ?? '';
      return id.startsWith('sheet:') || id.startsWith('hud:') || id.startsWith('btn:') || id.startsWith('ed:') || id.startsWith('help:') || id.startsWith('ctx:live:');
    };
    graph.getCursorForCell = (cell: Cell) => {
      const id = cell.getId() ?? '';
      if (id.startsWith('piece:') || id.startsWith('btn:') || id.startsWith('ed:btn') || id === 'hdr:corner' || id.startsWith('ctx:row:') || id.startsWith('ctx:livebar:')) return 'pointer';
      if (id.startsWith('sheet:')) return 'cell';
      if (id === 'ed:frame') return 'move';
      return null;
    };
    const tooltips = graph.getPlugin<TooltipHandler>('TooltipHandler');
    if (tooltips) {
      tooltips.delay = 350;
      tooltips.getTooltipForCell = (cell: Cell) => {
        const id = cell.getId() ?? '';
        const custom = this.listeners?.tooltipFor?.(id, cell);
        if (custom != null) return custom;
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

    graph.addListener(InternalEvent.CLICK, (_sender: unknown, evt: EventObject) => {
      const cell = evt.getProperty('cell') as Cell | null | undefined;
      const me = evt.getProperty('event') as MouseEvent;
      if (!cell || !this.listeners || this.contentDragBusy) return;
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
        if (isDouble) this.listeners.onCellDoubleClick(id.slice(6));
      } else {
        this.listeners.onOtherClick(id, cell, me);
      }
    });
    graph.addListener(InternalEvent.DOUBLE_CLICK, (_sender: unknown, evt: EventObject) => {
      const cell = evt.getProperty('cell') as Cell | null | undefined;
      if (!cell || !this.listeners) return;
      const id = cell.getId() ?? '';
      if (id.startsWith('sheet:')) this.listeners.onCellDoubleClick(id.slice(6));
      evt.consume();
    });
    const contentDragListener: MouseListenerSet = {
      mouseDown: (_sender, me) => this.onContentMouseDown(me),
      mouseMove: (_sender, me) => this.onContentMouseMove(me),
      mouseUp: (_sender, me) => this.onContentMouseUp(me),
    };
    graph.addMouseListener(contentDragListener);
    // A touch that the browser takes over for scrolling ends in pointercancel; maxGraph ignores that,
    // which would leave a half-finished drag hanging.
    container.addEventListener('pointercancel', () => {
      this.cancelContentDrag();
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
      viewText: null,
      codeVisual: {},
      span: { cols: 1, rows: 1 },
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

  /** Scrolls so that the row (and column, if given) is on screen; does nothing when it already is. */
  reveal(rowIndex: number, colIndex?: number, smooth = true): void {
    const view = this.graph.getView();
    const s = view.getScale();
    const t = view.getTranslate();
    const c = this.container;
    const top = (ORIGIN_Y + rowIndex * CH + t.y) * s;
    const h = CH * s;
    const options: ScrollToOptions = { behavior: smooth ? 'smooth' : 'auto' };
    if (top - HDR_H * s < c.scrollTop || top + h > c.scrollTop + c.clientHeight) {
      options.top = Math.max(0, top - c.clientHeight / 2 + h / 2);
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
    return `<div class="${cls}">${escapeHtml(text)}</div>`;
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
    const style: CellStyle = { baseStyleNames: ['sheet'] };
    const merged: CellVisual = { ...base, ...code, ...sel, ...flash };
    if (merged.fill) style.fillColor = merged.fill;
    if (merged.stroke) style.strokeColor = merged.stroke;
    if (merged.strokeWidth) style.strokeWidth = merged.strokeWidth;
    if (merged.fontColor) style.fontColor = merged.fontColor;
    if (merged.fontSize) style.fontSize = merged.fontSize;
    if (merged.align) style.align = merged.align;
    if (merged.verticalAlign) style.verticalAlign = merged.verticalAlign;
    if (d.error) {
      style.fillColor = THEME.errorFill;
      style.fontColor = THEME.errorInk;
    }
    if (d.code && !merged.fill && !d.error) style.fillColor = THEME.codeFill;
    this.graph.getDataModel().setStyle(cell, style);
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
    // A hosted live node (e.g. a mounted inline Monaco editor) must not be detached/reattached
    // mid-keystroke, so skip the forced-relabel toggle for it; just reapply colours/etc.
    if (!this.nodeLabels.has(cell.getId() ?? '')) {
      // Changing the value forces the label to be re-read through getLabel.
      this.graph.getDataModel().setValue(cell, (cell.getValue() ?? 0) === 0 ? 1 : 0);
    }
    this.applyStyle(address);
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
    cols = Math.max(1, Math.min(Math.floor(cols), this.colCount - d.col));
    rows = Math.max(1, Math.min(Math.floor(rows), this.rowCount - d.row));
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

  /** A finger that has not armed the grab gesture belongs to the browser (it scrolls the sheet). */
  fingerIsScrolling(me: InternalMouseEvent): boolean {
    return (me.getEvent() as PointerEvent).pointerType === 'touch' && !this.grabArmed();
  }

  private cancelContentDrag(): void {
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
    if (!d || !d.code.trim()) return false;
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
    const view = this.graph.getView();
    const scale = view.getScale();
    const t = view.getTranslate();
    const toPx = (b: { x: number; y: number; width: number; height: number }) => ({
      x: (b.x + t.x) * scale,
      y: (b.y + t.y) * scale,
      width: b.width * scale,
      height: b.height * scale,
    });
    const place = (el: HTMLElement, b: { x: number; y: number; width: number; height: number }): void => {
      el.style.left = `${b.x}px`;
      el.style.top = `${b.y}px`;
      el.style.width = `${b.width}px`;
      el.style.height = `${b.height}px`;
    };

    const first = this.geometryOf(formatAddress(landing.c1, landing.r1));
    if (first) {
      const drop = document.createElement('div');
      drop.className = 'room-landing';
      place(drop, toPx({ x: first.x, y: first.y, width: (landing.c2 - landing.c1 + 1) * CW, height: (landing.r2 - landing.r1 + 1) * CH }));
      this.container.append(drop);
      drop.animate([{ opacity: 0.9 }, { opacity: 0.9, offset: 0.6 }, { opacity: 0 }], { duration: SHIFT_MS + SHIFT_STAGGER_MS * ghosts.length, easing: 'ease-out' }).finished.then(() => drop.remove(), () => drop.remove());
    }

    ghosts.forEach((g, i) => {
      if (!g.dest) return;
      const a = toPx(g.box);
      const b = toPx(g.dest);
      const el = document.createElement('div');
      el.className = 'room-ghost';
      el.style.background = g.fill;
      place(el, a);
      const label = document.createElement('div');
      label.className = 'room-ghost-label';
      label.textContent = `${g.from} → ${g.to}`;
      const note = document.createElement('div');
      note.className = 'room-ghost-text';
      note.textContent = g.text;
      el.append(label, note);
      this.container.append(el);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const anim = el.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 0.95 },
          { transform: `translate(0, 0) scale(1.04)`, opacity: 1, offset: 0.15 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.04)`, opacity: 1, offset: 0.85 },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 0 },
        ],
        { duration: Math.min(1500, SHIFT_MS + Math.hypot(dx, dy) * 0.5), delay: i * SHIFT_STAGGER_MS, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both' },
      );
      anim.finished.then(() => el.remove(), () => el.remove());
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
    const touched: string[] = [];
    for (const d of [from, to]) {
      for (let r = d.row; r < d.row + rows; r++) for (let c = d.col; c < d.col + cols; c++) touched.push(formatAddress(c, r));
    }
    this.graph.batchUpdate(() => {
      from.code = '';
      from.uid = '';
      from.codeVisual = {};
      from.memory = {};
      from.runCount = 0;
      from.output = [];
      from.plot = null;
      from.tiles = null;
      from.viewText = null;
      from.error = null;
      this.setSpan(fromAddress, 1, 1);
      to.code = code;
      to.uid = uid;
      to.memory = memory;
      to.codeVisual = visual;
      to.output = [];
      to.plot = null;
      to.tiles = null;
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
    const fromRuns = from.runCount;
    const toRuns = to.runCount;

    this.graph.batchUpdate(() => {
      to.code = fromCode;
      to.uid = fromUid;
      to.codeVisual = fromVisual;
      to.memory = fromMemory;
      to.runCount = fromRuns;
      to.output = [];
      to.plot = null;
      to.tiles = null;
      to.viewText = null;
      to.error = null;
      from.code = toCode;
      from.uid = toUid;
      from.codeVisual = toVisual;
      from.memory = toMemory;
      from.runCount = toRuns;
      from.output = [];
      from.plot = null;
      from.tiles = null;
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

  private onContentMouseDown(me: InternalMouseEvent): void {
    if (this.contentDrag) return;
    const id = me.getCell()?.getId() ?? '';
    if (!id.startsWith('sheet:')) return;
    const address = id.slice(6);
    if (!this.draggable(address)) return;
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

  private onContentMouseMove(me: InternalMouseEvent): void {
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

  private onContentMouseUp(me: InternalMouseEvent): void {
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
          viewText: null,
          codeVisual: {},
          span: { cols: 1, rows: 1 },
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
          dst.runCount = src.runCount;
        }
      }
      for (let c = 0; c < this.colCount; c++) {
        const fresh = this.data.get(formatAddress(c, afterRowIndex + 1))!;
        fresh.code = '';
        fresh.uid = '';
        fresh.memory = {};
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

  // ------------------------------------------------------------------- code

  /** `uid` restores a saved identity; code written into a cell without one gets a fresh uid. */
  setCode(address: string, code: string, uid?: string): void {
    const d = this.data.get(address);
    if (!d) return;
    const changed = d.code !== code;
    d.code = code;
    if (!code.trim()) d.uid = '';
    else if (uid) d.uid = uid;
    else if (!d.uid) d.uid = newUid();
    d.error = null;
    d.runCount = 0;
    this.nextReason.set(address, 'edit');
    this.stopTasks(address);
    if (changed) this.depGraph.markDirty(codeNode(address));
    if (!code.trim()) {
      d.memory = {};
      d.output = [];
      d.plot = null;
      d.tiles = null;
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
    const all = [address, sizeNode(address), codeNode(address)].flatMap((n) => this.depGraph.dependentsOf(n));
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

  /** How many timers and handlers a cell currently owns. */
  taskCount(address: string): number {
    return this.contexts.get(address)?.taskCount ?? 0;
  }

  /** Starts a fresh run for a cell: the previous run (and everything it started) is cancelled. */
  private startRun(address: string): RunContext {
    this.stopTasks(address);
    const ctx = new RunContext(address);
    this.contexts.set(address, ctx);
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
        for (const w of this.depGraph.writeTargets(order)) resetSet.add(w);
        this.graph.batchUpdate(() => {
          for (const addr of resetSet) {
            const d = this.data.get(addr);
            if (!d) continue;
            d.output = [];
            d.plot = null;
            d.tiles = null;
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
          d.runReason = this.nextReason.get(address) ?? 'update';
          this.nextReason.delete(address);
          d.runCount += 1;
          const finished = Promise.resolve()
            .then(() => this.runner!(d, ctx))
            .catch((err) => {
              if (!(err instanceof CancelError)) d.error = err instanceof Error ? err.message : String(err);
            })
            .then(() => {
              ctx.tracking = false;
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
      if (this.runPending) {
        this.runPending = false;
        this.requestRun();
      }
    }
  }

  // ------------------------------------------------------------------- zoom

  zoomBy(factor: number): void {
    const view = this.graph.getView();
    const next = Math.min(2.5, Math.max(0.4, view.getScale() * factor));
    this.graph.zoomTo(next, false);
    this.updateStickyHeaders();
  }

  /** Zooms by `factor` while keeping the point under (clientX, clientY) where it is on screen. */
  zoomAround(factor: number, clientX: number, clientY: number): void {
    const view = this.graph.getView();
    const before = view.getScale();
    const next = Math.min(2.5, Math.max(0.4, before * factor));
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
