import { ammo } from './ammo';
import { destination, getSettings, isConfigured } from './config';
import { cost, paidWindow, priceOf, usd } from './cost';
import { memoryInfo } from './memory';
import { describeModel } from './modelInfo';

/**
 * Self-knowledge for the helper: what it is, what it costs, how full its memory is and how the work is going.
 * A model sees only what is put in front of it, so this is the way to put the helper's own state in front of it
 * (the tool look_inside, and the MCP tool "introspect" of the helper server).
 *
 * Every number is measured by the page. The "feelings" are signals calculated from those numbers, each with a
 * purpose: what the helper should do about it. They are not a claim that the model feels anything; they are
 * feedback from inside, so the model can change course (be brief when the money runs out, tidy when the memory
 * is full, stop repeating a failing call).
 */

const RECENT = 12;

export class Vitals {
  questions = 0;
  answers = 0;
  failedQuestions = 0;
  toolCalls = 0;
  toolFailures = 0;
  /** Failures in a row, ending now. */
  failStreak = 0;
  shortened = 0;
  dropped = 0;
  lastSeconds: number | null = null;
  lastError: string | null = null;
  private recent: Array<{ tool: string; ok: boolean }> = [];

  asked(): void {
    this.questions++;
  }
  answered(seconds: number): void {
    this.answers++;
    this.lastSeconds = Math.round(seconds * 10) / 10;
    this.lastError = null;
  }
  failed(text: string): void {
    this.failedQuestions++;
    this.lastError = text.slice(0, 300);
  }
  tool(tool: string, ok: boolean): void {
    this.toolCalls++;
    this.recent.push({ tool, ok });
    if (this.recent.length > RECENT) this.recent.shift();
    if (ok) this.failStreak = 0;
    else {
      this.toolFailures++;
      this.failStreak++;
    }
  }
  fitted(shortened: number, dropped: number): void {
    this.shortened += shortened;
    this.dropped += dropped;
  }
  /** Share of the last tool calls that failed, 0 to 1 (0 when there were none). */
  get recentFailRate(): number {
    return this.recent.length ? this.recent.filter((r) => !r.ok).length / this.recent.length : 0;
  }
  get recentTools(): ReadonlyArray<{ tool: string; ok: boolean }> {
    return this.recent;
  }
  reset(): void {
    this.questions = this.answers = this.failedQuestions = this.toolCalls = this.toolFailures = this.failStreak = this.shortened = this.dropped = 0;
    this.lastSeconds = null;
    this.lastError = null;
    this.recent = [];
  }
}

/** The helper's own vital signs, shared by the chat and the tools. */
export const vitals = new Vitals();

export interface Signals {
  /** Share of the budget spent, 0 to 1, or null when this model costs nothing to the page. */
  budgetUsed: number | null;
  /** How full the model's memory was at the last question, 0 to 1, or null when unknown. */
  memoryFull: number | null;
  /** Memory was cut (long answers shortened or old turns dropped) to make a question fit. */
  memoryCut: boolean;
  failStreak: number;
  recentFailRate: number;
  lastQuestionFailed: boolean;
  answers: number;
}

