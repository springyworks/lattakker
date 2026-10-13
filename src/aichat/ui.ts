import { workspace } from '../workspace';
import { cellLink } from '../nav';
import { helpButton } from '../ui/help';
import { router } from '../mcp/router';
import { jobs, onJobsChange, type JobNode } from './jobs';
import { installPopupMenu } from '../editor/EditorContextMenu';
import type { Conversation, Entry } from './agent';
import { destination, forgetAll, getKey, getSettings, isConfigured, setKey, updateSettings } from './config';
import { localAssistantReady, localState, localWarning, onLocalChange } from './localAi';
import { renderMarkdown, linkify } from './markdown';
import { allNotes, exportJson, forget, importJson, isKeptSafe, keepSafe, memoryInfo, onMemoryChange, wipe } from './memory';
import { describeModel } from './modelInfo';
import { ammo, gaugeText } from './ammo';
import { diagnose } from './diagnose';
import { memoryFileState } from './memorySync';
import { GeminiProvider, OpenAiCompatProvider, friendly, type ModelProvider } from './providers';
import type { AiContext } from './tools';

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
  clearCell(path: string, code: string): { ok: boolean; error?: string };
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

/** The tiny line under the header: who answers (company, model, where it runs) and a guess how well it codes. */
function modelLine(): HTMLElement {
  const line = el('div', { className: 'ai-model' });
  line.dataset.role = 'model';
  return line;
}

export class AiChatUi {
  private readonly side = el('aside', { className: 'ai-side', hidden: true });
  private readonly sideLog = el('div', { className: 'ai-log' });
  private readonly sideBody = el('div', { className: 'ai-body' });
  private readonly sideInput = el('textarea', { className: 'ai-input', rows: 2, placeholder: 'Ask about the cell you are in… (Enter sends)' });
  private readonly sideChip = el('span', { className: 'ai-chip' });
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
    onJobsChange(() => this.convo.busy && this.render());
    onLocalChange(() => this.render());
    ammo.onChange(() => this.render());
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
    const form = el('div', { className: 'ai-form' }, this.sideInput, send);
    this.sideBody.append(this.sideLog);
    this.side.append(this.makeGrip(), head, modelLine(), this.sideBody, sent, form);
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
    this.sideChip.textContent = ctx.address ? `📍 ${workspace.pathFor(ctx.tab, ctx.address, workspace.current)}${ctx.line ? `:${ctx.line}` : ''}` : `📍 /${ctx.tab}`;
    this.sideChip.title = 'The cell your question will be about (click a cell to change it)';
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
    this.mini.append(head, modelLine(), this.miniLog, sent, el('div', { className: 'ai-form' }, this.miniInput, send));
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

  private submit(input: HTMLTextAreaElement, ctx: () => AiContext): void {
    const text = input.value.trim();
    if (!text || this.convo.busy) return;
    if (!isConfigured()) {
      this.showSettings(true);
      return;
    }
    input.value = '';
    void this.convo.ask(text, ctx());
  }

  // ------------------------------------------------------------ drawing

