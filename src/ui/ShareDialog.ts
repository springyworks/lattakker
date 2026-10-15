import { RtcLink } from '../share/link';
import { ShareSession, type SessionHooks } from '../share/session';
import { workspace } from '../workspace';
import type { TabStrip } from './TabStrip';
import { pauseSaving } from '../storage';
import { buildLink, type ViewLink } from '../deeplink';
import { currentViewLink } from '../viewLink';

/**
 * The 🤝 Share window: the one place where text has to be typed and pasted, so it is plain HTML. It walks a
 * learner and a tutor through connecting two browsers directly (see share/link.ts), shows who is connected
 * and what they may do, and has a tiny chat. The strip (drawn by maxGraph) shows the state at a glance.
 */

type Step = 'start' | 'host' | 'guest' | 'connected';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

export class ShareDialog {
  private readonly dialog = el('dialog', { className: 'share-dialog' });
  private readonly toasts = el('div', { className: 'share-toasts' });
  private step: Step = 'start';
  private session: ShareSession | null = null;
  private link: RtcLink | null = null;
  private invitation = '';
  private busy = '';
  private error = '';
  private name = 'Friend';
  private allowEdits = false;
  private useStun = false;
  private viewOptions = { place: true, cell: true, ai: true };

  constructor(private readonly strip: TabStrip) {
    document.body.append(this.dialog, this.toasts);
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    strip.onShare = () => this.open();
    workspace.onRemoteChange((r) => strip.setRemote(r ? `🧑 ${workspace.pathOf(r.tab, r.address, r.tile)}` : null));
    this.paintStrip();
  }

