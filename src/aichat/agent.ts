import { friendly, makeProvider, type ChatMsg, type ToolCall } from './providers';
import { localAssistantReady, probeLocal } from './localAi';
import { router } from '../mcp/router';
import { getSettings, localWindow } from './config';
import { CLIENT, runTool, setTurnTrace, toolsFor, WriteLedger, type AiContext, type FixResult, type ToolHost } from './tools';
import { workspace } from '../workspace';
import { jobs } from './jobs';
import { describeModel, isSmallModel } from './modelInfo';
import { memoryInfo } from './memory';
import { addressHints } from './cellPaths';
import { focusPoints } from '../editor/focusPoints';
import { ammo, fit, kilo } from './ammo';
import { paidWindow } from './cost';
import { RULES, docUrls, standingDirectives } from './docs';
import { bibleFor } from '../ai/bible';
import { goalPrompt, MAX_PLAY_NUDGES, MAX_PLAY_ROUNDS, playGoalFrom, type PlayGoal } from './playGoal';
import { markOriented } from '../ai/orientation';
import { bellForAnswer } from './bell';

const MAX_ROUNDS = 6;
/** When the helper works on its own it may go round more often: write, check, run, read, fix, again. */
const MAX_ROUNDS_AUTONOMOUS = 16;
/** How often a helper that stops while its code still has problems is told to carry on. */
const MAX_NUDGES = 4;
const MAX_MESSAGES = 24;
/** No single tool may keep a child waiting longer than this (the longest honest job is typing code, then running it). */
const TOOL_TIMEOUT_MS = 40_000;

const BASE_PROMPT = `You are the helper inside "Lattakker Sheet", a spreadsheet of small TypeScript programs (cells) that also holds a board game. Most people who ask you are children who are learning to program, and a tutor may be near.

You ARE connected to the app and you have tools to use it (look at the list your tools come with). Use them instead of guessing, and never say you cannot reach the app or must ask the person to run code for you.`;

// Every rule text comes from README.md chapter 11.5, the one home of the rules (tests/rulesConsistency guards these names).
const CHANGE_RULE_ASK = (): string => RULES.section('Helper: changing cells by asking');
const CHANGE_RULE_AUTONOMOUS = (): string => RULES.section('Helper: changing cells on its own');
const CHANGE_RULE_WRITE = (): string => RULES.section('Helper: changing cells, empty ones only');
const TOOL_HINTS = (): string => RULES.section('Helper: using the tools');
const MEMORY_RULES = (): string => RULES.section('Helper: memory and discovery');
const SMALL_RULES = (): string => RULES.section('Helper: small models');

/** Where the documents live, for a model that can open links itself (the built-in helper reads them with read_docs). */
function pointers(): string {
  const u = docUrls();
  return `\nDocuments (read them with read_docs; if you can open links, these are the addresses): index ${u.index} · API ${u.api} · examples ${u.examples} · README ${u.readme}`;
}

/** The owner's standing directives (with their strengths), for every model: a small one gets them too. */
function directives(): string {
  const text = standingDirectives();
  return text ? `\n\nStanding directives:\n${text}` : '';
}

/** The fixed instructions, shaped for this model: the shared rules (README.md chapter 11.5), how to use the tools, and where the documents are. A small model gets no memory tools. */
export function buildPrompt(options: { small: boolean; write: boolean }): string {
  return `${BASE_PROMPT} ${options.write ? (getSettings().autonomous ? CHANGE_RULE_AUTONOMOUS() : CHANGE_RULE_WRITE()) : CHANGE_RULE_ASK()}\n\nFirst contact (your very first tool call: read_docs with doc "readme"):\n${RULES.first}\n\nRules (the same for every AI that helps here):\n${RULES.behave}\n\nHow to work:\n${RULES.coder}${directives()}\n\nCell code:\n${RULES.cell}\n\nHow to use your tools:\n${TOOL_HINTS()}\n${options.small ? SMALL_RULES() : MEMORY_RULES()}${pointers()}`;
}

const LOCAL_PROMPT = (): string => `\n${RULES.section('Helper: the second brain')}`;

