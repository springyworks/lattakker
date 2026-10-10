import { Cell } from '@maxgraph/core';
import { THEME } from '../theme';
import { CH, CW, ORIGIN_X, ORIGIN_Y, Sheet, escapeHtml } from '../sheet/Sheet';

export type Tone = 'info' | 'good' | 'bad' | 'advice' | 'think';

/** Decorative emoji are stripped so every message stays sober and readable. */
export function plain(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').replace(/^[ \t]+/gm, '').trim();
}

export interface HudSnapshot {
  turnText: string;
  turnSub: string;
  turnColor: 'red' | 'blue' | 'none';
  message: string;
  tone: Tone;
  buttons: Array<{ id: string; label: string; status: string; visible: boolean }>;
}

export const REPO_URL = 'https://github.com/springyworks/lattakker';
export const HUD_X = ORIGIN_X + 10 * CW + 24;
export const HUD_W = 7 * CW - 24;
export const HUD_Y = ORIGIN_Y;
export const HUD_H = 10 * CH;

/** Two-line label: the action in plain words, and under it a tiny line that says what state it is in. */
export function buttonHtml(label: string, status: string): string {
  return `<div class="btn-main">${escapeHtml(plain(label))}</div>${status ? `<div class="btn-sub">${escapeHtml(plain(status))}</div>` : ''}`;
}

/** Flat status line with a coloured edge. It reads as a sentence, not as something to press. */
export function turnHtml(text: string, sub: string, edge: string): string {
  return `<div class="turn-line" style="border-left-color:${edge}"><div class="turn-main">${escapeHtml(plain(text))}</div>${sub ? `<div class="turn-sub">${escapeHtml(plain(sub))}</div>` : ''}</div>`;
}

/** Heads-up display built from maxGraph vertices: message bubble, turn banner, buttons and lists. */
export class Hud {
  readonly group: Cell;
  private message: Cell;
  private turn: Cell;
  private capRed: Cell;
  private capBlue: Cell;
  private log: Cell;
  private buttons = new Map<string, Cell>();
  private buttonLabels = new Map<string, string>();
  private buttonStatuses = new Map<string, string>();
  private turnState: { text: string; sub: string; color: 'red' | 'blue' | 'none' } = { text: '', sub: '', color: 'none' };
  private updateHandlers: Array<(s: HudSnapshot) => void> = [];
  private logLines: string[] = [];
  private pulseTimer: number | null = null;
  private currentTone: Tone = 'info';
  private sayHandlers: Array<(text: string, tone: Tone) => void> = [];
  /** Most recent message shown in the bubble (read by the AI/text surface). */
  lastMessage: { text: string; tone: Tone } = { text: '', tone: 'info' };