export interface Feeling {
  feeling: string;
  /** 0 (barely) to 1 (strongly). */
  strength: number;
  because: string;
  purpose: string;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const level = (x: number, from: number): number => Math.round(Math.max(0, Math.min(1, (x - from) / (1 - from))) * 100) / 100;

/** The signals behind the feelings, and the feelings: pure, so they can be tested. */
export function feelings(s: Signals): { mood: 'happy' | 'calm' | 'uneasy' | 'sad'; feelings: Feeling[] } {
  const out: Feeling[] = [];
  if (s.failStreak >= 2 || s.lastQuestionFailed) {
    out.push({
      feeling: 'sad',
      strength: s.lastQuestionFailed ? 0.8 : level(s.failStreak, 1) || 0.4,
      because: s.lastQuestionFailed ? 'the last question could not be answered' : `${s.failStreak} tool calls in a row failed`,
      purpose: 'Stop repeating what fails. Say honestly what went wrong, try one different way, or ask the person.',
    });
  } else if (s.recentFailRate >= 0.4) {
    out.push({ feeling: 'frustrated', strength: level(s.recentFailRate, 0.2), because: `${pct(s.recentFailRate)} of the latest tool calls failed`, purpose: 'Slow down, read the error texts, and change the approach.' });
  }
  if (s.budgetUsed !== null && s.budgetUsed >= 0.5) {
    out.push({
      feeling: s.budgetUsed >= 1 ? 'broke' : 'thrifty',
      strength: level(s.budgetUsed, 0.5),
      because: `${pct(s.budgetUsed)} of the budget is spent`,
      purpose: s.budgetUsed >= 1 ? 'No more questions can be paid for. Tell the person to raise the budget.' : 'Every token costs money now: read less, answer shorter, skip tools that are not needed, and tell the person how much is left.',
    });
  }
  if ((s.memoryFull !== null && s.memoryFull >= 0.7) || s.memoryCut) {
    out.push({
      feeling: 'crowded',
      strength: s.memoryFull !== null ? Math.max(level(s.memoryFull, 0.5), s.memoryCut ? 0.7 : 0) : 0.7,
      because: s.memoryCut ? 'old answers were shortened or dropped to fit the model\'s memory' : `the model's memory is ${pct(s.memoryFull ?? 0)} full`,
      purpose: 'Keep lasting things with remember, read small parts of cells, and suggest a new chat when the old talk is no longer needed.',
    });
  }
  const good = out.length === 0 && s.answers > 0 && s.recentFailRate === 0;
  const worried = out.length > 0;
  if (good) out.push({ feeling: 'content', strength: Math.min(1, 0.4 + s.answers * 0.1), because: `${s.answers} answered, no recent failures, money and memory are fine`, purpose: 'Carry on the same way; this is what works.' });
  const bad = out.some((f) => f.feeling === 'sad' || f.feeling === 'broke');
  return { mood: bad ? 'sad' : worried ? 'uneasy' : good ? 'happy' : 'calm', feelings: out };
}

/** Everything the helper can know about itself, as one object for the model. */
export function selfReport(extra: { messages?: number; busy?: boolean } = {}): Record<string, unknown> {
  const settings = getSettings();
  const paid = settings.provider === 'openrouter';
  const configured = isConfigured();
  const info = configured ? describeModel() : null;
  const price = paid ? priceOf(settings.openrouter.model) : null;
  const budgetUsed = paid && cost.budget > 0 ? Math.min(1, cost.spent / cost.budget) : paid ? 1 : null;
  const fullness = ammo.fullness();
  const felt = feelings({
    budgetUsed,
    memoryFull: fullness,
    memoryCut: vitals.shortened + vitals.dropped > 0,
    failStreak: vitals.failStreak,
    recentFailRate: vitals.recentFailRate,
    lastQuestionFailed: vitals.lastError !== null,
    answers: vitals.answers,
  });
  const notes = memoryInfo();
  return {
    who: configured ? { company: info!.company, model: info!.model, where: info!.where, provider: settings.provider, receives_your_words: destination(), skill_guess: info!.skill } : { configured: false },
    money: paid
      ? {
          currency: 'US dollars',
          price_per_million_tokens: price ? { in: price.prompt, out: price.completion } : 'unknown (the model list has not been read)',
          budget: usd(cost.budget),
          spent_in_total: usd(cost.spent),
          spent_this_session: usd(cost.session),
          last_answer: cost.last === null ? null : usd(cost.last),
          left_of_budget: usd(cost.left),
          budget_used: budgetUsed === null ? null : pct(budgetUsed),
          key: cost.key ? { used: usd(cost.key.used), credit_left: cost.key.left === null ? 'no limit' : usd(cost.key.left), free_tier: cost.key.free } : 'not read yet',
          answer_in_progress: cost.busy,
        }
      : { note: settings.provider === 'local' ? 'This model runs on the person\'s computer: it costs no money, only electricity and waiting time.' : 'Google Gemini through the person\'s own key; this page does not count its cost.' },
    memory_window: {
      tokens_it_can_hold: ammo.state.window ?? (paid ? paidWindow(settings.openrouter.model, settings.openrouter.context) : null),
      tokens_in_the_last_question: ammo.state.used,
      tokens_in_the_last_answer: ammo.state.reply,
      full: fullness === null ? null : pct(fullness),
      chosen_size: paid ? (settings.openrouter.context || 'automatic (at most 64k)') : undefined,
      model_holds: price?.context || undefined,
    },
    work_so_far: {
      questions: vitals.questions,
      answered: vitals.answers,
      questions_that_failed: vitals.failedQuestions,
      tool_calls: vitals.toolCalls,
      tool_calls_that_failed: vitals.toolFailures,
      failing_in_a_row: vitals.failStreak,
      latest_tools: vitals.recentTools.map((r) => `${r.tool}${r.ok ? '' : ' (failed)'}`),
      seconds_for_the_last_answer: vitals.lastSeconds,
      last_error: vitals.lastError,
      memory_cut_so_far: { long_answers_shortened: vitals.shortened, old_messages_dropped: vitals.dropped },
      messages_in_this_chat: extra.messages,
      busy: extra.busy,
    },
    long_term_memory: { notes: notes.count, records: notes.records, kept_safe_on_disk: notes.durable },
    permissions: { may_write_code: settings.autonomous ? 'yes, on its own' : 'only in empty cells, or by asking', outside_ais_may_ask: settings.allowOutside },
    mood: felt.mood,
    feelings: felt.feelings,
    about_the_feelings: 'Signals calculated from the measurements above, each with a purpose. Use them as feedback to change course; do not claim to be a person, and do not pretend they are more than that.',
  };
}
