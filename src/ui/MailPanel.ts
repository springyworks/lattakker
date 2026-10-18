import { router } from '../mcp/router';
import { covers, mailbox, normalizeAddress, type Letter } from '../mcp/mailbox';
import { clearDraft, loadDraft, saveDraft, type Draft } from '../mcp/mailDraft';
import type { TabStrip } from './TabStrip';

/**
 * The ✉ mail window: the person's own mailbox (`you` on the router). The person reads and writes through the same `mail` MCP server
 * everybody else uses, so what they do shows in the Monitor like any other traffic. Plain HTML, like the 🤝 Share window.
 */

const ME = 'you';
const store = typeof localStorage === 'undefined' ? null : localStorage;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const when = (t: number): string => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function mailTool(name: string, args: Record<string, unknown>): Promise<{ unreachable?: string[]; next?: string } | null> {
  const answer = (await router.request(ME, 'mail', 'tools/call', { name, arguments: args })) as { structuredContent?: { unreachable?: string[]; next?: string } } | null;
  return answer?.structuredContent ?? null;
}

export class MailPanel {
  private readonly dialog = el('dialog', { className: 'mail-dialog' });
  private view: 'inbox' | 'sent' | 'all' = 'inbox';
  private openId: string | null = null;
  private composing: Draft | null = null;
  /** The letter on the screen was kept from before (a reload, a closed window): said in the window, so it is not mistaken for sent. */
  private restored = false;

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
      // A letter that arrives while one is being written must not rebuild the form under the person's hands.
      if (this.dialog.open && !this.composing) this.render();
    });
    mailbox.onDelivery((letter) => {
      if (letter.to.some((t) => covers(t, ME)) && letter.from !== ME) this.say(`✉ New mail from ${letter.from}: ${letter.subject}`);
    });
    this.paintStrip();
    // Written but not sent is the easiest thing to forget: say so when the page starts.
    if (loadDraft(store)) this.say('📝 You have a mail you wrote but did not send. Open ✉ to finish it, then press ➤ Send.');
  }

  open(): void {
    if (!this.composing) {
      const kept = loadDraft(store);
      if (kept) {
        this.composing = kept;
        this.restored = true;
      }
    }
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private paintStrip(): void {
    this.strip.setMail(mailbox.unread(ME));
  }

  private render(): void {
    const letters = this.view === 'inbox' ? mailbox.inbox(ME) : this.view === 'sent' ? mailbox.sent(ME) : mailbox.all();
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
      this.tab('all', `All mail (${mailbox.all().length})`),
      el('button', { className: 'mail-new', textContent: '✎ Write', onclick: () => {
          const kept = loadDraft(store);
          this.restored = !!kept;
          this.compose(kept ?? { to: 'ai-chat', subject: '', body: '' });
        },
      }),
    );
    const list = el('div', { className: 'mail-list' });
    if (!letters.length) list.append(el('p', { className: 'mail-empty', textContent: this.view === 'inbox' ? 'No letters yet. The helper, AI chats outside the page and cells can write to you with the mail tools.' : this.view === 'sent' ? 'You have not written anything yet.' : 'There is no mail at all yet.' }));
    for (const l of letters) {
      const unread = this.view === 'inbox' && mailbox.isUnread(l, ME);
      const row = el(
        'button',
        { className: `mail-row${unread ? ' unread' : ''}${l.id === this.openId ? ' open' : ''}`, onclick: () => this.show(l.id) },
        el('span', { className: 'mail-from', textContent: this.view === 'inbox' ? l.from : this.view === 'sent' ? `to ${l.to.join(', ')}` : `${l.from} → ${l.to.join(', ')}` }),
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

  private tab(view: 'inbox' | 'sent' | 'all', text: string): HTMLButtonElement {
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
    const letter = mailbox.get(id);
    const mine = !!letter && letter.from !== ME && letter.to.some((t) => covers(t, ME));
    if (letter && mine && mailbox.isUnread(letter, ME)) void mailTool('read', { id });
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
      this.view === 'all'
        ? el('span', { className: 'mail-hint', textContent: `Read only here: ${l.readBy.length ? `read by ${l.readBy.join(', ')}` : 'not read yet'}.` })
        : el('button', {
            textContent: '🗑 Delete',
            onclick: () => {
              this.openId = null;
              void mailTool('delete', { id: l.id });
            },
          }),
    );
    return el('div', {}, box, actions);
  }

  private compose(c: Draft): void {
    this.composing = c;
    this.render();
    this.dialog.querySelector<HTMLTextAreaElement>('.mail-form textarea')?.focus();
  }

  private form(c: Draft): HTMLElement {
    const to = el('input', { className: 'mail-to', value: c.to, placeholder: 'ai-chat, outside-ai, lab:A16 …' });
    const subject = el('input', { className: 'mail-sub', value: c.subject, placeholder: 'Subject' });
    const body = el('textarea', { className: 'mail-write', value: c.body, rows: 6, placeholder: 'Write here…' });
    const note = el('div', { className: 'mail-hint', textContent: `${this.restored ? '📝 Kept from before: ' : ''}To: you, ai-chat (the helper), outside-ai (AI chats outside the page), or a cell like lab:A16. Nothing is sent until you press ➤ Send (or Ctrl+Enter).` });
    // What is typed goes into the draft at once, and into the browser's storage, so nothing typed can be lost.
    const keep = (): void => {
      Object.assign(c, { to: to.value, subject: subject.value, body: body.value });
      saveDraft(store, c);
    };
    for (const field of [to, subject, body]) field.addEventListener('input', keep);
    const send = (): void => {
      const text = body.value.trim();
      if (!text || !normalizeAddress(to.value)) {
        note.textContent = 'Say who it is for and write something.';
        return;
      }
      // An answer stays an answer only while the address is still the one of the letter it answers (the draft's own address changes as the person types).
      const parent = c.replyTo ? mailbox.get(c.replyTo) : undefined;
      const reply = !!parent && to.value.trim() === (parent.from === ME ? parent.to.join(', ') : parent.from);
      const args = reply ? { id: c.replyTo, body: text } : { to: to.value, subject: subject.value, body: text };
      this.composing = null;
      this.restored = false;
      clearDraft(store);
      this.view = 'sent';
      void mailTool(reply ? 'reply' : 'send', args).then((result) => {
        // A letter to a name nobody has would wait for ever: say so now, while there is something to do about it.
        if (result?.unreachable?.length) this.say(`⚠ ${result.next}`);
      });
    };
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
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
        el('button', { className: 'mail-send', textContent: '➤ Send', onclick: send }),
        el('button', {
          textContent: 'Cancel',
          onclick: () => {
            this.composing = null;
            this.restored = false;
            clearDraft(store);
            this.render();
          },
        }),
      ),
    );
  }
}
