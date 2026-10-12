import { Cell, EventObject, Geometry, InternalEvent } from '@maxgraph/core';
import type { Sheet } from '../sheet/Sheet';
import { escapeHtml } from '../sheet/Sheet';
import { THEME } from '../theme';
import { isAnswered, requestAt } from '../ai/requests';
import { createEditor, modelFor, monaco } from './monaco';
import { installPopupMenu } from './EditorContextMenu';

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
  /** A click on the output preview at the bottom of the editor: it counts as a click on the cell itself. */
  onOutputClick?(address: string): void;
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
  private hints: monaco.editor.IEditorDecorationsCollection | null = null;
  private hintTimer = 0;
  private outTimer = 0;
  private outBox: HTMLElement | null = null;
  private outCell: HTMLElement | null = null;
  private outHtml = '';
  private outOpen = false;
  /** Set by the AI bridge: is an assistant listening for questions right now? */
  aiListening: () => boolean = () => false;

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

  /** Pulls the cell's current code into the open editor, so saving it later cannot bring old addresses back. */
  refreshFromSheet(): void {
    const d = this.address ? this.sheet.dataAt(this.address) : undefined;
    if (d && this.editor) modelFor(d.address, d.code, this.sheet.id);
  }

  get isOpen(): boolean {
    return this.frame !== null;
  }

  get valueLength(): number {
    return this.editor?.getValue().length ?? 0;
  }

  /** What is in the open editor right now, saved or not (null when no editor is open). */
  get valueText(): string | null {
    return this.editor?.getValue() ?? null;
  }

  /** Adds text as new lines right below a line of the open editor. If the player's cursor sits on that line, it moves to the end of the new text so they can keep typing. */
  insertAfterLine(line: number, text: string): boolean {
    const model = this.editor?.getModel();
    if (!this.editor || !model || line < 1 || line > model.getLineCount()) return false;
    const cursorOnLine = this.editor.getPosition()?.lineNumber === line;
    const col = model.getLineMaxColumn(line);
    this.editor.executeEdits('assistant', [{ range: new monaco.Range(line, col, line, col), text: '\n' + text }]);
    if (cursorOnLine) {
      const last = line + text.split('\n').length;
      this.editor.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
      this.editor.revealLine(last);
    }
    this.updateHints();
    return true;
  }

  /** Ghost text in the editor: a nudge on an empty `//` line, and a status behind each question that has no answer yet. */
  private updateHints(): void {
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model || !this.hints) return;
    const lines = model.getLinesContent();
    const cursorLine = editor.getPosition()?.lineNumber ?? 0;
    const listening = this.aiListening();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    lines.forEach((text, i) => {
      const n = i + 1;
      let hint = '';
      if (n === cursorLine && /^\s*\/\/\s*$/.test(text) && !(lines[i - 1] ?? '').trimStart().startsWith('// ↳')) hint = 'type "AI: " and ask your question';
      else if (n === cursorLine && /^\s*\/\/\s*$/.test(text)) hint = 'ask the AI something';
      else if (requestAt(lines, i) && !isAnswered(lines, i)) hint = listening ? '⏳ the AI is reading along…' : '💤 the AI is not listening right now';
      if (!hint) return;
      decorations.push({
        range: new monaco.Range(n, model.getLineMaxColumn(n), n, model.getLineMaxColumn(n)),
        options: { after: { content: '  ' + hint, inlineClassName: 'ai-hint' } },
      });
    });
    this.hints.set(decorations);
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
    this.layoutOutput();
  }

  /** The output pane: the cell's latest output, shrunk to a strip, or (after a click) at real cell size, a bit scaled up. */
  private layoutOutput(): void {
    const box = this.outBox;
    const cell = this.outCell;
    const geo = this.address ? this.sheet.geometryOf(this.address) : null;
    if (!box || !cell || !geo || !this.frame) return;
    const cw = Math.max(20, geo.width);
    const ch = Math.max(20, geo.height);
    const availW = Math.max(40, this.frame.getGeometry()!.width - 4);
    let k: number;
    if (this.outOpen) {
      const maxH = Math.max(80, this.frame.getGeometry()!.height * 0.65);
      k = Math.min(1.3, availW / cw, maxH / ch);
      box.style.height = `${Math.ceil(ch * k) + 6}px`;
    } else {
      box.style.height = '64px';
      k = Math.min(1, 58 / ch, availW / cw);
    }
    cell.style.width = `${cw}px`;
    cell.style.height = `${ch}px`;
    cell.style.transform = `scale(${k})`;
    cell.style.margin = '3px';
    this.renderOutput(true);
  }

  private renderOutput(force = false): void {
    const cell = this.outCell;
    const geo = this.address ? this.sheet.geometryOf(this.address) : null;
    if (!cell || !geo || !this.address) return;
    if (!force && cell.dataset.size !== `${geo.width}x${geo.height}`) {
      this.layoutOutput();
      return;
    }
    const html = this.sheet.outputHtml(this.address, { width: geo.width, height: geo.height }, true);
    const fill = this.sheet.fillOf(this.address);
    const key = fill + html;
    if (!force && key === this.outHtml) return;
    this.outHtml = key;
    cell.style.background = fill;
    cell.innerHTML = html || '<div class="cell-text out" style="color:#9aa5b1">(no output yet: press Run)</div>';
    cell.dataset.size = `${geo.width}x${geo.height}`;
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
    const out = document.createElement('div');
    out.className = 'cell-editor-out';
    out.title = 'The latest output of this cell. Clicking here clicks the cell, like on the sheet.';
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'cell-editor-out-tag';
    tag.textContent = '⤢ enlarge';
    tag.title = 'Show the output bigger (or smaller again)';
    const outCell = document.createElement('div');
    outCell.className = 'cell-editor-out-cell';
    out.appendChild(tag);
    out.appendChild(outCell);
    // Only the button resizes the preview: a click on the preview itself may be what the cell's code waits for.
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      this.outOpen = !this.outOpen;
      out.classList.toggle('open', this.outOpen);
      tag.textContent = this.outOpen ? '⤡ shrink' : '⤢ enlarge';
      this.layoutOutput();
    });
    out.addEventListener('click', () => {
      if (this.address) this.hooks.onOutputClick?.(this.address);
    });
    host.appendChild(out);
    this.installWindowMenus(titleBar, out, outCell, tag);
    this.outBox = out;
    this.outCell = outCell;
    this.outOpen = false;
    this.outHtml = '';
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'keydown']) {
      host.addEventListener(type, (e) => e.stopPropagation(), { passive: type === 'wheel' || type === 'touchstart' });
    }
    this.sheet.setNodeLabel('ed:frame', host);

    const model = modelFor(address, data.code, this.sheet.id);
    this.editor = createEditor(body, model);
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.run());
    this.editor.addCommand(monaco.KeyCode.Escape, () => this.close(true));
    this.editor.layout();
    this.editor.focus();
    this.hints = this.editor.createDecorationsCollection();
    this.editor.onDidChangeCursorPosition(() => this.updateHints());
    this.editor.onDidChangeModelContent(() => this.updateHints());
    this.hintTimer = window.setInterval(() => this.updateHints(), 3000);
    this.updateHints();
    this.layoutOutput();
    this.outTimer = window.setInterval(() => this.renderOutput(), 400);
  }

  /** Right-click on the title bar or the output strip gets the popup menu too, not the browser's. */
  private installWindowMenus(titleBar: HTMLElement, out: HTMLElement, outCell: HTMLElement, tag: HTMLElement): void {
    installPopupMenu(titleBar, () => [
      { label: 'Run', hint: 'Ctrl+Enter', onSelect: () => this.run() },
      { label: 'Save & close', hint: 'Esc', onSelect: () => this.close(true) },
      { label: 'Close without saving', danger: true, onSelect: () => this.close(false) },
    ]);
    installPopupMenu(out, () => {
      const picked = window.getSelection()?.toString() ?? '';
      const text = picked || outCell.innerText.trim();
      return [
        {
          label: picked ? 'Copy selection' : 'Copy output',
          disabled: !text,
          onSelect: () => void navigator.clipboard?.writeText(text).catch(() => {}),
        },
        { label: this.outOpen ? 'Shrink output' : 'Enlarge output', onSelect: () => tag.click() },
        { label: 'Run', hint: 'Ctrl+Enter', onSelect: () => this.run() },
      ];
    });
  }

  /** Types code into the open editor over a few seconds so the player watches it grow. Progress follows the clock, so a throttled background tab still finishes on time. */
  async typeCode(code: string, totalMs = 4000): Promise<boolean> {
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model) return false;
    model.setValue('');
    const started = performance.now();
    let done = 0;
    while (done < code.length) {
      await new Promise((r) => setTimeout(r, 30));
      if (this.editor !== editor) return false;
      const next = Math.min(code.length, Math.ceil(((performance.now() - started) / totalMs) * code.length));
      if (next <= done) continue;
      const end = model.getFullModelRange().getEndPosition();
      editor.executeEdits('assistant', [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: code.slice(done, next) }]);
      editor.revealLine(model.getLineCount());
      done = next;
    }
    return this.editor === editor;
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
    window.clearInterval(this.hintTimer);
    window.clearInterval(this.outTimer);
    this.outBox = null;
    this.outCell = null;
    this.hints = null;
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
