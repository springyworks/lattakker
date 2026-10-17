/**
 * The page's internal mail: letters between the parties that talk over the router (the person, the built-in helper,
 * AI chats outside the page, cells). The store is plain data and plain functions, so it works the same for the
 * `mail` MCP server (services/mailServer.ts), the ✉ panel (ui/MailPanel.ts) and the tests.
 *
 * An address is the name a party has on the router: `you` (the person), `ai-chat` (the built-in helper),
 * `outside-ai:<client>@<model>` (an AI chat over the dev server's /mcp), `lab:A16` (a cell). A letter to a shorter
 * address reaches everybody it covers: `outside-ai` reaches every outside AI, `lab` every cell of the Lab.
 */

export interface Letter {
  id: string;
  /** The first letter of the conversation; a letter that starts one has its own id here. */
  thread: string;
  replyTo?: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  /** Unix time in milliseconds. */
  sentAt: number;
  /** The router message that carried it, so `trace` can follow it. */
  via?: string;
  /** Who has opened it (a letter to a group is read by each reader on their own). */
  readBy: string[];
  /** Who has thrown it away (it stays for the others). */
  hiddenBy: string[];
}

export const MAX_BODY = 4000;
export const MAX_SUBJECT = 120;
export const MAX_LETTERS = 300;
const KEY = 'lattakker.mail.v1';

const ALIASES: Record<string, string> = {
  me: 'you',
  user: 'you',
  person: 'you',
  player: 'you',
  child: 'you',
  helper: 'ai-chat',
  assistant: 'ai-chat',
  'ai-helper': 'ai-chat',
  sidebar: 'ai-chat',
  chat: 'ai-chat',
  outside: 'outside-ai',
  'outside_ai': 'outside-ai',
};

/** The words a small model may use for an address, turned into the address the router knows. */
export function normalizeAddress(raw: string): string {
  const a = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!a) return '';
  if (ALIASES[a]) return ALIASES[a];
  // A cell is written with a capital letter and keeps it: lab:A16.
  const cell = /^([a-z0-9-]+):([a-z]{1,2}\d{1,3})$/.exec(a);
  if (cell) return `${cell[1]}:${cell[2].toUpperCase()}`;
  return a.replace(/[^\w:@./-]/g, '').slice(0, 80);
}

/** True when a letter addressed to `to` is for somebody called `who` ('outside-ai' covers 'outside-ai:codex@gpt-5'). */
export function covers(to: string, who: string): boolean {
  if (to === who) return true;
  return who.startsWith(to) && [':', '@'].includes(who[to.length] ?? '');
}

/**
 * Can a letter to `to` ever be read? The person, the helper and any cell can (a cell is written lab:A16); a group like `outside-ai` reaches
 * every outside AI that comes; anything else must be (the start of) somebody who has been seen: `known` holds who called in or wrote.
 * A letter to a name nobody has just sits there, and whoever wrote it waits for an answer that cannot come.
 */
export function isReachable(to: string, known: string[]): boolean {
  if (['you', 'ai-chat', 'outside-ai'].includes(to) || /^[a-z0-9-]+:[A-Za-z]{1,2}\d{1,3}$/.test(to)) return true;
  return known.some((k) => covers(to, k));
}

/** Turns "you, helper" or ["you", "lab:A3"] into addresses (each once). */
export function parseRecipients(value: unknown): string[] {
  const list = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,;]+|\s+and\s+/i) : [];
  return [...new Set(list.map(normalizeAddress).filter(Boolean))];
}

type Listener = (letter: Letter) => void;

