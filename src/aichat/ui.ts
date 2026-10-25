import { workspace } from '../workspace';
import { cellLink } from '../nav';
import { helpButton } from '../ui/help';
import { bindPathChip } from '../ui/pathChip';
import { router } from '../mcp/router';
import { jobs, onJobsChange, type JobNode } from './jobs';
import { installPopupMenu } from '../editor/EditorContextMenu';
import type { Conversation, Entry } from './agent';
import { destination, forgetAll, getKey, getSettings, isConfigured, isPaidProvider, OLLAMA_CONTEXT_OPTIONS, patienceMs, SERVER_CONTEXT, setKey, updateSettings, WAIT_OPTIONS } from './config';
import { localAssistantReady, localState, localWarning, makeLocalProvider, onLocalChange } from './localAi';
import { renderMarkdown, linkify } from './markdown';
import { allNotes, exportJson, forget, importJson, isKeptSafe, keepSafe, memoryInfo, onMemoryChange, wipe } from './memory';
import { describeModel } from './modelInfo';
import { ammo, gaugeText, kilo } from './ammo';
import { diagnose } from './diagnose';
import { getLive, onLiveChange } from './ollamaLoad';
import { bellOn, onBellChange, primeBell, ringBell, setBell, soundSources, typewriterSounds } from './bell';
import { answerCheckpoint, checkpoints, EXTENSIONS, minutesText, onCheckpointChange } from './patience';
import { memoryFileState } from './memorySync';
import { EdenProvider, GeminiProvider, OpenAiCompatProvider, OpenRouterProvider, friendly, makeProvider, type ModelProvider } from './providers';
import { cost, costLine, costWarn, modelLabel, paidWindow, priceOf, priceText, usd } from './cost';
import type { AiContext, FixResult } from './tools';

/**
 * The helper's two faces on one shared conversation: a side chat docked on the right (like the chat of an
 * editor) and a tiny pop-up that can open anywhere, next to the cell the question is about. Plain HTML,
 * because a chat is mostly typing; everything the model writes is shown through textContent (see markdown.ts).
 */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

export interface UiHost {
  /** Types code into a cell where the person can watch (the "Type it into the cell" button). */
  typeIn(path: string, code: string, afterLine: number | null): Promise<{ ok: boolean; error?: string }>;
  /** Empties a cell the helper wrote in, if it still holds exactly that code (the undo button). */
  clearCell(path: string, code: string, before?: string | null): { ok: boolean; error?: string };
  /** Takes the person to a cell. */
  goTo(path: string): boolean;
  /** Where the person is pointing right now. */
  contextNow(): AiContext;
  onSideChange(open: boolean): void;
}

const TERMS_URL = 'https://ai.google.dev/gemini-api/terms';
const KEY_URL = 'https://aistudio.google.com/apikey';

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
const WIDTH_KEY = 'lattakker:ai:width';
/** Widths the chat likes to stop at: when the drag comes near one it sticks to it. */
const SNAPS = [DEFAULT_WIDTH, 480, 600];

const clampWidth = (px: number): number => Math.round(Math.max(MIN_WIDTH, Math.min(px, Math.max(MIN_WIDTH, window.innerWidth * 0.7))));
const snapWidth = (px: number): number => SNAPS.find((s) => Math.abs(px - s) <= 10) ?? px;

function loadWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(px: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(px));
  } catch {
    // storage blocked: the width simply lasts until the page is closed
  }
}

