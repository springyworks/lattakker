export type TabId = 'board' | 'lab' | 'examples';

interface TabSpec {
  id: TabId;
  label: string;
  hint: string;
}

const TABS: TabSpec[] = [
  { id: 'board', label: '🎲 Game board', hint: 'The battle and your cells' },
  { id: 'lab', label: '🧪 Lab', hint: 'A second sheet full of live, animated demos (no battle here)' },
  { id: 'examples', label: '📚 Examples', hint: 'Every example, ready to play with' },
];

/**
 * A tab strip above the page. The panels stay in the DOM (just hidden), so the board keeps its
 * state, scroll position and running cells while the player browses the examples.
 */
export class Tabs {
  readonly root = document.createElement('nav');
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private current: TabId = 'board';
  private readonly listeners: Array<(tab: TabId, previous: TabId) => void> = [];

  constructor(private readonly panels: Record<TabId, HTMLElement>) {
    this.root.id = 'tabs';
    this.root.setAttribute('role', 'tablist');
    for (const spec of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
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

  select(tab: TabId): void {
    if (tab === this.current) return;
    const previous = this.current;
    this.current = tab;
    this.apply();
    history.replaceState(null, '', tab === 'board' ? location.pathname + location.search : `#${tab}`);
    this.listeners.forEach((h) => h(tab, previous));
  }

  private apply(): void {
    for (const spec of TABS) {
      const on = spec.id === this.current;
      const b = this.buttons.get(spec.id)!;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      this.panels[spec.id].hidden = !on;
    }
    for (const spec of TABS) document.body.classList.toggle(`tab-${spec.id}`, spec.id === this.current);
  }
}
