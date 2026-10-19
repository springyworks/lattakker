import * as monaco from 'monaco-editor';
import { workspace } from '../workspace';
import { cellUri, modelFor, parseCellUri } from './monaco';
import { resolveSmart } from '../aichat/cellPaths';
import { describeLines, formatFocusRef, parseFocusRef, type FocusRange } from '../focusRef';

/**
 * Focus points: places in a cell's code that the person (a selection in the editor, marked with 📌) or the AI (a tool) points at, so both
 * look at the same lines. Each one is a range on the cell's Monaco model, so it moves along when lines are added above it; its words are
 * remembered too, so when the range is lost (the code was replaced) it is found again by its text, or reported as gone, never guessed.
 */

export type FocusBy = 'person' | 'ai';
export type FocusState = 'same' | 'edited' | 'gone';

export interface FocusPoint {
  id: string;
  by: FocusBy;
  /** The tab and the cell identity, so the point follows the cell when it moves. */
  tab: string;
  uid: string;
  address: string;
  /** The reference to write in a chat: /lab/J24#L3-5. */
  ref: string;
  startLine: number;
  endLine: number;
  /** What the lines say now (shortened), and whether that is what was marked. */
  text: string;
  state: FocusState;
  note?: string;
}

interface Entry {
  id: string;
  by: FocusBy;
  tab: string;
  uid: string;
  address: string;
  /** What was marked, as it was. */
  snapshot: string;
  note?: string;
  wholeLines: boolean;
  decoration: string | null;
}

const MAX_POINTS = 6;
const TEXT_CHARS = 500;
const entries: Entry[] = [];
const listeners: Array<() => void> = [];
let counter = 0;
let installed = false;

const changed = (): void => listeners.forEach((l) => l());
const clip = (text: string, n = TEXT_CHARS): string => (text.length > n ? `${text.slice(0, n)}…` : text);

function modelOf(tab: string, address: string): monaco.editor.ITextModel | null {
  const t = workspace.get(tab);
  if (!t) return null;
  const live = monaco.editor.getModel(cellUri(address, t.sheet.id));
  if (live) return live;
  const code = t.sheet.dataAt(address)?.code;
  return code === undefined ? null : modelFor(address, code, t.sheet.id);
}

const options = (by: FocusBy, wholeLines: boolean, note?: string): monaco.editor.IModelDecorationOptions => ({
  className: `focus-${by}`,
  isWholeLine: wholeLines,
  linesDecorationsClassName: `focus-bar-${by}`,
  stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
  hoverMessage: { value: `${by === 'ai' ? '🤖 The AI points here' : '📌 Focus point for the AI'}${note ? `: ${note}` : ''}` },
  overviewRuler: { color: by === 'ai' ? '#3b82c4' : '#e0a100', position: monaco.editor.OverviewRulerLane.Right },
});

/** The cell's current address (it may have moved) and the range the point covers now, or null when it is lost. */
function locate(e: Entry): { model: monaco.editor.ITextModel; range: monaco.Range | null } | null {
  const t = workspace.get(e.tab);
  if (!t) return null;
  const now = t.sheet.addressOfUid(e.uid);
  if (!now) return null;
  const moved = now !== e.address;
  const model = modelOf(e.tab, now);
  if (!model) return null;
  let range = !moved && e.decoration ? model.getDecorationRange(e.decoration) : null;
  if (range && range.isEmpty()) range = null;
  if (!range) {
    // The range was lost (the code was replaced, or the cell moved): look for the marked words; only a single match is trusted.
    const found = e.snapshot ? model.findMatches(e.snapshot, false, false, true, null, false) : [];
    if (found.length === 1) {
      range = found[0].range;
      e.address = now;
      e.decoration = model.deltaDecorations([], [{ range, options: options(e.by, e.wholeLines, e.note) }])[0];
    }
  }
  return { model, range };
}

