import { InternalEvent, InternalMouseEvent, type TooltipHandler } from '@maxgraph/core';
import { HDR_H, HDR_W, type Sheet } from '../sheet/Sheet';
import { HoverMenu, type MenuItem } from './HoverMenu';

export interface CellMenuHooks {
  /** The lines of the menu for a cell (empty or holding code). Null: this cell gets no menu icon. */
  itemsFor(address: string): MenuItem[] | null;
}

const ICON_W = 16;
const ICON_H = 18;

/**
 * A tiny ⋮ in the top-right corner of the cell (or merged block) under the pointer. Resting on it
 * opens a menu with the things you can do with that cell: edit, resize, delete, ids and so on.
 * The icon is also a handle: pressing and dragging it moves the cell like dragging the cell does,
 * which matters when a code editor covers the cell and swallows the mouse.
 */
export class CellMenu {
  private readonly icon = document.createElement('div');
  /** A strip across the top of the cell while the pointer rests on the ⋮: the first // line of its code, a title for the block. */
  private readonly subheader = document.createElement('div');
  private readonly menu: HoverMenu;
  private address: string | null = null;
  private overIcon = false;
  private hideTimer = 0;
  private badges = new Map<string, HTMLElement>();
  private showIds = false;
  private placeQueued = false;

  constructor(
    private readonly sheet: Sheet,
    private readonly hooks: CellMenuHooks,
  ) {
    this.menu = new HoverMenu(() => {
      this.syncTooltips();
      this.scheduleHide();
      if (!this.overIcon) this.hideSubheader();
    });
    this.subheader.className = 'cell-subheader';
    this.subheader.hidden = true;
    sheet.container.append(this.subheader);
    this.icon.className = 'cell-menu-icon';
    this.icon.textContent = '⋮';
    this.icon.title = 'Hover for the cell menu · drag to move this cell';
    this.icon.setAttribute('role', 'button');
    this.icon.setAttribute('aria-haspopup', 'menu');
    this.icon.hidden = true;
    sheet.container.append(this.icon);

    this.icon.addEventListener('pointerenter', () => {
      this.overIcon = true;
      this.showSubheader();
      this.syncTooltips();
      window.clearTimeout(this.hideTimer);
      if (this.address) this.menu.hoverAnchor(this.icon, () => this.items());
    });
    this.icon.addEventListener('pointerleave', () => {
      this.overIcon = false;
      if (!this.menu.isOpen) this.hideSubheader();
      this.syncTooltips();
      this.menu.leaveAnchor();
      this.scheduleHide();
    });
    // A press on the icon starts a drag, so the menu gets out of the way. The icon is not part of the
    // drawing, so the press is handed to the graph as a press on the cell underneath.
    this.icon.addEventListener('pointerdown', () => this.menu.close());
    this.icon.addEventListener('mousedown', (e) => {
      const cell = this.address ? sheet.cellAt(this.address) : undefined;
      const state = cell ? sheet.graph.getView().getState(cell) : null;
      if (e.button !== 0 || !state) return;
      sheet.graph.fireMouseEvent(InternalEvent.MOUSE_DOWN, new InternalMouseEvent(e, state));
    });

    sheet.graph.addMouseListener({
      mouseDown: () => {},
      mouseMove: (_s: unknown, me: InternalMouseEvent) => this.onMove(me),
      mouseUp: () => {},
    });
    sheet.container.addEventListener('pointerleave', () => this.scheduleHide());
    sheet.container.addEventListener('scroll', () => this.queuePlace(), { passive: true });

    const relayout = (): void => this.queuePlace();
    sheet.graph.getView().addListener(InternalEvent.SCALE, relayout);
    sheet.graph.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, relayout);
    sheet.onAfterRun(relayout);
    sheet.onModeChange(relayout);
    sheet.onCodeChanged(() => this.syncBadges());
    sheet.onRowsInserted(() => this.syncBadges());
  }

  /** Tiny ids in the corner of every cell that holds code. */
  get idsShown(): boolean {
    return this.showIds;
  }

  setIdsShown(on: boolean): void {
    this.showIds = on;
    this.syncBadges();
  }

  /** Rebuild the open menu (after a choice that should change what it says). */
  refreshMenu(): void {
    this.menu.refresh();
  }

  closeMenu(): void {
    this.menu.close();
    this.hide();
  }

  /** Called when the icon or the menu takes the pointer (other hover hints should go away). */
  onBusy: () => void = () => {};

  /** The pointer is on the ⋮ icon or a menu is open: nothing else should pop up. */
  get busy(): boolean {
    return this.overIcon || this.menu.isOpen;
  }

  /** The sheet's own cell tooltip would pile up under the icon and the menu. */
  private syncTooltips(): void {
    const tip = this.sheet.graph.getPlugin<TooltipHandler>('TooltipHandler');
    if (!tip) return;
    const on = !this.overIcon && !this.menu.isOpen;
    if (!on) this.onBusy();
    if (!on) tip.hide();
    tip.setEnabled(on);
  }

  private items(): MenuItem[] {
    return (this.address && this.hooks.itemsFor(this.address)) || [];
  }

  private onMove(me: InternalMouseEvent): void {
    const id = me.getCell()?.getId() ?? '';
    if (!id.startsWith('sheet:')) {
      if (!this.overIcon && !this.menu.isOpen) this.scheduleHide();
      return;
    }
    window.clearTimeout(this.hideTimer);
    const address = id.slice(6);
    if (address === this.address && !this.icon.hidden) return;
    if (this.menu.isOpen && this.address !== address) return;
    if (!this.hooks.itemsFor(address)) {
      this.hide();
      return;
    }
    this.address = address;
    this.place();
  }

  private scheduleHide(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.overIcon || this.menu.isOpen) return;
      this.hide();
    }, 450);
  }

  private hide(): void {
    this.address = null;
    this.icon.hidden = true;
    this.hideSubheader();
  }

  /** The first comment line of a cell's code, without the slashes ('' when the code does not start with a comment). */
  private titleOf(address: string): string {
    const line = (this.sheet.dataAt(address)?.code ?? '').split('\n').find((l) => l.trim()) ?? '';
    return line.trim().startsWith('//') ? line.trim().replace(/^\/\/+\s*/, '') : '';
  }

  /** Only a cell that shows its output has anything to add: a cell that shows its code already shows that line. */
  private showSubheader(): void {
    if (!this.address || this.sheet.mode !== 'run') return;
    const title = this.titleOf(this.address);
    const box = this.boxOf(this.address);
    if (!title || !box) return;
    const c = this.sheet.container;
    const scale = this.sheet.graph.getView().getScale();
    this.subheader.textContent = title;
    this.subheader.style.left = `${Math.round(box.x)}px`;
    this.subheader.style.top = `${Math.round(Math.max(box.y, c.scrollTop + HDR_H * scale))}px`;
    this.subheader.style.width = `${Math.round(box.width)}px`;
    this.subheader.hidden = false;
  }

  private hideSubheader(): void {
    this.subheader.hidden = true;
  }

  private queuePlace(): void {
    if (this.placeQueued) return;
    this.placeQueued = true;
    requestAnimationFrame(() => {
      this.placeQueued = false;
      if (this.address) this.place();
      this.placeBadges();
    });
  }

  private place(): void {
    const box = this.boxOf(this.address);
    if (!box) {
      this.hide();
      return;
    }
    // A big block can stick out of the window: keep the icon on the visible part of the block.
    const c = this.sheet.container;
    const scale = this.sheet.graph.getView().getScale();
    const right = Math.min(box.x + box.width, c.scrollLeft + c.clientWidth - 18) - ICON_W - 2;
    const left = Math.max(box.x + 2, c.scrollLeft + HDR_W * scale + 2);
    const bottom = box.y + box.height - ICON_H - 2;
    const top = Math.min(bottom, Math.max(box.y + 2, c.scrollTop + HDR_H * scale + 2));
    this.icon.hidden = false;
    this.icon.style.left = `${Math.round(Math.max(left, right))}px`;
    this.icon.style.top = `${Math.round(top)}px`;
    this.icon.style.height = `${ICON_H}px`;
    this.icon.style.width = `${ICON_W}px`;
  }

  /** The cell's box in the scrolling container's own pixels (what an absolutely placed child needs). */
  private boxOf(address: string | null): { x: number; y: number; width: number; height: number } | null {
    if (!address) return null;
    const cell = this.sheet.cellAt(address);
    if (!cell || !cell.isVisible()) return null;
    const state = this.sheet.graph.getView().getState(cell);
    return state ? { x: state.x, y: state.y, width: state.width, height: state.height } : null;
  }

  // ------------------------------------------------------------------ id badges

  private syncBadges(): void {
    const wanted = new Set<string>();
    if (this.showIds) for (const d of this.sheet.codeCells()) wanted.add(d.address);
    for (const [address, el] of [...this.badges]) {
      if (!wanted.has(address)) {
        el.remove();
        this.badges.delete(address);
      }
    }
    for (const address of wanted) {
      let el = this.badges.get(address);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cell-id-badge';
        this.sheet.container.append(el);
        this.badges.set(address, el);
      }
      el.textContent = this.sheet.dataAt(address)?.uid ?? '';
    }
    this.queuePlace();
  }

  private placeBadges(): void {
    for (const [address, el] of this.badges) {
      const box = this.boxOf(address);
      if (!box) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      el.style.left = `${Math.round(box.x + 2)}px`;
      el.style.top = `${Math.round(box.y + box.height - 11)}px`;
    }
  }
}
