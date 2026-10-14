import { friendly, makeProvider, type ChatMsg, type ToolCall } from './providers';
import { localAssistantReady, probeLocal } from './localAi';
import { router } from '../mcp/router';
import { getSettings } from './config';
import { CLIENT, runTool, setTurnTrace, toolsFor, WriteLedger, type AiContext, type ToolHost } from './tools';
import { workspace } from '../workspace';
import { jobs } from './jobs';
import { describeModel, isSmallModel } from './modelInfo';
import { memoryInfo } from './memory';
import { addressHints } from './cellPaths';
import { ammo, fit, kilo } from './ammo';
import { RULES, docUrls } from './docs';

const MAX_ROUNDS = 6;
const MAX_MESSAGES = 24;
/** No single tool may keep a child waiting longer than this (the longest honest job is typing code, then running it). */
const TOOL_TIMEOUT_MS = 40_000;

const BASE_PROMPT = `You are the helper inside "Lattakker Sheet", a spreadsheet of small TypeScript programs (cells) that also holds a board game. Most people who ask you are children who are learning to program, and a tutor may be near.

You ARE connected to the app and you have tools to use it (look at the list your tools come with). Use them instead of guessing, and never say you cannot reach the app or must ask the person to run code for you.`;

const CHANGE_RULE_ASK = `The only thing you cannot do yourself is change a cell: you offer code with suggest_code and the person presses the button. If the person asks you to write and run code on your own, offer it with suggest_code and say that a grown-up can switch on "Let the helper write code in empty cells" in the settings (the ⚙ button).`;
const CHANGE_RULE_WRITE = `You may write code yourself, but only in an EMPTY cell: look up the names in read_docs (doc "api"), find a similar cell in read_docs (doc "examples", a few words as query), then find_free_cell and write_code (the person watches it being typed, and has an undo button). You see what it printed or its error: if there is an error, fix it with write_code on the same path (at most twice), then tell the person what happened. A cell that already has code is never changed by you: use suggest_code for it.`;

/** What only the built-in helper's tools make possible; the general rules come from ai-docs/rules.md, the same file outside AIs read. */
const TOOL_HINTS = `
How to use your tools:
- Use look_around when the question is about "this cell" or an error. When the question has a line number, "here" means that line: look_around shows the code with line numbers. To add code there, use suggest_code with after_line.
- A cell name like A16 exists in every tab. If it is empty in the person's tab, the tools use the other tab that has code there and tell you which; say the full path (like /lab/A16) in your answer.
- "go to", "show me", "take me to", "focus on" a cell: call goto_cell. It moves the screen and makes the cell blink.
- Before you write or explain code, use read_docs: doc "api" with a query for exact names and signatures; doc "examples" with a query to find a working cell like the one you need (its path can be opened with goto_cell); doc "readme" for how the app works.
- Questions like "which example ...", "show me an example of ...", "how do I ..." are answered with read_docs (doc "examples", a few words as query). Only name a cell path that a tool returned: the example cells are NOT where you would guess.
- If the person reports an error, look_around shows the cell's error: fix that exact error.
- Code for a cell always goes through suggest_code or write_code: code that is only written in your answer gets no button. Never claim you changed a cell unless write_code said so.`;

/** Where the documents live, for a model that can open links itself (the built-in helper reads them with read_docs). */
function pointers(): string {
  const u = docUrls();
  return `\nDocuments (read them with read_docs; if you can open links, these are the addresses): index ${u.index} · API ${u.api} · examples ${u.examples} · README ${u.readme}`;
}