function toPoint(e: Entry): FocusPoint | null {
  const at = locate(e);
  if (!at) return null;
  const path = workspace.pathOf(e.tab, e.address);
  if (!at.range) return { id: e.id, by: e.by, tab: e.tab, uid: e.uid, address: e.address, ref: path, startLine: 0, endLine: 0, text: '', state: 'gone', note: e.note };
  const { range, model } = at;
  const text = model.getValueInRange(range);
  const ref = formatFocusRef(path, e.wholeLines ? { startLine: range.startLineNumber, endLine: range.endLineNumber } : { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn });
  return { id: e.id, by: e.by, tab: e.tab, uid: e.uid, address: e.address, ref, startLine: range.startLineNumber, endLine: range.endLineNumber, text: clip(text), state: text === e.snapshot ? 'same' : 'edited', note: e.note };
}

/** A selection that ends at the very start of a line does not really include that line. */
function trimmed(model: monaco.editor.ITextModel, sel: monaco.IRange): monaco.Range {
  let endLine = sel.endLineNumber;
  let endColumn = sel.endColumn;
  if (endColumn === 1 && endLine > sel.startLineNumber) {
    endLine--;
    endColumn = model.getLineMaxColumn(endLine);
  }
  return new monaco.Range(sel.startLineNumber, sel.startColumn, endLine, endColumn);
}

/** Does the range cover whole lines (from the first column to the end of its last line)? Then the reference names lines, not columns. */
function coversWholeLines(model: monaco.editor.ITextModel, r: monaco.Range): boolean {
  const firstText = model.getLineContent(r.startLineNumber);
  const startsAtText = r.startColumn <= (firstText.length - firstText.trimStart().length) + 1;
  return startsAtText && r.endColumn >= model.getLineMaxColumn(r.endLineNumber);
}

function add(by: FocusBy, tab: string, address: string, range: monaco.Range, note?: string): FocusPoint | null {
  const t = workspace.get(tab);
  const uid = t?.sheet.dataAt(address)?.uid;
  const model = modelOf(tab, address);
  if (!t || !uid || !model) return null;
  const whole = coversWholeLines(model, range);
  const fixed = whole ? new monaco.Range(range.startLineNumber, 1, range.endLineNumber, model.getLineMaxColumn(range.endLineNumber)) : range;
  // The same place marked again replaces the old mark (and takes the new note).
  for (const e of entries.filter((x) => x.by === by && x.uid === uid)) {
    const at = locate(e);
    if (at?.range?.equalsRange(fixed)) remove(e.id, false);
  }
  const entry: Entry = { id: `f${++counter}`, by, tab, uid, address, snapshot: model.getValueInRange(fixed), note, wholeLines: whole, decoration: null };
  entry.decoration = model.deltaDecorations([], [{ range: fixed, options: options(by, whole, note) }])[0];
  entries.push(entry);
  // Few marks at a time: the oldest of the same kind makes room.
  const mine = entries.filter((x) => x.by === by);
  for (const old of mine.slice(0, Math.max(0, mine.length - MAX_POINTS))) remove(old.id, false);
  changed();
  return toPoint(entry);
}

function remove(id: string, notify = true): boolean {
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return false;
  const [e] = entries.splice(i, 1);
  const model = workspace.get(e.tab) ? modelOf(e.tab, e.address) : null;
  if (model && e.decoration) model.deltaDecorations([e.decoration], []);
  if (notify) changed();
  return true;
}

/** The selection that was made last in any open code editor (it stays while the person clicks into the chat). */
let lastSelection: { uri: string; range: monaco.Range } | null = null;

function watchEditor(editor: monaco.editor.ICodeEditor): void {
  editor.onDidChangeCursorSelection((e) => {
    const model = editor.getModel();
    if (!model || !parseCellUri(model.uri)) return;
    if (e.selection.isEmpty()) {
      if (lastSelection?.uri === model.uri.toString()) lastSelection = null;
    } else lastSelection = { uri: model.uri.toString(), range: e.selection };
    changed();
  });
}

