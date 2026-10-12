/** One line of a hover menu. Anything that can describe itself with these lines can have a menu. */
export interface MenuItem {
  label?: string;
  /** Small grey text at the right of the label. */
  hint?: string;
  /** Tiny monospace text (ids and other facts), not a button unless it has onSelect. */
  tiny?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a tick box. */
  checked?: boolean;
  separator?: boolean;
  /** Why a disabled item is disabled (shown as its tooltip). */
  title?: string;
  /** Return false to keep the menu open (for example to ask "are you sure?"). */
  onSelect?: () => void | false;
  /** A fly-out list that opens while the pointer rests on this line. */
  children?: MenuItem[];
}

const CLOSE_DELAY_MS = 280;
const OPEN_DELAY_MS = 90;

/**
 * A small dropdown that opens when the pointer rests on its anchor and stays while the pointer is
 * on the anchor or on the menu. Plain DOM on <body>, so no canvas layer can clip or cover it.
 */
export class HoverMenu {
  private root: HTMLDivElement | null = null;
  private flyouts: HTMLDivElement[] = [];
  private openTimer = 0;
  private closeTimer = 0;
  private anchor: HTMLElement | null = null;
  private build: (() => MenuItem[]) | null = null;
  /** A right-click menu stays until a choice, a click elsewhere or Esc — leaving it with the pointer does not close it. */
  private sticky = false;

  constructor(private readonly onClose: () => void = () => {}) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.root) this.close();
    }, true);
    document.addEventListener('pointerdown', (e) => {
      if (this.root && !this.root.contains(e.target as Node) && !this.flyouts.some((f) => f.contains(e.target as Node)) && !this.anchor?.contains(e.target as Node)) this.close();
    }, true);
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Call when the pointer enters the anchor. */
  hoverAnchor(anchor: HTMLElement, build: () => MenuItem[]): void {
    this.cancelClose();
    if (this.root && this.anchor === anchor) return;
    window.clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => this.open(anchor, build), OPEN_DELAY_MS);
  }

  /** Opens a menu at a screen point (a right-click), kept open until a choice, a click elsewhere or Esc. */
  openAt(x: number, y: number, items: MenuItem[]): void {
    this.close();
    this.sticky = true;
    const menu = this.render(items, 0);
    menu.classList.add('hover-menu-root', 'fresh');
    document.body.append(menu);
    this.root = menu;
    const left = Math.max(6, Math.min(x, window.innerWidth - menu.offsetWidth - 6));
    const top = Math.max(6, Math.min(y, window.innerHeight - menu.offsetHeight - 6));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  /** Call when the pointer leaves the anchor. */
  leaveAnchor(): void {
    window.clearTimeout(this.openTimer);
    this.scheduleClose();
  }

  /** Builds the list again (after a choice that changed what the menu should say). */
  refresh(): void {
    if (!this.root || !this.anchor || !this.build) return;
    this.open(this.anchor, this.build);
  }

  close(): void {
    window.clearTimeout(this.openTimer);
    this.cancelClose();
    this.closeFlyouts(0);
    if (this.root) {
      this.root.remove();
      this.root = null;
      this.anchor = null;
      this.build = null;
      this.sticky = false;
      this.onClose();
    }
  }

  private scheduleClose(): void {
    this.cancelClose();
    if (this.sticky) return;
    this.closeTimer = window.setTimeout(() => this.close(), CLOSE_DELAY_MS);
  }

  private cancelClose(): void {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = 0;
  }

  private open(anchor: HTMLElement, build: () => MenuItem[]): void {
    const had = this.root !== null;
    this.closeFlyouts(0);
    this.root?.remove();
    this.anchor = anchor;
    this.build = build;
    const menu = this.render(build(), 0);
    menu.classList.add('hover-menu-root');
    document.body.append(menu);
    this.root = menu;
    const a = anchor.getBoundingClientRect();
    this.place(menu, a.right - menu.offsetWidth, a.bottom + 2, a);
    if (!had) menu.classList.add('fresh');
  }

  /** Keeps the menu inside the window: below the anchor if it fits, otherwise above it. */
  private place(menu: HTMLElement, x: number, y: number, anchorRect: DOMRect): void {
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    let top = y;
    if (top + h > window.innerHeight - 6) top = Math.max(6, anchorRect.top - h - 2);
    left = Math.max(6, left);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  private render(items: MenuItem[], depth: number): HTMLDivElement {
    const menu = document.createElement('div');
    menu.className = 'hover-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('pointerenter', () => this.cancelClose());
    menu.addEventListener('pointerleave', () => this.scheduleClose());
    for (const e of ['mousedown', 'click', 'dblclick', 'contextmenu', 'wheel']) menu.addEventListener(e, (ev) => ev.stopPropagation());
    for (const item of items) {
      if (item.separator) {
        const hr = document.createElement('div');
        hr.className = 'hover-menu-sep';
        menu.append(hr);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'hover-menu-item';
      row.setAttribute('role', 'menuitem');
      if (item.tiny) row.classList.add('tiny');
      if (item.danger) row.classList.add('danger');
      if (item.disabled) {
        row.classList.add('disabled');
        row.setAttribute('aria-disabled', 'true');
      }
      if (item.title) row.title = item.title;
      const label = document.createElement('span');
      label.className = 'hover-menu-label';
      label.textContent = (item.checked !== undefined ? (item.checked ? '☑ ' : '☐ ') : '') + (item.label ?? '');
      row.append(label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'hover-menu-hint';
        hint.textContent = item.hint;
        row.append(hint);
      }
      if (item.children) {
        const arrow = document.createElement('span');
        arrow.className = 'hover-menu-arrow';
        arrow.textContent = '▸';
        row.append(arrow);
        row.addEventListener('pointerenter', () => this.openFlyout(row, item.children!, depth + 1));
      } else {
        row.addEventListener('pointerenter', () => this.closeFlyouts(depth + 1));
      }
      if (item.onSelect && !item.disabled) {
        row.classList.add('actionable');
        row.addEventListener('click', () => {
          if (item.onSelect!() !== false) this.close();
        });
      }
      menu.append(row);
    }
    return menu;
  }

  private openFlyout(row: HTMLElement, items: MenuItem[], depth: number): void {
    this.closeFlyouts(depth);
    if (items.length === 0) return;
    const fly = this.render(items, depth);
    fly.classList.add('hover-menu-fly');
    document.body.append(fly);
    this.flyouts[depth - 1] = fly;
    const r = row.getBoundingClientRect();
    const w = fly.offsetWidth;
    const h = fly.offsetHeight;
    let left = r.right - 2;
    if (left + w > window.innerWidth - 6) left = Math.max(6, r.left - w + 2);
    const top = Math.max(6, Math.min(r.top - 4, window.innerHeight - h - 6));
    fly.style.left = `${left}px`;
    fly.style.top = `${top}px`;
  }

  private closeFlyouts(fromDepth: number): void {
    const keep = Math.max(0, fromDepth - 1);
    for (const f of this.flyouts.splice(keep)) f.remove();
  }
}
