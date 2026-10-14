import type { Sheet } from '../sheet/Sheet';
import { monaco } from '../editor/monaco';

/**
 * Mouse gestures that work on every sheet and in every code editor.
 *
 *  - Ctrl (Cmd) + drag: pan the view.
 *  - Morse clicks: a quick press is a dit (.), a press that is held is a dah (-). A pattern that ends in a held
 *    press starts a gesture that lasts as long as the button stays down:
 *        dit, dah-hold          (.-)   pan: drag to move the view
 *        dit, dit, dah-hold     (..-)  zoom: drag up to zoom in, down to zoom out
 *    More patterns can be added with onMorseHold (patterns ending in a hold) and onMorseTap (patterns of quick
 *    presses that were followed by a pause).
 *
 * The press itself is never delayed or blocked: Monaco and the sheet see it as usual (so Ctrl+click still goes to
 * a definition and a plain click still picks a cell). A gesture only takes over once it is certain, after a few
 * pixels of movement (Ctrl) or after the hold (Morse); the editor's cursor and selection are then put back.
 */

const MOVE_PX = 3;
/** A press shorter than this is a dit, a press held longer is a dah. */
const DIT_MS = 260;
/** The pause that may separate the symbols of one pattern. */
const GAP_MS = 450;
const GAP_PX = 40;
/** A press that moves more than this is a plain drag, not a Morse symbol. */
const DRAG_PX = 6;
const MAX_SYMBOLS = 6;

/** What a running gesture does with the pointer: dx and dy are measured from where the press began. */
export interface Drive {
  move(dx: number, dy: number): void;
  end(): void;
}

/** What is under the pointer: the sheet it is on and, when it is in a code editor, that editor. */
export interface GestureTarget {
  sheet?: Sheet;
  editor?: monaco.editor.ICodeEditor;
  x: number;
  y: number;
}

interface HoldHandler {
  label: string;
  start: (target: GestureTarget) => Drive | null;
}

const sheets = new Map<HTMLElement, Sheet>();
const holds = new Map<string, HoldHandler>();
const taps = new Map<string, (target: GestureTarget) => void>();

/** Starts something when `pattern` (like '.-' or '..-', dits and one final dah) ends with the button held down. */
export function onMorseHold(pattern: string, label: string, start: (target: GestureTarget) => Drive | null): void {
  holds.set(pattern, { label, start });
}

/** Does something when `pattern` (dits and dahs, like '...' or '.-.') is followed by a pause. */
export function onMorseTap(pattern: string, run: (target: GestureTarget) => void): void {
  taps.set(pattern, run);
}

function editorAt(target: Element): monaco.editor.ICodeEditor | undefined {
  if (target.closest('.cell-code-view') || !target.closest('.monaco-editor')) return undefined;
  return monaco.editor.getEditors().find((ed) => ed.getDomNode()?.contains(target));
}

function targetAt(el: Element, x: number, y: number): GestureTarget | null {
  const editor = editorAt(el);
  let sheet: Sheet | undefined;
  for (const [box, sh] of sheets) if (box.contains(el)) sheet = sh;
  return editor || sheet ? { sheet, editor, x, y } : null;
}

/** Moves the view: the code in the editor under the pointer, or else the sheet. */
function startPan(t: GestureTarget): Drive | null {
  const { editor, sheet } = t;
  if (editor) {
    const dom = editor.getDomNode();
    // The editor may sit inside the zoomed graph: a screen pixel is 1/scale of a pixel of the editor.
    const scale = dom && dom.offsetWidth ? dom.getBoundingClientRect().width / dom.offsetWidth || 1 : 1;
    const left0 = editor.getScrollLeft();
    const top0 = editor.getScrollTop();
    return { move: (dx, dy) => editor.setScrollPosition({ scrollLeft: left0 - dx / scale, scrollTop: top0 - dy / scale }), end: () => {} };
  }
  if (!sheet) return null;
  const box = sheet.container;
  const left0 = box.scrollLeft;
  const top0 = box.scrollTop;
  return {
    move: (dx, dy) => {
      box.scrollLeft = left0 - dx;
      box.scrollTop = top0 - dy;
    },
    end: () => {},
  };
}

/** Zooms the sheet around the point where the press began. */
function startZoom(t: GestureTarget): Drive | null {
  const { sheet } = t;
  if (!sheet) return null;
  let last = 0;
  return {
    move: (_dx, dy) => {
      sheet.zoomAround(Math.exp(-(dy - last) / 240), t.x, t.y);
      last = dy;
    },
    end: () => {},
  };
}