const MEMORY_RULES = `
- You have a memory that survives reloads (recall, remember, tidy_memory). Recall it when the person refers to earlier work or goals; remember lasting, useful things (one idea per note, short, no personal information); tidy it when asked.
- If you are not sure what the app can do, call discover: it lists every MCP server and tool (the weather, the model on this computer called ollama, the memory, the router's statistics ...). mcp_call talks MCP to them. Before you rely on the local model, ask mcp_call ollama tools/call status: it says in plain words if the model server is missing. Cell code can use the same things: weather, ollama, input and mcp (read_docs doc "api" has them).
- What you know and keep, if you are asked: the first time you know nothing about the person or their sheet, only these instructions, their question, the cell they asked from and what your tools show. Your memory (recall, remember) is stored in this browser only: it survives reloads but does not follow the person to another computer, another browser or another address. This chat is forgotten on reload or when a new conversation starts.`;

const SMALL_RULES = `
- Your list of tools is short on purpose. Use one tool at a time, and only the names on your list. Do the shortest thing that answers the question.`;

/** The fixed instructions, shaped for this model: the shared rules (ai-docs/rules.md), how to use the tools, and where the documents are. A small model gets no memory tools. */
export function buildPrompt(options: { small: boolean; write: boolean }): string {
  return `${BASE_PROMPT} ${options.write ? CHANGE_RULE_WRITE : CHANGE_RULE_ASK}\n\nFirst contact (your very first tool call: read_docs with doc "readme"):\n${RULES.first}\n\nRules (the same for every AI that helps here):\n${RULES.behave}\n\nHow to work:\n${RULES.coder}\n\nCell code:\n${RULES.cell}\n${TOOL_HINTS}${options.small ? SMALL_RULES : MEMORY_RULES}${pointers()}`;
}

const LOCAL_PROMPT = `
- A second, smaller model lives on this computer and keeps the memory and the database (consult_local, teach_local, manage_local). Use consult_local for cheap lookups, summaries and drafts, and teach_local to hand it lasting knowledge to store, so it is kept on this computer and not only in this chat. It is less clever than you: give it clear, self-contained text.`;

export type Entry =
  | { kind: 'user'; text: string; where: string; path: string | null }
  | { kind: 'ai'; text: string; via: string }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'proposal'; path: string; code: string; note: string; afterLine: number | null; state: 'open' | 'typed' | 'dismissed' }
  | { kind: 'wrote'; path: string; code: string; ok: boolean; error?: string; printed?: string; state: 'kept' | 'undone' };

export interface AskResult {
  ok: boolean;
  text: string;
}

/** One conversation, shared by the side chat and the little pop-up (they show the same story). */
export class Conversation {
  readonly entries: Entry[] = [];
  private messages: ChatMsg[] = [];
  private abort: AbortController | null = null;
  private listeners: Array<() => void> = [];
  private active: AiContext = { tab: 'board', address: null };
  /** Whether a question is being answered right now. */
  busy = false;
  /** The seconds shown next to a job are re-drawn once a second while something runs. */
  private ticker = 0;
  private readonly ledger = new WriteLedger();

