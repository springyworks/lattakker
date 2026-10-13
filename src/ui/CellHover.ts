import { InternalEvent, type InternalMouseEvent } from '@maxgraph/core';
import type { Sheet } from '../sheet/Sheet';
import { cellHints } from './hints';

const LABEL_DELAY_MS = 1000;
const HINT_DELAY_MS = 600;
const HINT_GRACE_MS = 280;
const FADE_MS = 6000;
const TRAIL = 5;

interface Tag {
  address: string;
  el: HTMLDivElement;
  timer: number;
}

/**
 * What a hovered cell tells you, in two quiet ways:
 *  - its address, small, in the top-left corner of the cell, after resting on it for a second. When the pointer leaves it
 *    fades out slowly, so the last five cells you touched stay readable for a moment;
 *  - a short yellow hint under the cell ("double-click to write TypeScript") with a box to switch such hints off.
 */
export class CellHover {
  private current: string | null = null;
  private readonly tags: Tag[] = [];
  private labelTimer = 0;
  private hintTimer = 0;
  private hideTimer = 0;
  private hint: HTMLDivElement | null = null;
  private hintFor: string | null = null;

  /** `blocked` says when something else owns the pointer (a menu is open), so no hint is shown. */
  constructor(
    private readonly sheet: Sheet,
    private readonly blocked: () => boolean,
  ) {
    sheet.externalCellHints = true;
    const { graph, container } = sheet;
    graph.addMouseListener({
      mouseDown: () => {
        this.leave();
        this.hideHint(true);
      },
      mouseMove: (_s: unknown, me: InternalMouseEvent) => {
        const id = me.getCell()?.getId() ?? '';
        const address = id.startsWith('sheet:') ? id.slice(6) : null;
        if (address !== this.current) this.move(address);
      },
      mouseUp: () => {},
    });
    container.addEventListener('pointerleave', () => this.move(null));
    container.addEventListener('scroll', () => this.hideHint(true), { passive: true });
    const reposition = (): void => this.tags.forEach((t) => this.place(t));
    graph.getView().addListener(InternalEvent.SCALE, reposition);
    graph.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, reposition);
    cellHints.onChange((on) => {
      if (!on) this.hideHint(true);
    });
  }

  private move(address: string | null): void {
    this.leave();
    this.current = address;
    if (address === null) {
      this.scheduleHideHint();
      return;
    }
    window.clearTimeout(this.hideTimer);
    const trail = this.tags.find((t) => t.address === address);
    if (trail) this.makeLive(trail);
    else this.labelTimer = window.setTimeout(() => this.showLabel(address), LABEL_DELAY_MS);
    if (this.hintFor !== address) this.hideHint(true);
    if (this.hintFor !== address && cellHints.enabled && !this.blocked()) this.hintTimer = window.setTimeout(() => this.showHint(address), HINT_DELAY_MS);
  }

  /** The pointer left the cell it was on: its tag starts to fade. */
  private leave(): void {
    window.clearTimeout(this.labelTimer);
    window.clearTimeout(this.hintTimer);
    const was = this.current;
    this.current = null;
    const tag = was ? this.tags.find((t) => t.address === was) : undefined;
    if (!tag) return;
    tag.el.classList.remove('live');
    tag.el.classList.add('fading');
    window.clearTimeout(tag.timer);
    tag.timer = window.setTimeout(() => this.drop(tag), FADE_MS + 400);
  }

  private makeLive(tag: Tag): void {
    window.clearTimeout(tag.timer);
    tag.el.classList.remove('fading');
    tag.el.classList.add('live');
    this.place(tag);
    // The most recently touched one goes to the end of the list.
    this.tags.splice(this.tags.indexOf(tag), 1);
    this.tags.push(tag);
  }

  private drop(tag: Tag): void {
    window.clearTimeout(tag.timer);
    tag.el.remove();
    const at = this.tags.indexOf(tag);
    if (at >= 0) this.tags.splice(at, 1);
  }

  private rectOf(address: string): { x: number; y: number; width: number; height: number } | null {
    const cell = this.sheet.cells.get(address);
    const state = cell ? this.sheet.graph.getView().getState(cell) : null;
    return state ? { x: state.x, y: state.y, width: state.width, height: state.height } : null;
  }

  private place(tag: Tag): void {
    const r = this.rectOf(tag.address);
    tag.el.hidden = !r;
    if (!r) return;
    tag.el.style.left = `${Math.round(r.x) + 3}px`;
    tag.el.style.top = `${Math.round(r.y) + 3}px`;
  }

  private showLabel(address: string): void {
    if (this.current !== address || !this.rectOf(address)) return;
    const el = document.createElement('div');
    el.className = 'cell-address-tag';
    el.textContent = address;
    el.setAttribute('aria-hidden', 'true');
    this.sheet.container.append(el);
    const tag: Tag = { address, el, timer: 0 };
    this.tags.push(tag);
    this.place(tag);
    while (this.tags.length > TRAIL) this.drop(this.tags[0]);
    requestAnimationFrame(() => el.classList.add('live'));
  }

  // ------------------------------------------------------------------ the yellow hint

  private showHint(address: string): void {
    if (this.current !== address || !cellHints.enabled || this.blocked()) return;
    const r = this.rectOf(address);
    if (!r) return;
    this.hideHint(true);
    const d = this.sheet.dataAt(address);
    const box = document.createElement('div');
    box.className = 'cell-hint';
    const text = document.createElement('div');
    text.textContent = d?.code.trim() ? 'Code cell · double-click to edit' : 'Empty · double-click to write TypeScript here';
    const off = document.createElement('label');
    off.className = 'cell-hint-off';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.addEventListener('change', () => {
      if (!check.checked) return;
      window.setTimeout(() => {
        cellHints.set(false);
        this.hideHint(true);
      }, 220);
    });
    off.append(check, ' Do not show these hints');
    box.append(text, off);
    box.addEventListener('pointerenter', () => window.clearTimeout(this.hideTimer));
    box.addEventListener('pointerleave', () => this.scheduleHideHint());
    document.body.append(box);
    const origin = this.sheet.container.getBoundingClientRect();
    const left = origin.left + r.x - this.sheet.container.scrollLeft;
    const bottom = origin.top + r.y + r.height - this.sheet.container.scrollTop;
    // Right under the cell, touching it, so the pointer can walk onto the box.
    box.style.left = `${Math.max(6, Math.min(left + 6, window.innerWidth - box.offsetWidth - 6))}px`;
    const below = bottom - 6;
    box.style.top = `${below + box.offsetHeight > window.innerHeight - 6 ? origin.top + r.y - this.sheet.container.scrollTop - box.offsetHeight + 6 : below}px`;
    this.hint = box;
    this.hintFor = address;
  }

  /** Hides the hint at once (a menu opened, a drag began). */
  dismiss(): void {
    window.clearTimeout(this.hintTimer);
    this.hideHint(true);
  }

  private scheduleHideHint(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hideHint(false), HINT_GRACE_MS);
  }

  private hideHint(now: boolean): void {
    window.clearTimeout(this.hideTimer);
    if (!now && this.current !== null) return;
    this.hint?.remove();
    this.hint = null;
    this.hintFor = null;
  }
}
