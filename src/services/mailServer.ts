import { ERR, McpError, router, type Json, type McpServer, type Trace } from '../mcp/router';
import { covers, mailbox, normalizeAddress, parseRecipients, type Letter, type Mailbox } from '../mcp/mailbox';

/**
 * The MCP server `mail`: letters between everybody that talks over the router. It is made to be easy for a small AI:
 * few tools, flat arguments (no nested JSON), several names accepted for the same thing, and every answer says what to do next.
 *
 *   check                       how many unread letters are waiting for you (cheap; ask it often)
 *   inbox {unread_only?}        the list: id, from, subject, first words
 *   read {id}                   the whole letter (it counts as read)
 *   send {to, body, subject?}   write to one or more addresses (to: "you", "ai-chat", "outside-ai", "lab:A16" ...)
 *   reply {id, body}            answer a letter: it goes to whoever wrote it
 *   sent, delete {id}, boxes
 *
 * Who you are is not something you say: it is who the router says is calling (an outside AI is outside-ai:<client>@<model>).
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const first = (args: Record<string, unknown>, names: string[]): unknown => names.map((n) => args[n]).find((v) => v !== undefined && v !== null && v !== '');

const TOOLS = [
  {
    name: 'check',
    description: 'How many unread letters wait for you, and who wrote them (start here; small and safe, call it now and then). Then use inbox and read.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'inbox',
    description: 'The letters for you, newest first: id, from, subject and the first words. Use read with an id for the whole letter.',
    inputSchema: {
      type: 'object',
      properties: {
        unread_only: { type: 'boolean', description: 'Only letters you have not read yet.' },
        limit: { type: 'integer', description: 'At most this many (default 10, at most 50).' },
      },
    },
  },
  {
    name: 'read',
    description: 'Open one letter by its id (like "m-3") and read all of it. The whole conversation it belongs to comes with it. The letter then counts as read.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The id from inbox, like "m-3".' } }, required: ['id'] },
  },
  {
    name: 'send',
    description:
      'Write a letter. to is one address or several with commas: "you" (the person), "ai-chat" (the helper in the sidebar), "outside-ai" (every AI chat outside the page), "outside-ai:codex" (one of them), "lab:A16" (a cell). ' +
      'Example: {"to":"you","subject":"Hello","body":"I found a bug in A12."}',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Who gets it. Several: "you, ai-chat".' },
        body: { type: 'string', description: 'The letter itself (at most 4000 characters).' },
        subject: { type: 'string', description: 'A few words on what it is about (optional).' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'reply',
    description: 'Answer a letter by its id. It goes to whoever wrote it, with the same subject. Example: {"id":"m-3","body":"Thanks, done."}',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, body: { type: 'string' } }, required: ['id', 'body'] },
  },
  { name: 'sent', description: 'The letters you wrote, newest first.', inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } } },
  { name: 'delete', description: 'Throw away a letter of yours (the others who got it keep theirs).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'boxes', description: 'Who can be written to: the usual addresses, and everybody who has sent or got a letter, with how many unread letters they have.', inputSchema: { type: 'object', properties: {} } },
];

/** Who is calling: the router's name for it, or for an outside AI (which arrives as "ai") the origin of the chain. */
function whoIs(from: string, trace?: Trace): string {
  const name = from === 'ai' && trace?.origin ? trace.origin : from;
  return normalizeAddress(name) || 'anonymous';
}

const brief = (l: Letter, who: string, box: Mailbox) => ({
  id: l.id,
  from: l.from,
  to: l.to.join(', '),
  subject: l.subject,
  preview: l.body.replace(/\s+/g, ' ').slice(0, 90),
  sent: new Date(l.sentAt).toISOString(),
  unread: box.isUnread(l, who),
});

const whole = (l: Letter) => ({ id: l.id, from: l.from, to: l.to.join(', '), subject: l.subject, sent: new Date(l.sentAt).toISOString(), replyTo: l.replyTo ?? null, body: l.body });

export class MailServer implements McpServer {
  readonly name = 'mail';
  readonly description = 'Internal mail: letters between the person, the helper, outside AI chats and cells. check, inbox, read, send, reply.';

  constructor(private readonly box: Mailbox = mailbox) {}

