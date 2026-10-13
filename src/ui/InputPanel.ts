/**
 * The input panel: where a cell's code gets answers from the person, through the `input` global
 * (`input.slider(...)`, `await input.ask(...)`, `input.onKey(...)`).
 *
 * Controls (sliders, boxes, buttons ...) live in one small floating panel, grouped by the cell that made them,
 * so they never fight with how a cell draws itself. When a cell runs again its controls are removed and made
 * anew, and the value the person had set is put back. Questions (ask, confirm, choose) appear one at a time
 * as a card in the middle of the top of the page. Everything here is plain DOM with textContent only: a cell
 * can write whatever it likes into a label and it stays text.
 */

import { cellLink } from '../nav';
import { helpButton } from './help';

export type ControlKind = 'slider' | 'number' | 'text' | 'checkbox' | 'select' | 'button';

export interface ControlSpec {
  kind: ControlKind;
  value?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Called with the new value (for a button: with nothing) every time the person changes the control. */
  onChange?: (value: unknown) => void;
}

export interface ControlHandle {
  readonly value: unknown;
  set(value: unknown): void;
  remove(): void;
}

export interface Question {
  kind: 'ask' | 'confirm' | 'choose';
  text: string;
  initial?: string;
  options?: string[];
}

export interface KeyInfo {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
}

export const MAX_CONTROLS_PER_CELL = 24;
export const MAX_CONTROLS = 60;
const MAX_LABEL = 60;
const MAX_SAVED = 300;

interface Control {
  owner: string;
  label: string;
  spec: ControlSpec;
  value: unknown;
  row: HTMLElement;
  show(value: unknown): void;
}

interface Group {
  el: HTMLElement;
  controls: Set<Control>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const clip = (text: unknown, max: number): string => String(text ?? '').slice(0, max);

/** The name a key goes by in cell code: 'a', 'ArrowLeft', 'Enter', 'Space'. */
export const keyName = (key: string): string => (key === ' ' ? 'Space' : key.length === 1 ? key.toLowerCase() : key);

class InputPanel {
  private root: HTMLElement | null = null;
  private body!: HTMLElement;
  private title!: HTMLElement;
  private readonly groups = new Map<string, Group>();
  private total = 0;
  /** The last value of every control, so that a cell that runs again finds the sliders where the person left them. */
  private readonly saved = new Map<string, unknown>();

  private readonly queue: Array<() => void> = [];
  private showing = false;

  private readonly down = new Set<string>();
  private readonly keyListeners = new Set<(key: string, info: KeyInfo) => void>();
  private keysInstalled = false;

  // ---------------------------------------------------------------- controls

  /** How many controls a cell has (to refuse too many). */
  countFor(owner: string): number {
    return this.groups.get(owner)?.controls.size ?? 0;
  }

  get controlCount(): number {
    return this.total;
  }

  add(owner: string, ownerLabel: string, label: string, spec: ControlSpec): ControlHandle {
    if (this.total >= MAX_CONTROLS) throw new Error(`There are already ${MAX_CONTROLS} controls on the page. Remove some (their cells stop() or run again) before adding more.`);
    if (this.countFor(owner) >= MAX_CONTROLS_PER_CELL) throw new Error(`One cell can have at most ${MAX_CONTROLS_PER_CELL} controls.`);
    this.ensureRoot();
    const text = clip(label, MAX_LABEL) || spec.kind;
    const key = `${owner}|${spec.kind}|${text}`;
    const restored = spec.kind !== 'button' && this.saved.has(key) ? this.saved.get(key) : spec.value;
    const control: Control = { owner, label: text, spec, value: restored, row: el('div', 'input-row'), show: () => {} };
    this.build(control, key);

    let group = this.groups.get(owner);
    if (!group) {
      const box = el('div', 'input-group');
      const title = el('div', 'input-owner');
      title.append(cellLink(clip(ownerLabel, 40)));
      box.append(title);
      this.body.append(box);
      group = { el: box, controls: new Set() };
      this.groups.set(owner, group);
    }
    group.el.append(control.row);
    group.controls.add(control);
    this.total++;
    this.refresh();

    return {
      get value() {
        return control.value;
      },
      set: (value) => {
        control.value = value;
        control.show(value);
        if (spec.kind !== 'button') this.remember(key, value);
      },
      remove: () => this.remove(control),
    };
  }

