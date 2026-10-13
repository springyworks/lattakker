import { TabStrip } from './TabStrip';

export type TabId = 'board' | 'lab' | 'examples';

interface TabSpec {
  id: TabId;
  label: string;
  hint: string;
}

const TABS: TabSpec[] = [
  { id: 'board', label: '🎲 Game board', hint: 'The battle and your cells' },
  { id: 'lab', label: '🧪 Lab', hint: 'A second sheet full of live, animated demos (no battle here)' },
  { id: 'examples', label: '📚 Examples', hint: 'A notebook: every example as a big block with its live output' },
];

/**
 * A tab strip above the page. The panels stay in the DOM (just hidden), so the board keeps its
 * state, scroll position and running cells while the player browses the examples.
 *
 * What you see is drawn by maxGraph (TabStrip.ts). The <button role="tab"> elements stay in the page,
 * visually hidden, so the keyboard, screen readers and AI helpers still have real tabs to work with.
 */
export class Tabs {
  readonly root = document.createElement('nav');
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private current: TabId = 'board';
  readonly strip: TabStrip;
  private readonly listeners: Array<(tab: TabId, previous: TabId) => void> = [];
  private readonly leaving: Array<() => void> = [];

  constructor(private readonly panels: Record<TabId, HTMLElement>) {
    this.root.id = 'tabs';
    this.root.setAttribute('role', 'tablist');
    for (const spec of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-a11y';
      b.id = `tab-${spec.id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', panels[spec.id].id);
      b.title = spec.hint;
      b.textContent = spec.label;
      b.addEventListener('click', () => this.select(spec.id));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = TABS[(TABS.findIndex((t) => t.id === spec.id) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        this.select(next.id);
        this.buttons.get(next.id)?.focus();
      });
      this.buttons.set(spec.id, b);
      this.root.append(b);
    }
    const drawing = document.createElement('div');
    drawing.setAttribute('aria-hidden', 'true');
    this.root.prepend(drawing);
    this.strip = new TabStrip(
      drawing,
      TABS.map((t) => ({ id: t.id, label: t.label, hint: t.hint })),
      (id) => this.select(id as TabId),
    );
    // A keyboard user moving between the hidden buttons sees the focus on the drawn tab.
    for (const b of this.buttons.values()) {
      b.addEventListener('focus', () => drawing.classList.add('kbd-focus'));
      b.addEventListener('blur', () => drawing.classList.remove('kbd-focus'));
    }
    document.body.prepend(this.root);
    document.body.classList.add('has-tabs');
    window.addEventListener('hashchange', () => this.select(this.fromHash()));
    this.apply();
  }

  fromHash(): TabId {
    const id = location.hash.slice(1);
    return TABS.some((t) => t.id === id) ? (id as TabId) : 'board';
  }

  get active(): TabId {
    return this.current;
  }

  onChange(handler: (tab: TabId, previous: TabId) => void): void {
    this.listeners.push(handler);
  }

  /** Runs just before another tab comes to the front, while the one on screen still has its scroll position. */
  onBeforeChange(handler: () => void): void {
    this.leaving.push(handler);
  }

  select(tab: TabId): void {
    if (tab === this.current) return;
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
    for (const spec of TABS) {
      const on = spec.id === this.current;
      const b = this.buttons.get(spec.id)!;
      b.classList.toggle('active', on);
      if (on) this.strip.setActive(spec.id);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      this.panels[spec.id].hidden = !on;
    }
    for (const spec of TABS) document.body.classList.toggle(`tab-${spec.id}`, spec.id === this.current);
  }
}
