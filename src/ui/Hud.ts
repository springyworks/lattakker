import { Cell } from '@maxgraph/core';
import { THEME } from '../theme';
import { CH, CW, ORIGIN_X, ORIGIN_Y, Sheet, escapeHtml } from '../sheet/Sheet';
import { colToLetters } from '../sheet/address';

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
  buttons: Array<{ id: string; label: string; status: string; help: string; address: string; fill: string; enabled: boolean }>;
}

export const REPO_URL = 'https://github.com/springyworks/lattakker';
/** The cockpit is pinned to the sheet grid: columns L to Q, rows 1 to 10, so every part has an A1-style name. */
export const HUD_COL = 11;
export const HUD_COLS = 6;
export const HUD_X = ORIGIN_X + HUD_COL * CW;
export const HUD_W = HUD_COLS * CW;
export const HUD_Y = ORIGIN_Y;
export const HUD_H = 10 * CH;
const INSET = 4;

/** Where each part sits, in whole grid cells relative to L1: [column, row, columns wide, rows high]. */
const LAYOUT: Record<string, [number, number, number, number]> = {
  'hud:title': [0, 0, 6, 1],
  'hud:turn': [0, 1, 6, 1],
  'hud:msg': [0, 2, 6, 2],
  'btn:start': [0, 4, 3, 1],
  'btn:shuffle': [3, 4, 3, 1],
  'btn:undo': [0, 5, 3, 1],
  'btn:new': [3, 5, 3, 1],
  'btn:help': [0, 6, 2, 1],
  'btn:mode': [2, 6, 2, 1],
  'btn:code': [4, 6, 2, 1],
  'hud:capRed': [0, 7, 3, 2],
  'hud:capBlue': [3, 7, 3, 2],
  'hud:log': [0, 9, 6, 1],
};

/** A1-style range of a cockpit part, for example "L5:N5". */
export function hudAddress(id: string): string {
  const l = LAYOUT[id];
  if (!l) return '';
  const [c, r, w, h] = l;
  const a = `${colToLetters(HUD_COL + c)}${r + 1}`;
  return w === 1 && h === 1 ? a : `${a}:${colToLetters(HUD_COL + c + w - 1)}${r + h}`;
}

const BUTTON_HELP: Record<string, string> = {
  'btn:start': 'Starts the battle. You move first. While the battle runs, this button pauses it.',
  'btn:shuffle': 'Mixes up your army at random, with your flag safe at the back. Only before the battle starts.',
  'btn:undo': "Takes back your last move and Blue's answer.",
  'btn:new': 'Throws this game away and starts a fresh one with new armies. Your code cells stay.',
  'btn:help': 'Shows the rules of the game in the message box.',
  'btn:mode': 'Switches the code cells between showing their TypeScript and showing what they print.',
  'btn:code': 'Opens the code editor on the cell you clicked last.',
};

const PART_HELP: Record<string, string> = {
  'hud:title': 'The name of the game. The small link opens the source code.',
  'hud:turn': 'Whose turn it is right now.',
  'hud:msg': 'The game talks to you here: hints, results and warnings.',
  'hud:capRed': 'Your pieces that Blue has captured.',
  'hud:capBlue': 'Blue pieces that you have captured.',
  'hud:log': 'The last three moves.',
};

