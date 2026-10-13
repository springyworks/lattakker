import { TabStrip } from './TabStrip';

export type TabId = string;

export interface TabSpec {
  id: TabId;
  label: string;
  hint: string;
}

const BUILT_IN: TabSpec[] = [
  { id: 'board', label: '🎲 Game board', hint: 'The battle and your cells' },
  { id: 'lab', label: '🧪 Lab', hint: 'A second sheet full of live, animated demos (no battle here)' },
  { id: 'examples', label: '📚 Examples', hint: 'A notebook: every example as a big block with its live output' },
];

/** A tab id is used in cell paths (/plots/A1), in the address bar (#plots) and as a server name, so it stays plain. */
export const TAB_ID = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * A tab strip above the page. The panels stay in the DOM (just hidden), so the board keeps its
 * state, scroll position and running cells while the player browses the examples.
 *
 * What you see is drawn by maxGraph (TabStrip.ts). The <button role="tab"> elements stay in the page,
 * visually hidden, so the keyboard, screen readers and AI helpers still have real tabs to work with.
 *
 * Tabs can come and go while the page runs (add, rename, remove); the first three are built in.
 */
export class Tabs {
  readonly root = document.createElement('nav');
  private readonly specs: TabSpec[] = [];
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private readonly panels = new Map<TabId, HTMLElement>();
  private current: TabId = 'board';
  readonly strip: TabStrip;
  private readonly drawing = document.createElement('div');
  private readonly listeners: Array<(tab: TabId, previous: TabId) => void> = [];
  private readonly leaving: Array<() => void> = [];

  constructor(panels: Record<'board' | 'lab' | 'examples', HTMLElement>) {
    this.root.id = 'tabs';
    this.root.setAttribute('role', 'tablist');
    this.drawing.setAttribute('aria-hidden', 'true');
    this.root.prepend(this.drawing);
    for (const spec of BUILT_IN) {
      this.specs.push({ ...spec });
      this.panels.set(spec.id, panels[spec.id as keyof typeof panels]);
      this.makeButton(spec);
    }
    this.strip = new TabStrip(
      this.drawing,
      this.specs.map((t) => ({ id: t.id, label: t.label, hint: t.hint })),
      (id) => this.select(id),
    );
    document.body.prepend(this.root);
    document.body.classList.add('has-tabs');
    window.addEventListener('hashchange', () => this.select(this.fromHash()));
    this.apply();
  }

  private makeButton(spec: TabSpec): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab-a11y';
    b.id = `tab-${spec.id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', this.panels.get(spec.id)!.id);
    b.title = spec.hint;
    b.textContent = spec.label;
    b.addEventListener('click', () => this.select(spec.id));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const at = this.specs.findIndex((t) => t.id === spec.id);
      const next = this.specs[(at + (e.key === 'ArrowRight' ? 1 : this.specs.length - 1)) % this.specs.length];
      this.select(next.id);
      this.buttons.get(next.id)?.focus();
    });
    // A keyboard user moving between the hidden buttons sees the focus on the drawn tab.
    b.addEventListener('focus', () => this.drawing.classList.add('kbd-focus'));
    b.addEventListener('blur', () => this.drawing.classList.remove('kbd-focus'));
    this.buttons.set(spec.id, b);
    this.root.append(b);
  }

  fromHash(): TabId {
    const id = location.hash.slice(1);
    return this.has(id) ? id : 'board';
  }

  get active(): TabId {
    return this.current;
  }

  has(id: string): boolean {
    return this.panels.has(id);
  }

  /** The tabs, left to right. */
  list(): TabSpec[] {
    return this.specs.map((s) => ({ ...s }));
  }

  /** Puts one more tab at the end. Its panel must already be in the page (hidden). */
  add(spec: TabSpec, panel: HTMLElement, index = this.specs.length): void {
    if (this.has(spec.id)) throw new Error(`There is already a tab "${spec.id}".`);
    this.specs.splice(index, 0, { ...spec });
    this.panels.set(spec.id, panel);
    this.makeButton(spec);
    this.strip.addTab({ id: spec.id, label: spec.label, hint: spec.hint }, index);
    this.apply();
  }

  /** Takes a tab away (the board, the Lab and the Examples cannot go). If it was in front, the board comes forward. */
  remove(id: TabId): void {
    if (!this.has(id) || BUILT_IN.some((t) => t.id === id)) return;
    if (this.current === id) this.select('board');
    this.specs.splice(this.specs.findIndex((t) => t.id === id), 1);
    this.panels.delete(id);
    this.buttons.get(id)?.remove();
    this.buttons.delete(id);
    document.body.classList.remove(`tab-${id}`);
    this.strip.removeTab(id);
  }

  rename(id: TabId, label: string, hint?: string): void {
    const spec = this.specs.find((t) => t.id === id);
    if (!spec) return;
    spec.label = label;
    if (hint !== undefined) spec.hint = hint;
    const b = this.buttons.get(id);
    if (b) {
      b.textContent = label;
      if (hint !== undefined) b.title = hint;
    }
    this.strip.renameTab(id, label, hint);
  }

  onChange(handler: (tab: TabId, previous: TabId) => void): void {
    this.listeners.push(handler);
  }

  /** Runs just before another tab comes to the front, while the one on screen still has its scroll position. */
  onBeforeChange(handler: () => void): void {
    this.leaving.push(handler);
  }

  select(tab: TabId): void {
    if (tab === this.current || !this.has(tab)) return;
    this.leaving.forEach((h) => h());
    const previous = this.current;
    this.current = tab;
    this.apply();
    history.replaceState(null, '', tab === 'board' ? location.pathname + location.search : `#${tab}`);
    this.listeners.forEach((h) => h(tab, previous));
  }

  /** The "you are here" path shown at the right of the strip. */
  setPath(text: string): void {
    this.strip.setPath(text);
  }

  private apply(): void {
    for (const spec of this.specs) {
      const on = spec.id === this.current;
      const b = this.buttons.get(spec.id)!;
      b.classList.toggle('active', on);
      if (on) this.strip.setActive(spec.id);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      this.panels.get(spec.id)!.hidden = !on;
    }
    for (const spec of this.specs) document.body.classList.toggle(`tab-${spec.id}`, spec.id === this.current);
  }
}