  constructor(private readonly host: Omit<ToolHost, 'context' | 'suggest' | 'wrote' | 'ledger'>) {}

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    this.listeners.forEach((l) => l());
  }

  clear(): void {
    this.cancel();
    this.entries.length = 0;
    this.messages = [];
    this.ledger.reset();
    this.changed();
  }

  cancel(): void {
    this.abort?.abort();
    // Also whatever the chat is waiting for further down the chain (a tool, the local model).
    jobs.cancelAll();
  }

  /** The tools' view of the app, for the local librarian (it works for the person who asked last). */
  toolHost(): ToolHost {
    return { ...this.host, context: () => this.active, suggest: () => {}, wrote: () => {}, ledger: this.ledger };
  }

  /** A note in the conversation that the model never sees (for example "the answer was written into A12"). */
  note(text: string): void {
    this.entries.push({ kind: 'note', text });
    this.changed();
  }

  /** The sentence that says where a question came from. */
  where(ctx: AiContext): string {
    return ctx.address ? `${workspace.pathFor(ctx.tab, ctx.address, workspace.current)}${ctx.line ? ` line ${ctx.line}` : ''}` : `the ${ctx.tab} tab`;
  }

  private trim(): void {
    while (this.messages.length > MAX_MESSAGES) {
      const next = this.messages.findIndex((m, i) => i > 0 && m.role === 'user');
      if (next < 0) break;
      this.messages.splice(0, next);
    }
  }

  async ask(question: string, ctx: AiContext, from = ''): Promise<AskResult> {
    const provider = makeProvider();
    if (!provider) {
      const text = 'The helper is not set up yet. Open the settings (⚙) to choose one.';
      this.entries.push({ kind: 'error', text });
      this.changed();
      return { ok: false, text };
    }
    if (this.busy) return { ok: false, text: 'The helper is still busy with the last question.' };

    this.active = ctx;
    // Is the second brain (a local model) there? Looked up at most every 15 s.
    await probeLocal();
    const second = localAssistantReady();
    let proposed = false;
    const host: ToolHost = {
      ...this.host,
      context: () => this.active,
      ledger: this.ledger,
      suggest: (path, code, note, afterLine) => {
        proposed = true;
        this.entries.push({ kind: 'proposal', path, code, note, afterLine, state: 'open' });
      },
      wrote: (path, code, report) => {
        proposed = true;
        this.entries.push({ kind: 'wrote', path, code, ok: report.ok, error: report.error, printed: report.output?.slice(0, 300), state: 'kept' });
        this.changed();
      },
    };
    const where = this.where(ctx);
    const turnStart = this.entries.length;
    const hints = addressHints(question, ctx.tab).map((h) => `\n[Note: ${h}]`).join('');
    this.entries.push({ kind: 'user', text: question, where: from ? `${from} (outside AI) · ${where}` : where, path: ctx.address ? workspace.pathOf(ctx.tab, ctx.address) : null });
    this.messages.push({ role: 'user', text: `[Asked from ${ctx.address ? `${workspace.pathOf(ctx.tab, ctx.address)}${ctx.line ? `, line ${ctx.line} of its code` : ''}` : `the ${ctx.tab} tab`}]${hints}\n${question}${ctx.selection ? `\n[The person selected this text in the cell]\n${ctx.selection.slice(0, 800)}` : ''}` });
    this.trim();
    this.busy = true;
    this.abort = new AbortController();
    // The seconds of "last sign of life" are re-drawn once a second; they are measured, not invented (see jobs.ts).
    this.ticker = window.setInterval(() => this.changed(), 1000);
    const info = describeModel();
    // Every message of this turn says what caused it, so the whole chain can be followed back to the question (router tool 'trace').
    let link = router.notify(from || 'you', CLIENT, 'chat/question', { characters: question.length });
    const chat = jobs.start('chat', `answering “${question.slice(0, 40)}${question.length > 40 ? '…' : ''}”`, { stallAfterSeconds: 3600 });
    const stopWatching = jobs.onCancel(() => this.abort?.abort());
    this.changed();

    let answer = '';
    let fitNoted = false;
    let tightNoted = false;
    try {
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        // On the last round the model gets no tools, so it has to answer with what it has learned.
        chat.say(round === 0 ? `asking ${info.company} (${info.model}) with ${this.messages.length} message${this.messages.length === 1 ? '' : 's'}` : `asking ${info.company} again with what the tools returned (round ${round + 1})`, false);
        const small = isSmallModel();
        let tools = round < MAX_ROUNDS ? toolsFor({ small, second, tight: false }) : [];
        const write = tools.some((t) => t.name === 'write_code');
        const system = `${buildPrompt({ small, write })}${second && !small ? LOCAL_PROMPT : ''}\n${small ? '' : `(Your memory holds ${memoryInfo().count} notes.)`}`;
        // The model can only hold so much in mind. Make the conversation fit (shortening old, long tool answers first) and say so.
        let fitted = fit(system, tools, this.messages);
        if (fitted.tooBig && tools.length) {
          tools = toolsFor({ small, second, tight: true });
          fitted = fit(system, tools, this.messages);
          if (!tightNoted) {
            tightNoted = true;
            this.note(`🔋 This model’s memory is small (${kilo(ammo.state.window ?? 0)} tokens), so I use fewer tools. A grown-up can give it more memory in ⚙ (“Memory of the chat”).`);
          }
        }
        if ((fitted.shortened || fitted.dropped) && !fitNoted) {
          fitNoted = true;
          this.note(`🔋 The model’s memory was nearly full, so I shortened ${fitted.shortened ? `${fitted.shortened} long answer${fitted.shortened === 1 ? '' : 's'}` : ''}${fitted.shortened && fitted.dropped ? ' and ' : ''}${fitted.dropped ? 'the oldest part of this chat' : ''} to make room.`);
        }
        chat.say(`memory check: about ${kilo(fitted.estimate)} of ${fitted.room ? kilo(fitted.room) : '?'} tokens${fitted.shortened || fitted.dropped ? ' (shortened to fit)' : ''}`, false);
        // The model is reached by fetch, not over the router, so the router is told: the chat shows up in its traffic.
        const modelBox = getSettings().provider === 'local' ? 'ollama' : 'helper';
        link = router.notify(CLIENT, modelBox, 'llm/complete', { round: round + 1, messages: this.messages.length, tools: tools.length }, link);
        const reply = await provider.complete(system, this.messages, tools, this.abort.signal);
        link = router.notify(modelBox, CLIENT, 'llm/reply', { toolCalls: reply.toolCalls.length, characters: reply.text.length }, link);
        setTurnTrace(link);
        this.messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
        if (reply.text.trim()) answer = reply.text.trim();
        if (!reply.toolCalls.length) break;
        for (const call of reply.toolCalls) {
          chat.say(`running the tool ${call.name}`, false);
          const tool = jobs.start('tool', call.name, { stallAfterSeconds: 3600 });
          tool.say(toolStatus(call), false);
          let result: string;
          try {
            result = await guarded(runTool(host, call.name, call.args), this.abort.signal, call.name);
            tool.done(`${result.length} characters back`);
          } catch (err) {
            if (this.abort.signal.aborted) throw err;
            // A tool that hangs must not leave a child waiting: say so to the model, which then answers with what it has.
            const message = err instanceof Error ? err.message : String(err);
            result = JSON.stringify({ error: message });
            tool.fail(message);
          }
          this.messages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, text: result });
        }
      }
      if (!answer) answer = 'I do not have an answer for that one. Could you ask it in another way?';
      this.entries.push({ kind: 'ai', text: answer, via: info.short });
      // If the helper's own code still does not run, say it in calm words: the person should not be left guessing.
      const mine = this.entries.slice(turnStart).filter((e): e is Extract<Entry, { kind: 'wrote' }> => e.kind === 'wrote');
      const last = mine[mine.length - 1];
      if (last && !last.ok) this.entries.push({ kind: 'note', text: `The code the helper wrote in ${last.path} still has a problem, so it does not work yet. You can press ↶ Undo, ask again in other words, or ask a grown-up to pick a bigger model in ⚙.` });
      // Some models write the code into the answer instead of calling suggest_code: still give the person a button.
      if (!proposed) {
        const rescued = rescueCode(answer, question, ctx);
        if (rescued) this.entries.push({ kind: 'proposal', ...rescued, afterLine: null, state: 'open' });
      }
      chat.done('answered');
      router.notify(CLIENT, from || 'you', 'chat/answer', { characters: answer.length }, link);
      return { ok: true, text: answer };
    } catch (err) {
      if (this.abort?.signal.aborted) {
        chat.cancel();
        this.entries.push({ kind: 'note', text: 'Stopped.' });
        // Remove the unanswered tail so the next question starts clean.
        const last = this.messages.map((m) => m.role).lastIndexOf('user');
        if (last >= 0) this.messages.length = last;
        return { ok: false, text: 'Stopped.' };
      }
      const text = friendly(err);
      chat.fail(text);
      this.entries.push({ kind: 'error', text });
      const last = this.messages.map((m) => m.role).lastIndexOf('user');
      if (last >= 0) this.messages.length = last;
      return { ok: false, text };
    } finally {
      window.clearInterval(this.ticker);
      stopWatching();
      setTurnTrace(undefined);
      this.busy = false;
      this.abort = null;
      this.changed();
    }
  }
}