function link(href: string, text: string): HTMLAnchorElement {
  return el('a', { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
}

const SPELL_SYSTEM = 'You correct typing mistakes for a person who types fast. Return the given text with its spelling and obvious typos fixed. Keep the language it is written in, the meaning, the wording, the line breaks and the casual tone. The text is often a question: never answer it, never add, remove or reorder anything, never comment. Reply with the corrected text only.';

/** Models like to wrap their answer: a code fence, quotes, a "Corrected text:" lead-in. Unwrap it. */
function unwrapCorrection(raw: string): string {
  let t = raw.trim();
  const fence = /^```[a-z]*\n?([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/^(corrected( text)?|here is the corrected text)\s*:\s*/i, '');
  t = t.replace(/^"""\n?/, '').replace(/\n?"""$/, '');
  if (t.length > 1 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”')))) t = t.slice(1, -1);
  return t.trim();
}

/** The tiny line under the header: who answers (company, model, where it runs) and a guess how well it codes. */
function modelLine(): HTMLElement {
  const line = el('div', { className: 'ai-model' });
  line.dataset.role = 'model';
  return line;
}

/** The money line: always in view while OpenRouter or Eden AI is the helper (the price of the model, what was spent, what is left). */
function costNode(): HTMLElement {
  const line = el('div', { className: 'ai-cost' });
  line.dataset.role = 'cost';
  return line;
}

/** Paints every money line; cheap, so it can run on every piece of an answer. */
function paintCost(nodes: HTMLElement[]): void {
  const on = isPaidProvider(getSettings().provider);
  const who = getSettings().provider === 'eden' ? 'Eden AI' : 'OpenRouter';
  for (const node of nodes) {
    const line = node.querySelector<HTMLElement>('[data-role=cost]');
    if (!line) continue;
    line.hidden = !on;
    line.textContent = on ? costLine() : '';
    line.classList.toggle('ai-warn', on && costWarn());
    line.title = `Real money. The price of the model, what this page has spent through ${who} (the amount is the one ${who} reports for each answer, or an estimate from the model's price), and how much of your budget is left. The helper stops asking when the budget is used up. Change the budget in the settings ⚙.`;
  }
}

/** The tiny line about the local model's doings: what is known (measured, in green) apart from what is only a reading of it (maybe, in amber). */
function liveLine(): HTMLElement {
  const line = el('div', { className: 'ai-live' });
  line.dataset.role = 'live';
  return line;
}

function paintLive(into: HTMLElement): void {
  const { note, now } = getLive();
  into.textContent = '';
  into.hidden = !note.known.length && !note.maybe.length;
  if (into.hidden) return;
  const tag = now ? '' : 'last answer · ';
  into.append(el('span', { className: 'ai-live-known', textContent: `✔ ${tag}${note.known.join(' · ')}` }));
  if (note.maybe.length) into.append(el('span', { className: 'ai-live-maybe', textContent: ` ≈ maybe: ${note.maybe.join('; ')}` }));
  into.title = '✔ = a fact: measured by Ollama or by this page (a clock, a ping, Ollama\'s own list of models in memory). ≈ maybe = our reading of those facts; Ollama\'s own log is not readable from a web page, so the reason for a delay is never certain.';
}

export class AiChatUi {
  private readonly side = el('aside', { className: 'ai-side', hidden: true });
  private readonly sideLog = el('div', { className: 'ai-log' });
  private readonly sideBody = el('div', { className: 'ai-body' });
  private readonly sideInput = el('textarea', { className: 'ai-input', rows: 2, placeholder: 'Ask about the cell you are in… (Enter sends)' });
  private readonly sideChip = el('span', { className: 'ai-chip' });
  private chipText = '';
  private chipPath = '';
  private readonly mini = el('div', { className: 'ai-mini', hidden: true });
  private readonly miniLog = el('div', { className: 'ai-log' });
  private readonly miniInput = el('textarea', { className: 'ai-input', rows: 2, placeholder: 'Ask… (Enter sends)' });
  private miniCtx: AiContext = { tab: 'board', address: null };
  private settingsOpen = false;
  private pickers = new Map<string, { models: string[]; note: string }>();
  private kept = false;
  private memoryNote = '';
  private wipeArmed = false;

  constructor(
    private readonly convo: Conversation,
    private readonly host: UiHost,
  ) {
    document.body.append(this.side, this.mini);
    this.buildSide();
    this.buildMini();
    // The conversation gets the app's own right-click menu too (the question box keeps the browser's, for spelling help).
    for (const log of [this.sideLog, this.miniLog]) {
      installPopupMenu(log, () => {
        const picked = window.getSelection()?.toString() ?? '';
        const all = this.convo.entries.map((e) => ('text' in e ? e.text : '')).filter(Boolean).join('\n\n');
        return [
          { label: picked ? 'Copy selection' : 'Copy the conversation', disabled: !picked && !all, onSelect: () => void navigator.clipboard?.writeText(picked || all).catch(() => {}) },
          { label: 'New conversation', onSelect: () => this.convo.clear() },
          { label: 'Settings ⚙', onSelect: () => this.showSettings(true) },
        ];
      });
    }
    convo.onChange(() => this.render());
    convo.clickFix = (text) => this.pressFix(text);
    for (const box of [this.sideInput, this.miniInput]) box.addEventListener('focus', () => (this.activeBox = box));
    convo.fillInput = (text) => {
      const box = this.activeBox;
      if (box.value.trim()) return { ok: false, error: 'The question box already has new text in it, so it was left alone. Give the text in your answer instead.' };
      this.replaceTyped(box, text);
      return { ok: true };
    };
    onJobsChange(() => this.convo.busy && this.render());
    onLocalChange(() => this.render());
    onLiveChange(() => this.render());
    onCheckpointChange(() => this.render());
    ammo.onChange(() => this.render());
    cost.onChange(() => paintCost([this.side, this.mini]));
    onMemoryChange(() => this.settingsOpen && this.render());
    void isKeptSafe().then((v) => (this.kept = v));
    workspace.onFocusChange(() => this.paintChip());
    workspace.onCurrentChange(() => this.paintChip());
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.mini.hidden && !this.mini.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.hover-menu')) this.closeMini();
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.mini.hidden) this.closeMini();
    });
    this.render();
  }

  get sideOpen(): boolean {
    return !this.side.hidden;
  }

  // ------------------------------------------------------------ the side chat

  private buildSide(): void {
    bindPathChip(this.sideChip, () => this.chipText || '📍', () => this.chipPath || '/');
    const title = el('div', { className: 'ai-title' }, el('strong', { textContent: '🤖 AI helper' }), this.sideChip);
    const settings = el('button', { className: 'ai-icon', textContent: '⚙', title: 'Settings: choose the helper' });
    const clear = el('button', { className: 'ai-icon', textContent: '🗑', title: 'Start a new conversation' });
    const close = el('button', { className: 'ai-icon', textContent: '✕', title: 'Close (Alt+I)' });
    settings.onclick = () => this.showSettings(!this.settingsOpen);
    clear.onclick = () => this.convo.clear();
    close.onclick = () => this.closeSide();
    const head = el('div', { className: 'ai-head' }, title, helpButton('ai', 'ai-icon help-q'), settings, clear, close);
    const send = el('button', { className: 'ai-send', textContent: 'Ask' });
    send.onclick = () => this.submit(this.sideInput, () => this.host.contextNow());
    this.sideInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit(this.sideInput, () => this.host.contextNow());
      }
    });
    const sent = el('div', { className: 'ai-sent' });
    sent.dataset.role = 'sent';
    const form = el('div', { className: 'ai-form' }, this.sideInput, this.fixColumn(this.sideInput), send);
    this.sideBody.append(this.sideLog);
    this.side.append(this.makeGrip(), head, costNode(), modelLine(), liveLine(), this.sideBody, sent, form);
    this.applyWidth(loadWidth());
  }

  /** The separator between the page and the chat: drag it, or use the arrow keys; it snaps softly to a few good widths; double-click resets. */
  private makeGrip(): HTMLElement {
    const grip = el('div', { className: 'ai-grip', tabIndex: 0, title: 'Drag to change the width of the chat. Double-click: back to normal. Arrow keys also work.' });
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', 'Width of the chat');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      document.body.classList.add('ai-resizing');
      const move = (ev: PointerEvent): void => this.applyWidth(snapWidth(window.innerWidth - ev.clientX));
      const up = (): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        document.body.classList.remove('ai-resizing');
        saveWidth(this.width);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => {
      this.applyWidth(DEFAULT_WIDTH);
      saveWidth(DEFAULT_WIDTH);
    });
    grip.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 80 : 20;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home') return;
      e.preventDefault();
      this.applyWidth(e.key === 'Home' ? DEFAULT_WIDTH : this.width + (e.key === 'ArrowLeft' ? step : -step));
      saveWidth(this.width);
    });
    return grip;
  }

  private width = DEFAULT_WIDTH;

  /** Sets the width of the chat; the page gives up exactly that much (see body.ai-open in style.css), and the sheets are told their room changed. */
  private applyWidth(px: number): void {
    this.width = clampWidth(px);
    document.body.style.setProperty('--ai-w', `${this.width}px`);
    this.side.querySelector('.ai-grip')?.setAttribute('aria-valuenow', String(this.width));
    // Sheets and the editor measure their box when the window changes size.
    if (!this.resizeQueued) {
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        window.dispatchEvent(new Event('resize'));
      });
    }
  }

  private resizeQueued = false;

  openSide(focusInput = true): void {
    this.side.hidden = false;
    document.body.classList.add('ai-open');
    this.host.onSideChange(true);
    this.paintChip();
    this.render();
    if (focusInput && !this.settingsOpen) this.sideInput.focus();
  }

  /** Adds text (a reference to code) at the end of the side chat's question box and puts the cursor behind it. */
  insertText(text: string): void {
    this.openSide(false);
    const box = this.sideInput;
    const sep = box.value && !/\s$/.test(box.value) ? ' ' : '';
    box.value = `${box.value}${sep}${text} `;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }

  closeSide(): void {
    this.side.hidden = true;
    document.body.classList.remove('ai-open');
    this.host.onSideChange(false);
  }

  toggleSide(): void {
    if (this.sideOpen) this.closeSide();
    else this.openSide();
  }

  showSettings(on = true): void {
    this.settingsOpen = on;
    if (on && !this.sideOpen) this.openSide(false);
    this.closeMini();
    this.render();
  }

  private paintChip(): void {
    const ctx = this.host.contextNow();
    this.chipText = ctx.address ? `📍 ${workspace.pathFor(ctx.tab, ctx.address, workspace.current)}${ctx.line ? `:${ctx.line}` : ''}` : `📍 /${ctx.tab}`;
    this.chipPath = ctx.address ? workspace.pathOf(ctx.tab, ctx.address) : `/${ctx.tab}`;
    this.sideChip.repaint?.();
  }

  // ------------------------------------------------------------ the little pop-up

  private buildMini(): void {
    const title = el('strong', { className: 'ai-mini-title' });
    title.dataset.role = 'title';
    const more = el('button', { className: 'ai-icon', textContent: '⇥', title: 'Open in the side chat' });
    const close = el('button', { className: 'ai-icon', textContent: '✕', title: 'Close (Esc)' });
    more.onclick = () => {
      this.closeMini();
      this.openSide();
    };
    close.onclick = () => this.closeMini();
    const head = el('div', { className: 'ai-head ai-drag' }, el('span', { className: 'ai-mini-title-wrap' }, '🤖 ', title), helpButton('ai', 'ai-icon help-q'), more, close);
    head.title = 'Drag here to move this little chat';
    this.makeDraggable(head);
    this.miniInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit(this.miniInput, () => this.miniCtx);
      }
    });
    const send = el('button', { className: 'ai-send', textContent: 'Ask' });
    send.onclick = () => this.submit(this.miniInput, () => this.miniCtx);
    const sent = el('div', { className: 'ai-sent' });
    sent.dataset.role = 'sent';
    this.mini.append(head, costNode(), modelLine(), liveLine(), this.miniLog, sent, el('div', { className: 'ai-form' }, this.miniInput, this.fixColumn(this.miniInput), send));
  }

  /** The little chat can be moved: press on its header (not on a button) and drag. It stays inside the window. */
  private makeDraggable(head: HTMLElement): void {
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const box = this.mini.getBoundingClientRect();
      const dx = e.clientX - box.left;
      const dy = e.clientY - box.top;
      const move = (ev: PointerEvent): void => {
        this.mini.style.left = `${Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 80))}px`;
        this.mini.style.top = `${Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40))}px`;
      };
      const up = (): void => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
  }

  /** Opens the little chat near `anchor` (a point on screen) about `ctx`. */
  openMini(ctx: AiContext, anchor: { x: number; y: number } | null, focusInput = true): void {
    this.miniCtx = ctx;
    const label = ctx.address ? `${workspace.pathFor(ctx.tab, ctx.address, workspace.current)}${ctx.line ? ` · line ${ctx.line}` : ''}` : `/${ctx.tab}`;
    this.mini.querySelector<HTMLElement>('[data-role=title]')!.textContent = `About ${label}`;
    this.mini.hidden = false;
    this.render();
    const w = Math.min(360, window.innerWidth - 12);
    this.mini.style.width = `${w}px`;
    const x = anchor?.x ?? window.innerWidth - w - 20;
    const y = anchor?.y ?? 80;
    const sideW = this.sideOpen ? this.side.offsetWidth : 0;
    this.mini.style.left = `${Math.max(6, Math.min(x + 8, window.innerWidth - sideW - w - 6))}px`;
    this.mini.style.top = `${Math.max(6, Math.min(y + 8, window.innerHeight - this.mini.offsetHeight - 6))}px`;
    if (focusInput) this.miniInput.focus({ preventScroll: true });
  }

  closeMini(): void {
    this.mini.hidden = true;
  }

  get miniOpen(): boolean {
    return !this.mini.hidden;
  }

  // ------------------------------------------------------------ asking

  /** The fix button with the tiny loudspeaker above it: the switch of the teletype bell that rings when a slow answer arrives. */
  private fixColumn(input: HTMLTextAreaElement): HTMLElement {
    typewriterSounds(input);
    const speaker = el('button', { className: 'ai-speaker', type: 'button' });
    const paint = (): void => {
      const on = bellOn();
      speaker.textContent = on ? '🔊' : '🔇';
      speaker.setAttribute('aria-pressed', String(on));
      speaker.setAttribute('aria-label', on ? 'Teletype bell on' : 'Teletype bell muted');
      speaker.title = on ? 'The ASR-33 teletype sounds are on: the machine hums and clacks as you type, and a bell when a slow answer arrives. Click to mute.' : 'The teletype bell is muted. Click to turn it on (it rings once, softly, so you can hear how loud it is).';
    };
    // Hovering lists the cells that made sound lately and flashes them: the way to find a cell that is clacking somewhere out of sight.
    speaker.onmouseenter = () => {
      const sources = soundSources();
      paint();
      if (!sources.length) return;
      speaker.title += `\n\nCells making sound now: ${sources.map((s) => s.path).join(', ')}`;
      for (const src of sources) {
        const hit = workspace.resolve(src.path);
        if (!('error' in hit)) hit.tab.sheet.flash(hit.address);
      }
    };
    speaker.onclick = () => {
      setBell(!bellOn());
      if (bellOn()) {
        primeBell();
        void ringBell();
      }
    };
    onBellChange(paint);
    paint();
    return el('div', { className: 'ai-fixcol' }, speaker, this.spellFixButton(input));
  }

  /**
   * The "fix my spelling" button: everything typed so far goes to a model (the second brain when it answers,
   * else the main helper) and comes back with the typos fixed. Typing may go on meanwhile: the correction is
   * then spliced in front of the new keystrokes. Ctrl+Z brings the original back. Pressing it again while it
   * works stops it. The same action can be started without a mouse (see pressFix, the "click_fix_button" tool).
   */
  private spellFixButton(input: HTMLTextAreaElement): HTMLButtonElement {
    const btn = el('button', { className: 'ai-stop ai-fix', textContent: '✏ fix' });
    const idle = 'Correct the spelling of everything typed so far. Your words and language stay yours; Ctrl+Z brings the original back. The text goes to the same helper a question would go to.';
    btn.title = idle;
    let abort: AbortController | null = null;
    const run = async (given?: string): Promise<FixResult> => {
      if (abort) return { ok: false, error: 'A correction is already running in this box.' };
      if (given !== undefined) {
        if (input.value.trim() && input.value.trim() !== given.trim()) return { ok: false, error: 'The question box already has other text in it, so it was left alone.' };
        if (input.value !== given) this.replaceTyped(input, given);
      }
      const text = input.value;
      if (!text.trim()) return { ok: false, error: 'The question box is empty: there is nothing to correct.' };
      if (!isConfigured()) {
        this.showSettings(true);
        return { ok: false, error: 'No helper is set up yet.' };
      }
      // Prefer the model on this computer (private and cheap); the main helper only when there is no local one.
      const provider = (localAssistantReady() ? makeLocalProvider() : null) ?? makeProvider();
      if (!provider) {
        this.showSettings(true);
        return { ok: false, error: 'No model is available to do the correction.' };
      }
      const own = new AbortController();
      abort = own;
      // The model on this computer may be slow: the same patience as in the settings, and never less than 3 minutes. "Never ask" (0) sets no timer.
      const patient = patienceMs();
      const timer = patient ? window.setTimeout(() => own.abort(), Math.max(180000, patient)) : 0;
      btn.textContent = '…';
      btn.title = 'Correcting… press again to stop.';
      try {
        const r = await provider.complete(SPELL_SYSTEM, [{ role: 'user', text: `Correct the typing mistakes in this text and give back only the corrected text:\n"""\n${text}\n"""` }], [], own.signal);
        const fixed = unwrapCorrection(r.text);
        if (!fixed) return { ok: false, before: text, error: 'The model gave no text back; nothing was changed.' };
        const now = input.value;
        if (now === text) this.replaceTyped(input, fixed);
        else if (now.startsWith(text)) this.replaceTyped(input, fixed + now.slice(text.length));
        else return { ok: false, before: text, error: 'The box was changed while the model worked, so the correction was dropped.' };
        return { ok: true, before: text, after: fixed, changed: fixed !== text };
      } catch (err) {
        return { ok: false, before: text, error: own.signal.aborted && !(err instanceof Error && /did not answer/.test(err.message)) ? 'Stopped.' : friendly(err), stopped: own.signal.aborted };
      } finally {
        window.clearTimeout(timer);
        abort = null;
        btn.textContent = '✏ fix';
        btn.title = idle;
      }
    };
    btn.onclick = () => {
      if (abort) {
        // A second press while it works means: stop.
        abort.abort();
        return;
      }
      void run().then((r) => {
        if (!r.ok && !r.stopped && input.value.trim()) this.convo.note(`Could not correct the spelling: ${r.error}`);
      });
    };
    this.fixers.set(input, run);
    return btn;
  }

  /** The box that was used last (typed in, focused or asked from): where the helper's tools act. */
  private activeBox: HTMLTextAreaElement = this.sideInput;
  private readonly fixers = new Map<HTMLTextAreaElement, (given?: string) => Promise<FixResult>>();

  /**
   * Presses the fix button without a mouse, for the helper's tool and the MCP server. With `text` the box is
   * filled first (only when it is empty); without, whatever is typed in the box is corrected.
   */
  pressFix(text?: string): Promise<FixResult> {
    const run = this.fixers.get(this.activeBox);
    return run ? run(text) : Promise.resolve({ ok: false, error: 'There is no question box.' });
  }

  /** Puts the corrected text into the box through the browser's own editing, so Ctrl+Z still knows the original. */
  private replaceTyped(input: HTMLTextAreaElement, text: string): void {
    input.focus();
    input.select();
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok || input.value !== text) {
      input.value = text;
      input.setSelectionRange(text.length, text.length);
    }
  }

  private submit(input: HTMLTextAreaElement, ctx: () => AiContext): void {
    const text = input.value.trim();
    if (!text || this.convo.busy) return;
    if (!isConfigured()) {
      this.showSettings(true);
      return;
    }
    this.activeBox = input;
    primeBell();
    input.value = '';
    // Pressing the Ask button takes the cursor away from the box; give it back.
    input.focus();
    void this.convo.ask(text, ctx());
  }

  // ------------------------------------------------------------ drawing

  private render(): void {
    const configured = isConfigured();
    const sent = `Your question and the cells the helper reads are sent to ${destination()}.`;
    const info = describeModel();
    paintCost([this.side, this.mini]);
    if (getSettings().provider === 'openrouter' && getKey('openrouter')) void cost.refreshKey(getKey('openrouter'));
    for (const node of [this.side, this.mini]) {
      const line = node.querySelector<HTMLElement>('[data-role=sent]');
      if (line) line.textContent = configured ? sent : '';
      const live = node.querySelector<HTMLElement>('[data-role=live]');
      if (live) paintLive(live);
      const model = node.querySelector<HTMLElement>('[data-role=model]');
      if (model) {
        const warning = localWarning();
        const gauge = gaugeText();
        const full = ammo.fullness();
        model.textContent = configured ? `${info.line}${localAssistantReady() ? ` · 🧠 second brain: ${localState.model}` : ''}${gauge ? ` · ${gauge}` : ''}${warning ? ` · ${warning}` : ''}` : '';
        model.classList.toggle('ai-warn', configured && (!!warning || (full !== null && full >= 0.85)));
        model.title = 'Who answers, and how well it probably writes code (a guess from the model\'s name). The 🔋 number is measured by the server: how much of the model\'s memory the last question used. When it is nearly full, old answers are shortened.';
      }
    }
    const busy = this.convo.busy;
    // The boxes stay enabled while the helper answers, so the cursor stays where it is and you can already type the next question (Enter waits until the answer is there).
    for (const input of [this.sideInput, this.miniInput]) input.classList.toggle('busy', busy);
    this.side.classList.toggle('settings', this.settingsOpen);
    if (this.settingsOpen) {
      this.sideLog.hidden = true;
      this.renderSettings();
    } else {
      this.sideBody.querySelector('.ai-settings')?.remove();
      this.sideLog.hidden = false;
      this.fill(this.sideLog, this.convo.entries, true);
    }
    // The pop-up shows only the latest exchange, so it stays small.
    const lastUser = this.convo.entries.map((e) => e.kind).lastIndexOf('user');
    this.fill(this.miniLog, lastUser >= 0 ? this.convo.entries.slice(lastUser) : [], false);
  }

  private fill(log: HTMLElement, entries: Entry[], welcome: boolean): void {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.textContent = '';
    if (!isConfigured()) log.append(this.setupCard());
    else if (welcome && !entries.length) {
      log.append(
        el('div', { className: 'ai-hello' }, el('p', { textContent: 'Hi! I can look at the cell you are in and explain it, find a bug, or suggest code.' }), el('p', { textContent: 'Try: “What does this cell do?” or “Why is there an error?”' }), this.knowsPanel()),
      );
    }
    for (const entry of entries) log.append(this.entryNode(entry));
    if (this.convo.busy) {
      const stop = el('button', { className: 'ai-stop', textContent: 'Stop' });
      stop.onclick = () => this.convo.cancel();
      const ask = el('button', { className: 'ai-stop', textContent: '🔎 Status' });
      ask.title = 'Ask the status service (an MCP server, like the others) what is going on right now';
      ask.onclick = () => void this.askStatus();
      const tree = el('div', { className: 'ai-progress' });
      this.drawJobs(tree, jobs.tree(), 0);
      const status = el('div', { className: 'ai-status' }, '🤖 working… ', stop, ' ', ask);
      const why = diagnose(jobs.tree());
      if (why) {
        status.append(el('div', { className: `ai-why ${why.level}`, textContent: `${why.level === 'stuck' ? '⚠' : '⏳'} ${why.line}` }));
        if (why.hint) status.append(el('div', { className: 'ai-why-hint', textContent: `💡 ${why.hint}` }));
        status.append(el('div', { className: 'ai-why-chain', textContent: `Where: ${why.chain}` }));
      }
      const { note, now } = getLive();
      if (now) {
        status.append(el('div', { className: 'ai-live-known', textContent: `✔ Known: ${note.known.join(' · ')}` }));
        if (note.maybe.length) status.append(el('div', { className: 'ai-live-maybe', textContent: `≈ Maybe (a reading, not a fact): ${note.maybe.join('; ')}` }));
      }
      status.append(...this.checkpointNodes());
      status.append(tree);
      log.append(status);
    } else log.append(...this.checkpointNodes());
    if (stick) log.scrollTop = log.scrollHeight;
  }

  /** The model has been silent for as long as the settings allow: ask whether to keep waiting. Unanswered, the request is stopped by itself. */
  private checkpointNodes(): HTMLElement[] {
    return checkpoints().map((c) => {
      const left = Math.max(0, Math.round((c.until - performance.now()) / 1000));
      const buttons = el('div', { className: 'ai-actions' });
      for (const m of EXTENSIONS) {
        const b = el('button', { className: 'ai-send', textContent: `Wait ${minutesText(m)} more` });
        b.onclick = () => answerCheckpoint(c.id, m);
        buttons.append(b);
      }
      const stop = el('button', { className: 'ai-stop', textContent: 'Stop' });
      stop.onclick = () => answerCheckpoint(c.id, 0);
      buttons.append(stop);
      const facts = c.facts();
      return el(
        'div',
        { className: 'ai-patience' },
        el('div', { className: 'ai-why slow', textContent: `⏳ ${c.model} has been silent for ${minutesText(Math.max(1, Math.round(c.silentSeconds() / 60)))}. It may still be working (a big model on a small computer is slow). Keep waiting?` }),
        ...(facts.length ? [el('div', { className: 'ai-why-hint', textContent: facts.join(' · ') })] : []),
        buttons,
        el('div', { className: 'ai-why-chain', textContent: `No answer within ${Math.ceil(left / 60)} min (${left} s) and the request is stopped. Change how long it waits in ⚙.` }),
      );
    });
  }

  /** The jobs as a tree, one line each: what it does, what it waits for, how long ago it last showed a sign of life. */
  private drawJobs(into: HTMLElement, nodes: JobNode[], depth: number): void {
    const icon: Record<string, string> = { waiting: '⏳', running: '⚙️', done: '✓', failed: '✗', cancelled: '■' };
    for (const n of nodes) {
      const open = n.state === 'waiting' || n.state === 'running';
      const quiet = !open ? '' : n.stalled ? ` ⚠ nothing heard for ${n.quietSeconds} s: it may be stuck` : n.quietSeconds >= 3 ? ` · last sign of life ${n.quietSeconds} s ago` : '';
      const line = el('div', { className: `ai-job${n.stalled ? ' stalled' : ''}${open ? '' : ' finished'}`, textContent: `${'\u00a0\u00a0'.repeat(depth)}${depth ? '└ ' : ''}${icon[n.state]} ${n.service}: ${n.title}${n.detail ? ` — ${n.detail}` : ''} [${n.ageSeconds.toFixed(0)} s]${quiet}` });
      into.append(line);
      this.drawJobs(into, n.children, depth + 1);
    }
  }

  /** "What is going on?": asked of the status service over the router, the way anyone else would ask. */
  private async askStatus(): Promise<void> {
    try {
      const answer = (await router.request('you', 'status', 'tools/call', { name: 'jobs', arguments: {} })) as { structuredContent?: { text?: string } };
      this.convo.note(`Status:\n${answer.structuredContent?.text ?? 'no answer'}`);
    } catch (err) {
      this.convo.note(`The status service did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setupCard(): HTMLElement {
    const open = el('button', { className: 'ai-send', textContent: 'Set up a helper ⚙' });
    open.onclick = () => this.showSettings(true);
    return el(
      'div',
      { className: 'ai-hello' },
      el('p', { textContent: 'No helper is set up yet, so nothing is sent anywhere.' }),
      el('p', { textContent: 'A grown-up can choose one: a model on this computer (private), or Google Gemini (for adults).' }),
      open,
    );
  }

  private entryNode(entry: Entry): HTMLElement {
    switch (entry.kind) {
      case 'user': {
        const said = el('div');
        linkify(said, entry.text);
        return el('div', { className: 'ai-msg user' }, el('div', { className: 'ai-who' }, 'You · ', entry.path ? cellLink(entry.path, entry.where) : entry.where), said);
      }
      case 'ai': {
        const body = el('div', { className: 'ai-text' });
        body.append(renderMarkdown(entry.text));
        return el('div', { className: 'ai-msg bot' }, el('div', { className: 'ai-who', textContent: '🤖 Helper' }), body, el('div', { className: 'ai-via', textContent: `via ${entry.via}` }));
      }
      case 'note': {
        const note = el('div', { className: 'ai-note' });
        linkify(note, entry.text);
        return note;
      }
      case 'error': {
        const error = el('div', { className: 'ai-msg error' });
        linkify(error, entry.text);
        return error;
      }
      case 'proposal':
        return this.proposalNode(entry);
      case 'wrote':
        return this.wroteNode(entry);
    }
  }

  /** The card for code the helper wrote by itself: where, how it ran, and a way to look at it or take it back. */
  private wroteNode(entry: Extract<Entry, { kind: 'wrote' }>): HTMLElement {
    const undone = entry.state === 'undone';
    const marked = entry.mistakes ?? [];
    const good = entry.ok && !marked.length;
    const card = el('div', { className: 'ai-proposal ai-wrote' }, el('div', { className: 'ai-who' }, good ? '🧪 The helper wrote code in ' : '⚠ The helper wrote code in ', cellLink(entry.path), good ? ' and ran it ✓' : entry.ok ? ` and ran it, but the editor marks ${marked.length} mistake${marked.length === 1 ? '' : 's'}` : ' but it stopped with a problem'));
    if (marked.length) card.append(el('div', { className: 'ai-note', textContent: `Editor: ${marked.slice(0, 3).join(' · ')}${marked.length > 3 ? ' …' : ''}` }));
    if (entry.error) {
      const problem = el('div', { className: 'ai-note' });
      linkify(problem, entry.error);
      card.append(problem);
    } else if (entry.printed) card.append(el('div', { className: 'ai-note', textContent: `It printed: ${entry.printed}` }));
    card.append(el('details', { className: 'ai-help' }, el('summary', { textContent: 'The code' }), el('pre', {}, el('code', { textContent: entry.code }))));
    if (undone) {
      card.append(el('div', { className: 'ai-note', textContent: entry.before != null ? 'Undone: the cell is as it was before.' : 'Undone: the cell is empty again.' }));
      return card;
    }
    const show = el('button', { className: 'ai-send', textContent: '👀 Show me' });
    show.title = 'Fly to the cell and make it blink';
    show.onclick = () => this.host.goTo(entry.path);
    const undo = el('button', { className: 'ai-stop', textContent: '↶ Undo' });
    undo.title = entry.before != null ? 'Give the cell back as it was before the helper added to it.' : 'Empty the cell again. Only the helper’s own code is removed.';
    undo.onclick = () => {
      const r = this.host.clearCell(entry.path, entry.code, entry.before);
      if (r.ok) entry.state = 'undone';
      else this.convo.note(`Could not undo: ${r.error ?? 'unknown problem'}`);
      this.render();
    };
    card.append(el('div', { className: 'ai-actions' }, show, undo));
    return card;
  }

  private proposalNode(entry: Extract<Entry, { kind: 'proposal' }>): HTMLElement {
    const pre = el('pre', {}, el('code', { textContent: entry.code }));
    const card = el('div', { className: 'ai-proposal' }, el('div', { className: 'ai-who' }, entry.afterLine ? '💡 Code to add in ' : '💡 Code for ', cellLink(entry.path), entry.afterLine ? ` below line ${entry.afterLine}` : ''));
    if (entry.note) card.append(el('div', { className: 'ai-note', textContent: entry.note }));
    card.append(pre);
    if (entry.state === 'open') {
      const type = el('button', { className: 'ai-send', textContent: entry.afterLine ? `✍ Add it below line ${entry.afterLine}` : `✍ Type it into ${entry.path}` });
      type.title = entry.afterLine ? 'The code is added right below that line of the cell. You can undo it with Ctrl+Z.' : 'The code is typed slowly into the cell, so you can watch. You decide whether to keep it.';
      type.onclick = () => {
        entry.state = 'typed';
        this.closeMini();
        void this.host.typeIn(entry.path, entry.code, entry.afterLine).then((r) => {
          if (!r.ok) this.convo.note(`Could not type it: ${r.error ?? 'unknown problem'}`);
          else this.render();
        });
        this.render();
      };
      const copy = el('button', { className: 'ai-stop', textContent: 'Copy' });
      copy.onclick = () => void navigator.clipboard?.writeText(entry.code).catch(() => {});
      const skip = el('button', { className: 'ai-stop', textContent: 'No thanks' });
      skip.onclick = () => {
        entry.state = 'dismissed';
        this.render();
      };
      card.append(el('div', { className: 'ai-actions' }, type, copy, skip));
    } else {
      card.append(el('div', { className: 'ai-note', textContent: entry.state === 'typed' ? 'Done ✓ (press Esc or Restart & close in the cell editor to keep it)' : 'Skipped.' }));
    }
    return card;
  }

  // ------------------------------------------------------------ settings

  private renderSettings(): void {
    this.sideBody.querySelector('.ai-settings')?.remove();
    const s = getSettings();
    const root = el('div', { className: 'ai-settings' });

    const choose = (id: 'local' | 'gemini' | 'openrouter' | 'eden', title: string, detail: string): HTMLElement => {
      const radio = el('input', { type: 'radio', name: 'ai-provider', checked: s.provider === id });
      radio.onchange = () => {
        updateSettings((x) => (x.provider = id));
        this.pickers.clear();
        this.render();
      };
      return el('label', { className: 'ai-choice' }, radio, el('span', {}, el('strong', { textContent: title }), el('br'), detail));
    };
    root.append(
      el('h3', { textContent: 'Choose the helper' }),
      choose('local', 'A model on this computer (recommended)', 'Ollama or LM Studio. Private and free: nothing leaves this computer. Best for children.'),
      choose('openrouter', 'OpenRouter (adults only, costs money)', 'Hundreds of models with one key, paid per token. The real cost and your budget are always shown at the top of the chat.'),
      choose('eden', 'Eden AI, France (adults only, costs money)', 'Hundreds of models with one key, paid per token, from a French company. It picks the cheapest working provider for the model you name. The real cost and your budget are always shown at the top of the chat.'),
      choose('gemini', 'Google Gemini (adults only)', 'Runs at Google. Needs your own key, and Google’s rules apply (see below).'),
    );

    if (s.provider === 'local') root.append(this.localSettings());
    else if (s.provider === 'openrouter' || s.provider === 'eden') root.append(this.paidSettings(s.provider));
    else root.append(this.geminiSettings());

    const remember = el('input', { type: 'checkbox', checked: s.remember });
    remember.onchange = () => {
      updateSettings((x) => (x.remember = remember.checked));
      setKey('local', getKey('local'));
      setKey('gemini', getKey('gemini'));
      setKey('openrouter', getKey('openrouter'));
      setKey('eden', getKey('eden'));
    };
    const auto = el('input', { type: 'checkbox', checked: s.autoPopup });
    auto.onchange = () => updateSettings((x) => (x.autoPopup = auto.checked));
    const secs = el('input', { type: 'number', min: '3', max: '600', value: String(s.autoSeconds), className: 'ai-num' });
    secs.onchange = () => updateSettings((x) => (x.autoSeconds = Number(secs.value)));
    const forget = el('button', { className: 'ai-stop', textContent: 'Forget all helper settings and keys' });
    forget.onclick = () => {
      forgetAll();
      this.pickers.clear();
      this.render();
    };
    const done = el('button', { className: 'ai-send', textContent: 'Done' });
    done.onclick = () => this.showSettings(false);
    const outside = el('input', { type: 'checkbox', checked: s.allowOutside });
    outside.onchange = () => updateSettings((x) => (x.allowOutside = outside.checked));
    const weatherBox = el('input', { type: 'checkbox', checked: s.allowWeather });
    weatherBox.onchange = () => updateSettings((x) => (x.allowWeather = weatherBox.checked));
    const writeBox = el('input', { type: 'checkbox', checked: s.allowWrite });
    writeBox.onchange = () => updateSettings((x) => (x.allowWrite = writeBox.checked));
    const autoBox = el('input', { type: 'checkbox', checked: s.autonomous });
    autoBox.onchange = () => updateSettings((x) => (x.autonomous = autoBox.checked));
    root.append(this.knowsPanel(), this.memorySettings());
    root.append(
      el('h3', { textContent: 'Other' }),
      el('label', { className: 'ai-row' }, autoBox, ' Let the helper work on its own (on by default): it writes or adds code, lets the code editor check it for mistakes, runs it, reads what came out and keeps fixing until it works (up to 12 writes per conversation). It also adds code below a cell that already has code, and every card has an undo button that gives the cell back as it was. It never replaces code that is not its own.'),
      el('label', { className: 'ai-row' }, writeBox, ' Only let the helper write code in empty cells (it does not carry on by itself, at most 6 writes). This matters only when the option above is off.'),
      el('label', { className: 'ai-row' }, weatherBox, ' Let cells and the helper look up the weather (weather.now(...), the MCP server “weather”). A lookup sends the place name to open-meteo.com, nothing else.'),
      el('label', { className: 'ai-row' }, outside, ' Let an outside AI (one connected over MCP, see the README) put questions to this helper. It then uses your helper, so with Gemini it uses your key and quota. Off by default.'),
      el('label', { className: 'ai-row' }, remember, ' Remember the key on this computer (otherwise it is forgotten when the page closes). Code in a cell could read a remembered key, so only do this on your own computer.'),
      el('label', { className: 'ai-row' }, auto, ' When I write “// AI:”, “//ai” or “//help” in a cell, pop up the helper after ', secs, ' seconds.'),
      el('div', { className: 'ai-actions' }, done, forget),
      el('p', { className: 'ai-note', textContent: 'Microsoft Copilot cannot be used here: it has no free way to be called from a web page.' }),
    );
    this.sideBody.append(root);
  }

  /** What an AI learns about you and the page when it starts, and what it keeps: in this chat, this browser, elsewhere. */
  private knowsPanel(): HTMLElement {
    const info = memoryInfo();
    const item = (title: string, text: string): HTMLElement => el('li', {}, el('strong', { textContent: title }), ` ${text}`);
    return el(
      'details',
      { className: 'ai-help' },
      el('summary', { textContent: 'What the helper knows and remembers' }),
      el(
        'ul',
        {},
        item('The first time:', 'it knows nothing about you or your sheet. It gets the app’s fixed instructions, your question, which cell you asked from (and the text you selected), and how many notes its memory holds. Everything else it must look up with its tools: the cells it reads, the guide, the board.'),
        item('Where that goes:', `all of it is sent to ${isConfigured() ? destination() : 'the model you choose'}. A model on this computer keeps it here; an online one (Gemini) works under its company’s rules. Weather lookups (cells or helper) send only the place name to open-meteo.com; they can be switched off below.`),
        item('This conversation:', 'the last messages are re-sent with each question so it can follow along. They are forgotten when the page is reloaded or you start a new conversation (🗑).'),
        item('Its memory:', `${info.count} notes and ${info.records} database records, kept in this browser (IndexedDB). They survive a reload and a restart. The helper only sees a note when it looks it up.`),
        item('One memory on this computer:', memoryFileState.file ? `while the dev server runs, every page of it (whatever the port) shares one memory, kept in the file ${memoryFileState.file}. A note forgotten in one page is gone in the others. The command line or an AI in the editor can read the same file.` : 'the published page keeps its memory in this browser only. The dev server (npm run dev) keeps one shared memory in a file instead.'),
        item('Without the dev server:', `the memory stays in this browser: another browser, another computer, a private window, or the same app opened from another address (for example localhost instead of ${location.host}) starts with an empty memory. Move it with “Back up to a file” and “Load a backup”.`),
        item('Nothing in the cloud:', 'this app has no server of its own that stores your notes, chats or keys. Sharing a session with someone sends code and pointers straight to their browser, never the memory.'),
      ),
    );
  }

  /** A list of the models the server offers (the whole list, always), a box for typing a name, and a button that really asks the model one tiny thing. */
  /** The helper's memory: how much it holds, a backup to a file, and a way to look through and clean it. */
  private memorySettings(): HTMLElement {
    const info = memoryInfo();
    const root = el('div', { className: 'ai-group' }, el('h3', { textContent: 'Memory of the helper' }));
    root.append(
      el('p', { className: 'ai-note', textContent: `${info.count} notes (${Math.round(info.chars / 100) / 10} thousand characters), ${info.records} database records in ${info.collections} collections. ${info.durable ? 'Kept in this browser, so they survive a reload. If the browser clears its storage they are gone: make a backup.' : 'This browser gives no storage here: notes last only until the page closes.'}${this.kept ? ' The browser promised to keep this storage.' : ''}` }),
    );
    const save = el('button', { className: 'ai-stop', textContent: '💾 Back up to a file' });
    save.onclick = () => void this.backup();
    const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.onchange = () =>
      void file.files?.[0]?.text().then(async (t) => {
        const r = await importJson(t);
        this.memoryNote = r.ok ? `Loaded the backup: ${r.added} notes added or updated.` : (r.error ?? 'could not read it');
        this.render();
      });
    const load = el('button', { className: 'ai-stop', textContent: '📂 Load a backup' });
    load.onclick = () => file.click();
    const safe = el('button', { className: 'ai-stop', textContent: '🛡 Ask the browser to keep it', disabled: this.kept });
    safe.title = 'Asks the browser not to clear this storage when the disk is nearly full. It may say no.';
    safe.onclick = () =>
      void keepSafe().then((v) => {
        this.kept = v;
        this.memoryNote = v ? 'The browser will keep the storage.' : 'The browser did not promise (it decides itself). Make backups.';
        this.render();
      });
    const clear = el('button', { className: 'ai-stop', textContent: this.wipeArmed ? 'Click again: forget everything' : '🗑 Forget all notes', disabled: info.count === 0 });
    clear.onclick = () => {
      if (!this.wipeArmed) {
        this.wipeArmed = true;
        window.setTimeout(() => ((this.wipeArmed = false), this.settingsOpen && this.render()), 4000);
        this.render();
        return;
      }
      this.wipeArmed = false;
      void wipe();
    };
    root.append(el('div', { className: 'ai-actions' }, save, load, safe, clear), file);
    if (this.memoryNote) root.append(el('div', { className: 'ai-note', textContent: this.memoryNote }));
    const list = el('details', { className: 'ai-help' }, el('summary', { textContent: 'Look through the notes' }));
    for (const n of allNotes().slice(0, 100)) {
      const drop = el('button', { className: 'ai-icon', textContent: '✕', title: 'Forget this note' });
      drop.onclick = () => void forget(n.id);
      list.append(el('div', { className: 'ai-note' }, drop, el('strong', { textContent: n.title }), ` — ${n.text.slice(0, 140)}`, el('span', { className: 'ai-via', textContent: ` · ${n.source}${n.tags.length ? ' · ' + n.tags.join(', ') : ''}` })));
    }
    if (!info.count) list.append(el('div', { className: 'ai-note', textContent: 'No notes yet. The helper writes them when it learns something lasting.' }));
    root.append(list);
    return root;
  }

  /** Saves the memory as a file: a "Save as" window when the browser has one, else an ordinary download. */
  private async backup(): Promise<void> {
    const text = exportJson();
    const name = `lattakker-memory-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      const pick = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
      if (pick) {
        const handle = await pick({ suggestedName: name, types: [{ description: 'Memory backup', accept: { 'application/json': ['.json'] } }] });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
      } else {
        const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
        a.click();
        URL.revokeObjectURL(a.href);
      }
      this.memoryNote = `Saved ${name}.`;
    } catch (err) {
      this.memoryNote = err instanceof DOMException && err.name === 'AbortError' ? 'Cancelled.' : `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.render();
  }

  private modelPicker(slot: string, make: () => ModelProvider, current: string, set: (m: string) => void, auto = true): HTMLElement {
    const st = this.pickers.get(slot) ?? { models: [] as string[], note: '' };
    this.pickers.set(slot, st);
    const note = el('div', { className: 'ai-note', textContent: st.note });
    const say = (text: string): void => {
      st.note = text;
      note.textContent = text;
    };
    const load = (): void => {
      say('asking for the list of models…');
      const provider = make();
      provider.onNote = say;
      provider
        .listModels()
        .then(
          async (models) => {
            st.models = models;
            st.note = models.length ? `${models.length} models. Pick one from the list.` : 'The server answered, but has no models.';
            // Without a choice, take the model the server already holds in memory: any other one makes it load (minutes) and push that one out.
            if (models.length && !current && !(provider instanceof OpenRouterProvider || provider instanceof EdenProvider)) set((await provider.loadedModels?.())?.find((m) => models.includes(m)) ?? models[0]);
            this.render();
          },
          (err: unknown) => say(friendly(err)),
        );
    };
    const choices = el('select', { className: 'ai-wide' });
    const names = st.models.includes(current) || !current ? st.models : [current, ...st.models];
    const fillChoices = (needle: string): void => {
      choices.textContent = '';
      const shown = names.filter((m) => m === current || !needle || modelLabel(m).toLowerCase().includes(needle) || (needle === 'free' && priceOf(m) && !priceOf(m)!.prompt && !priceOf(m)!.completion));
      if (!shown.length) choices.append(el('option', { value: '', textContent: names.length ? '(no model matches the filter)' : '(press “Find models”)' }));
      for (const m of shown) choices.append(el('option', { value: m, textContent: modelLabel(m), selected: m === current }));
    };
    fillChoices('');
    choices.onchange = () => {
      set(choices.value);
      this.render();
    };
    const filter = el('input', { type: 'text', className: 'ai-wide', placeholder: 'filter the list (for example: claude, qwen, free)' });
    filter.oninput = () => fillChoices(filter.value.trim().toLowerCase());
    filter.hidden = names.length < 12;
    const typed = el('input', { type: 'text', value: current, className: 'ai-wide', placeholder: 'or type a model name' });
    typed.onchange = () => {
      set(typed.value.trim());
      this.render();
    };
    const find = el('button', { className: 'ai-stop', textContent: 'Find models' });
    find.onclick = load;
    const test = el('button', { className: 'ai-stop', textContent: 'Test this model' });
    test.title = 'Sends one tiny question to the model and shows exactly what came back';
    test.onclick = () => {
      const started = performance.now();
      say(`asking ${current || 'the model'}… (the answer to “Say OK.”)`);
      const provider = make();
      provider.onNote = say;
      provider
        .complete('Answer with one short word.', [{ role: 'user', text: 'Say OK.' }], [], new AbortController().signal)
        .then(
          (r) => say(`✓ ${current} answered in ${((performance.now() - started) / 1000).toFixed(1)} s: “${r.text.trim().slice(0, 40)}”`),
          (err: unknown) => say(`✗ ${friendly(err)}`),
        );
    };
    // The list is fetched by itself the first time, when there is a key (or no key is needed).
    if (auto && !st.models.length && !st.note) window.setTimeout(() => !st.models.length && !st.note && load(), 0);
    const table = slot === 'openrouter' || slot === 'eden' ? this.modelTable(names, current, (m) => { set(m); this.render(); }) : null;
    return el('div', { className: 'ai-field' }, el('label', { textContent: 'Model' }), ...(table ? [table] : [filter, choices]), el('div', { className: 'ai-inline' }, typed), el('div', { className: 'ai-actions' }, find, test), note);
  }

  private keyRejected = false;
  private tableSort: { key: 'name' | 'in' | 'out' | 'context'; dir: 1 | -1 } = { key: 'in', dir: 1 };
  private tableKind: 'all' | 'free' | 'paid' = 'all';
  private tableFilter = '';

  /** The models as a table with a header: click a column to sort by it (again to reverse), narrow by free or paid and by text. */
  private modelTable(names: string[], current: string, pick: (m: string) => void): HTMLElement {
    const isFree = (m: string): boolean => {
      const p = priceOf(m);
      return !!p && !p.prompt && !p.completion;
    };
    const wrap = el('div', { className: 'ai-models' });
    const count = el('span', { className: 'ai-note' });
    const head = el('div', { className: 'ai-models-head' });
    const body = el('div', { className: 'ai-models-body' });
    const columns: Array<['name' | 'in' | 'out' | 'context', string, string]> = [
      ['name', 'Model', 'Sort alphabetically'],
      ['in', 'In $/M', 'Price per million tokens you send: sort by it'],
      ['out', 'Out $/M', 'Price per million tokens the model writes: sort by it'],
      ['context', 'Context', 'How many tokens the model can hold: sort by it'],
    ];
    const valueOf = (m: string, key: 'name' | 'in' | 'out' | 'context'): string | number => {
      const p = priceOf(m);
      return key === 'name' ? m : key === 'in' ? (p?.prompt ?? Infinity) : key === 'out' ? (p?.completion ?? Infinity) : (p?.context ?? 0);
    };
    const num = (n: number): string => (n === Infinity ? '?' : n === 0 ? 'free' : n < 0.1 ? n.toFixed(3) : n.toFixed(2));
    const paintBody = (): void => {
      const needle = this.tableFilter.trim().toLowerCase();
      const shown = names
        .filter((m) => (this.tableKind === 'all' || (this.tableKind === 'free') === isFree(m)) && (!needle || m.toLowerCase().includes(needle)))
        .sort((a, b) => {
          const x = valueOf(a, this.tableSort.key);
          const y = valueOf(b, this.tableSort.key);
          const c = typeof x === 'string' ? x.localeCompare(y as string) : x === y ? 0 : x < (y as number) ? -1 : 1;
          return c * this.tableSort.dir || a.localeCompare(b);
        });
      count.textContent = `${shown.length} of ${names.length} models`;
      body.textContent = '';
      for (const m of shown) {
        const p = priceOf(m);
        const row = el('div', { className: `ai-models-row${m === current ? ' picked' : ''}`, title: m });
        row.append(el('span', { className: 'c-name', textContent: m }), el('span', { className: 'c-num', textContent: num(p?.prompt ?? Infinity) }), el('span', { className: 'c-num', textContent: num(p?.completion ?? Infinity) }), el('span', { className: 'c-num', textContent: p?.context ? kilo(p.context) : '?' }));
        row.onclick = () => pick(m);
        body.append(row);
      }
      if (!shown.length) body.append(el('div', { className: 'ai-note', textContent: names.length ? 'No model matches.' : 'Press “Find models”.' }));
    };
    const paintHead = (): void => {
      head.textContent = '';
      for (const [key, label, tip] of columns) {
        const on = this.tableSort.key === key;
        const cell = el('button', { className: `${key === 'name' ? 'c-name' : 'c-num'}${on ? ' on' : ''}`, textContent: `${label}${on ? (this.tableSort.dir === 1 ? ' ▲' : ' ▼') : ''}`, title: tip });
        cell.onclick = () => {
          this.tableSort = on ? { key, dir: this.tableSort.dir === 1 ? -1 : 1 } : { key, dir: key === 'context' ? -1 : 1 };
          paintHead();
          paintBody();
        };
        head.append(cell);
      }
    };
    const kind = el('select', {});
    for (const [v, t] of [['all', 'Free and paid'], ['free', 'Free only'], ['paid', 'Paid only']] as const) kind.append(el('option', { value: v, textContent: t, selected: this.tableKind === v }));
    kind.onchange = () => {
      this.tableKind = kind.value as 'all' | 'free' | 'paid';
      paintBody();
    };
    const filter = el('input', { type: 'text', value: this.tableFilter, placeholder: 'filter by name (claude, qwen, …)', className: 'ai-wide' });
    filter.oninput = () => {
      this.tableFilter = filter.value;
      paintBody();
    };
    paintHead();
    paintBody();
    wrap.append(el('div', { className: 'ai-models-bar' }, filter, kind), count, head, body);
    return wrap;
  }

  private localSettings(): HTMLElement {
    const s = getSettings();
    const url = el('input', { type: 'text', value: s.local.baseUrl, className: 'ai-wide' });
    url.onchange = () => updateSettings((x) => (x.local.baseUrl = url.value.trim()));
    const key = el('input', { type: 'password', value: getKey('local'), className: 'ai-wide', placeholder: 'usually empty', autocomplete: 'off' });
    key.onchange = () => setKey('local', key.value);
    const memory = el('select', { className: 'ai-wide' });
    for (const n of OLLAMA_CONTEXT_OPTIONS) memory.append(el('option', { value: String(n), textContent: n === SERVER_CONTEXT ? 'As the server runs it (recommended: never reloads the model)' : `${n / 1024}k tokens${n >= 131072 ? ' (high RAM use)' : n === 4096 ? ' (too small for the helper)' : ''}`, selected: s.local.context === n }));
    memory.onchange = () => updateSettings((x) => (x.local.context = Number(memory.value)));
    const patience = el('select', { className: 'ai-wide' });
    for (const n of WAIT_OPTIONS) patience.append(el('option', { value: String(n), textContent: n === 0 ? 'Never ask (only the Stop button ends the wait)' : `${minutesText(n)} of silence`, selected: s.local.waitMinutes === n }));
    patience.onchange = () => updateSettings((x) => (x.local.waitMinutes = Number(patience.value)));
    return el(
      'div',
      { className: 'ai-group' },
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Server address (OpenAI-compatible)' }), url),
      this.modelPicker(
        'local',
        () => new OpenAiCompatProvider(getSettings().local.baseUrl, getSettings().local.model, getKey('local'), getSettings().local.context),
        s.local.model,
        (m) => updateSettings((x) => (x.local.model = m)),
      ),
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Memory of the chat (Ollama only)' }), memory, el('div', { className: 'ai-note', textContent: 'Context is measured in tokens, not kilobytes. "As the server runs it" sends no size, so Ollama keeps using the instance (and the remembered conversation) it already has: connecting or disconnecting this page never reloads the model. Set the size once in the Ollama service (OLLAMA_CONTEXT_LENGTH). A size chosen here that differs from the one in memory makes Ollama start a new instance. Weights plus the context cache and runtime all need memory: even 48 GB RAM does not guarantee 256k will fit; try 32k or 64k if loading fails or the computer swaps. The 🔋 line shows token use, not RAM use; check ollama ps and your system monitor too.' })),
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Ask me whether to keep waiting after' }), patience, el('div', { className: 'ai-note', textContent: 'A big model on a small computer can take many minutes before the first word, and a question may take longer still. The page never gives up by itself while words keep coming. When the model has been silent this long it asks you: wait 10, 30 or 60 minutes more, or stop. If nobody answers within 3 minutes (you walked away) the request is stopped. The status lines show what the page can know (is the server alive, is the model in memory, how much of it runs on the GPU). Ollama\'s own log is deeper: start it with OLLAMA_DEBUG=1 and follow it (journalctl -u ollama -f).' })),
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Key (only if your server wants one)' }), key),
      el(
        'details',
        { className: 'ai-help' },
        el('summary', { textContent: 'How do I get a model on my computer?' }),
        el('ol', {}, el('li', {}, 'Install Ollama (ollama.com) or LM Studio.'), el('li', { textContent: 'Get a small model that can use tools, for example: ollama pull qwen2.5-coder:7b' }), el('li', { textContent: `Let this page talk to it. Ollama: set OLLAMA_ORIGINS=${location.origin} and start “ollama serve”.` }), el('li', { textContent: 'Press “Find models” here and pick one.' })),
        el('p', { textContent: 'On the live page (https) your browser may ask whether this site may reach devices on your own network: allow it.' }),
      ),
    );
  }

  private paidSettings(id: 'openrouter' | 'eden'): HTMLElement {
    const s = getSettings();
    const eden = id === 'eden';
    const name = eden ? 'Eden AI' : 'OpenRouter';
    const slot = s[id];
    const key = el('input', { type: 'password', value: getKey(id), className: 'ai-wide', placeholder: eden ? 'paste your Eden AI API key' : 'paste your OpenRouter API key (sk-or-…)', autocomplete: 'off' });
    key.onchange = () => {
      setKey(id, key.value);
      this.keyRejected = !!key.value.trim() && !getKey(id);
      void cost.refreshKey(getKey(id), true);
      this.pickers.clear();
      this.render();
    };
    const budget = el('input', { type: 'number', min: '0.01', step: '0.5', value: String(slot.budgetUsd), className: 'ai-num' });
    budget.onchange = () => {
      updateSettings((x) => (x[id].budgetUsd = Number(budget.value)));
      paintCost([this.side, this.mini]);
    };
    const reset = el('button', { className: 'ai-stop', textContent: 'Reset the counter' });
    reset.title = 'Start counting the spent money from zero again (' + name + ' itself keeps its own record at ' + (eden ? 'app.edenai.run' : 'openrouter.ai/activity') + ')';
    reset.onclick = () => {
      cost.reset();
      this.render();
    };
    const chosen = priceOf(slot.model);
    const memory = el('select', { className: 'ai-wide' });
    const held = chosen?.context || 0;
    const sizes: Array<[number, string]> = [[0, 'Automatic (what the model holds, at most 64k: keeps chats cheap)'], [32768, '32k tokens'], [65536, '64k tokens'], [131072, '128k tokens'], [200000, '200k tokens'], [262144, '256k tokens'], [524288, '512k tokens'], [1000000, '1M tokens (expensive)']];
    for (const [n, label] of sizes) {
      if (n > 0 && held && n > held) continue;
      memory.append(el('option', { value: String(n), textContent: label, selected: slot.context === n }));
    }
    memory.onchange = () => {
      updateSettings((x) => (x[id].context = Number(memory.value)));
      ammo.setWindow(paidWindow(getSettings()[id].model, getSettings()[id].context));
    };
    const parts: HTMLElement[] = [
      el(
        'div',
        { className: 'ai-terms' },
        el('strong', { textContent: `Before you use ${name}, please know:` }),
        el(
          'ul',
          {},
          el('li', { textContent: 'It costs real money, per token, at the price shown next to each model. Longer chats and a helper that works on its own cost more. The cost of every answer is added up and shown at the top of the chat.' }),
          el('li', { textContent: 'Your question and the cells the helper reads go to ' + name + ' and to the company that runs the model. Never send names, addresses or other personal information, and not to children.' }),
          el('li', {}, `Your key stays in this page (it is sent only to ${name}). Get one at `, eden ? link('https://app.edenai.run', 'app.edenai.run') : link('https://openrouter.ai/keys', 'openrouter.ai/keys'), ' and set a spending limit on the key there too.'),
          ...(eden ? [el('li', { textContent: 'The balance of your Eden AI account is not shown here (their API does not give it): look at app.edenai.run. This page counts what it has spent from the price of each model.' })] : []),
        ),
      ),
      el('div', { className: 'ai-field' }, el('label', { textContent: `${name} API key` }), key, ...(this.keyRejected ? [el('div', { className: 'ai-note ai-warn', textContent: eden ? 'That does not look like an Eden AI key, so it was not kept. A key is one long word (copy it from app.edenai.run).' : 'That is not an OpenRouter key, so it was not kept. A key is one word that starts with sk-or- (copy it from openrouter.ai/keys).' })] : [])),
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Budget in dollars: the helper stops asking when this much has been spent' }), budget, el('div', { className: 'ai-note', textContent: `Spent so far: ${usd(cost.spent)} (${usd(cost.session)} since this page was opened). ${usd(cost.left)} left.` }), el('div', { className: 'ai-actions' }, reset)),
    ];
    if (getKey(id)) {
      parts.push(
        this.modelPicker(
          id,
          () => (eden ? new EdenProvider(getSettings().eden.model, getKey(id)) : new OpenRouterProvider(getSettings().openrouter.model, getKey(id))),
          slot.model,
          (m) => updateSettings((x) => (x[id].model = m)),
          true,
        ),
        el('div', { className: 'ai-note', textContent: slot.model ? `${slot.model}: ${priceText(chosen)}${chosen?.context ? `; the model can hold ${Math.round(chosen.context / 1000)}k tokens` : ''}. Click a column header to sort (price in, price out, context, name); the list shows only models that can use tools.${eden ? ' A model named without a provider is routed by Eden AI to the cheapest working provider; add :latency, :speed or :exact to the name to optimise for that instead, or type provider/model (for example openai/gpt-latest) to pin one.' : ''}` : 'Choose a model. Click a column header to sort by price, context or name; the list shows only models that can use tools.' }),
      );
      parts.push(el('div', { className: 'ai-field' }, el('label', { textContent: 'Memory of the chat (how much of the conversation is sent with every question)' }), memory, el('div', { className: 'ai-note', textContent: name + ' has no memory setting of its own: a model simply holds what its maker built it for (the Context column). This choice is the page\'s own limit on how much of the conversation it keeps and sends. You pay for every token sent, with every question, so a bigger memory makes each answer cost more. Automatic keeps it at 64k at most.' })));
      void cost.refreshKey(getKey(id));
    }
    return el('div', { className: 'ai-group' }, ...parts);
  }

  private geminiSettings(): HTMLElement {
    const s = getSettings();
    const ack = el('input', { type: 'checkbox', checked: s.gemini.adultAck });
    ack.onchange = () => {
      updateSettings((x) => (x.gemini.adultAck = ack.checked));
      this.render();
    };
    const key = el('input', { type: 'password', value: getKey('gemini'), className: 'ai-wide', placeholder: 'paste your Gemini API key', autocomplete: 'off' });
    key.onchange = () => {
      setKey('gemini', key.value);
      this.pickers.clear();
      this.render();
    };
    const terms = el(
      'div',
      { className: 'ai-terms' },
      el('strong', { textContent: 'Before you use Google Gemini, please read:' }),
      el(
        'ul',
        {},
        el('li', { textContent: 'Google requires users of its API to be 18 or older, and says it must not be used in an app that is directed to, or likely to be used by, people under 18. If a child may use this page, choose the model on this computer instead.' }),
        el('li', { textContent: 'On the free tier, Google may use what you send to improve its products, and people may read it. Never send names, addresses or other personal information.' }),
        el('li', { textContent: 'In the EEA, Switzerland and the UK, Google requires its paid service when an app is made available to others.' }),
        el('li', {}, 'Your key stays in this page (it is sent only to Google). Get one at ', link(KEY_URL, 'aistudio.google.com/apikey'), '; the rules are at ', link(TERMS_URL, 'ai.google.dev/gemini-api/terms'), '.'),
      ),
      el('label', { className: 'ai-row' }, ack, ' I am 18 or older, I am the one using this, and I have read the above.'),
    );
    const parts: HTMLElement[] = [terms];
    if (s.gemini.adultAck) {
      parts.push(
        el('div', { className: 'ai-field' }, el('label', { textContent: 'Gemini API key' }), key),
        this.modelPicker(
          'gemini',
          () => new GeminiProvider(getSettings().gemini.model, getKey('gemini')),
          s.gemini.model,
          (m) => updateSettings((x) => (x.gemini.model = m || x.gemini.model)),
          !!getKey('gemini'),
        ),
      );
    }
    // A second brain: the local model that keeps the memory and the database, and that Gemini may consult and teach.
    const status = localState.ok ? `✓ ready: ${localState.model}. Gemini can consult it and teach it.` : `not answering${localState.error ? `: ${localState.error}` : ' (no model chosen yet)'}.`;
    parts.push(
      el(
        'details',
        { className: 'ai-help', open: !!s.local.model },
        el('summary', { textContent: '🧠 Second brain: a model on this computer (optional)' }),
        el('p', { className: 'ai-note', textContent: 'If one is set up and answering, Gemini gets tools to ask it questions and to hand it knowledge to store. It keeps the memory and the little database. Free, private, runs on your computer.' }),
        this.localSettings(),
        el('div', { className: 'ai-note', textContent: `Second brain ${status}` }),
      ),
    );
    return el('div', { className: 'ai-group' }, ...parts);
  }
}