  private render(): void {
    const configured = isConfigured();
    const sent = `Your question and the cells the helper reads are sent to ${destination()}.`;
    const info = describeModel();
    for (const node of [this.side, this.mini]) {
      const line = node.querySelector<HTMLElement>('[data-role=sent]');
      if (line) line.textContent = configured ? sent : '';
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
    for (const input of [this.sideInput, this.miniInput]) input.disabled = busy;
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
      status.append(tree);
      log.append(status);
    }
    if (stick) log.scrollTop = log.scrollHeight;
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
    const card = el('div', { className: 'ai-proposal ai-wrote' }, el('div', { className: 'ai-who' }, entry.ok ? '🧪 The helper wrote code in ' : '⚠ The helper wrote code in ', cellLink(entry.path), entry.ok ? ' and ran it ✓' : ' but it stopped with a problem'));
    if (entry.error) {
      const problem = el('div', { className: 'ai-note' });
      linkify(problem, entry.error);
      card.append(problem);
    } else if (entry.printed) card.append(el('div', { className: 'ai-note', textContent: `It printed: ${entry.printed}` }));
    card.append(el('details', { className: 'ai-help' }, el('summary', { textContent: 'The code' }), el('pre', {}, el('code', { textContent: entry.code }))));
    if (undone) {
      card.append(el('div', { className: 'ai-note', textContent: 'Undone: the cell is empty again.' }));
      return card;
    }
    const show = el('button', { className: 'ai-send', textContent: '👀 Show me' });
    show.title = 'Fly to the cell and make it blink';
    show.onclick = () => this.host.goTo(entry.path);
    const undo = el('button', { className: 'ai-stop', textContent: '↶ Undo' });
    undo.title = 'Empty the cell again. Only the helper’s own code is removed.';
    undo.onclick = () => {
      const r = this.host.clearCell(entry.path, entry.code);
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

    const choose = (id: 'local' | 'gemini', title: string, detail: string): HTMLElement => {
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
      choose('gemini', 'Google Gemini (adults only)', 'Runs at Google. Needs your own key, and Google’s rules apply (see below).'),
    );

    if (s.provider === 'local') root.append(this.localSettings());
    else root.append(this.geminiSettings());

    const remember = el('input', { type: 'checkbox', checked: s.remember });
    remember.onchange = () => {
      updateSettings((x) => (x.remember = remember.checked));
      setKey('local', getKey('local'));
      setKey('gemini', getKey('gemini'));
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
    root.append(this.knowsPanel(), this.memorySettings());
    root.append(
      el('h3', { textContent: 'Other' }),
      el('label', { className: 'ai-row' }, writeBox, ' Let the helper write code in empty cells by itself (“Let the helper write code in empty cells”). You watch it being typed, it runs, and every card has an undo button. It never changes a cell that already has code, and it may do this at most 6 times per conversation. Off by default.'),
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
          (models) => {
            st.models = models;
            st.note = models.length ? `${models.length} models. Pick one from the list.` : 'The server answered, but has no models.';
            if (models.length && !current) set(models[0]);
            this.render();
          },
          (err: unknown) => say(friendly(err)),
        );
    };
    const choices = el('select', { className: 'ai-wide' });
    const names = st.models.includes(current) || !current ? st.models : [current, ...st.models];
    if (!names.length) choices.append(el('option', { value: '', textContent: '(press “Find models”)' }));
    for (const m of names) choices.append(el('option', { value: m, textContent: m, selected: m === current }));
    choices.onchange = () => {
      set(choices.value);
      this.render();
    };
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
    return el('div', { className: 'ai-field' }, el('label', { textContent: 'Model' }), choices, el('div', { className: 'ai-inline' }, typed), el('div', { className: 'ai-actions' }, find, test), note);
  }

  private localSettings(): HTMLElement {
    const s = getSettings();
    const url = el('input', { type: 'text', value: s.local.baseUrl, className: 'ai-wide' });
    url.onchange = () => updateSettings((x) => (x.local.baseUrl = url.value.trim()));
    const key = el('input', { type: 'password', value: getKey('local'), className: 'ai-wide', placeholder: 'usually empty', autocomplete: 'off' });
    key.onchange = () => setKey('local', key.value);
    const memory = el('select', { className: 'ai-wide' });
    for (const n of [4096, 8192, 16384, 32768]) memory.append(el('option', { value: String(n), textContent: `${n / 1024}k tokens${n === 16384 ? ' (recommended)' : n === 4096 ? ' (too small for the helper)' : ''}`, selected: s.local.context === n }));
    memory.onchange = () => updateSettings((x) => (x.local.context = Number(memory.value)));
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
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Memory of the chat (Ollama only)' }), memory, el('div', { className: 'ai-note', textContent: 'How much the model can keep in mind at once. Ollama’s own default is 4k, which is too small for the helper’s instructions and tools: they would silently fall out. More memory uses more RAM; a model that will not load may need a smaller number. The 🔋 line under the title shows what is really used.' })),
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