  handle(method: string, params: Record<string, unknown>, from: string, trace?: Trace): Json {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-mail', title: 'Mail', version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(str(params.name), isRecord(params.arguments) ? params.arguments : {}, whoIs(from, trace), trace);
      default:
        throw new McpError(ERR.methodNotFound, `mail does not know the method "${method}". Use tools/list, then tools/call with a name like check, inbox, read, send or reply.`);
    }
  }

  private call(name: string, args: Record<string, unknown>, who: string, trace?: Trace): Json {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const fail = (message: string, hint?: string) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message, ...(hint ? { example: hint } : {}) }) }], isError: true });
    const idOf = () => str(first(args, ['id', 'message_id', 'letter', 'letter_id', 'mail', 'message'])).trim().toLowerCase();
    const bodyOf = () => str(first(args, ['body', 'text', 'message', 'content', 'letter', 'msg'])).trim();
    const limitOf = (fallback: number) => Math.min(50, Math.max(1, Math.round(Number(args.limit)) || fallback));

    switch (name) {
      case 'check': {
        const unread = this.box.inbox(who).filter((l) => this.box.isUnread(l, who));
        return reply({
          ok: true,
          you: who,
          unread: unread.length,
          from: [...new Set(unread.map((l) => l.from))],
          next: unread.length ? 'Call inbox, then read with the id of a letter.' : 'Nothing is waiting. To write one: send {"to":"you","body":"..."}.',
        });
      }
      case 'inbox': {
        const unreadOnly = args.unread_only === true || args.unread_only === 'true';
        const all = this.box.inbox(who);
        const list = (unreadOnly ? all.filter((l) => this.box.isUnread(l, who)) : all).slice(0, limitOf(10));
        return reply({
          ok: true,
          you: who,
          total: all.length,
          unread: all.filter((l) => this.box.isUnread(l, who)).length,
          letters: list.map((l) => brief(l, who, this.box)),
          next: list.length ? 'Open one with read {"id":"' + list[0].id + '"}.' : 'The mailbox is empty.',
        });
      }
      case 'read': {
        const id = idOf();
        const letter = id ? this.box.get(id) : undefined;
        if (!letter) return fail(id ? `there is no letter ${id}` : 'say which letter: id, like "m-3" (see inbox)', '{"id":"m-3"}');
        const mine = letter.from === who || letter.to.some((t) => covers(t, who));
        if (!mine && who !== 'you') return fail(`letter ${id} is not for you`);
        if (this.box.isUnread(letter, who)) this.box.markRead(id, who);
        return reply({ ok: true, letter: whole(letter), conversation: this.box.thread(id).filter((l) => l.id !== id).map((l) => whole(l)), next: `Answer it with reply {"id":"${id}","body":"..."}.` });
      }
      case 'send':
      case 'reply': {
        const body = bodyOf();
        let to: string[];
        let replyTo: string | undefined;
        if (name === 'reply') {
          const id = idOf();
          const parent = id ? this.box.get(id) : undefined;
          if (!parent) return fail(id ? `there is no letter ${id} to answer` : 'say which letter to answer: id, like "m-3"', '{"id":"m-3","body":"Thanks!"}');
          // Answering a letter of your own goes to the people it was written to.
          to = parent.from === who ? parent.to : [parent.from];
          replyTo = id;
        } else {
          to = parseRecipients(first(args, ['to', 'recipient', 'recipients', 'address', 'for']));
          if (!to.length) return fail('say who it is for: to, like "you", "ai-chat", "outside-ai" or "lab:A16"', '{"to":"you","body":"Hello!"}');
        }
        if (!body) return fail('the letter is empty: give a body', '{"to":"you","body":"Hello!"}');
        const letter = this.box.send({ from: who, to, subject: str(args.subject), body, replyTo, via: trace?.id });
        for (const t of to) router.notify('mail', t, 'notifications/mail/new', { id: letter.id, from: who, subject: letter.subject }, trace);
        return reply({ ok: true, sent: letter.id, to, subject: letter.subject, next: 'It is in their mailbox. They see it with check, inbox and read; you will see an answer in your inbox.' });
      }
      case 'sent':
        return reply({ ok: true, letters: this.box.sent(who).slice(0, limitOf(10)).map((l) => brief(l, who, this.box)) });
      case 'delete': {
        const id = idOf();
        if (!id || !this.box.discard(id, who)) return fail(id ? `there is no letter ${id}` : 'say which letter: id', '{"id":"m-3"}');
        return reply({ ok: true, deleted: id });
      }
      case 'boxes':
        return reply({
          ok: true,
          you: who,
          usual: [
            { address: 'you', for: 'the person at the screen (they read mail with the ✉ button)' },
            { address: 'ai-chat', for: 'the helper in the sidebar' },
            { address: 'outside-ai', for: 'every AI chat outside the page, over /mcp (outside-ai:<client> for one)' },
            { address: 'lab:A16', for: 'a cell (tab, colon, address); a cell reads its mail with mcp.call("mail", "inbox")' },
          ],
          known: this.box.directory(),
        });
      default:
        return fail(`mail has no tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}.`);
    }
  }
}
