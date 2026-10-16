import { monaco } from './monaco';

/**
 * From the output back to the code: when someone selects words in the output pane of a cell, the editor of that
 * cell shows where those words come from. The words are looked for in the code (a text that was written between
 * quotes shows up in the output as it is); when the whole selection is not there, its pieces are (an output like
 * "Red has 40 pieces" comes from the code "Red has ${red} pieces", so the piece "Red has" is found); and when nothing is
 * there at all (the output is made from numbers and calculations) the lines that write output (print, show, view)
 * are marked, because the answer to "where does this come from?" is one of them. The editor scrolls to the first
 * place, and the marks fade after a while or when the person edits the code.
 */

const MARK_MS = 12000;
const MAX_MARKS = 30;
const OUTPUT_CALL = /\b(?:print|show|view|log)\s*\(|\.(?:print|show|view)\s*\(/;

type Editor = monaco.editor.IStandaloneCodeEditor;

interface Found {
  ranges: monaco.Range[];
  /** 'whole': the selection itself is in the code. 'pieces': only parts of it. 'calls': the lines that write output. */
  kind: 'whole' | 'pieces' | 'calls' | 'none';
}

const isComment = (model: monaco.editor.ITextModel, line: number): boolean => model.getLineContent(line).trimStart().startsWith('//');

/** Places in the code where a text stands. A hit in code wins over a hit in a comment (comments talk about the code). */
function places(model: monaco.editor.ITextModel, text: string): monaco.Range[] {
  const all = model.findMatches(text, true, false, false, null, false).map((m) => m.range);
  const inCode = all.filter((r) => !isComment(model, r.startLineNumber));
  return (inCode.length ? inCode : all).slice(0, MAX_MARKS);
}

/** The pieces of a line of output that are probably words of the code: the stretches between numbers and signs. */
function pieces(line: string): string[] {
  return line
    .split(/[\d.,:;!?()[\]{}<>=+*/\\|"'`$%&#@^~_-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && /\p{L}/u.test(p))
    .sort((a, b) => b.length - a.length);
}

export function findInCode(model: monaco.editor.ITextModel, selected: string): Found {
  const lines = selected
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 6);
  const whole: monaco.Range[] = [];
  const parts: monaco.Range[] = [];
  for (const line of lines) {
    const exact = places(model, line);
    if (exact.length) {
      whole.push(...exact);
      continue;
    }
    // The two longest pieces that are in the code: more would mark every common word.
    let used = 0;
    for (const piece of pieces(line)) {
      const hit = places(model, piece);
      if (!hit.length) continue;
      parts.push(...hit);
      if (++used === 2) break;
    }
  }
  if (whole.length) return { ranges: whole.slice(0, MAX_MARKS), kind: 'whole' };
  if (parts.length) return { ranges: parts.slice(0, MAX_MARKS), kind: 'pieces' };
  const calls: monaco.Range[] = [];
  for (let n = 1; n <= model.getLineCount(); n++) {
    if (!isComment(model, n) && OUTPUT_CALL.test(model.getLineContent(n))) calls.push(new monaco.Range(n, 1, n, model.getLineMaxColumn(n)));
  }
  return calls.length ? { ranges: calls.slice(0, MAX_MARKS), kind: 'calls' } : { ranges: [], kind: 'none' };
}

/**
 * Makes an output pane answer to a selection. `getEditor` gives the editor of the same cell, or null when it is not on
 * screen. Returns the way to take it away again.
 */
export function installOutputTrace(out: HTMLElement, getEditor: () => Editor | null): () => void {
  let marks: monaco.editor.IEditorDecorationsCollection | null = null;
  let markedIn: Editor | null = null;
  let timer = 0;
  let note: HTMLElement | null = null;
  let watch: monaco.IDisposable | null = null;

  const clear = (): void => {
    window.clearTimeout(timer);
    try {
      marks?.clear();
    } catch {
      // the editor was closed meanwhile
    }
    marks = null;
    markedIn = null;
    watch?.dispose();
    watch = null;
    note?.remove();
    note = null;
  };

  const say = (message: string): void => {
    note?.remove();
    note = document.createElement('div');
    note.className = 'trace-note';
    note.textContent = message;
    out.appendChild(note);
  };

  const show = (selected: string): void => {
    const editor = getEditor();
    const model = editor?.getModel();
    clear();
    if (!editor || !model) return;
    const found = findInCode(model, selected);
    if (found.kind === 'none') {
      say('🔎 Not in the code: the text is made from other values');
      timer = window.setTimeout(clear, 4000);
      return;
    }
    marks = editor.createDecorationsCollection(
      found.ranges.map((range) => ({
        range,
        options: found.kind === 'calls' ? { isWholeLine: true, className: 'trace-line', overviewRuler: { color: '#e0a800', position: monaco.editor.OverviewRulerLane.Full } } : { inlineClassName: 'trace-hit', overviewRuler: { color: '#e0a800', position: monaco.editor.OverviewRulerLane.Full } },
      })),
    );
    markedIn = editor;
    editor.revealRangeInCenterIfOutsideViewport(found.ranges[0], monaco.editor.ScrollType.Smooth);
    const lines = [...new Set(found.ranges.map((r) => r.startLineNumber))];
    const where = lines.length === 1 ? `line ${lines[0]}` : `lines ${lines.slice(0, 4).join(', ')}${lines.length > 4 ? ' …' : ''}`;
    say(found.kind === 'whole' ? `🔎 In the code: ${where}` : found.kind === 'pieces' ? `🔎 Part of it is in the code: ${where}` : `🔎 This text is made from values. These lines write the output: ${where}`);
    // Editing the code makes the marks stale.
    watch = editor.onDidChangeModelContent(clear);
    timer = window.setTimeout(clear, MARK_MS);
  };

  const onMouseUp = (): void => {
    // The selection is final only after the mouse-up has been handled.
    window.setTimeout(() => {
      const sel = window.getSelection();
      const inside = !!sel && !sel.isCollapsed && !!sel.anchorNode && out.contains(sel.anchorNode);
      const text = inside ? sel.toString().trim() : '';
      if (text) show(text);
      else if (markedIn || note) clear();
    }, 0);
  };
  out.addEventListener('mouseup', onMouseUp);
  return () => {
    out.removeEventListener('mouseup', onMouseUp);
    clear();
  };
}