/** The code blocks of an answer that are TypeScript or JavaScript (or have no language), found line by line so a closing fence is never taken for an opening one. */
function codeBlocks(answer: string): string[] {
  const blocks: string[] = [];
  let open: { lang: string; lines: string[] } | null = null;
  for (const line of answer.split('\n')) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence && !open) open = { lang: fence[1].trim().toLowerCase(), lines: [] };
    else if (fence && open) {
      if (['', 'ts', 'typescript', 'js', 'javascript'].includes(open.lang) && open.lines.join('').trim()) blocks.push(open.lines.join('\n').trim());
      open = null;
    } else open?.lines.push(line);
  }
  return blocks;
}

/**
 * The biggest TypeScript/JavaScript block in an answer, and the cell it is meant for: a cell the question names,
 * else the cell the question was asked from, else one the answer names explicitly (a path like /lab/A16 or
 * "cell A16"). Null when there is no code or no cell that can take it.
 */
export function rescueCode(answer: string, question: string, ctx: AiContext): { path: string; code: string; note: string } | null {
  const blocks = codeBlocks(answer);
  if (!blocks.length) return null;
  const code = blocks.reduce((a, b) => (b.length > a.length ? b : a));
  const prose = answer.replace(/```[\s\S]*?```/g, ' ');
  const cellName = (tab: string | undefined, address: string): string => (tab ? `/${tab}/${address.toUpperCase()}` : address.toUpperCase());
  const inQuestion = [...question.matchAll(/(?:\/([a-z][\w-]*)\/)?\b([A-Za-z]\d{1,3})\b/g)].map((m) => cellName(m[1], m[2]));
  const inAnswer = [...prose.matchAll(/(?:\/([a-z][\w-]*)\/([A-Za-z]\d{1,3})\b)|(?:\bcell\s+([A-Za-z]\d{1,3})\b)/gi)].map((m) => cellName(m[1], m[2] ?? m[3]));
  const candidates = [...inQuestion, ...(ctx.address ? [ctx.address] : []), ...inAnswer];
  for (const candidate of candidates) {
    const hit = workspace.resolve(candidate, ctx.tab);
    if ('error' in hit || hit.tab.sheet.isBoardAddress(hit.address)) continue;
    return { path: workspace.pathOf(hit.tab.id, hit.address), code, note: 'The helper wrote this code in its answer: here is the button for it.' };
  }
  return null;
}

/** Waits for a tool, but never longer than the limit, and stops waiting at once when the person presses Stop. */
function guarded<T>(work: Promise<T>, signal: AbortSignal, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${name} took longer than ${TOOL_TIMEOUT_MS / 1000} seconds and was stopped. Answer with what you have.`)), TOOL_TIMEOUT_MS);
    const stop = (): void => reject(new Error('Stopped.'));
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    });
  });
}

function toolStatus(call: ToolCall): string {
  const path = String(call.args.path ?? 'a cell');
  switch (call.name) {
    case 'look_around':
      return 'looking around…';
    case 'read_cell':
      return `reading ${path}…`;
    case 'read_guide':
      return 'reading the guide…';
    case 'suggest_code':
      return 'writing some code…';
    case 'goto_cell':
      return `taking you to ${path}…`;
    case 'run_cell':
      return `running ${path} and waiting for it to finish…`;
    case 'find_free_cell':
      return 'looking for an empty cell…';
    case 'write_code':
      return 'typing code into an empty cell, then running it (about 10 seconds)…';
    default:
      return `${call.name.replace(/_/g, ' ')}…`;
  }
}
