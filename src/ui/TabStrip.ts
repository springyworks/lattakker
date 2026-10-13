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
const NAV_W = 30;

const INK = '#1f2933';
const INK_SOFT = '#3e4c59';
const EDGE = '#b8bfc7';

export class TabStrip {
  private readonly graph: Graph;
  private readonly tabCells = new Map<string, Cell>();
  private pathCell!: Cell;
  private shareCell!: Cell;
  private aiCell!: Cell;
  private backCell!: Cell;
  private forwardCell!: Cell;
  private remoteCell!: Cell;
  private helpCell!: Cell;
  /** What a click on the little ? does: open the help. */
  onHelp: () => void = () => {};
  /** What a click on the share button does (set by whoever owns the share dialog). */
  onShare: () => void = () => {};
  /** What a click on the 🤖 helper button does. */
  onAi: () => void = () => {};
  /** What the ◀ and ▶ buttons do: go to the previous or the next place visited. */
  onBack: () => void = () => {};
  onForward: () => void = () => {};
  private canBack = false;
  private canForward = false;
  private aiOn = false;
  private shareText = '🤝 Share';
  private shareOn = false;
  private remoteText = '';
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
        if (id === 'strip:back') return 'Back to the previous place (Alt+←)';
        if (id === 'strip:forward') return 'Forward to the next place (Alt+→)';
        if (id === 'strip:ai') return 'Ask the AI helper (Alt+I). It can look at the cell you are in';
        if (id === 'strip:share') return 'Work together with a tutor or a friend: a direct link between two browsers, no server';
        if (id === 'strip:remote') return 'Where the other person is pointing right now';
        if (id === 'strip:path') return "Where you are, written as a cell path. Click to copy it. Code can use it: at('/lab/J24')";
        if (id === 'strip:help') return 'Help and show me (F1)';
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
      this.shareCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:share',
        value: this.shareText,
        position: [x + 6, (STRIP_H - PATH_H) / 2 + 2],
        size: [112, PATH_H],
        style: this.shareStyle(),
      });
      this.aiCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:ai',
        value: '🤖 AI',
        position: [x + 130, (STRIP_H - PATH_H) / 2 + 2],
        size: [72, PATH_H],
        style: this.aiStyle(),
      });
      this.backCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:back',
        value: '◀',
        position: [x + 210, (STRIP_H - PATH_H) / 2 + 2],
        size: [NAV_W, PATH_H],
        style: this.navStyle(false),
      });
      this.forwardCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:forward',
        value: '▶',
        position: [x + 210 + NAV_W + 4, (STRIP_H - PATH_H) / 2 + 2],
        size: [NAV_W, PATH_H],
        style: this.navStyle(false),
      });
      this.remoteCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:remote',
        value: '',
        position: [x + 130, (STRIP_H - PATH_H) / 2 + 2],
        size: [120, PATH_H],
        style: this.remoteStyle(),
      });
      this.helpCell = graph.insertVertex({
        parent: graph.getDefaultParent(),
        id: 'strip:help',
        value: '?',
        position: [x + 210 + NAV_W * 2 + 8, (STRIP_H - PATH_H) / 2 + 2],
        size: [NAV_W, PATH_H],
        style: this.navStyle(true),
      });
      graph.getDataModel().setVisible(this.remoteCell, false);
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
      else if (id === 'strip:share') this.onShare();
      else if (id === 'strip:ai') this.onAi();
      else if (id === 'strip:help') this.onHelp();
      else if (id === 'strip:back') {
        if (this.canBack) this.onBack();
      } else if (id === 'strip:forward') {
        if (this.canForward) this.onForward();
      }
      else if (id === 'strip:remote') this.copyRemote();
      else if (id.startsWith('strip:')) this.onSelect(id.slice(6));
    });
    // Hover feedback on a tab: the drawing itself reacts, no CSS involved.
    graph.addMouseListener({
      mouseDown: () => {},
      mouseMove: (_s: unknown, me: { getCell(): Cell | null }) => {
        const id = me.getCell()?.getId() ?? '';
        const over = id.startsWith('strip:') && !['strip:path', 'strip:share', 'strip:ai', 'strip:remote', 'strip:back', 'strip:forward', 'strip:help'].includes(id) ? id.slice(6) : null;
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

  /** Where a control of the strip is on screen: 'tabs' (all the tabs), 'ai', 'share', 'back', 'forward', 'help' or 'path'. */
  rectOf(id: string): DOMRect | null {
    const named: Record<string, Cell | undefined> = { ai: this.aiCell, share: this.shareCell, back: this.backCell, forward: this.forwardCell, help: this.helpCell, path: this.pathCell };
    const cells = id === 'tabs' ? [...this.tabCells.values()] : named[id] ? [named[id]!] : [];
    const view = this.graph.getView();
    const boxes = cells.map((c) => view.getState(c)).filter((s): s is NonNullable<typeof s> => !!s);
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((s) => s.x));
    const top = Math.min(...boxes.map((s) => s.y));
    const right = Math.max(...boxes.map((s) => s.x + s.width));
    const bottom = Math.max(...boxes.map((s) => s.y + s.height));
    const origin = this.container.getBoundingClientRect();
    return new DOMRect(origin.left + left, origin.top + top, right - left, bottom - top);
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

  private shareStyle(): Record<string, unknown> {
    return {
      shape: 'rectangle',
      rounded: true,
      arcSize: 40,
      fillColor: this.shareOn ? '#d9e8dd' : '#f6f7f9',
      strokeColor: this.shareOn ? '#5b9a74' : EDGE,
      strokeWidth: 1,
      fontColor: INK,
      fontSize: 12,
      fontStyle: 1,
      fontFamily: 'system-ui, sans-serif',
      align: 'center',
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
    };
  }

  private aiStyle(): Record<string, unknown> {
    return { ...this.shareStyle(), fillColor: this.aiOn ? '#d9e8dd' : '#f6f7f9', strokeColor: this.aiOn ? '#5b9a74' : EDGE };
  }

  private navStyle(enabled: boolean): Record<string, unknown> {
    return { ...this.shareStyle(), fontSize: 13, fontColor: enabled ? INK : '#aab3bd', strokeColor: enabled ? '#8795a1' : '#d3d8de', fillColor: enabled ? '#f6f7f9' : '#eef0f2' };
  }

  /** Whether there is a place to go back to and a place to go forward to. */
  setHistory(canBack: boolean, canForward: boolean): void {
    this.canBack = canBack;
    this.canForward = canForward;
    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      model.setStyle(this.backCell, this.navStyle(canBack));
      model.setStyle(this.forwardCell, this.navStyle(canForward));
    } finally {
      model.endUpdate();
    }
  }

  /** Whether the helper's side chat is open. */
  setAiOpen(open: boolean): void {
    this.aiOn = open;
    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      model.setStyle(this.aiCell, this.aiStyle());
    } finally {
      model.endUpdate();
    }
  }

  private remoteStyle(): Record<string, unknown> {
    return { ...this.pathStyle(), fillColor: '#e8def8', strokeColor: '#a68bd0' };
  }

  /** The share button: its words and whether a session is running. */
  setShare(text: string, on: boolean): void {
    this.shareText = text;
    this.shareOn = on;
    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      model.setValue(this.shareCell, text);
      model.setStyle(this.shareCell, this.shareStyle());
    } finally {
      model.endUpdate();
    }
    this.placePath();
  }

  /** Where the other person is pointing ("🧑 /lab/J24"), or null when nobody is. */
  setRemote(text: string | null): void {
    this.remoteText = text ?? '';
    const model = this.graph.getDataModel();
    model.beginUpdate();
    try {
      model.setVisible(this.remoteCell, text !== null);
      if (text !== null) model.setValue(this.remoteCell, text);
    } finally {
      model.endUpdate();
    }
    this.placePath();
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

  /** The share button follows the tabs; the other person's pointer and the path sit at the right edge, each as wide as its text. */
  private placePath(): void {
    const widthFor = (text: string, min: number): number => Math.max(min, Math.round(text.length * 7.4 + 24));
    const model = this.graph.getDataModel();
    const move = (cell: Cell, x: number, w: number): void => {
      const geo = cell.getGeometry()!;
      if (geo.x === x && geo.width === w) return;
      const next = geo.clone();
      next.x = x;
      next.width = w;
      model.setGeometry(cell, next);
    };
    const lastTab = this.tabCells.get(this.tabs[this.tabs.length - 1].id)!.getGeometry()!;
    const shareX = lastTab.x + lastTab.width + 12;
    const shareW = widthFor(this.shareText, 112);
    move(this.shareCell, shareX, shareW);
    const aiX = shareX + shareW + 8;
    move(this.aiCell, aiX, 72);
    move(this.backCell, aiX + 72 + 8, NAV_W);
    move(this.forwardCell, aiX + 72 + 8 + NAV_W + 4, NAV_W);
    move(this.helpCell, aiX + 72 + 8 + NAV_W * 2 + 4 + 8, NAV_W);
    const rightOfButtons = aiX + 72 + 8 + NAV_W * 3 + 4 + 8 + 12;
    const pathText = this.flashing ? 'copied ✓' : `📍 ${this.pathText}`;
    const pathW = widthFor(pathText, 90);
    const available = this.container.clientWidth;
    const pathX = Math.max(rightOfButtons, available - pathW - 14);
    move(this.pathCell, pathX, pathW);
    if (this.remoteText) {
      const remoteW = widthFor(this.remoteText, 90);
      move(this.remoteCell, Math.max(rightOfButtons, pathX - remoteW - 8), remoteW);
    }
  }

  private copyRemote(): void {
    const path = this.remoteText.replace(/^\S+\s/, '');
    void navigator.clipboard?.writeText(path).catch(() => {});
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
