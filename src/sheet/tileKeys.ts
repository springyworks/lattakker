/**
 * The keyboard of a tile grid. A block's grid can take the keys (g.focus(), on(g, 'key', ...)), so a cell can
 * be a terminal. The keys go to a small hidden text box that has the browser's focus. That is the same trick
 * every web terminal uses, and it gives three things for free: the sheet's own shortcuts (Delete clears a cell,
 * Enter opens the editor) ignore keys typed in a text box, so they stay out of the way; a phone shows its
 * keyboard; pasting works. Only one grid has the keyboard at a time.
 */

export interface TileKeyInfo {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
}

export interface TileKeyListener {
  key?: (key: string, info: TileKeyInfo) => void;
  focus?: () => void;
  blur?: () => void;
}

const listeners = new Map<string, Set<TileKeyListener>>();
let box: HTMLTextAreaElement | null = null;
let current: string | null = null;

const emit = (id: string | null, what: 'focus' | 'blur'): void => {
  if (!id) return;
  for (const l of [...(listeners.get(id) ?? [])]) l[what]?.();
};

const send = (key: string, info: TileKeyInfo): void => {
  if (!current) return;
  for (const l of [...(listeners.get(current) ?? [])]) l.key?.(key, info);
};

const install = (): HTMLTextAreaElement => {
  if (box) return box;
  const t = document.createElement('textarea');
  t.setAttribute('aria-label', 'Typing into a tile grid');
  t.setAttribute('autocapitalize', 'off');
  t.setAttribute('autocomplete', 'off');
  t.setAttribute('autocorrect', 'off');
  t.spellcheck = false;
  // Fixed in the top-left corner and invisible, so that focusing it never scrolls the page.
  t.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;resize:none;font-size:16px;pointer-events:none';
  t.addEventListener('keydown', (e) => {
    if (!current) return;
    // Tab leaves the grid like it leaves any widget; the browser handles it.
    if (e.key === 'Tab') return;
    // Phone keyboards and input methods send their letters through the input event below.
    if (e.isComposing || e.key === 'Unidentified' || e.key === 'Process' || e.keyCode === 229) return;
    const info: TileKeyInfo = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, repeat: e.repeat };
    // Browser shortcuts (Ctrl+R, Ctrl+V ...) keep working: the grid hears them, but they are not cancelled.
    if (!info.ctrl && !info.alt) e.preventDefault();
    e.stopPropagation();
    if (info.ctrl && e.key.toLowerCase() === 'v') return;
    send(e.key, info);
  });
  t.addEventListener('input', () => {
    const text = t.value;
    t.value = '';
    for (const ch of Array.from(text.replace(/\r?\n/g, ' '))) send(ch, { shift: false, ctrl: false, alt: false, repeat: false });
  });
  t.addEventListener('blur', () => {
    const was = current;
    current = null;
    emit(was, 'blur');
  });
  // A click anywhere takes the keys away; the grid's own click then asks for them back if it wants them.
  window.addEventListener('pointerdown', () => {
    if (current) t.blur();
  }, true);
  document.body.appendChild(t);
  box = t;
  return t;
};

/** Listens to one grid's keys, focus and blur. Returns the way to stop. */
export function listenTileKeys(id: string, listener: TileKeyListener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(id);
      if (current === id) box?.blur();
    }
  };
}

export function focusTiles(id: string): void {
  const t = install();
  if (current === id) {
    t.focus();
    return;
  }
  const was = current;
  current = id;
  if (was) emit(was, 'blur');
  t.focus();
  emit(id, 'focus');
}

export function blurTiles(id: string): void {
  if (current === id) box?.blur();
}

export const tilesHaveFocus = (id: string): boolean => current === id;
