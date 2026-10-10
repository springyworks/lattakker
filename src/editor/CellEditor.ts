import { Cell, EventObject, Geometry, InternalEvent } from '@maxgraph/core';
import type { Sheet } from '../sheet/Sheet';
import { escapeHtml } from '../sheet/Sheet';
import { THEME } from '../theme';
import { createEditor, modelFor, monaco } from './monaco';

const FRAME_W = 580;
const FRAME_H = 360;
const MIN_W = 320;
const MIN_H = 200;
const BTN_W = 76;
const BTN_GAP = 6;
const BUTTONS: Array<[string, string, string]> = [
  ['ed:btn:run', 'Run', THEME.go],
  ['ed:btn:save', 'Save', THEME.primary],
  ['ed:btn:close', 'Close', THEME.neutral],
];

export interface CellEditorHooks {
  onSave(address: string, code: string): void;
  onRun(address: string, code: string): void;
  onClose(): void;
  onOpen?(address: string): void;
}

/**
 * The code editor is a maxGraph vertex (draggable + resizable frame + buttons) whose label is the
 * live Monaco DOM node itself, hosted through a real foreignObject (Sheet.setNodeLabel) so
 * position/zoom/drag/resize are handled by maxGraph's own SVG transforms and VertexHandler.
 */
export class CellEditor {
  address: string | null = null;
  private frame: Cell | null = null;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private restoreGeo: Geometry | null = null;

