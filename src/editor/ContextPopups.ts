import type { Cell, InternalMouseEvent, TooltipHandler } from '@maxgraph/core';
import type { Sheet } from '../sheet/Sheet';
import { THEME } from '../theme';
import { aiBridge } from '../aichat/bridge';
import { installPopupMenu } from './EditorContextMenu';
import { createCellViewEditor, modelFor, monaco, parseCellUri, typescriptWorker } from './monaco';

/**
 * Hover-driven "references" popups drawn with maxGraph vertices instead of Monaco's HTML widgets.
 *
 * Resting the mouse on a word in any cell editor for half a second asks the TypeScript worker for
 * that word's references and opens a panel next to the pointer: plain SVG rows (no HTML), one per
 * reference, plus rows for cell addresses (the hovered one, who uses it, what it reads). Resting on
 * a row for another half second expands it: a row that points at a cell opens a live copy of that
 * cell — a maxGraph vertex hosting a real Monaco on the same shared model, so it is editable and
 * always current — and hovering inside that copy can open the next level, recursively. Resting on a
 * row of a higher level collapses everything deeper and grows the new branch instead, so levels
 * never pop wildly. Everything is dwell-based: no clicking or click-holding is ever needed (a click
 * is only a shortcut that jumps to the reference).
 */

const DWELL_MS = 500; // rest this long on a word or row before a level opens or switches
const GRACE_MS = 700; // pointer must be away from the whole chain this long before it closes
const ROW_H = 19;
const TITLE_H = 20;
const MAX_REF_ROWS = 10;
const MAX_LABEL = 46;
const STOP_TYPES = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'keydown'];
const ADDRESS_RE = /\b[A-Z]{1,2}\d{1,3}\b/g;
const ADDRESS_WORD_RE = /^[A-Z]{1,2}\d{1,3}$/;

/** The worker's typing omits this language-service call, but monaco's own reference provider uses it. */
interface RefClient {
  getReferencesAtPosition(fileName: string, position: number): Promise<RefEntry[] | undefined>;
}
interface RefEntry {
  fileName: string;
  textSpan: { start: number; length: number };
}

interface RowSpec {
  label: string;
  /** Expanding this row shows a live copy of this cell. */
  address?: string;
  /** The reference's place in the code, for the line flash and the click-to-jump shortcut. */
  line?: number;
  uri?: string;
}

interface PanelLevel {
  kind: 'panel';
  top: Cell;
  rows: Map<string, RowSpec>;
  expandedRow: string | null;
  word: string;
  uri: string;
  geo: { x: number; y: number; w: number; h: number };
}

interface CellLevel {
  kind: 'cell';
  top: Cell;
  address: string;
  editor: monaco.editor.IStandaloneCodeEditor;
  out: HTMLElement;
}

type Level = PanelLevel | CellLevel;

const ROW_STYLE = {
  shape: 'rectangle',
  fillColor: '#ffffff',
  strokeColor: 'none',
  fontColor: THEME.ink,
  fontSize: 11,
  align: 'left',
  verticalAlign: 'middle',
  spacingLeft: 6,
} as const;

export class ContextPopups {
  private levels: Level[] = [];
  /** Which popup level a panel opened from this editor belongs to (source editors: 0). */
  private editorDepth = new WeakMap<monaco.editor.ICodeEditor, number>();
  private hoveredRow: string | null = null;
  private rowTimer = 0;
  private wordTimer = 0;
  private pendingWordKey = '';
  private closeTimer = 0;
  private lastAliveAt = 0;
  private hoveredEditor: monaco.editor.ICodeEditor | null = null;