  private remember(key: string, value: unknown): void {
    this.saved.delete(key);
    this.saved.set(key, value);
    while (this.saved.size > MAX_SAVED) this.saved.delete(this.saved.keys().next().value as string);
  }

  private remove(control: Control): void {
    const group = this.groups.get(control.owner);
    if (!group?.controls.delete(control)) return;
    control.row.remove();
    this.total--;
    if (!group.controls.size) {
      group.el.remove();
      this.groups.delete(control.owner);
    }
    this.refresh();
  }

  private build(control: Control, key: string): void {
    const { spec, row } = control;
    const changed = (value: unknown): void => {
      control.value = value;
      this.remember(key, value);
      spec.onChange?.(value);
    };
    if (spec.kind === 'button') {
      const button = el('button', 'input-button', control.label);
      button.onclick = () => spec.onChange?.(undefined);
      row.append(button);
      control.show = () => {};
      return;
    }
    const label = el('label', 'input-label', control.label);
    row.append(label);
    if (spec.kind === 'slider') {
      const min = Number.isFinite(spec.min) ? Number(spec.min) : 0;
      const max = Number.isFinite(spec.max) && Number(spec.max) > min ? Number(spec.max) : min + 100;
      const step = Number.isFinite(spec.step) && Number(spec.step) > 0 ? Number(spec.step) : (max - min) / 100;
      const input = el('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      const clamp = (v: unknown): number => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min));
      control.value = clamp(control.value ?? min);
      input.value = String(control.value);
      const shown = el('span', 'input-value', String(control.value));
      input.oninput = () => {
        shown.textContent = input.value;
        changed(Number(input.value));
      };
      control.show = (v) => {
        control.value = clamp(v);
        input.value = String(control.value);
        shown.textContent = String(control.value);
      };
      row.append(input, shown);
    } else if (spec.kind === 'number') {
      const input = el('input');
      input.type = 'number';
      if (Number.isFinite(spec.min)) input.min = String(spec.min);
      if (Number.isFinite(spec.max)) input.max = String(spec.max);
      if (Number.isFinite(spec.step)) input.step = String(spec.step);
      control.value = Number.isFinite(Number(control.value)) ? Number(control.value) : 0;
      input.value = String(control.value);
      input.onchange = () => {
        if (input.value.trim() === '' || !Number.isFinite(Number(input.value))) {
          input.value = String(control.value);
          return;
        }
        changed(Number(input.value));
      };
      control.show = (v) => {
        control.value = Number(v);
        input.value = String(v);
      };
      row.append(input);
    } else if (spec.kind === 'text') {
      const input = el('input');
      input.type = 'text';
      input.maxLength = 500;
      control.value = clip(control.value, 500);
      input.value = String(control.value);
      input.onchange = () => changed(input.value);
      control.show = (v) => {
        control.value = clip(v, 500);
        input.value = String(control.value);
      };
      row.append(input);
    } else if (spec.kind === 'checkbox') {
      const input = el('input');
      input.type = 'checkbox';
      control.value = control.value === true;
      input.checked = control.value as boolean;
      input.onchange = () => changed(input.checked);
      control.show = (v) => {
        control.value = v === true;
        input.checked = control.value as boolean;
      };
      row.append(input);
    } else {
      const select = el('select');
      const options = (spec.options ?? []).map((o) => clip(o, 80));
      for (const option of options) select.append(new Option(option, option));
      control.value = options.includes(String(control.value)) ? String(control.value) : (options[0] ?? '');
      select.value = String(control.value);
      select.onchange = () => changed(select.value);
      control.show = (v) => {
        control.value = options.includes(String(v)) ? String(v) : control.value;
        select.value = String(control.value);
      };
      row.append(select);
    }
  }

  private ensureRoot(): void {
    if (this.root) return;
    const root = el('div', 'input-panel');
    root.hidden = true;
    this.title = el('button', 'input-title');
    this.title.title = 'The controls that the cells of this page made. Click to fold them.';
    this.title.onclick = () => root.classList.toggle('folded');
    this.body = el('div', 'input-body');
    root.append(this.title, helpButton('inputs', 'help-icon input-help'), this.body);
    document.body.append(root);
    this.root = root;
  }

  private refresh(): void {
    if (!this.root) return;
    this.root.hidden = this.total === 0;
    this.title.textContent = `🎛 Inputs (${this.total})`;
  }

  // ---------------------------------------------------------------- questions

  /** Shows a question and resolves with the answer (null when cancelled). `cancel()` withdraws it. */
  question(q: Question): { answer: Promise<string | boolean | null>; cancel: () => void } {
    let finish: (value: string | boolean | null) => void = () => {};
    let cancelled = false;
    let open: (() => void) | null = null;
    const answer = new Promise<string | boolean | null>((resolve) => (finish = resolve));
    const run = (): void => {
      if (cancelled) {
        this.next();
        return;
      }
      this.showing = true;
      const card = el('div', 'input-card');
      card.setAttribute('role', 'dialog');
      card.append(el('div', 'input-question', clip(q.text, 300)));
      const done = (value: string | boolean | null): void => {
        card.remove();
        open = null;
        finish(value);
        this.next();
      };
      open = () => done(null);
      const buttons = el('div', 'input-buttons');
      const button = (text: string, value: () => string | boolean | null, primary = false): HTMLButtonElement => {
        const b = el('button', primary ? 'input-button primary' : 'input-button', text);
        b.onclick = () => done(value());
        return b;
      };
      let focus: HTMLElement | null = null;
      if (q.kind === 'ask') {
        const field = el('input', 'input-field');
        field.type = 'text';
        field.maxLength = 500;
        field.value = clip(q.initial, 500);
        field.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') done(field.value);
          else if (e.key === 'Escape') done(null);
        };
        card.append(field);
        buttons.append(button('OK', () => field.value, true), button('Cancel', () => null));
        focus = field;
      } else if (q.kind === 'confirm') {
        const yes = button('Yes', () => true, true);
        buttons.append(yes, button('No', () => false));
        focus = yes;
      } else {
        for (const option of (q.options ?? []).slice(0, 12)) buttons.append(button(clip(option, 60), () => clip(option, 60)));
        buttons.append(button('Cancel', () => null));
      }
      card.append(buttons);
      card.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') done(null);
      });
      document.body.append(card);
      (focus ?? card.querySelector<HTMLElement>('button'))?.focus();
    };
    const cancel = (): void => {
      cancelled = true;
      if (open) open();
      else finish(null);
    };
    if (this.queue.length >= 5) throw new Error('Too many questions are waiting for an answer. Let the person answer one before asking the next.');
    if (this.showing) this.queue.push(run);
    else run();
    return { answer, cancel };
  }

  private next(): void {
    this.showing = false;
    const run = this.queue.shift();
    if (run) run();
  }

  // ---------------------------------------------------------------- keys

  private installKeys(): void {
    if (this.keysInstalled) return;
    this.keysInstalled = true;
    const typing = (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null;
      return !!node && (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable || !!node.closest?.('.monaco-editor, .ai-side, .input-card'));
    };
    window.addEventListener('keydown', (e) => {
      if (typing(e.target)) return;
      const key = keyName(e.key);
      this.down.add(key);
      const info: KeyInfo = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, repeat: e.repeat };
      for (const listener of [...this.keyListeners]) listener(key, info);
    });
    window.addEventListener('keyup', (e) => this.down.delete(keyName(e.key)));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Hears the keys that are pressed while the person is not typing in a box or an editor. Returns the way to stop. */
  onKey(listener: (key: string, info: KeyInfo) => void): () => void {
    this.installKeys();
    this.keyListeners.add(listener);
    return () => {
      this.keyListeners.delete(listener);
    };
  }

  isDown(key: string): boolean {
    this.installKeys();
    return this.down.has(keyName(String(key)));
  }
}

export const inputPanel = new InputPanel();
