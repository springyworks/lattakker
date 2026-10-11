import type { Sheet } from '../sheet/Sheet';
import { createCellViewEditor, modelFor, monaco } from './monaco';

const STOP_TYPES = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'keydown'];

interface Mounted {
  editor: monaco.editor.IStandaloneCodeEditor;
  host: HTMLDivElement;
}

/**
 * Hosts a real, directly-editable Monaco instance inline on the canvas for every non-empty code
 * cell shown in 'view' mode — the same foreignObject/node-label mechanism CellEditor uses for the
 * popup (Sheet.setNodeLabel), so both views edit the exact same Monaco model (editor/monaco.ts's
 * modelFor cache). The editor swallows the mouse, so moving a cell works through the ⋮ handle that
 * ui/CellMenu.ts places in the cell's corner (or Ctrl/armed grab, see isGrabEvent).
 */
export class CellCodeView {
  private mounted = new Map<string, Mounted>();

  constructor(private sheet: Sheet) {
    sheet.onModeChange(() => this.reconcileAll());
    sheet.onAfterRun(() => this.reconcileAll());
    sheet.onCodeChanged((address) => this.reconcileOne(address));
    this.reconcileAll();
  }

  private wants(address: string): boolean {
    const d = this.sheet.dataAt(address);
    return !!d && this.sheet.mode === 'view' && d.code.trim().length > 0 && d.viewText === null && !d.error;
  }

  private reconcileAll(): void {
    for (const address of this.sheet.data.keys()) this.reconcileOne(address);
  }

  private reconcileOne(address: string): void {
    const mounted = this.mounted.get(address);
    if (this.wants(address)) {
      if (!mounted) {
        this.mount(address);
        return;
      }
      // Already mounted: nothing to sync for the model (modelFor's equality guard already
      // keeps it current regardless of whether the change came from here or elsewhere), but the
      // cell's own geometry may have changed (e.g. setSpan), so keep the host div's size current.
      const geo = this.sheet.geometryOf(address);
      if (geo) {
        mounted.host.style.width = `${geo.width}px`;
        mounted.host.style.height = `${geo.height}px`;
      }
    } else if (mounted) {
      this.unmount(address);
    }
  }

  private mount(address: string): void {
    const d = this.sheet.dataAt(address);
    const geo = this.sheet.geometryOf(address);
    if (!d || !geo) return;

    const host = document.createElement('div');
    host.className = 'cell-code-view';
    host.style.width = `${geo.width}px`;
    host.style.height = `${geo.height}px`;

    const mount = document.createElement('div');
    mount.className = 'cell-code-view-editor';
    host.append(mount);

    // Swallow interaction inside the editor area so Monaco (not the graph) handles it; the grip
    // icon deliberately gets none of this, so a mousedown there bubbles to the graph untouched and
    // is picked up by the existing content-drag mouse listener exactly like a press on a plain cell.
    for (const type of STOP_TYPES) {
      // Ctrl/Cmd or an armed double-tap-hold means "grab this cell": let the press reach the graph.
      mount.addEventListener(type, (e) => { if (!this.sheet.isGrabEvent(e)) e.stopPropagation(); }, { passive: type === 'wheel' || type === 'touchstart' });
    }

    const model = modelFor(address, d.code, this.sheet.id);
    const editor = createCellViewEditor(mount, model);
    editor.onDidChangeModelContent(() => this.sheet.setCode(address, editor.getValue()));

    this.mounted.set(address, { editor, host });
    this.sheet.setNodeLabel(`sheet:${address}`, host);
  }

  private unmount(address: string): void {
    const entry = this.mounted.get(address);
    if (!entry) return;
    entry.editor.dispose();
    this.mounted.delete(address);
    this.sheet.setNodeLabel(`sheet:${address}`, null);
  }
}