  open(): void {
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  toast(text: string): void {
    const t = el('div', { className: 'share-toast', textContent: text });
    this.toasts.append(t);
    window.setTimeout(() => t.remove(), 7000);
  }

  private hooks(): SessionHooks {
    return { toast: (t) => this.toast(t), pauseSaving };
  }

  // ------------------------------------------------------------ the session

  private attach(session: ShareSession): void {
    this.session = session;
    session.onChange(() => {
      if (!session.info.open && this.session === session) {
        const wasGuest = session.info.role === 'guest' && session.info.peerName !== '';
        this.session = null;
        this.link = null;
        this.step = 'start';
        if (wasGuest) {
          this.toast('Back to your own sheets in a moment…');
          window.setTimeout(() => location.reload(), 2500);
        }
      } else if (session.info.open && session.info.peerName && this.step !== 'connected') {
        this.step = 'connected';
      }
      this.paintStrip();
      if (this.dialog.open) this.render();
    });
    this.paintStrip();
  }

  private paintStrip(): void {
    const s = this.session;
    if (!s || !s.info.open || !s.info.peerName) {
      this.strip.setShare(s ? '🤝 waiting…' : '🤝 Share', false);
      return;
    }
    this.strip.setShare(`🤝 ${s.info.peerName} ${s.info.canEdit ? '✏️' : '👁'}`, true);
  }

  private async createInvitation(): Promise<void> {
    await this.guarded('Creating the invitation…', async () => {
      const { code, link } = await RtcLink.invite(this.useStun);
      this.link = link;
      this.invitation = code;
      this.attach(new ShareSession(workspace, link, 'host', this.name, this.hooks(), this.allowEdits));
    });
  }

  private async acceptReply(reply: string): Promise<void> {
    await this.guarded('Connecting…', async () => {
      await this.link!.acceptReply(reply);
    });
  }

  private async createReply(invitation: string): Promise<void> {
    await this.guarded('Creating the reply…', async () => {
      const { code, link } = await RtcLink.join(invitation, this.useStun);
      this.link = link;
      this.invitation = code;
      this.attach(new ShareSession(workspace, link, 'guest', this.name, this.hooks()));
    });
  }

  private async guarded(message: string, work: () => Promise<void>): Promise<void> {
    this.busy = message;
    this.error = '';
    this.render();
    try {
      await work();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.busy = '';
    this.render();
  }

  private stop(): void {
    this.session?.stop();
    this.link?.close();
    this.session = null;
    this.link = null;
    this.invitation = '';
    this.step = 'start';
    this.paintStrip();
    this.render();
  }

  // ------------------------------------------------------------ the window

  private render(): void {
    const d = this.dialog;
    d.textContent = '';
    const close = el('button', { type: 'button', className: 'share-x', textContent: '✕', title: 'Close' });
    close.addEventListener('click', () => d.close());
    d.append(el('div', { className: 'share-head' }, el('h2', { textContent: '🤝 Work together' }), close));
    if (this.busy) d.append(el('p', { className: 'share-busy', textContent: this.busy }));
    if (this.error) d.append(el('p', { className: 'share-error', textContent: '⚠ ' + this.error }));
    d.append(this.viewLinkBlock());

    const live = this.session && this.session.info.open && this.session.info.peerName;
    if (live) return this.renderConnected(this.session!);
    if (this.step === 'host') return this.renderHost();
    if (this.step === 'guest') return this.renderGuest();
    this.renderStart();
  }

  /**
   * "A link to what I see": the public page, opened on the same tab, at the same place, with the same cell pointed at and the AI chat open if it is.
   * Only the place travels. A friend sees their own cells (the examples, the Lab and the Monitor are the same for everybody).
   */
  private viewLinkBlock(): HTMLElement {
    const now = currentViewLink();
    const link = (base?: string): string => {
      const l: ViewLink = { tab: now.tab };
      if (this.viewOptions.place) {
        l.view = now.view;
        l.mode = now.mode;
      }
      if (this.viewOptions.cell) l.cell = now.cell;
      if (this.viewOptions.ai) l.ai = now.ai;
      return base ? buildLink(l, base) : buildLink(l);
    };
    const choice = (label: string, key: keyof typeof this.viewOptions, show: boolean): HTMLElement | null => {
      if (!show) return null;
      const box = el('input', { type: 'checkbox', checked: this.viewOptions[key] });
      box.addEventListener('change', () => {
        this.viewOptions[key] = box.checked;
        refresh();
      });
      return el('label', { className: 'share-check' }, box, el('span', {}, ' ' + label));
    };
    const area = el('textarea', { readOnly: true, rows: 3, className: 'share-code' });
    area.addEventListener('focus', () => area.select());
    const says = el('p', { className: 'share-note' });
    const copy = el('button', { type: 'button', className: 'share-btn', textContent: '📋 Copy the link' });
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(area.value).then(() => (copy.textContent = 'Copied ✓'));
      area.select();
    });
    const tryIt = el('button', { type: 'button', className: 'share-btn', textContent: '↗ Try it here', title: 'Opens the same view on this computer, in a new tab, to see what your friend will see' });
    tryIt.addEventListener('click', () => window.open(link(location.origin + location.pathname), '_blank', 'noopener'));
    const buttons = el('div', { className: 'share-row' }, copy, tryIt);
    if (typeof navigator.share === 'function') {
      const native = el('button', { type: 'button', className: 'share-btn', textContent: '📤 Share…' });
      native.addEventListener('click', () => void navigator.share({ title: 'Lattakker', url: area.value }).catch(() => {}));
      buttons.append(native);
    }
    const refresh = (): void => {
      area.value = link();
      copy.textContent = '📋 Copy the link';
      const parts = [`the ${now.tab === 'board' ? 'game board' : now.tab} tab`];
      if (this.viewOptions.place && now.view) parts.push(`zoom ${Math.round(now.view.scale * 100)}% at this place${now.mode === 'view' ? ', showing the code' : ''}`);
      if (this.viewOptions.cell && now.cell) parts.push(`the cell ${now.cell}`);
      if (this.viewOptions.ai && now.ai) parts.push('the AI chat open');
      says.textContent = `It opens ${parts.join(', ')}.`;
    };
    refresh();
    return el(
      'div',
      { className: 'share-block share-viewlink' },
      el('div', { className: 'share-label', textContent: '🔗 A link to what I see' }),
      el('div', { className: 'share-choices-inline' }, ...[choice('this zoom and place', 'place', !!now.view), choice('the cell I point at', 'cell', !!now.cell), choice('the AI chat, as it is open now', 'ai', !!now.ai)].filter((x): x is HTMLElement => x !== null)),
      area,
      buttons,
      says,
      this.note('Only the place is in the link, nobody\'s cells: those stay in the browser of whoever wrote them. A friend sees the same tab, the same place, the same cell (the examples, the Lab and the Monitor are the same for everybody). Everything the link says is checked before it is used.'),
    );
  }