  constructor(
    private sheet: Sheet,
    private hooks: CellEditorHooks,
  ) {
    const graph = sheet.graph;
    const relayout = () => this.editor?.layout();
    graph.getView().addListener(InternalEvent.SCALE, relayout);
    graph.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, relayout);
    graph.isCellResizable = (cell: Cell) => cell.getId() === 'ed:frame';
    // SelectionCellsHandler (needed so resize handles render at all) would otherwise let any
    // clicked cell enter native selection and grow a VertexHandler outline; restrict that to the
    // editor frame only, since every other click path in this app manages its own visuals.
    graph.isCellSelectable = (cell: Cell) => cell.getId() === 'ed:frame';
    graph.addListener(InternalEvent.CELLS_RESIZED, (_sender: unknown, evt: EventObject) => {
      const cells = evt.getProperty('cells') as Cell[] | undefined;
      if (!this.frame || !cells?.includes(this.frame)) return;
      this.onFrameResized();
    });
  }

  get isOpen(): boolean {
    return this.frame !== null;
  }

  private layoutButtons(width: number): void {
    if (!this.frame) return;
    const graph = this.sheet.graph;
    const model = graph.getDataModel();
    let bx = width - 10;
    for (const [id] of [...BUTTONS].reverse()) {
      bx -= BTN_W + BTN_GAP;
      const btn = model.getCell(id);
      if (!btn) continue;
      const geo = btn.getGeometry()!;
      model.setGeometry(btn, new Geometry(bx, geo.y, geo.width, geo.height));
    }
  }

  private onFrameResized(): void {
    if (!this.frame) return;
    const model = this.sheet.graph.getDataModel();
    const geo = this.frame.getGeometry()!;
    const w = Math.max(MIN_W, geo.width);
    const h = Math.max(MIN_H, geo.height);
    if (w !== geo.width || h !== geo.height) {
      model.setGeometry(this.frame, new Geometry(geo.x, geo.y, w, h));
    }
    this.layoutButtons(w);
    this.editor?.layout();
  }

  private setFrameGeometry(x: number, y: number, w: number, h: number): void {
    if (!this.frame) return;
    this.sheet.graph.getDataModel().setGeometry(this.frame, new Geometry(x, y, w, h));
    this.layoutButtons(w);
    this.editor?.layout();
  }

  /** Double-click on the title bar: fill the visible sheet area, or go back to the old place. */
  toggleMaximize(): void {
    if (!this.frame) return;
    if (this.restoreGeo) {
      const g = this.restoreGeo;
      this.restoreGeo = null;
      this.setFrameGeometry(g.x, g.y, g.width, g.height);
      return;
    }
    const g = this.frame.getGeometry()!;
    this.restoreGeo = new Geometry(g.x, g.y, g.width, g.height);
    const v = this.sheet.visibleRect();
    const m = 8;
    this.setFrameGeometry(v.x + m, v.y + m, Math.max(MIN_W, v.width - 2 * m), Math.max(MIN_H, v.height - 2 * m));
  }

  /** The frame's label is a DOM node that swallows pointer events, so the title bar moves it itself. */
  private installTitleDrag(bar: HTMLElement): void {
    let start: { px: number; py: number; gx: number; gy: number; id: number } | null = null;
    let raf = 0;
    let pending: { x: number; y: number } | null = null;
    const apply = () => {
      raf = 0;
      if (!pending || !this.frame) return;
      const g = this.frame.getGeometry()!;
      this.setFrameGeometry(pending.x, pending.y, g.width, g.height);
      pending = null;
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.frame) return;
      const g = this.frame.getGeometry()!;
      start = { px: e.clientX, py: e.clientY, gx: g.x, gy: g.y, id: e.pointerId };
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const s = this.sheet.graph.getView().getScale();
      pending = { x: start.gx + (e.clientX - start.px) / s, y: start.gy + (e.clientY - start.py) / s };
      if (!raf) raf = requestAnimationFrame(apply);
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (raf) cancelAnimationFrame(raf);
      apply();
      start = null;
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => this.toggleMaximize());
  }

  open(address: string): void {
    if (this.address === address && this.editor) {
      this.editor.focus();
      return;
    }
    if (this.frame) this.close(true);
    const data = this.sheet.dataAt(address);
    const geo = this.sheet.geometryOf(address);
    if (!data || !geo) return;
    this.address = address;
    this.hooks.onOpen?.(address);

    const graph = this.sheet.graph;
    const vis = this.sheet.visibleRect();
    let x = geo.x + geo.width + 12;
    let y = geo.y;
    if (x + FRAME_W > vis.x + vis.width) x = geo.x - FRAME_W - 12;
    if (x < vis.x + 50) x = vis.x + 60;
    if (y + FRAME_H > vis.y + vis.height) y = vis.y + vis.height - FRAME_H - 16;
    if (y < vis.y + 40) y = vis.y + 40;

    graph.batchUpdate(() => {
      this.frame = graph.insertVertex({
        parent: this.sheet.uiLayer,
        id: 'ed:frame',
        value: '',
        position: [x, y],
        size: [FRAME_W, FRAME_H],
        style: {
          shape: 'rectangle',
          rounded: true,
          arcSize: 3,
          fillColor: '#ffffff',
          strokeColor: THEME.inkSoft,
          strokeWidth: 1,
          align: 'left',
          verticalAlign: 'top',
          whiteSpace: 'wrap',
          overflow: 'fill',
          movable: true,
          resizable: true,
          shadow: true,
        },
      });
      let bx = FRAME_W - 10;
      for (const [id, label, fill] of [...BUTTONS].reverse()) {
        bx -= BTN_W + BTN_GAP;
        graph.insertVertex({
          parent: this.frame,
          id,
          value: label,
          position: [bx, 6],
          size: [BTN_W, 24],
          style: { baseStyleNames: ['button'], fillColor: fill, strokeColor: fill, fontSize: 12, shadow: false },
        });
      }
      graph.setSelectionCell(this.frame);
    });

    const host = document.createElement('div');
    host.className = 'cell-editor-host';
    const titleBar = document.createElement('div');
    titleBar.className = 'cell-editor-title hud-text';
    titleBar.innerHTML = `${escapeHtml(address)} · TypeScript &nbsp;<span style="font-weight:400;color:${THEME.inkSoft}">Ctrl+Enter runs · Esc saves &amp; closes · drag this bar to move · double-click it to fill the screen</span>`;
    this.installTitleDrag(titleBar);
    const body = document.createElement('div');
    body.className = 'cell-editor-body';
    host.appendChild(titleBar);
    host.appendChild(body);
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'keydown']) {
      host.addEventListener(type, (e) => e.stopPropagation(), { passive: type === 'wheel' || type === 'touchstart' });
    }
    this.sheet.setNodeLabel('ed:frame', host);

    const model = modelFor(address, data.code);
    this.editor = createEditor(body, model);
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.run());
    this.editor.addCommand(monaco.KeyCode.Escape, () => this.close(true));
    this.editor.layout();
    this.editor.focus();
  }

  handleButton(id: string): void {
    if (id === 'ed:btn:run') this.run();
    else if (id === 'ed:btn:save') this.close(true);
    else if (id === 'ed:btn:close') this.close(false);
  }

  run(): void {
    if (!this.address || !this.editor) return;
    this.hooks.onRun(this.address, this.editor.getValue());
  }

  close(save: boolean): void {
    if (!this.frame) return;
    const address = this.address!;
    const code = this.editor?.getValue() ?? '';
    this.editor?.dispose();
    this.editor = null;
    this.sheet.setNodeLabel('ed:frame', null);
    this.sheet.graph.removeCells([this.frame], false);
    this.frame = null;
    this.address = null;
    this.restoreGeo = null;
    if (save) this.hooks.onSave(address, code);
    this.hooks.onClose();
  }
}