  constructor(private sheet: Sheet) {
    const graph = sheet.graph;
    const W = HUD_W;
    const inner = W - 20;
    const half = (inner - 8) / 2;
    const third = (inner - 16) / 3;
    let created!: { group: Cell; turn: Cell; message: Cell; capRed: Cell; capBlue: Cell; log: Cell };
    graph.batchUpdate(() => {
      const group = graph.insertVertex({
        parent: sheet.uiLayer,
        id: 'hud:group',
        value: '',
        position: [HUD_X, HUD_Y],
        size: [W, HUD_H],
        style: { baseStyleNames: ['hud'], fillColor: THEME.hudFill, strokeColor: THEME.hudStroke },
      });
      const add = (id: string, value: string, x: number, y: number, w: number, h: number, style: Record<string, unknown>) =>
        graph.insertVertex({ parent: group, id, value, position: [x, y], size: [w, h], style: { baseStyleNames: ['hud'], ...style } });

      add('hud:title', `<div class="hud-text big">Lattakker Sheet</div><div class="hud-text tiny"><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">github code</a></div>`, 10, 8, inner, 40, {
        fillColor: THEME.headerFill,
        strokeColor: THEME.headerStroke,
        verticalAlign: 'middle',
        align: 'center',
      });
      const turn = add('hud:turn', '', 10, 50, inner, 52, { verticalAlign: 'middle', align: 'left', rounded: false, strokeColor: 'none', strokeWidth: 0 });
      const message = add('hud:msg', '', 10, 108, inner, 146, {});
      const btn = (id: string, label: string, status: string, x: number, y: number, w: number, fill: string) => {
        const c = graph.insertVertex({
          parent: group,
          id,
          value: buttonHtml(label, status),
          position: [x, y],
          size: [w, 44],
          style: { baseStyleNames: ['button'], fillColor: fill, strokeColor: fill },
        });
        this.buttons.set(id, c);
        this.buttonLabels.set(id, label);
        this.buttonStatuses.set(id, status);
      };
      btn('btn:shuffle', 'Shuffle my army', 'Places can still change', 10, 262, half, THEME.neutral);
      btn('btn:start', 'Start the battle', 'The battle has not started', 10 + half + 8, 262, half, THEME.go);
      btn('btn:new', 'New game', 'No move played yet', 10, 312, half, THEME.primary);
      btn('btn:undo', 'Undo my move', 'Takes back your last move', 10 + half + 8, 312, half, THEME.neutral);
      btn('btn:help', 'How to play', 'Rules are not shown', 10, 362, third, THEME.neutral);
      btn('btn:mode', 'Show code', 'Cells show their output', 10 + third + 8, 362, third, THEME.neutral);
      btn('btn:code', 'Code cell', 'You are not coding', 10 + 2 * (third + 8), 362, third, THEME.primary);

      const capRed = add('hud:capRed', '', 10, 414, half, 106, { fillColor: THEME.turnRed.fill, strokeColor: THEME.turnRed.stroke, strokeWidth: 1 });
      const capBlue = add('hud:capBlue', '', 10 + half + 8, 414, half, 106, { fillColor: THEME.turnBlue.fill, strokeColor: THEME.turnBlue.stroke, strokeWidth: 1 });
      const log = add('hud:log', '', 10, 528, inner, HUD_H - 538, { fillColor: THEME.cellFill, strokeColor: THEME.line });
      created = { group, turn, message, capRed, capBlue, log };
    });
    this.group = created.group;
    this.turn = created.turn;
    this.message = created.message;
    this.capRed = created.capRed;
    this.capBlue = created.capBlue;
    this.log = created.log;
    this.setCaptured([], []);
    this.setLog();
  }

