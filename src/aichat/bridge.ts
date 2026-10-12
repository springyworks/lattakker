import type { AiContext } from './tools';

/**
 * The one door through which the rest of the app reaches the helper ("Ask the AI about this cell"), so menus
 * and editors do not need to import the chat itself. Until the chat is installed, asking does nothing.
 */

export interface AskOptions {
  /** Text to send right away (the "// AI:" line that was left in a cell). */
  question?: string;
  /** Open the side chat instead of the little pop-up. */
  side?: boolean;
  /** Where on the screen the pop-up appears; by default next to the last click. */
  at?: { x: number; y: number };
  /** Called with the answer once the helper has finished (used to write it back under a "// AI:" line). */
  done?: (reply: { ok: boolean; text: string }) => void;
}

export interface AiChatApi {
  ask(ctx: AiContext, options: AskOptions): void;
  toggleSide(): void;
  openSettings(): void;
  /** True while the side chat or the little pop-up is open or a question is being answered. */
  isBusy(): boolean;
}

let api: AiChatApi | null = null;
let last = { x: Math.round(window.innerWidth / 2), y: 100 };

// Remember the last click so a pop-up can appear where the person is looking.
for (const type of ['pointerdown', 'contextmenu'] as const) {
  window.addEventListener(type, (e) => (last = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }), true);
}

export const aiBridge = {
  register(impl: AiChatApi): void {
    api = impl;
  },
  get ready(): boolean {
    return api !== null;
  },
  ask(ctx: AiContext, options: AskOptions = {}): void {
    api?.ask(ctx, { at: last, ...options });
  },
  toggleSide(): void {
    api?.toggleSide();
  },
  openSettings(): void {
    api?.openSettings();
  },
  isBusy(): boolean {
    return api?.isBusy() ?? false;
  },
};