/** Starts watching the editors (call once, after Monaco is there). */
function install(): void {
  if (installed) return;
  installed = true;
  monaco.editor.getEditors().forEach(watchEditor);
  monaco.editor.onDidCreateEditor(watchEditor);
}

export interface LiveSelection extends FocusRange {
  tab: string;
  address: string;
  ref: string;
  text: string;
}

function liveSelection(): LiveSelection | null {
  if (!lastSelection) return null;
  const model = monaco.editor.getModel(monaco.Uri.parse(lastSelection.uri));
  const owner = model ? parseCellUri(model.uri) : null;
  if (!model || !owner || !workspace.get(owner.scope)) return null;
  const range = trimmed(model, model.validateRange(lastSelection.range));
  if (range.isEmpty()) return null;
  const whole = coversWholeLines(model, range);
  const path = workspace.pathOf(owner.scope, owner.address);
  const r: FocusRange = whole ? { startLine: range.startLineNumber, endLine: range.endLineNumber } : { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn };
  return { ...r, tab: owner.scope, address: owner.address, ref: formatFocusRef(path, r), text: clip(model.getValueInRange(range)) };
}

/** Finds the open editor that shows this cell. */
const editorFor = (tab: string, address: string): monaco.editor.ICodeEditor | undefined => {
  const t = workspace.get(tab);
  const uri = t ? cellUri(address, t.sheet.id).toString() : '';
  return monaco.editor.getEditors().find((ed) => ed.getModel()?.uri.toString() === uri && !!ed.getDomNode()?.isConnected);
};

