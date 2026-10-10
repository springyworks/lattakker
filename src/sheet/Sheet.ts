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
import { colToLetters, expandRange, formatAddress, parseAddress, parseRange, shiftAddressesInCode } from './address';
import { THEME } from '../theme';
import { DependencyGraph } from './reactivity';
import { Spring } from './spring';

export const COLS = 26;
export const ROWS = 40;
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

export interface SheetCellData {
  address: string;
  col: number;
  row: number;
  code: string;
  output: string[];
  viewText: string | null;
  codeVisual: CellVisual;
  span: { cols: number; rows: number };
  error: string | null;
}

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

const BOARD_RE = /^[A-J](10|[1-9])$/;

export function svgUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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

  private baseVisual = new Map<string, CellVisual>();
  private selectionVisual = new Map<string, CellVisual>();
  private flashVisual = new Map<string, CellVisual>();
  private coveredBy = new Map<string, string>();
  private colHeaderGroup!: Cell;
  private rowHeaderGroup!: Cell;
  private corner!: Cell;
  private listeners: SheetListeners | null = null;
  private runner: ((data: SheetCellData) => Promise<void>) | null = null;
  private running = false;
  private runPending = false;
  private runTimer: number | null = null;
  private modeChangeHandlers: Array<(mode: Mode) => void> = [];
  private rowsInsertedHandlers: Array<(afterRowIndex: number) => void> = [];
  private contentMovedHandlers: Array<(from: string, to: string) => void> = [];
  private codeChangedHandlers: Array<(address: string) => void> = [];
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

  constructor(container: HTMLElement) {
    this.container = container;
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
      return id.startsWith('sheet:') || id.startsWith('hud:') || id.startsWith('btn:') || id.startsWith('ed:') || id.startsWith('help:');
    };
    graph.getCursorForCell = (cell: Cell) => {
      const id = cell.getId() ?? '';
      if (id.startsWith('piece:') || id.startsWith('btn:') || id.startsWith('ed:btn') || id === 'hdr:corner') return 'pointer';
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
    const { graph } = this;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const address = formatAddress(c, r);
        const cell = graph.insertVertex({
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
          code: '',
          output: [],
          viewText: null,
          codeVisual: {},
          span: { cols: 1, rows: 1 },
          error: null,
        });
      }
    }
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

  setRunner(runner: (data: SheetCellData) => Promise<void>): void {
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
    return BOARD_RE.test(address);
  }

  cellAt(address: string): Cell | undefined {
    return this.cells.get(address);
  }

  dataAt(address: string): SheetCellData | undefined {
    return this.data.get(address);
  }

  resolve(text: string): string | null {
    const p = parseAddress(text);
    if (!p || p.col < 0 || p.col >= COLS || p.row < 0 || p.row >= this.rowCount) return null;
    return formatAddress(p.col, p.row);
  }

  resolveRange(text: string): string[] {
    const r = parseRange(text);
    if (!r) return [];
    r.c1 = Math.max(0, r.c1);
    r.r1 = Math.max(0, r.r1);
    r.c2 = Math.min(COLS - 1, r.c2);
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
      const base = this.baseVisual.get(d.address);
      const text = this.displayText(d);
      if (!text) return base?.label ? `<div class="cell-text out">${escapeHtml(base.label)}</div>` : '';
      const cls = d.code && this.mode === 'view' && d.viewText === null ? 'cell-text code' : 'cell-text out';
      return `<div class="${cls}">${escapeHtml(text)}</div>`;
    }
    const value = cell.getValue();
    return value == null ? '' : String(value);
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

  refreshCell(address: string): void {
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
    cols = Math.max(1, Math.min(Math.floor(cols), COLS - d.col));
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
  }

  // ------------------------------------------------------------ content drag

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

  /** Can a block of cols x rows with its top-left on `anchor` sit there? Its own old squares are free. */
  private blockFits(fromAddress: string, anchor: string, cols: number, rows: number): boolean {
    const src = this.data.get(fromAddress);
    const to = this.data.get(anchor);
    if (!src || !to) return false;
    if (to.col + cols > COLS || to.row + rows > this.rowCount) return false;
    for (let r = to.row; r < to.row + rows; r++) {
      for (let c = to.col; c < to.col + cols; c++) {
        const a = formatAddress(c, r);
        if (this.isBoardAddress(a)) return false;
        if (c >= src.col && c < src.col + cols && r >= src.row && r < src.row + rows) continue;
        const d = this.data.get(a);
        if (!d || d.code.trim()) return false;
        const owner = this.coveredBy.get(a);
        if (owner && owner !== fromAddress) return false;
      }
    }
    return true;
  }

  private moveBlock(fromAddress: string, toAddress: string): boolean {
    const from = this.data.get(fromAddress)!;
    const to = this.data.get(toAddress)!;
    const { cols, rows } = from.span;
    if (!this.blockFits(fromAddress, toAddress, cols, rows)) return false;
    const code = from.code;
    const visual = from.codeVisual;
    const touched: string[] = [];
    for (const d of [from, to]) {
      for (let r = d.row; r < d.row + rows; r++) for (let c = d.col; c < d.col + cols; c++) touched.push(formatAddress(c, r));
    }
    this.graph.batchUpdate(() => {
      from.code = '';
      from.codeVisual = {};
      from.output = [];
      from.viewText = null;
      from.error = null;
      this.setSpan(fromAddress, 1, 1);
      to.code = code;
      to.codeVisual = visual;
      to.output = [];
      to.viewText = null;
      to.error = null;
      this.setSpan(toAddress, cols, rows);
      this.refreshCell(fromAddress);
      this.refreshCell(toAddress);
    });
    for (const a of new Set(touched)) this.depGraph.markDirty(a);
    this.requestRun();
    this.contentMovedHandlers.forEach((h) => h(fromAddress, toAddress));
    this.codeChangedHandlers.forEach((h) => {
      h(fromAddress);
      h(toAddress);
    });
    return true;
  }

  /** Moves/swaps one cell's code (and derived visual) with another, Excel-drag style. */
  moveCellContent(fromAddress: string, toAddress: string): boolean {
    if (fromAddress === toAddress) return false;
    if (!this.draggable(fromAddress)) return false;
    if (this.isBoardAddress(toAddress)) return false;
    const from = this.data.get(fromAddress);
    const to = this.data.get(toAddress);
    if (!from || !to) return false;
    if (from.span.cols > 1 || from.span.rows > 1) return this.moveBlock(fromAddress, toAddress);
    if (to.span.cols > 1 || to.span.rows > 1) return false;
    if (this.coveredBy.has(toAddress)) return false;

    const fromCode = from.code;
    const fromVisual = from.codeVisual;
    const toCode = to.code;
    const toVisual = to.codeVisual;

    this.graph.batchUpdate(() => {
      to.code = fromCode;
      to.codeVisual = fromVisual;
      to.output = [];
      to.viewText = null;
      to.error = null;
      from.code = toCode;
      from.codeVisual = toVisual;
      from.output = [];
      from.viewText = null;
      from.error = null;
      this.refreshCell(fromAddress);
      this.refreshCell(toAddress);
    });
    this.depGraph.markDirty(fromAddress);
    this.depGraph.markDirty(toAddress);
    this.requestRun();
    this.contentMovedHandlers.forEach((h) => h(fromAddress, toAddress));
    this.codeChangedHandlers.forEach((h) => {
      h(fromAddress);
      h(toAddress);
    });
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
    const col = drop ? Math.round((drop.x - drag.grab.x - ORIGIN_X) / CW) : -1;
    const row = drop ? Math.round((drop.y - drag.grab.y - ORIGIN_Y) / CH) : -1;
    const inBounds = col >= 0 && col < COLS && row >= 0 && row < this.rowCount;
    const toAddress = inBounds ? formatAddress(col, row) : null;
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
   * cell's address-literal references are rewritten to match (see shiftAddressesInCode). Only allowed
   * below row 11 (0-based index >= 11), since rows 0-9 are the Lattakker board.
   */
  insertRow(afterRowIndex: number): void {
    if (afterRowIndex < 11) return;
    const oldRowCount = this.rowCount;
    const newRowIndex = oldRowCount;
    const fromRow1Based = afterRowIndex + 2;

    // Rewrite address references in every code cell's source first (independent of where the code
    // currently lives — a cell anywhere may reference a row that's about to shift).
    for (const d of this.data.values()) {
      if (d.code) d.code = shiftAddressesInCode(d.code, fromRow1Based, 1);
    }

    this.graph.batchUpdate(() => {
      // Append one fresh blank row at the bottom so there's a destination slot to shift into.
      for (let c = 0; c < COLS; c++) {
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
          code: '',
          output: [],
          viewText: null,
          codeVisual: {},
          span: { cols: 1, rows: 1 },
          error: null,
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
        for (let c = 0; c < COLS; c++) {
          const dst = this.data.get(formatAddress(c, r))!;
          const src = this.data.get(formatAddress(c, r - 1))!;
          dst.code = src.code;
        }
      }
      for (let c = 0; c < COLS; c++) {
        this.data.get(formatAddress(c, afterRowIndex + 1))!.code = '';
      }

      // Clear transient per-cell state across the whole shifted band; it'll be rebuilt by requestRun().
      for (let r = afterRowIndex + 1; r <= newRowIndex; r++) {
        for (let c = 0; c < COLS; c++) {
          const addr = formatAddress(c, r);
          const d = this.data.get(addr)!;
          d.output = [];
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
        for (let c = 0; c < COLS; c++) this.applyStyle(formatAddress(c, r));
      }
    });

    for (let r = afterRowIndex + 1; r < this.rowCount; r++) {
      for (let c = 0; c < COLS; c++) {
        const addr = formatAddress(c, r);
        this.depGraph.markDirty(addr);
        this.codeChangedHandlers.forEach((h) => h(addr));
      }
    }
    this.rowsInsertedHandlers.forEach((h) => h(afterRowIndex));
    this.requestRun();
  }

  // ------------------------------------------------------------------- code

  setCode(address: string, code: string): void {
    const d = this.data.get(address);
    if (!d) return;
    d.code = code;
    d.error = null;
    if (!code.trim()) {
      d.output = [];
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
  trackRead(dep: string): void {
    this.depGraph.trackRead(dep);
  }

  /** Forwarded from api.ts when a cell's code writes into another cell (print/color/view/...). */
  trackWrite(target: string): void {
    this.depGraph.trackWrite(target);
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
    this.modeChangeHandlers.forEach((h) => h(mode));
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
      const order = this.depGraph.closure(universe);
      if (order.length) {
        const resetSet = new Set(order);
        for (const w of this.depGraph.writeTargets(order)) resetSet.add(w);
        this.graph.batchUpdate(() => {
          for (const addr of resetSet) {
            const d = this.data.get(addr);
            if (!d) continue;
            d.output = [];
            if (d.code) d.viewText = null;
            d.error = null;
            d.codeVisual = {};
            this.applyStyle(d.address);
          }
        });
        for (const address of order) {
          const d = this.data.get(address);
          if (!d) continue;
          this.depGraph.beginRun(address);
          try {
            await this.runner(d);
          } catch (err) {
            d.error = err instanceof Error ? err.message : String(err);
          }
          this.depGraph.endRun(address);
          this.refreshCell(address);
        }
        // cells that received prints from other cells need a refresh too
        this.graph.batchUpdate(() => {
          for (const addr of resetSet) {
            const d = this.data.get(addr);
            if (d && !d.code && d.output.length) this.refreshCell(addr);
          }
        });
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