  constructor(private sheet: Sheet) {
    monaco.editor.onDidCreateEditor((editor) => this.attachEditor(editor));
    sheet.graph.addMouseListener({
      mouseDown: (_s: unknown, me: InternalMouseEvent) => {
        const id = me.getCell()?.getId() ?? '';
        if (this.levels.length && !id.startsWith('ctx:')) this.closeAll();
      },
      mouseMove: (_s: unknown, me: InternalMouseEvent) => this.onGraphMove(me),
      mouseUp: () => {},
    });
    sheet.container.addEventListener('pointerleave', () => this.scheduleClose(true));
    // Capture phase: the editor hosts stop keydown propagation, but Esc should always clear popups.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.levels.length) this.closeAll();
    }, true);
    sheet.onAfterRun(() => {
      for (const level of this.levels) if (level.kind === 'cell') this.refreshOut(level);
    });
  }

  // ---------------------------------------------------------------- liveness

  /** The pointer is somewhere inside the chain (an editor or a popup): stop any pending close. */
  private alive(): void {
    this.lastAliveAt = performance.now();
    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = 0;
    }
  }

  /**
   * Monaco's own mousemove (which calls alive) fires before maxGraph's container listener on the
   * same pointer move, so a move inside an editor would otherwise schedule its own close; a close
   * request in the same burst as an alive() is that artefact and is ignored unless forced.
   */
  private scheduleClose(force = false): void {
    if (!this.levels.length) return;
    if (!force && performance.now() - this.lastAliveAt < 60) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.closeAll(), GRACE_MS);
  }

  closeAll(): void {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.cancelWordDwell();
    this.collapse(0);
  }

  // ------------------------------------------------------------ hover routing

  private onGraphMove(me: InternalMouseEvent): void {
    if (!this.hoveredEditor) this.setCellTooltips(true);
    const id = me.getCell()?.getId() ?? '';
    if (id.startsWith('ctx:')) {
      this.alive();
      this.hoverCtx(id);
      return;
    }
    if (this.hoveredRow) this.unhoverRow();
    // The floating editor frame keeps the chain alive through Monaco's own mouse events.
    if (id.startsWith('ed:')) return;
    this.scheduleClose();
  }

  private hoverCtx(id: string): void {
    const parts = id.split(':');
    if (parts[1] !== 'row') {
      this.unhoverRow();
      return;
    }
    if (this.hoveredRow === id) return;
    this.unhoverRow();
    const depth = Number(parts[2]);
    const level = this.levels[depth];
    if (level?.kind !== 'panel' || !level.rows.has(id)) return;
    this.hoveredRow = id;
    this.setRowFill(id, THEME.selectFill);
    this.rowTimer = window.setTimeout(() => this.expandRow(depth, id), DWELL_MS);
  }

  private unhoverRow(): void {
    window.clearTimeout(this.rowTimer);
    this.rowTimer = 0;
    const id = this.hoveredRow;
    this.hoveredRow = null;
    if (!id) return;
    const depth = Number(id.split(':')[2]);
    const level = this.levels[depth];
    if (level?.kind === 'panel' && level.rows.has(id)) {
      this.setRowFill(id, level.expandedRow === id ? THEME.flash : '#ffffff');
    }
  }

  private setRowFill(rowId: string, fill: string): void {
    const model = this.sheet.graph.getDataModel();
    const cell = model.getCell(rowId);
    if (cell) model.setStyle(cell, { ...ROW_STYLE, fillColor: fill });
  }

  // -------------------------------------------------------- editors as sources

  private attachEditor(editor: monaco.editor.ICodeEditor): void {
    editor.onMouseMove((e) => {
      const model = editor.getModel();
      const owner = model ? parseCellUri(model.uri) : null;
      if (!model || !owner || owner.scope !== this.sheet.id) return;
      this.alive();
      this.hoveredEditor = editor;
      // The cell tooltip of whatever lies under the editor must not pile on top of Monaco's own hover.
      this.setCellTooltips(false);
      const pos = e.target.position;
      const word = pos ? model.getWordAtPosition(pos) : null;
      if (!pos || !word) {
        this.cancelWordDwell();
        return;
      }
      const depth = this.editorDepth.get(editor) ?? 0;
      const key = `${model.uri.toString()}#${depth}#${word.word}#${pos.lineNumber}:${word.startColumn}`;
      if (key === this.pendingWordKey) return;
      this.cancelWordDwell();
      this.pendingWordKey = key;
      const me = e.event.browserEvent as MouseEvent;
      const client = { x: me.clientX, y: me.clientY };
      this.wordTimer = window.setTimeout(() => {
        this.pendingWordKey = '';
        this.alive();
        void this.openFromEditor(editor, depth, pos, client);
      }, DWELL_MS);
    });
    editor.onMouseLeave(() => {
      if (this.hoveredEditor === editor) this.hoveredEditor = null;
      this.setCellTooltips(true);
      this.cancelWordDwell();
      this.scheduleClose(true);
    });
  }

  private setCellTooltips(on: boolean): void {
    const tip = this.sheet.graph.getPlugin<TooltipHandler>('TooltipHandler');
    if (!tip || tip.isEnabled() === on) return;
    if (!on) tip.hide();
    tip.setEnabled(on);
  }

  private cancelWordDwell(): void {
    window.clearTimeout(this.wordTimer);
    this.wordTimer = 0;
    this.pendingWordKey = '';
  }

  private async openFromEditor(
    editor: monaco.editor.ICodeEditor,
    depth: number,
    pos: monaco.Position,
    client: { x: number; y: number },
  ): Promise<void> {
    const model = editor.getModel();
    if (!model || model.isDisposed()) return;
    const word = model.getWordAtPosition(pos)?.word;
    if (!word) return;
    const uri = model.uri.toString();
    const existing = this.levels[depth];
    if (existing?.kind === 'panel' && existing.word === word && existing.uri === uri) return;

    const ownAddress = parseCellUri(model.uri)?.address ?? '';
    const address = ADDRESS_WORD_RE.test(word) ? this.sheet.resolve(word) : null;
    let refs: RefEntry[] = [];
    try {
      const getWorker = await typescriptWorker();
      const worker = (await getWorker(model.uri)) as unknown as RefClient;
      refs = (await worker.getReferencesAtPosition(uri, model.getOffsetAt(pos))) ?? [];
    } catch {
      // The language service is still warming up; the popup simply shows the cell rows only.
    }
    if (model.isDisposed()) return;
    // The pointer left the chain while the worker was thinking: do not pop up behind its back.
    if (this.hoveredEditor !== editor) return;
    this.alive();

    const rows: RowSpec[] = [];
    if (address) {
      if (address !== ownAddress) rows.push({ label: `⬚ ${address} · live cell`, address });
      for (const dep of this.sheet.dependentsOf(address).slice(0, 5)) {
        if (this.sheet.resolve(dep) === dep && dep !== ownAddress) rows.push({ label: `◂ used by ${dep}`, address: dep });
      }
      for (const read of this.sheet.readsOf(address).slice(0, 5)) {
        if (this.sheet.resolve(read) === read) rows.push({ label: `▸ reads ${read}`, address: read });
      }
    }
    for (const ref of refs) {
      if (ref.fileName !== uri) continue; // cells are isolated modules; same-file refs only
      const p = model.getPositionAt(ref.textSpan.start);
      const text = model.getLineContent(p.lineNumber).trim();
      const lineAddr = this.firstAddressIn(text, word);
      rows.push({ label: `line ${p.lineNumber}: ${text}`, line: p.lineNumber, uri, address: lineAddr ?? undefined });
      if (rows.length >= MAX_REF_ROWS + 4) break;
    }
    const seen = new Set<string>();
    const unique = rows.filter((r) => !seen.has(r.label) && seen.add(r.label) !== undefined).slice(0, 14);
    if (!unique.length) return;

    const refCount = refs.filter((r) => r.fileName === uri).length;
    const where = ownAddress ? ` in the code of ${ownAddress}` : '';
    const title = address ? `${word} · cell` : `${word} · ${refCount} reference${refCount === 1 ? '' : 's'}${where}`;
    this.openPanel(depth, this.modelPt(client.x + 12, client.y + 14), title, unique, word, uri);
  }

  /** The first cell address written in `text` that is not the hovered word itself. */
  private firstAddressIn(text: string, exclude: string): string | null {
    for (const m of text.matchAll(ADDRESS_RE)) {
      if (m[0] === exclude) continue;
      const resolved = this.sheet.resolve(m[0]);
      if (resolved) return resolved;
    }
    return null;
  }

  // ----------------------------------------------------------------- levels

  private openPanel(depth: number, pt: { x: number; y: number }, title: string, rows: RowSpec[], word: string, uri: string): void {
    this.collapse(depth);
    const graph = this.sheet.graph;
    const longest = Math.max(title.length, ...rows.map((r) => Math.min(r.label.length, MAX_LABEL)));
    const w = Math.min(340, Math.max(180, 16 + 6.2 * longest));
    const h = TITLE_H + rows.length * ROW_H + 4;
    const { x, y } = this.clampToView(pt, w, h);
    const map = new Map<string, RowSpec>();
    let top!: Cell;
    graph.batchUpdate(() => {
      top = graph.insertVertex({
        parent: this.sheet.uiLayer,
        id: `ctx:panel:${depth}`,
        value: '',
        position: [x, y],
        size: [w, h],
        style: { shape: 'rectangle', rounded: true, arcSize: 4, fillColor: '#ffffff', strokeColor: THEME.inkSoft, strokeWidth: 1, shadow: true },
      });
      graph.insertVertex({
        parent: top,
        id: `ctx:title:${depth}`,
        value: this.truncate(title),
        position: [1, 1],
        size: [w - 2, TITLE_H],
        style: { shape: 'rectangle', fillColor: THEME.headerFill, strokeColor: 'none', fontColor: THEME.headerInk, fontSize: 10, fontStyle: 1, align: 'left', verticalAlign: 'middle', spacingLeft: 6 },
      });
      rows.forEach((spec, i) => {
        const id = `ctx:row:${depth}:${i}`;
        graph.insertVertex({
          parent: top,
          id,
          value: this.truncate(spec.label),
          position: [2, TITLE_H + 2 + i * ROW_H],
          size: [w - 4, ROW_H],
          style: { ...ROW_STYLE },
        });
        map.set(id, spec);
      });
    });
    this.levels.push({ kind: 'panel', top, rows: map, expandedRow: null, word, uri, geo: { x, y, w, h } });
  }

  private truncate(text: string): string {
    return text.length > MAX_LABEL ? text.slice(0, MAX_LABEL - 1) + '…' : text;
  }

  private expandRow(depth: number, rowId: string): void {
    this.rowTimer = 0;
    const level = this.levels[depth];
    if (level?.kind !== 'panel') return;
    const spec = level.rows.get(rowId);
    if (!spec) return;
    if (spec.line && spec.uri) this.flashLine(spec.uri, spec.line);
    if (spec.address) {
      const next = this.levels[depth + 1];
      if (level.expandedRow === rowId && next?.kind === 'cell' && next.address === spec.address) return;
      if (level.expandedRow && level.expandedRow !== rowId) this.setRowFill(level.expandedRow, '#ffffff');
      level.expandedRow = rowId;
      const rowGeo = level.top.getChildren().find((c) => c.getId() === rowId)?.getGeometry();
      const anchor = { x: level.geo.x + level.geo.w + 10, y: level.geo.y + (rowGeo?.y ?? 0) };
      this.openCellPreview(depth + 1, spec.address, anchor);
    } else {
      // A plain row: resting here means "come back up" — fold the deeper branch away.
      this.collapse(depth + 1);
      if (level.expandedRow) {
        this.setRowFill(level.expandedRow, '#ffffff');
        level.expandedRow = null;
      }
    }
  }

  /** A live copy of the cell: same Monaco model as the cell itself, so it is current and editable. */
  private openCellPreview(depth: number, address: string, pt: { x: number; y: number }): void {
    this.collapse(depth);
    const d = this.sheet.dataAt(address);
    const cellGeo = this.sheet.geometryOf(address);
    if (!d || !cellGeo) return;
    const graph = this.sheet.graph;
    const w = Math.min(420, Math.max(250, cellGeo.width));
    const edH = Math.min(260, Math.max(96, cellGeo.height));
    const outH = 42;
    const h = TITLE_H + edH + outH;
    const { x, y } = this.clampToView(pt, w, h);
    let top!: Cell;
    graph.batchUpdate(() => {
      top = graph.insertVertex({
        parent: this.sheet.uiLayer,
        id: `ctx:live:${depth}`,
        value: '',
        position: [x, y],
        size: [w, h],
        style: {
          shape: 'rectangle',
          rounded: true,
          arcSize: 3,
          fillColor: '#ffffff',
          strokeColor: THEME.select,
          strokeWidth: 1.5,
          align: 'left',
          verticalAlign: 'top',
          whiteSpace: 'wrap',
          overflow: 'fill',
          shadow: true,
        },
      });
      graph.insertVertex({
        parent: top,
        id: `ctx:livebar:${depth}`,
        value: `⬚ ${address} · live cell`,
        position: [1, 1],
        size: [w - 2, TITLE_H],
        style: { shape: 'rectangle', fillColor: THEME.headerFill, strokeColor: 'none', fontColor: THEME.headerInk, fontSize: 10, fontStyle: 1, align: 'left', verticalAlign: 'middle', spacingLeft: 6 },
      });
    });

    const host = document.createElement('div');
    host.className = 'ctx-preview-host';
    host.style.paddingTop = `${TITLE_H + 1}px`;
    const mount = document.createElement('div');
    mount.className = 'ctx-preview-editor';
    const out = document.createElement('div');
    out.className = 'ctx-preview-out';
    out.style.height = `${outH}px`;
    host.append(mount, out);
    // Monaco (not the graph) handles interaction inside the editor area; the title bar stays SVG.
    for (const type of STOP_TYPES) {
      mount.addEventListener(type, (e) => e.stopPropagation(), { passive: type === 'wheel' || type === 'touchstart' });
    }
    host.addEventListener('pointermove', () => this.alive());
    // The output pane of this little editor gets the app's popup menu as well (not the browser's).
    installPopupMenu(out, () => {
      const picked = window.getSelection()?.toString() ?? '';
      const text = picked || out.innerText.trim();
      return [
        { label: picked ? 'Copy selection' : 'Copy output', disabled: !text, onSelect: () => void navigator.clipboard?.writeText(text).catch(() => {}) },
        { label: '🤖 Ask the AI about this…', hint: 'Alt+I', onSelect: () => aiBridge.ask({ tab: this.sheet.id, address }) },
      ];
    });
    this.sheet.setNodeLabel(`ctx:live:${depth}`, host);

    const editor = createCellViewEditor(mount, modelFor(address, d.code, this.sheet.id));
    this.editorDepth.set(editor, depth + 1);
    editor.onDidChangeModelContent(() => this.sheet.setCode(address, editor.getValue()));

    const level: CellLevel = { kind: 'cell', top, address, editor, out };
    this.levels.push(level);
    this.refreshOut(level);
  }

  private refreshOut(level: CellLevel): void {
    if (this.sheet.graph.getDataModel().getCell(level.top.getId()!) !== level.top) return;
    const geo = this.sheet.geometryOf(level.address);
    if (!geo) return;
    level.out.style.background = this.sheet.fillOf(level.address);
    const html = this.sheet.outputHtml(level.address, { width: geo.width, height: 38 }, true);
    level.out.innerHTML = html || '<span class="ctx-preview-empty">(no output yet)</span>';
  }

  private collapse(fromDepth: number): void {
    if (fromDepth >= this.levels.length) return;
    if (this.hoveredRow && Number(this.hoveredRow.split(':')[2]) >= fromDepth) this.unhoverRow();
    const removed = this.levels.splice(fromDepth);
    const tops: Cell[] = [];
    for (const level of removed) {
      if (level.kind === 'cell') {
        level.editor.dispose();
        this.sheet.setNodeLabel(level.top.getId()!, null);
      }
      tops.push(level.top);
    }
    this.sheet.graph.removeCells(tops, false);
  }

  // ----------------------------------------------------------------- shortcuts

  /** Click on a popup element: a shortcut that jumps straight to the reference. */
  handleClick(id: string): void {
    const parts = id.split(':');
    const depth = Number(parts[2]);
    const level = this.levels[depth];
    if (parts[1] === 'row' && level?.kind === 'panel') {
      const spec = level.rows.get(id);
      if (!spec) return;
      if (spec.line && spec.uri) {
        this.flashLine(spec.uri, spec.line);
        for (const ed of monaco.editor.getEditors()) {
          if (ed.getModel()?.uri.toString() === spec.uri) ed.revealLineInCenterIfOutsideViewport(spec.line);
        }
      } else if (spec.address) {
        this.jumpTo(spec.address);
      }
    } else if ((parts[1] === 'live' || parts[1] === 'livebar') && level?.kind === 'cell') {
      this.jumpTo(level.address);
    }
  }

  private jumpTo(address: string): void {
    const d = this.sheet.dataAt(address);
    if (!d) return;
    this.sheet.reveal(d.row, d.col);
    this.sheet.flash(address, THEME.flash, 700);
  }

  private flashLine(uri: string, line: number): void {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model || line > model.getLineCount()) return;
    const ids = model.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'ctx-ref-flash' } }]);
    window.setTimeout(() => {
      if (!model.isDisposed()) model.deltaDecorations(ids, []);
    }, 1200);
  }

  // -------------------------------------------------------------- coordinates

  /** Client (viewport) pixels to graph model units, same math as Sheet.visibleRect. */
  private modelPt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.sheet.container.getBoundingClientRect();
    const view = this.sheet.graph.getView();
    const s = view.getScale();
    const t = view.getTranslate();
    return {
      x: (this.sheet.container.scrollLeft + clientX - rect.left) / s - t.x,
      y: (this.sheet.container.scrollTop + clientY - rect.top) / s - t.y,
    };
  }

  private clampToView(pt: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
    const vis = this.sheet.visibleRect();
    return {
      x: Math.max(vis.x + 2, Math.min(pt.x, vis.x + vis.width - w - 6)),
      y: Math.max(vis.y + 2, Math.min(pt.y, vis.y + vis.height - h - 6)),
    };
  }
}