export const focusPoints = {
  install,

  /** Marks the editor's selection (or, with nothing selected, the cursor's line) for the AI. Returns the new point, or null when this editor is not a cell's. */
  markFromEditor(editor: monaco.editor.ICodeEditor): FocusPoint | null {
    const model = editor.getModel();
    const owner = model ? parseCellUri(model.uri) : null;
    const sel = editor.getSelection();
    if (!model || !owner || !sel || !workspace.get(owner.scope)) return null;
    const range = sel.isEmpty() ? new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, model.getLineMaxColumn(sel.startLineNumber)) : trimmed(model, sel);
    if (!model.getValueInRange(range).trim()) return null;
    return add('person', owner.scope, owner.address, range);
  },

  /** The AI points at lines of a cell (1-based, inclusive). */
  markByAi(path: string, from: number, to: number, note?: string): FocusPoint | { error: string } {
    const hit = workspace.resolve(path, workspace.current);
    if ('error' in hit) return { error: hit.error };
    const model = modelOf(hit.tab.id, hit.address);
    if (!model || !model.getValue().trim()) return { error: `${workspace.pathOf(hit.tab.id, hit.address)} has no code to point at.` };
    const last = model.getLineCount();
    const start = Math.min(Math.max(1, Math.round(from)), last);
    const end = Math.min(Math.max(start, Math.round(to)), last);
    const point = add('ai', hit.tab.id, hit.address, new monaco.Range(start, 1, end, model.getLineMaxColumn(end)), note?.slice(0, 160));
    return point ?? { error: `${path} is not a cell with code.` };
  },

  /** The points that stand now (the person's first), optionally only those in one cell (path) or by one side. */
  list(filter: { path?: string; by?: FocusBy } = {}): FocusPoint[] {
    let uid: string | null = null;
    if (filter.path) {
      const hit = workspace.resolve(filter.path, workspace.current);
      if ('error' in hit) return [];
      uid = hit.tab.sheet.dataAt(hit.address)?.uid ?? null;
    }
    return entries
      .filter((e) => (!filter.by || e.by === filter.by) && (!uid || e.uid === uid))
      .map(toPoint)
      .filter((p): p is FocusPoint => p !== null)
      .sort((a, b) => Number(b.by === 'person') - Number(a.by === 'person'));
  },

  remove: (id: string): boolean => remove(id),

  /** Takes away the points of one side (the AI's own, by default), or all. */
  clear(by?: FocusBy): number {
    const gone = entries.filter((e) => !by || e.by === by).map((e) => e.id);
    gone.forEach((id) => remove(id, false));
    if (gone.length) changed();
    return gone.length;
  },

  /** What is selected right now in a cell's editor, for a question that does not mark anything. */
  selection: liveSelection,

  onChange(listener: () => void): void {
    listeners.push(listener);
  },

  /** Opens the cell's editor with these lines selected and blinking: the place a link to a reference leads to. */
  reveal(ref: string): { ok: boolean; error?: string } {
    const parsed = parseFocusRef(ref);
    if (!parsed) return { ok: false, error: `"${ref}" is not a place in a cell (like /lab/J24#L3-5).` };
    const hit = workspace.resolve(parsed.path, workspace.current);
    if ('error' in hit) return { ok: false, error: hit.error };
    const { tab, address } = hit;
    tab.select();
    workspace.setFocus(tab.id, address);
    void tab.sheet.flyToCell(address);
    tab.editor.open(address);
    const select = (): boolean => {
      const editor = editorFor(tab.id, address);
      const model = editor?.getModel();
      if (!editor || !model) return false;
      const last = model.getLineCount();
      const startLine = Math.min(parsed.startLine, last);
      const endLine = Math.min(parsed.endLine, last);
      const range =
        parsed.startColumn !== undefined && parsed.endColumn !== undefined
          ? model.validateRange(new monaco.Range(startLine, parsed.startColumn, endLine, parsed.endColumn))
          : new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range);
      const flash = editor.createDecorationsCollection([{ range, options: { className: 'focus-flash', isWholeLine: true } }]);
      window.setTimeout(() => flash.clear(), 1600);
      return true;
    };
    // The editor frame is built a moment after open(); try now and again shortly after.
    if (!select()) for (const wait of [60, 250, 700]) window.setTimeout(() => editorFor(tab.id, address)?.getModel() && select(), wait);
    return { ok: true };
  },

  /** For the GUI report: where the cursor is in the open cell editor, what is selected (with line numbers) and what is marked. */
  report(): string[] {
    const out: string[] = [];
    for (const ed of monaco.editor.getEditors()) {
      const model = ed.getModel();
      const owner = model && ed.getDomNode()?.isConnected ? parseCellUri(model.uri) : null;
      if (!model || !owner || !workspace.get(owner.scope)) continue;
      const path = workspace.pathOf(owner.scope, owner.address);
      const pos = ed.getPosition();
      out.push(`Editor on ${path}: ${model.getLineCount()} lines${pos ? `, cursor at line ${pos.lineNumber}, column ${pos.column}` : ''}${ed.hasTextFocus() ? ', has the keyboard focus' : ''}`);
      const live = ed.getSelection();
      const range = live && !live.isEmpty() ? trimmed(model, model.validateRange(live)) : null;
      if (!range || range.isEmpty()) out.push('  nothing is selected');
      else {
        const first = range.startLineNumber;
        const last = range.endLineNumber;
        out.push(`  selected: ${first === last ? `line ${first}, columns ${range.startColumn}-${range.endColumn}` : `lines ${first}-${last} (from column ${range.startColumn} of line ${first} to column ${range.endColumn} of line ${last})`}, ${model.getValueInRange(range).length} characters`);
        for (let n = first; n <= Math.min(last, first + 11); n++) out.push(`    ${String(n).padStart(3)} | ${clip(model.getLineContent(n), 120)}`);
        if (last > first + 11) out.push(`    … ${last - first - 11} more lines`);
      }
    }
    if (!out.length) {
      const sel = liveSelection();
      out.push(sel ? `No cell editor is open. The last selection was ${sel.ref} (${describeLines(sel)})` : 'No cell editor is open.');
    }
    const marks = focusPoints.list({}).filter((x) => x.state !== 'gone').slice(0, 6);
    for (const m of marks) out.push(`  marked by ${m.by}: ${m.ref} (${describeLines(m)}${m.state === 'edited' ? ', edited since' : ''})`);
    return out;
  },

  /** For the question the AI gets: the person's marked places and what is selected right now, each with its words. Empty when there are none. */
  note(): string {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const p of focusPoints.list({ by: 'person' }).filter((x) => x.state !== 'gone').slice(0, 3)) {
      seen.add(p.ref);
      lines.push(`- ${p.ref} (${describeLines(p)}${p.state === 'edited' ? ', edited since it was marked' : ''}):\n${p.text}`);
    }
    const sel = liveSelection();
    if (sel && !seen.has(sel.ref)) lines.push(`- ${sel.ref} (selected right now, ${describeLines(sel)}):\n${sel.text}`);
    return lines.length ? `[The person marked these places in the code: look at them first, and answer about them]\n${lines.join('\n')}` : '';
  },
};

