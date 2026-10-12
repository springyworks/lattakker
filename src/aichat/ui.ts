import { workspace } from '../workspace';
import type { Conversation, Entry } from './agent';
import { destination, forgetAll, getKey, getSettings, isConfigured, setKey, updateSettings } from './config';
import { renderMarkdown } from './markdown';
import { GeminiProvider, OpenAiCompatProvider, friendly } from './providers';
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
  /** Where the person is pointing right now. */
  contextNow(): AiContext;
  onSideChange(open: boolean): void;
}

const TERMS_URL = 'https://ai.google.dev/gemini-api/terms';
const KEY_URL = 'https://aistudio.google.com/apikey';

function link(href: string, text: string): HTMLAnchorElement {
  return el('a', { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
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
  private models: string[] = [];
  private modelNote = '';

  constructor(
    private readonly convo: Conversation,
    private readonly host: UiHost,
  ) {
    document.body.append(this.side, this.mini);
    this.buildSide();
    this.buildMini();
    convo.onChange(() => this.render());
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
    const head = el('div', { className: 'ai-head' }, title, settings, clear, close);
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
    this.side.append(head, this.sideBody, sent, form);
  }

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
    const head = el('div', { className: 'ai-head' }, el('span', { className: 'ai-mini-title-wrap' }, '🤖 ', title), more, close);
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
    this.mini.append(head, this.miniLog, sent, el('div', { className: 'ai-form' }, this.miniInput, send));
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
    for (const node of [this.side, this.mini]) {
      const line = node.querySelector<HTMLElement>('[data-role=sent]');
      if (line) line.textContent = configured ? sent : '';
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
        el('div', { className: 'ai-hello' }, el('p', { textContent: 'Hi! I can look at the cell you are in and explain it, find a bug, or suggest code.' }), el('p', { textContent: 'Try: “What does this cell do?” or “Why is there an error?”' })),
      );
    }
    for (const entry of entries) log.append(this.entryNode(entry));
    if (this.convo.busy) {
      const stop = el('button', { className: 'ai-stop', textContent: 'Stop' });
      stop.onclick = () => this.convo.cancel();
      log.append(el('div', { className: 'ai-status' }, `🤖 ${this.convo.status} `, stop));
    }
    if (stick) log.scrollTop = log.scrollHeight;
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
      case 'user':
        return el('div', { className: 'ai-msg user' }, el('div', { className: 'ai-who', textContent: `You · ${entry.where}` }), el('div', { textContent: entry.text }));
      case 'ai': {
        const body = el('div', { className: 'ai-text' });
        body.append(renderMarkdown(entry.text));
        return el('div', { className: 'ai-msg bot' }, el('div', { className: 'ai-who', textContent: '🤖 Helper' }), body);
      }
      case 'note':
        return el('div', { className: 'ai-note', textContent: entry.text });
      case 'error':
        return el('div', { className: 'ai-msg error', textContent: entry.text });
      case 'proposal':
        return this.proposalNode(entry);
    }
  }

  private proposalNode(entry: Extract<Entry, { kind: 'proposal' }>): HTMLElement {
    const pre = el('pre', {}, el('code', { textContent: entry.code }));
    const card = el('div', { className: 'ai-proposal' }, el('div', { className: 'ai-who', textContent: entry.afterLine ? `💡 Code to add in ${entry.path} below line ${entry.afterLine}` : `💡 Code for ${entry.path}` }));
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
        this.models = [];
        this.modelNote = '';
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
      this.models = [];
      this.modelNote = '';
      this.render();
    };
    const done = el('button', { className: 'ai-send', textContent: 'Done' });
    done.onclick = () => this.showSettings(false);
    root.append(
      el('h3', { textContent: 'Other' }),
      el('label', { className: 'ai-row' }, remember, ' Remember the key on this computer (otherwise it is forgotten when the page closes). Code in a cell could read a remembered key, so only do this on your own computer.'),
      el('label', { className: 'ai-row' }, auto, ' When I write “// AI:”, “//ai” or “//help” in a cell, pop up the helper after ', secs, ' seconds.'),
      el('div', { className: 'ai-actions' }, done, forget),
      el('p', { className: 'ai-note', textContent: 'Microsoft Copilot cannot be used here: it has no free way to be called from a web page.' }),
    );
    this.sideBody.append(root);
  }

  private modelPicker(list: () => Promise<string[]>, current: string, set: (m: string) => void): HTMLElement {
    const input = el('input', { type: 'text', value: current, className: 'ai-wide', placeholder: 'model name' });
    input.setAttribute('list', 'ai-models');
    input.onchange = () => set(input.value.trim());
    const data = el('datalist', { id: 'ai-models' });
    for (const m of this.models) data.append(el('option', { value: m }));
    const find = el('button', { className: 'ai-stop', textContent: 'Find models' });
    const note = el('div', { className: 'ai-note', textContent: this.modelNote });
    find.onclick = () => {
      note.textContent = 'asking…';
      list().then(
        (models) => {
          this.models = models;
          this.modelNote = models.length ? `${models.length} found. Click the box and pick one.` : 'The server answered, but has no models.';
          if (models.length && !current) set(models[0]);
          this.render();
        },
        (err: unknown) => {
          this.modelNote = friendly(err);
          this.render();
        },
      );
    };
    return el('div', { className: 'ai-field' }, el('label', { textContent: 'Model' }), el('div', { className: 'ai-inline' }, input, find), data, note);
  }

  private localSettings(): HTMLElement {
    const s = getSettings();
    const url = el('input', { type: 'text', value: s.local.baseUrl, className: 'ai-wide' });
    url.onchange = () => updateSettings((x) => (x.local.baseUrl = url.value.trim()));
    const key = el('input', { type: 'password', value: getKey('local'), className: 'ai-wide', placeholder: 'usually empty', autocomplete: 'off' });
    key.onchange = () => setKey('local', key.value);
    return el(
      'div',
      { className: 'ai-group' },
      el('div', { className: 'ai-field' }, el('label', { textContent: 'Server address (OpenAI-compatible)' }), url),
      this.modelPicker(
        () => new OpenAiCompatProvider(getSettings().local.baseUrl, getSettings().local.model, getKey('local')).listModels(),
        s.local.model,
        (m) => updateSettings((x) => (x.local.model = m)),
      ),
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
          () => new GeminiProvider(getSettings().gemini.model, getKey('gemini')).listModels(),
          s.gemini.model,
          (m) => updateSettings((x) => (x.gemini.model = m || x.gemini.model)),
        ),
      );
    }
    return el('div', { className: 'ai-group' }, ...parts);
  }
}