const DISABLED = { fill: '#d5dbe1', stroke: '#b6bfc9', font: '#52606d' };

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
  private buttonHelps = new Map<string, string>();
  private buttonLooks = new Map<string, { fill: string; enabled: boolean }>();
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
    let created!: { group: Cell; turn: Cell; message: Cell; capRed: Cell; capBlue: Cell; log: Cell };
    graph.batchUpdate(() => {
      const group = graph.insertVertex({
        parent: sheet.uiLayer,
        id: 'hud:group',
        value: '',
        position: [HUD_X, HUD_Y],
        size: [HUD_W, HUD_H],
        style: { baseStyleNames: ['hud'], fillColor: THEME.hudFill, strokeColor: THEME.hudStroke },
      });
      const box = (id: string): { position: [number, number]; size: [number, number] } => {
        const [c, r, w, h] = LAYOUT[id];
        return { position: [c * CW + INSET, r * CH + INSET], size: [w * CW - 2 * INSET, h * CH - 2 * INSET] };
      };
      const add = (id: string, value: string, style: Record<string, unknown>) =>
        graph.insertVertex({ parent: group, id, value, ...box(id), style: { baseStyleNames: ['hud'], ...style } });

      add('hud:title', `<div class="hud-text big">Lattakker Sheet</div><div class="hud-text tiny"><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">github code</a></div>`, {
        fillColor: THEME.headerFill,
        strokeColor: THEME.headerStroke,
        verticalAlign: 'middle',
        align: 'center',
      });
      const turn = add('hud:turn', '', { verticalAlign: 'middle', align: 'left', rounded: false, strokeColor: 'none', strokeWidth: 0 });
      const message = add('hud:msg', '', {});
      const btn = (id: string, label: string, status: string, fill: string) => {
        const c = graph.insertVertex({
          parent: group,
          id,
          value: buttonHtml(label, status),
          ...box(id),
          style: { baseStyleNames: ['button'], fillColor: fill, strokeColor: fill },
        });
        this.buttons.set(id, c);
        this.buttonLabels.set(id, label);
        this.buttonStatuses.set(id, status);
        this.buttonHelps.set(id, BUTTON_HELP[id] ?? '');
        this.buttonLooks.set(id, { fill, enabled: true });
      };
      btn('btn:start', 'Start the battle', 'The battle has not started', THEME.go);
      btn('btn:shuffle', 'Shuffle my army', 'Places can still change', THEME.neutral);
      btn('btn:undo', 'Undo my move', 'Nothing to take back', THEME.neutral);
      btn('btn:new', 'New game', 'No move played yet', THEME.primary);
      btn('btn:help', 'How to play', 'Rules are not shown', THEME.neutral);
      btn('btn:mode', 'Show code', 'Cells show output', THEME.neutral);
      btn('btn:code', 'Code cell', 'Not coding', THEME.primary);

      const capRed = add('hud:capRed', '', { fillColor: THEME.turnRed.fill, strokeColor: THEME.turnRed.stroke, strokeWidth: 1 });
      const capBlue = add('hud:capBlue', '', { fillColor: THEME.turnBlue.fill, strokeColor: THEME.turnBlue.stroke, strokeWidth: 1 });
      const log = add('hud:log', '', { fillColor: THEME.cellFill, strokeColor: THEME.line });
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
      buttons: [...this.buttons.keys()].map((id) => ({
        id,
        label: this.buttonLabels.get(id) ?? '',
        status: this.buttonStatuses.get(id) ?? '',
        help: this.buttonHelps.get(id) ?? '',
        address: hudAddress(id),
        fill: this.buttonLooks.get(id)?.fill ?? THEME.neutral,
        enabled: this.buttonLooks.get(id)?.enabled ?? true,
      })),
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

  /** Colour and enabled look of a button. A disabled button stays on screen, greyed out, and explains itself when pressed. */
  setButtonLook(id: string, fill: string, enabled: boolean): void {
    const b = this.buttons.get(id);
    const old = this.buttonLooks.get(id);
    if (!b || (old && old.fill === fill && old.enabled === enabled)) return;
    this.buttonLooks.set(id, { fill, enabled });
    this.sheet.graph.getDataModel().setStyle(b, this.buttonStyle(id));
    this.notify();
  }

  setButtonHelp(id: string, help: string): void {
    if (this.buttonHelps.get(id) === help) return;
    this.buttonHelps.set(id, help);
    this.notify();
  }

  private buttonStyle(id: string, pressed = false): Record<string, unknown> {
    const look = this.buttonLooks.get(id) ?? { fill: THEME.neutral, enabled: true };
    const style: Record<string, unknown> = look.enabled
      ? { baseStyleNames: ['button'], fillColor: look.fill, strokeColor: look.fill }
      : { baseStyleNames: ['button'], fillColor: DISABLED.fill, strokeColor: DISABLED.stroke, fontColor: DISABLED.font };
    if (pressed) Object.assign(style, { strokeColor: THEME.select, strokeWidth: 4 });
    return style;
  }

  /** Quick visual feedback when a button is pressed. */
  pressButton(id: string): void {
    const b = this.buttons.get(id);
    if (!b) return;
    const model = this.sheet.graph.getDataModel();
    model.setStyle(b, this.buttonStyle(id, true));
    window.setTimeout(() => model.setStyle(b, this.buttonStyle(id)), 220);
  }

  /** Helper text for a cockpit part, led by its A1-style name. Returns null for ids that are not part of the cockpit. */
  tooltipFor(id: string): string | null {
    const address = hudAddress(id);
    if (!address) return null;
    if (this.buttons.has(id)) {
      const label = plain(this.buttonLabels.get(id) ?? '');
      const status = plain(this.buttonStatuses.get(id) ?? '');
      const disabled = this.buttonLooks.get(id)?.enabled === false ? ' (not available right now)' : '';
      return `${address} · ${label}${disabled}\n${this.buttonHelps.get(id) ?? ''}${status ? `\n${status}` : ''}`;
    }
    return `${address} · ${PART_HELP[id] ?? ''}`;
  }

  /** Subscribe to every message shown in the bubble. */
  onSay(handler: (text: string, tone: Tone) => void): void {
    this.sayHandlers.push(handler);
  }
}