onMorseHold('.-', 'pan', startPan);
onMorseHold('..-', 'zoom', startZoom);

interface Press {
  ctrl: boolean;
  x0: number;
  y0: number;
  target: GestureTarget | null;
  /** The symbols that came before this press. */
  before: string;
  selections: monaco.Selection[] | null;
  dragged: boolean;
  timer: number;
  drive: Drive | null;
  at: number;
}

let installed = false;

export function installMouseGestures(sheet: Sheet): void {
  sheets.set(sheet.container, sheet);
  if (installed) return;
  installed = true;

  let press: Press | null = null;
  let history = '';
  let lastUp = { at: 0, x: 0, y: 0 };
  let tapTimer = 0;
  let swallowClickUntil = 0;
  let cue: HTMLElement | null = null;

  const showCue = (text: string, x: number, y: number): void => {
    cue ??= Object.assign(document.createElement('div'), { className: 'morse-cue' });
    cue.textContent = text;
    cue.style.left = `${x + 14}px`;
    cue.style.top = `${y - 34}px`;
    document.body.append(cue);
  };

  const activate = (p: Press, drive: Drive | null): void => {
    if (!drive || !p.target) return;
    p.drive = drive;
    window.clearTimeout(p.timer);
    p.target.sheet?.beginPan();
    if (p.target.editor && p.selections) p.target.editor.setSelections(p.selections);
    document.body.classList.add('gesture-active');
    window.dispatchEvent(new CustomEvent('lattakker:gesture', { detail: { pattern: p.before + '-' } }));
  };

  const finish = (): void => {
    const p = press;
    press = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    const now = performance.now();
    if (p.drive) {
      p.drive.end();
      p.target?.sheet?.endPan();
      swallowClickUntil = now + 80;
      document.body.classList.remove('gesture-active');
      cue?.remove();
      history = '';
      return;
    }
    if (p.ctrl || p.dragged) {
      history = '';
      return;
    }
    const symbol = now - p.at < DIT_MS ? '.' : '-';
    history = (p.before + symbol).slice(-MAX_SYMBOLS);
    lastUp = { at: now, x: p.x0, y: p.y0 };
    const tap = taps.get(history);
    if (tap && p.target) {
      const target = p.target;
      const seen = now;
      window.clearTimeout(tapTimer);
      tapTimer = window.setTimeout(() => {
        if (lastUp.at === seen) {
          history = '';
          tap(target);
        }
      }, GAP_MS);
    }
  };

  window.addEventListener(
    'pointerdown',
    (e) => {
      press = null;
      window.clearTimeout(tapTimer);
      if (e.button !== 0 || e.pointerType !== 'mouse' || e.shiftKey || e.altKey || !(e.target instanceof Element)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const now = performance.now();
      const continues = !ctrl && now - lastUp.at < GAP_MS && Math.hypot(e.clientX - lastUp.x, e.clientY - lastUp.y) < GAP_PX;
      const before = continues ? history : '';
      if (!continues) history = '';
      const target = targetAt(e.target, e.clientX, e.clientY);
      const hold = ctrl ? undefined : holds.get(before + '-');
      if (!target) return;
      const p: Press = {
        ctrl,
        x0: e.clientX,
        y0: e.clientY,
        target,
        before,
        selections: target.editor ? target.editor.getSelections() : null,
        dragged: false,
        timer: 0,
        drive: null,
        at: now,
      };
      if (hold) {
        p.timer = window.setTimeout(() => {
          if (press !== p || p.dragged || p.drive) return;
          activate(p, hold.start(target));
          if (p.drive) showCue(`${(before + '-').replace(/\./g, '·').replace(/-/g, '–')} ${hold.label}`, p.x0, p.y0);
        }, DIT_MS);
      }
      press = p;
    },
    true,
  );

  const move = (e: MouseEvent): void => {
    const p = press;
    if (!p) return;
    if (!(e.buttons & 1)) {
      finish();
      return;
    }
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    const dist = Math.hypot(dx, dy);
    if (!p.drive) {
      if (p.ctrl && dist >= MOVE_PX && p.target) activate(p, startPan(p.target));
      else if (!p.ctrl && dist >= DRAG_PX) {
        p.dragged = true;
        window.clearTimeout(p.timer);
      }
      if (!p.drive) return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    p.drive.move(dx, dy);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('mousemove', move, true);
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  window.addEventListener('blur', finish);
  window.addEventListener(
    'click',
    (e) => {
      if (performance.now() < swallowClickUntil) e.stopImmediatePropagation();
    },
    true,
  );
}
