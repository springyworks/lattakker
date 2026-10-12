import { Graph, InternalEvent, TooltipHandler, type Cell, type EventObject } from '@maxgraph/core';

/**
 * The tab strip, drawn by maxGraph instead of HTML: every tab and the "you are here" path are vertices of a
 * small graph, so the strip is part of the same drawing system as the rest of the page. The real <button>
 * tabs (see Tabs.ts) stay in the page, visually hidden, for the keyboard and for screen readers.
 */

export interface StripTab {
  id: string;
  label: string;
  hint: string;
}

export const STRIP_H = 40;
const TAB_TOP = 7;
const TAB_GAP = 6;
const PATH_H = 24;

const INK = '#1f2933';
const INK_SOFT = '#3e4c59';
const EDGE = '#b8bfc7';

export class TabStrip {
  private readonly graph: Graph;
  private readonly tabCells = new Map<string, Cell>();
  private pathCell!: Cell;
  private active = '';
  private hovered: string | null = null;
  private pathText = '';
  private flashing = false;
  private flashTimer = 0;

  constructor(
    readonly container: HTMLElement,
    private readonly tabs: StripTab[],
    private readonly onSelect: (id: string) => void,
  ) {
    container.classList.add('tab-strip');
    this.graph = new Graph(container, undefined, [TooltipHandler]);
    const graph = this.graph;
    graph.setEnabled(true);
    graph.setCellsMovable(false);
    graph.setCellsResizable(false);
    graph.setCellsEditable(false);
    graph.setCellsSelectable(false);
    graph.setCellsDeletable(false);
    graph.setCellsCloneable(false);
    graph.setConnectable(false);
    graph.setPanning(false);
    graph.setTooltips(true);
    container.style.overflow = 'hidden';

    graph.getCursorForCell = (cell: Cell) => ((cell.getId() ?? '').startsWith('strip:') ? 'pointer' : null);
    const tips = graph.getPlugin<TooltipHandler>('TooltipHandler');
    if (tips) {
      tips.delay = 400;
      tips.getTooltipForCell = (cell: Cell) => {
        const id = cell.getId() ?? '';
        if (id === 'strip:path') return "Where you are, written as a cell path. Click to copy it. Code can use it: at('/lab/J24')";
        return this.tabs.find((t) => `strip:${t.id}` === id)?.hint ?? '';
      };
    }

    let x = 12;
    graph.batchUpdate(() => {
      for (const spec of this.tabs) {
        const w = Math.round(spec.label.length * 8.4 + 34);
        const cell = graph.insertVertex({
          parent: graph.getDefaultParent(),
          id: `strip:${spec.id}`,
          value: spec.label,
          position: [x, TAB_TOP],
          size: [w, STRIP_H],
          style: this.tabStyle(false, false),
        });
        this.tabCells.set(spec.id, cell);
        x += w + TAB_GAP;
      }
      this.pathCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:path',
        value: '',
        position: [x, (STRIP_H - PATH_H) / 2 + 2],
        size: [180, PATH_H],
        style: this.pathStyle(),
      });
    });

    graph.addListener(InternalEvent.CLICK, (_sender: unknown, evt: EventObject) => {
      const cell = evt.getProperty('cell') as Cell | null | undefined;
      const id = cell?.getId() ?? '';
      if (id === 'strip:path') this.copyPath();
      else if (id.startsWith('strip:')) this.onSelect(id.slice(6));
    });
    // Hover feedback on a tab: the drawing itself reacts, no CSS involved.
    graph.addMouseListener({
      mouseDown: () => {},
      mouseMove: (_s: unknown, me: { getCell(): Cell | null }) => {
        const id = me.getCell()?.getId() ?? '';
        const over = id.startsWith('strip:') && id !== 'strip:path' ? id.slice(6) : null;
        if (over !== this.hovered) {
          this.hovered = over;
          this.paintTabs();
        }
      },
      mouseUp: () => {},
    });
    container.addEventListener('pointerleave', () => {
      if (this.hovered) {
        this.hovered = null;
        this.paintTabs();
      }
    });
    new ResizeObserver(() => this.placePath()).observe(container);
    this.placePath();
  }

  private tabStyle(active: boolean, hover: boolean): Record<string, unknown> {
    return {
      shape: 'rectangle',
      rounded: true,
      arcSize: 22,
      fillColor: active ? '#f1f0ec' : hover ? '#e9edf1' : '#d3d8de',
      strokeColor: EDGE,
      strokeWidth: 1,
      fontColor: active ? INK : INK_SOFT,
      fontSize: 14,
      fontStyle: 1,
      fontFamily: 'system-ui, sans-serif',
      align: 'center',
      verticalAlign: 'top',
      spacingTop: 9,
      whiteSpace: 'nowrap',
    };
  }

  private pathStyle(): Record<string, unknown> {
    return {
      shape: 'rectangle',
      rounded: true,
      arcSize: 40,
      fillColor: this.flashing ? '#d9e8dd' : '#f6f7f9',
      strokeColor: EDGE,
      strokeWidth: 1,
      fontColor: INK,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      align: 'center',
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
    };
  }

  private paintTabs(): void {
    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      for (const spec of this.tabs) {
        const cell = this.tabCells.get(spec.id)!;
        model.setStyle(cell, this.tabStyle(spec.id === this.active, spec.id === this.hovered && spec.id !== this.active));
      }
    } finally {
      model.endUpdate();
    }
  }

  /** The tab that is in front. */
  setActive(id: string): void {
    this.active = id;
    this.paintTabs();
  }

  /** The "you are here" text, e.g. /lab/J24/3,4. */
  setPath(text: string): void {
    this.pathText = text;
    this.paintPath();
  }

  private paintPath(): void {
    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      model.setValue(this.pathCell, this.flashing ? 'copied ✓' : `📍 ${this.pathText}`);
      model.setStyle(this.pathCell, this.pathStyle());
    } finally {
      model.endUpdate();
    }
    this.placePath();
  }

  /** The path sits at the right edge of the strip and is as wide as its text. */
  private placePath(): void {
    const text = this.flashing ? 'copied ✓' : `📍 ${this.pathText}`;
    const w = Math.max(90, Math.round(text.length * 7.4 + 24));
    const available = this.container.clientWidth;
    const lastTab = this.tabCells.get(this.tabs[this.tabs.length - 1].id)!.getGeometry()!;
    const minX = lastTab.x + lastTab.width + 12;
    const x = Math.max(minX, available - w - 14);
    const geo = this.pathCell.getGeometry()!;
    if (geo.x === x && geo.width === w) return;
    const next = geo.clone();
    next.x = x;
    next.width = w;
    this.graph.getDataModel().setGeometry(this.pathCell, next);
  }

  private copyPath(): void {
    void navigator.clipboard?.writeText(this.pathText).catch(() => {});
    this.flashing = true;
    this.paintPath();
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashing = false;
      this.paintPath();
    }, 1100);
  }
}