export type Entry =
  | { kind: 'user'; text: string; where: string; path: string | null }
  | { kind: 'ai'; text: string; via: string }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'proposal'; path: string; code: string; note: string; afterLine: number | null; state: 'open' | 'typed' | 'dismissed' }
  | { kind: 'wrote'; path: string; code: string; ok: boolean; error?: string; printed?: string; /** What the cell held before (somebody else's code the helper added to), or null when undo empties it. */ before?: string | null; /** What the code editor underlined in it ("line 2: ..."). */ mistakes?: string[]; state: 'kept' | 'undone' };

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

  /** Set by the chat window: puts text into the box the last question came from. */
  fillInput: ((text: string) => { ok: boolean; error?: string }) | null = null;

  /** Set by the chat window: presses the "✏ fix" button of the question box. */
  clickFix: ((text?: string) => Promise<FixResult>) | null = null;

  constructor(private readonly host: Omit<ToolHost, 'context' | 'suggest' | 'wrote' | 'ledger' | 'fillInput' | 'clickFix'>) {}

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
    return { ...this.host, context: () => this.active, suggest: () => {}, wrote: () => {}, ledger: this.ledger, fillInput: (text) => this.fillInput?.(text) ?? { ok: false, error: 'There is no question box to fill.' }, clickFix: (text) => this.clickFix?.(text) ?? Promise.resolve({ ok: false, error: 'There is no question box.' }) };
  }

  /** Counts the moves made for the standing task, and drops the task when the router held the helper back. */
  private tally(tool: string, result: string): void {
    const goal = this.playGoal;
    if (!goal) return;
    if (result.includes('was running away')) this.playGoal = null;
    else if (tool === 'make_move' && !result.includes('"ok":false') && !result.includes('"error"')) goal.done++;
  }

  /** True while the standing task is not finished: the game is not over (nobody has won), and the number of moves asked for is not reached. */
  private stillToPlay(): boolean {
    const goal = this.playGoal;
    if (!goal) return false;
    if (goal.target !== null && goal.done >= goal.target) return false;
    const s = this.host.state() as { phase?: string; winner?: unknown } | undefined;
    return !!s && s.phase !== 'over' && !s.winner;
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

  /** The model's fixed instructions: a model on this computer also gets the Bible (the rules and the README chapters that fit) up front, because it cannot open the README itself. */
  private async systemFor(small: boolean, write: boolean, second: boolean): Promise<{ system: string; hasReadme: boolean }> {
    const bible = getSettings().provider === 'local' ? await bibleFor(localWindow(), 0.35) : null;
    const system = `${bible ? `${bible.text}\n\n` : ''}${buildPrompt({ small, write })}${second && !small ? LOCAL_PROMPT() : ''}${goalPrompt(this.playGoal)}\n${small ? '' : `(Your memory holds ${memoryInfo().count} notes.)`}`;
    return { system, hasReadme: !!bible?.hasReadme };
  }

  private warmedAt = 0;
  private playGoal: PlayGoal | null = null;

  /**
   * Has Ollama read the fixed start of every conversation (the rules, the README, the tools) before the first question,
   * so a new chat or a page reload does not wait for it. Costs nothing when Ollama still has it. Never throws, never
   * loads a model that is not already in memory, never pushes another one out.
   */
  async warmUp(force = false): Promise<void> {
    if (this.busy || getSettings().provider !== 'local') return;
    if (!force && performance.now() - this.warmedAt < 5 * 60000 && this.warmedAt) return;
    const provider = makeProvider();
    if (!provider?.warm) return;
    this.warmedAt = performance.now() || 1;
    try {
      await probeLocal();
      const second = localAssistantReady();
      const small = isSmallModel();
      const tools = toolsFor({ small, second, tight: false });
      const { system } = await this.systemFor(small, tools.some((t) => t.name === 'write_code'), second);
      await provider.warm(system, tools);
    } catch {
      this.warmedAt = 0;
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
    this.playGoal = playGoalFrom(question, this.playGoal);
    // Is the second brain (a local model) there? Looked up at most every 15 s.
    await probeLocal();
    const second = localAssistantReady();
    let proposed = false;
    const host: ToolHost = {
      ...this.host,
      context: () => this.active,
      ledger: this.ledger,
      fillInput: (text) => this.fillInput?.(text) ?? { ok: false, error: 'There is no question box to fill.' },
      clickFix: (text) => this.clickFix?.(text) ?? Promise.resolve({ ok: false, error: 'There is no question box.' }),
      suggest: (path, code, note, afterLine) => {
        proposed = true;
        this.entries.push({ kind: 'proposal', path, code, note, afterLine, state: 'open' });
      },
      wrote: (path, code, report, before, mistakes) => {
        proposed = true;
        this.entries.push({ kind: 'wrote', path, code, ok: report.ok, error: report.error, printed: report.output?.slice(0, 300), before, mistakes, state: 'kept' });
        this.changed();
      },
    };
    const where = this.where(ctx);
    const turnStart = this.entries.length;
    const hints = addressHints(question, ctx.tab).map((h) => `\n[Note: ${h}]`).join('');
    // The places the person marked with 📌 (and what is selected right now), so the question comes with its focus.
    const focus = focusPoints.note();
    const picked = ctx.selection && !focus.includes(ctx.selection.slice(0, 120)) ? `\n[The person selected this text in the cell]\n${ctx.selection.slice(0, 800)}` : '';
    this.entries.push({ kind: 'user', text: question, where: from ? `${from} (outside AI) · ${where}` : where, path: ctx.address ? workspace.pathOf(ctx.tab, ctx.address) : null });
    this.messages.push({ role: 'user', text: `[Asked from ${ctx.address ? `${workspace.pathOf(ctx.tab, ctx.address)}${ctx.line ? `, line ${ctx.line} of its code` : ''}` : `the ${ctx.tab} tab`}]${hints}\n${question}${focus ? `\n${focus}` : ''}${picked}` });
    this.trim();
    this.busy = true;
    const askedAt = performance.now();
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
      const rounds = this.playGoal ? MAX_PLAY_ROUNDS : getSettings().autonomous ? MAX_ROUNDS_AUTONOMOUS : MAX_ROUNDS;
      let nudges = 0;
      let playNudges = 0;
      this.ledger.pending = null;
      for (let round = 0; round <= rounds; round++) {
        // On the last round the model gets no tools, so it has to answer with what it has learned.
        chat.say(round === 0 ? `asking ${info.company} (${info.model}) with ${this.messages.length} message${this.messages.length === 1 ? '' : 's'}` : `asking ${info.company} again with what the tools returned (round ${round + 1})`, false);
        const small = isSmallModel();
        let tools = round < rounds ? toolsFor({ small, second, tight: false }) : [];
        const write = tools.some((t) => t.name === 'write_code');
        // A model on this computer has no way to open the README itself: it is given the Bible (the rules and the README chapters that fit) up front.
        ammo.setWindow(getSettings().provider === 'local' ? localWindow() : getSettings().provider === 'openrouter' ? paidWindow(getSettings().openrouter.model, getSettings().openrouter.context) : null);
        const { system, hasReadme } = await this.systemFor(small, write, second);
        if (hasReadme) markOriented('helper');
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
        if (!reply.toolCalls.length) {
          // It stopped, but its own code still has problems and it still has turns: carry on, the way a person would.
          if (this.ledger.pending && getSettings().autonomous && write && nudges < MAX_NUDGES && round < rounds - 1) {
            nudges++;
            chat.say(`the code still has a problem (${this.ledger.pending}); asking the helper to carry on (${nudges} of ${MAX_NUDGES})`, true);
            this.messages.push({ role: 'user', text: `[Automatic message, not from the person] Not finished: ${this.ledger.pending}. Fix it with write_code (the complete code of the cell), then check the problems and the output again. Only answer when it works, or when you have to tell the person honestly why it does not.` });
            continue;
          }
          // The person asked for a game to be played on, and the model only talked about it: it is still Red's turn, so say so and carry on.
          if (this.playGoal && playNudges < MAX_PLAY_NUDGES && round < rounds - 1 && this.stillToPlay()) {
            playNudges++;
            chat.say(`the standing task is not finished (${this.playGoal.done}${this.playGoal.target === null ? '' : ` of ${this.playGoal.target}`} moves); asking the helper to carry on (${playNudges})`, true);
            this.messages.push({ role: 'user', text: `[Automatic message, not from the person] The task is not finished and the game is not over. Do not answer or ask a question: call make_move now (start_battle first if the battle has not started; legal_moves if you need to choose).` });
            continue;
          }
          break;
        }
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
          if (this.playGoal) this.tally(call.name, result);
        }
      }
      if (this.playGoal && !this.stillToPlay()) this.playGoal = null;
      if (!answer) answer = 'I do not have an answer for that one. Could you ask it in another way?';
      this.entries.push({ kind: 'ai', text: answer, via: info.short });
      bellForAnswer(performance.now() - askedAt);
      // If the helper's own code still does not run, say it in calm words: the person should not be left guessing.
      const mine = this.entries.slice(turnStart).filter((e): e is Extract<Entry, { kind: 'wrote' }> => e.kind === 'wrote');
      const last = mine[mine.length - 1];
      const pending = this.ledger.pending as string | null;
      if (last && (!last.ok || pending)) this.entries.push({ kind: 'note', text: `The code the helper wrote in ${last.path} still has a problem${pending ? ` (${pending.replace(`${last.path} `, '')})` : ''}, so it does not work yet. You can press ↶ Undo, ask again in other words, or ask a grown-up to pick a bigger model in ⚙.` });
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
    case 'put_in_input':
      return 'putting the text in your question box…';
    case 'click_fix_button':
      return 'pressing the ✏ fix button (the model corrects the spelling)…';
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