  private note(...kids: Array<Node | string>): HTMLElement {
    return el('p', { className: 'share-note' }, ...kids);
  }

  private nameField(): HTMLElement {
    const input = el('input', { type: 'text', value: this.name, maxLength: 24, className: 'share-input' });
    input.addEventListener('input', () => (this.name = input.value));
    return el('label', { className: 'share-field' }, 'Your name ', input);
  }

  private stunField(): HTMLElement {
    const box = el('input', { type: 'checkbox', checked: this.useStun });
    box.addEventListener('change', () => (this.useStun = box.checked));
    return el(
      'label',
      { className: 'share-check' },
      box,
      el('span', {}, el('strong', { textContent: ' Connect across the internet. ' }), 'Needs a public helper server (Google STUN) to find the way. Leave it off when you are on the same network (same Wi-Fi or room): then nothing leaves your network.'),
    );
  }

  private copyBox(label: string, value: string): HTMLElement {
    const area = el('textarea', { readOnly: true, value, rows: 4, className: 'share-code' });
    area.addEventListener('focus', () => area.select());
    const copy = el('button', { type: 'button', className: 'share-btn', textContent: '📋 Copy' });
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(value).then(() => (copy.textContent = 'Copied ✓'));
      area.select();
    });
    return el('div', { className: 'share-block' }, el('div', { className: 'share-label', textContent: label }), area, copy);
  }

  private renderStart(): void {
    const d = this.dialog;
    d.append(
      this.note('Two browsers, connected directly. Only the code of your cells, where you point and chat travel, and only to the person you give your code to. No account, no server of ours.'),
      el('div', { className: 'share-choices' }, this.bigButton('🧑‍🎓 I want to share my sheets', 'I start. I get a code and send it to my tutor or friend.', () => {
        this.step = 'host';
        this.render();
      }), this.bigButton('🧑‍🏫 I was invited', 'I paste the code I was sent.', () => {
        this.step = 'guest';
        this.render();
      })),
    );
  }

  private bigButton(title: string, text: string, onClick: () => void): HTMLElement {
    const b = el('button', { type: 'button', className: 'share-big' }, el('strong', { textContent: title }), el('span', { textContent: text }));
    b.addEventListener('click', onClick);
    return b;
  }

  private renderHost(): void {
    const d = this.dialog;
    d.append(this.nameField());
    if (!this.invitation) {
      const edits = el('input', { type: 'checkbox', checked: this.allowEdits });
      edits.addEventListener('change', () => (this.allowEdits = edits.checked));
      d.append(
        el('label', { className: 'share-check' }, edits, el('span', {}, el('strong', { textContent: ' Let the other person change my code. ' }), 'Code you share runs on your page, so a person who can write code can do anything your cells can. Only allow it for someone you trust. You can switch it off any time.')),
        this.stunField(),
      );
      const go = el('button', { type: 'button', className: 'share-btn primary', textContent: 'Create my invitation', disabled: !!this.busy });
      go.addEventListener('click', () => void this.createInvitation());
      const back = el('button', { type: 'button', className: 'share-btn', textContent: '← Back' });
      back.addEventListener('click', () => {
        this.step = 'start';
        this.render();
      });
      d.append(el('div', { className: 'share-actions' }, back, go));
      return;
    }
    d.append(this.copyBox('1. Send this code to the person you are sharing with:', this.invitation));
    const reply = el('textarea', { rows: 4, className: 'share-code', placeholder: 'lk1.…' });
    const connect = el('button', { type: 'button', className: 'share-btn primary', textContent: 'Connect', disabled: !!this.busy });
    connect.addEventListener('click', () => void this.acceptReply(reply.value));
    const cancel = el('button', { type: 'button', className: 'share-btn', textContent: 'Cancel' });
    cancel.addEventListener('click', () => this.stop());
    d.append(el('div', { className: 'share-block' }, el('div', { className: 'share-label', textContent: '2. They send you a reply code. Paste it here:' }), reply, el('div', { className: 'share-actions' }, cancel, connect)));
  }

  private renderGuest(): void {
    const d = this.dialog;
    d.append(this.nameField());
    if (!this.invitation) {
      const invite = el('textarea', { rows: 4, className: 'share-code', placeholder: 'lk1.…' });
      const go = el('button', { type: 'button', className: 'share-btn primary', textContent: 'Create my reply', disabled: !!this.busy });
      go.addEventListener('click', () => void this.createReply(invite.value));
      const back = el('button', { type: 'button', className: 'share-btn', textContent: '← Back' });
      back.addEventListener('click', () => {
        this.step = 'start';
        this.render();
      });
      d.append(
        this.note('While you are connected your sheets show the other person’s cells. Your own work stays safe in this browser and comes back when you leave.'),
        this.stunField(),
        el('div', { className: 'share-block' }, el('div', { className: 'share-label', textContent: '1. Paste the invitation you were sent:' }), invite),
        el('div', { className: 'share-actions' }, back, go),
      );
      return;
    }
    const cancel = el('button', { type: 'button', className: 'share-btn', textContent: 'Cancel' });
    cancel.addEventListener('click', () => this.stop());
    d.append(this.copyBox('2. Send this reply code back. You are connected as soon as they paste it:', this.invitation), el('div', { className: 'share-actions' }, cancel));
  }

  private renderConnected(session: ShareSession): void {
    const d = this.dialog;
    const { role, peerName, canEdit } = session.info;
    d.append(
      el('p', { className: 'share-status', textContent: `✅ Connected with ${peerName} (you are the ${role === 'host' ? 'host: your sheets are shared' : 'guest: you see their sheets'}).` }),
    );
    if (role === 'host') {
      const edits = el('input', { type: 'checkbox', checked: canEdit });
      edits.addEventListener('change', () => session.setAllowEdits(edits.checked));
      d.append(el('label', { className: 'share-check' }, edits, el('span', {}, el('strong', { textContent: ' Let ' + peerName + ' change my code. ' }), canEdit ? 'They can edit your cells right now.' : 'They can watch and point, not change.')));
    } else {
      d.append(this.note(canEdit ? '✏️ You can change the code. Your edits appear on their page too.' : '👁 View-only: you can look, point and chat. Ask the host to allow editing if you want to change code.'));
      const follow = el('input', { type: 'checkbox', checked: session.info.follow });
      follow.addEventListener('change', () => session.setFollow(follow.checked));
      d.append(el('label', { className: 'share-check' }, follow, el('span', { textContent: ' Follow the host between tabs.' })));
    }
    const say = el('input', { type: 'text', className: 'share-input', placeholder: 'Say something…', maxLength: 300 });
    const send = (): void => {
      if (!say.value.trim()) return;
      session.chat(say.value);
      this.toast(`You: ${say.value.trim()}`);
      say.value = '';
    };
    say.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
    const sendBtn = el('button', { type: 'button', className: 'share-btn', textContent: 'Send' });
    sendBtn.addEventListener('click', send);
    const stop = el('button', { type: 'button', className: 'share-btn danger', textContent: role === 'guest' ? 'Leave (back to my own sheets)' : 'Stop sharing' });
    stop.addEventListener('click', () => {
      this.stop();
      if (role === 'guest') location.reload();
    });
    d.append(el('div', { className: 'share-chat' }, say, sendBtn), el('div', { className: 'share-actions' }, stop));
  }
}