export class Mailbox {
  private letters: Letter[] = [];
  private counter = 0;
  private readonly listeners = new Set<Listener>();
  private readonly changed = new Set<() => void>();

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { letters?: Letter[]; counter?: number };
      if (Array.isArray(saved.letters)) this.letters = saved.letters.filter((l) => l && typeof l.id === 'string' && Array.isArray(l.to));
      this.counter = Math.max(Number(saved.counter) || 0, ...this.letters.map((l) => Number(/^m-(\d+)$/.exec(l.id)?.[1]) || 0));
    } catch {
      this.letters = [];
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ letters: this.letters, counter: this.counter }));
    } catch {
      // A full or blocked storage only means the mail is not kept after a reload.
    }
    for (const fn of this.changed) fn();
  }

  /** Called when a letter is delivered. */
  onDelivery(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called after any change (delivered, read, thrown away). */
  onChange(fn: () => void): () => void {
    this.changed.add(fn);
    return () => this.changed.delete(fn);
  }

  send(input: { from: string; to: string[]; subject?: string; body: string; replyTo?: string; via?: string }): Letter {
    const parent = input.replyTo ? this.letters.find((l) => l.id === input.replyTo) : undefined;
    const id = `m-${++this.counter}`;
    const body = input.body.trim().slice(0, MAX_BODY);
    const subject = (input.subject?.trim() || parent?.subject || firstLine(body)).slice(0, MAX_SUBJECT);
    const letter: Letter = {
      id,
      thread: parent?.thread ?? id,
      replyTo: parent?.id,
      from: input.from,
      to: input.to,
      subject,
      body,
      sentAt: Date.now(),
      via: input.via,
      readBy: [input.from],
      hiddenBy: [],
    };
    this.letters.push(letter);
    this.trim();
    this.save();
    for (const fn of this.listeners) fn(letter);
    return letter;
  }

  /** Keeps the store small: the oldest letters that everybody has seen go first, then the oldest of all. */
  private trim(): void {
    while (this.letters.length > MAX_LETTERS) {
      const i = this.letters.findIndex((l) => l.hiddenBy.length > 0 || l.to.every((t) => l.readBy.some((r) => covers(t, r))));
      this.letters.splice(i < 0 ? 0 : i, 1);
    }
  }

  get(id: string): Letter | undefined {
    return this.letters.find((l) => l.id === id);
  }

  /** The letters for `who`, newest first (letters to the ones who have it covered; not the ones who threw it away). */
  inbox(who: string): Letter[] {
    return this.letters
      .filter((l) => l.from !== who && !l.hiddenBy.includes(who) && l.to.some((t) => covers(t, who)))
      .sort((a, b) => b.sentAt - a.sentAt || b.id.localeCompare(a.id, undefined, { numeric: true }));
  }

  /** The letters `who` sent, newest first. */
  sent(who: string): Letter[] {
    return this.letters.filter((l) => l.from === who && !l.hiddenBy.includes(who)).sort((a, b) => b.sentAt - a.sentAt);
  }

  isUnread(letter: Letter, who: string): boolean {
    return !letter.readBy.includes(who);
  }

  unread(who: string): number {
    return this.inbox(who).filter((l) => this.isUnread(l, who)).length;
  }

  markRead(id: string, who: string, read = true): boolean {
    const l = this.get(id);
    if (!l) return false;
    const has = l.readBy.includes(who);
    if (read && !has) l.readBy.push(who);
    else if (!read && has) l.readBy = l.readBy.filter((r) => r !== who);
    else return true;
    this.save();
    return true;
  }

  /** Throws a letter away for `who` only. */
  discard(id: string, who: string): boolean {
    const l = this.get(id);
    if (!l) return false;
    if (!l.hiddenBy.includes(who)) l.hiddenBy.push(who);
    this.save();
    return true;
  }

  /** Everybody who has written a letter (somebody who writes is somebody who is there). */
  senders(): string[] {
    return [...new Set(this.letters.map((l) => l.from))];
  }

  /** Everybody who has sent or been written to, with how much is waiting for them. */
  directory(): Array<{ address: string; unread: number; letters: number }> {
    const names = new Set<string>();
    for (const l of this.letters) {
      names.add(l.from);
      for (const t of l.to) names.add(t);
    }
    return [...names].sort().map((address) => ({ address, unread: this.unread(address), letters: this.inbox(address).length }));
  }

  /** Letters of one conversation, oldest first. */
  thread(id: string): Letter[] {
    const first = this.get(id);
    const root = first?.thread ?? id;
    return this.letters.filter((l) => l.thread === root).sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  clear(): void {
    this.letters = [];
    this.save();
  }
}

const firstLine = (text: string): string => text.split('\n').find((l) => l.trim())?.trim() ?? '(no subject)';

/** The page's one mailbox, kept in this browser. */
export const mailbox = new Mailbox(typeof localStorage === 'undefined' ? null : localStorage);