/** A link that shows the lines of a reference (opens the editor with them selected). */
export function focusLink(ref: string, label?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'cell-link focus-link';
  a.href = '#';
  a.textContent = label ?? ref;
  a.dataset.ref = ref;
  a.title = `Show ${ref}`;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const r = focusPoints.reveal(ref);
    if (!r.ok) a.title = r.error ?? 'Could not show this place';
  });
  return a;
}

/** A point as the AI reads it. */
export const pointText = (p: FocusPoint): Record<string, unknown> => ({
  ref: p.ref,
  by: p.by === 'person' ? 'the person (📌)' : 'you (the AI)',
  lines: p.state === 'gone' ? 'lost: the code was replaced' : describeLines(p),
  text: p.text,
  note: p.note,
  edited: p.state === 'edited' ? 'the code there was changed after it was marked' : undefined,
});

/** The tool the AIs have (focus_points in the helper, code.focus over MCP): list the marked places, point at lines, take the pointers away. */
export function focusTool(args: Record<string, unknown>, fromTab: string): Record<string, unknown> {
  const action = typeof args.action === 'string' ? args.action : 'list';
  if (action === 'clear') return { cleared: focusPoints.clear('ai'), note: "Your pointers are removed. The person's own 📌 marks stay." };
  if (action === 'add') {
    const path = typeof args.path === 'string' ? args.path : '';
    const from = typeof args.from_line === 'number' ? args.from_line : NaN;
    if (!path || !Number.isFinite(from) || from < 1) return { error: 'add needs path and from_line (1-based), like path "/lab/J24", from_line 3, to_line 5.' };
    const to = typeof args.to_line === 'number' && Number.isFinite(args.to_line) ? args.to_line : from;
    const hit = resolveSmart(path, fromTab);
    if ('error' in hit) return { error: hit.error };
    const point = focusPoints.markByAi(workspace.pathOf(hit.tab.id, hit.address), from, to, typeof args.note === 'string' ? args.note : undefined);
    return 'error' in point ? point : { ok: true, ...pointText(point), next: 'The lines are highlighted in blue in the editor. Say in your answer what is there, with the reference in `backticks` so it becomes a link.' };
  }
  const path = typeof args.path === 'string' && args.path ? args.path : undefined;
  const points = focusPoints.list({ path });
  const live = focusPoints.selection();
  return {
    marked: points.map(pointText),
    selectedNow: live ? { ref: live.ref, text: live.text, note: 'selected in the editor right now, not marked' } : null,
    note: points.length || live ? 'Look at these places first, and answer about them. Read the whole cell with read_cell when you need more around them.' : 'Nothing is marked and nothing is selected. Ask the person to select code and press 📌 (Alt+M), or use look_around.',
  };
}