  say(text: string, tone: Tone = 'info', small = false): void {
    this.lastMessage = { text: plain(text), tone };
    this.setButtonStatus('btn:help', small ? 'Rules are shown' : 'Rules are not shown', false);
    this.sayHandlers.forEach((h) => h(text, tone));
    const model = this.sheet.graph.getDataModel();
    this.currentTone = tone;
    model.batchUpdate(() => {
      model.setValue(this.message, `<div class="hud-text${small ? ' small' : ''}">${escapeHtml(plain(text))}</div>`);
      model.setStyle(this.message, {
        baseStyleNames: ['hud'],
        fillColor: THEME.tone[tone].fill,
        strokeColor: THEME.tone[tone].stroke,
        strokeWidth: 3,
      });
    });
    this.notify();
    if (this.pulseTimer) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null;
      model.setStyle(this.message, {
        baseStyleNames: ['hud'],
        fillColor: THEME.tone[this.currentTone].fill,
        strokeColor: THEME.tone[this.currentTone].stroke,
        strokeWidth: 1,
      });
    }, 350);
  }

  setTurn(text: string, color: 'red' | 'blue' | 'none', sub = ''): void {
    const model = this.sheet.graph.getDataModel();
    this.turnState = { text: plain(text), sub: plain(sub), color };
    const { fill, stroke } = color === 'red' ? THEME.turnRed : color === 'blue' ? THEME.turnBlue : THEME.turnNone;
    model.batchUpdate(() => {
      model.setValue(this.turn, turnHtml(text, sub, stroke));
      model.setStyle(this.turn, { baseStyleNames: ['hud'], fillColor: fill, strokeColor: 'none', strokeWidth: 0, rounded: false, verticalAlign: 'middle', align: 'left' });
    });
    this.notify();
  }

  /** Plain-data view of what the HUD shows; lets another surface (the small-screen dock) mirror it. */
  snapshot(): HudSnapshot {
    return {
      turnText: this.turnState.text,
      turnSub: this.turnState.sub,
      turnColor: this.turnState.color,
      message: this.lastMessage.text,
      tone: this.lastMessage.tone,
      buttons: [...this.buttons].map(([id, cell]) => ({ id, label: this.buttonLabels.get(id) ?? '', status: this.buttonStatuses.get(id) ?? '', visible: cell.isVisible() })),
    };
  }

  onUpdate(handler: (s: HudSnapshot) => void): void {
    this.updateHandlers.push(handler);
  }

  private notify(): void {
    if (!this.updateHandlers.length) return;
    const snap = this.snapshot();
    this.updateHandlers.forEach((h) => h(snap));
  }

  setCaptured(red: string[], blue: string[]): void {
    const model = this.sheet.graph.getDataModel();
    const fmt = (title: string, list: string[]) =>
      `<div class="hud-text small"><b>${title}</b> (${list.length})\n${list.length ? escapeHtml(plain(list.join(' · '))) : '—'}</div>`;
    model.batchUpdate(() => {
      model.setValue(this.capRed, fmt('Red lost', red));
      model.setValue(this.capBlue, fmt('Blue lost', blue));
    });
  }

  addLog(line: string): void {
    this.logLines.unshift(plain(line));
    this.logLines = this.logLines.slice(0, 3);
    this.setLog();
  }

  clearLog(): void {
    this.logLines = [];
    this.setLog();
  }

  private setLog(): void {
    const text = this.logLines.length ? this.logLines.join('\n') : 'Moves will be listed here.';
    this.sheet.graph.getDataModel().setValue(this.log, `<div class="hud-text small">${escapeHtml(text)}</div>`);
  }

  setButtonLabel(id: string, label: string, status?: string): void {
    const b = this.buttons.get(id);
    if (!b) return;
    this.buttonLabels.set(id, plain(label));
    if (status !== undefined) this.buttonStatuses.set(id, plain(status));
    this.sheet.graph.getDataModel().setValue(b, buttonHtml(label, this.buttonStatuses.get(id) ?? ''));
    this.notify();
  }

  /** The tiny line under a button's label: says what state that control is in right now. */
  setButtonStatus(id: string, status: string, notify = true): void {
    const b = this.buttons.get(id);
    if (!b || this.buttonStatuses.get(id) === status) return;
    this.buttonStatuses.set(id, status);
    this.sheet.graph.getDataModel().setValue(b, buttonHtml(this.buttonLabels.get(id) ?? '', status));
    if (notify) this.notify();
  }

  showButtons(ids: string[]): void {
    const model = this.sheet.graph.getDataModel();
    model.batchUpdate(() => {
      for (const [id, cell] of this.buttons) model.setVisible(cell, ids.includes(id));
    });
    this.notify();
  }

  /** Quick visual feedback when a button is pressed. */
  pressButton(id: string): void {
    const b = this.buttons.get(id);
    if (!b) return;
    const model = this.sheet.graph.getDataModel();
    const style = b.getStyle();
    model.setStyle(b, { ...style, strokeColor: THEME.select, strokeWidth: 4 });
    window.setTimeout(() => model.setStyle(b, style), 220);
  }

  /** Subscribe to every message shown in the bubble. */
  onSay(handler: (text: string, tone: Tone) => void): void {
    this.sayHandlers.push(handler);
  }
}
