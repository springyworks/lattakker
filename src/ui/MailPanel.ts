import { router } from '../mcp/router';
import { covers, mailbox, normalizeAddress, type Letter } from '../mcp/mailbox';
import type { TabStrip } from './TabStrip';

/**
 * The ✉ mail window: the person's own mailbox (`you` on the router). The person reads and writes through the same `mail` MCP server
 * everybody else uses, so what they do shows in the Monitor like any other traffic. Plain HTML, like the 🤝 Share window.
 */

const ME = 'you';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const when = (t: number): string => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function mailTool(name: string, args: Record<string, unknown>): Promise<void> {
  await router.request(ME, 'mail', 'tools/call', { name, arguments: args });
}

export class MailPanel {
  private readonly dialog = el('dialog', { className: 'mail-dialog' });
  private view: 'inbox' | 'sent' = 'inbox';
  private openId: string | null = null;
  private composing: { to: string; subject: string; body: string; replyTo?: string } | null = null;

  constructor(
    private readonly strip: TabStrip,
    private readonly say: (text: string) => void,
  ) {
    document.body.append(this.dialog);
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    strip.onMail = () => this.open();
    mailbox.onChange(() => {
      this.paintStrip();
      if (this.dialog.open) this.render();
    });
    mailbox.onDelivery((letter) => {
      if (letter.to.some((t) => covers(t, ME)) && letter.from !== ME) this.say(`✉ New mail from ${letter.from}: ${letter.subject}`);
    });
    this.paintStrip();
  }

  open(): void {
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private paintStrip(): void {
    this.strip.setMail(mailbox.unread(ME));
  }

  private render(): void {
    const letters = this.view === 'inbox' ? mailbox.inbox(ME) : mailbox.sent(ME);
    const open = this.openId ? mailbox.get(this.openId) : undefined;
    const head = el(
      'div',
      { className: 'mail-head' },
      el('h2', { textContent: '✉ Mail' }),
      el('button', { className: 'mail-x', textContent: '✕', title: 'Close', onclick: () => this.dialog.close() }),
    );
    const tabs = el(
      'div',
      { className: 'mail-bar' },
      this.tab('inbox', `Inbox${mailbox.unread(ME) ? ` (${mailbox.unread(ME)})` : ''}`),
      this.tab('sent', 'Sent'),
      el('button', { className: 'mail-new', textContent: '✎ Write', onclick: () => this.compose({ to: 'ai-chat', subject: '', body: '' }) }),
    );
    const list = el('div', { className: 'mail-list' });
    if (!letters.length) list.append(el('p', { className: 'mail-empty', textContent: this.view === 'inbox' ? 'No letters yet. The helper, AI chats outside the page and cells can write to you with the mail tools.' : 'You have not written anything yet.' }));
    for (const l of letters) {
      const unread = this.view === 'inbox' && mailbox.isUnread(l, ME);
      const row = el(
        'button',
        { className: `mail-row${unread ? ' unread' : ''}${l.id === this.openId ? ' open' : ''}`, onclick: () => this.show(l.id) },
        el('span', { className: 'mail-from', textContent: this.view === 'inbox' ? l.from : `to ${l.to.join(', ')}` }),
        el('span', { className: 'mail-subject', textContent: l.subject }),
        el('span', { className: 'mail-when', textContent: when(l.sentAt) }),
      );
      row.dataset.id = l.id;
      list.append(row);
    }
    const pane = el('div', { className: 'mail-pane' });
    if (this.composing) pane.append(this.form(this.composing));
    else if (open) pane.append(this.letter(open));
    else pane.append(el('p', { className: 'mail-empty', textContent: 'Pick a letter, or write one.' }));
    this.dialog.replaceChildren(head, tabs, el('div', { className: 'mail-body' }, list, pane));
  }

  private tab(view: 'inbox' | 'sent', text: string): HTMLButtonElement {
    return el('button', {
      className: `mail-tab${this.view === view ? ' on' : ''}`,
      textContent: text,
      onclick: () => {
        this.view = view;
        this.render();
      },
    });
  }

  private show(id: string): void {
    this.openId = id;
    this.composing = null;
    if (mailbox.get(id) && mailbox.isUnread(mailbox.get(id)!, ME)) void mailTool('read', { id });
    else this.render();
  }

  private letter(l: Letter): HTMLElement {
    const thread = mailbox.thread(l.id);
    const box = el('div', { className: 'mail-letter' });
    for (const t of thread) {
      box.append(
        el(
          'div',
          { className: `mail-msg${t.id === l.id ? ' now' : ''}` },
          el('div', { className: 'mail-meta' }, el('b', { textContent: t.from }), ` → ${t.to.join(', ')} · ${when(t.sentAt)} · ${t.id}`),
          el('div', { className: 'mail-subj', textContent: t.subject }),
          el('pre', { className: 'mail-text', textContent: t.body }),
        ),
      );
    }
    const actions = el(
      'div',
      { className: 'mail-actions' },
      el('button', {
        textContent: '↩ Reply',
        onclick: () => this.compose({ to: l.from === ME ? l.to.join(', ') : l.from, subject: l.subject.startsWith('Re: ') ? l.subject : `Re: ${l.subject}`, body: '', replyTo: l.id }),
      }),
      el('button', {
        textContent: '🗑 Delete',
        onclick: () => {
          this.openId = null;
          void mailTool('delete', { id: l.id });
        },
      }),
    );
    return el('div', {}, box, actions);
  }

  private compose(c: { to: string; subject: string; body: string; replyTo?: string }): void {
    this.composing = c;
    this.render();
    this.dialog.querySelector<HTMLTextAreaElement>('.mail-form textarea')?.focus();
  }

  private form(c: { to: string; subject: string; body: string; replyTo?: string }): HTMLElement {
    const to = el('input', { className: 'mail-to', value: c.to, placeholder: 'ai-chat, outside-ai, lab:A16 …' });
    const subject = el('input', { className: 'mail-sub', value: c.subject, placeholder: 'Subject' });
    const body = el('textarea', { className: 'mail-write', value: c.body, rows: 6, placeholder: 'Write here…' });
    const note = el('div', { className: 'mail-hint', textContent: 'To: you, ai-chat (the helper), outside-ai (AI chats outside the page), or a cell like lab:A16.' });
    return el(
      'div',
      { className: 'mail-form' },
      el('label', {}, 'To ', to),
      el('label', {}, 'Subject ', subject),
      body,
      note,
      el(
        'div',
        { className: 'mail-actions' },
        el('button', {
          className: 'mail-send',
          textContent: '➤ Send',
          onclick: () => {
            const text = body.value.trim();
            if (!text || !normalizeAddress(to.value)) {
              note.textContent = 'Say who it is for and write something.';
              return;
            }
            this.composing = null;
            this.view = 'sent';
            void mailTool(c.replyTo && to.value.trim() === c.to ? 'reply' : 'send', c.replyTo && to.value.trim() === c.to ? { id: c.replyTo, body: text } : { to: to.value, subject: subject.value, body: text });
          },
        }),
        el('button', {
          textContent: 'Cancel',
          onclick: () => {
            this.composing = null;
            this.render();
          },
        }),
      ),
    );
  }
}
