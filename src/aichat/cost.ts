import { getSettings, paidSlot, type PaidProviderId } from './config';
import { estimateTokens, kilo } from './ammo';
import { cacheFactor } from './compact';

/**
 * Money. A model on this computer is free; OpenRouter charges per token, and a helper that works on its own can
 * ask many questions in a row. So the person always sees what it costs: the price of the chosen model, what the
 * answer being written costs right now (an estimate, replaced by the real number when it arrives), what was spent
 * in total, and how much of the budget is left. When the budget is used up the helper stops asking.
 */

/** Dollars per million tokens, and how many tokens the model can hold. */
export interface Price {
  prompt: number;
  completion: number;
  context: number;
}

export interface PricedModel {
  id: string;
  price: Price;
  tools: boolean;
}

/** OpenRouter's keys keep their old names; Eden AI's get a suffix. Each paid provider has its own prices and its own spent total, since their model names and money are different. */
const PRICES_KEY = 'lattakker:ai:prices';
const SPENT_KEY = 'lattakker:ai:spent';
const stored = (base: string, provider: PaidProviderId): string => (provider === 'eden' ? `${base}:eden` : base);
const activeProvider = (): PaidProviderId => (getSettings().provider === 'eden' ? 'eden' : 'openrouter');
/** Never let the page assume a window bigger than this for budgeting: a long chat on a big model gets expensive. */
export const BUDGET_WINDOW = 65536;

const prices: Record<PaidProviderId, Map<string, Price>> = { openrouter: new Map(), eden: new Map() };

/** A list of models: OpenRouter gives prices as dollars per token in strings and the tools in `supported_parameters`; Eden AI gives numbers in `pricing.input_cost_per_token` and `capabilities.supports_function_calling`. */
export function parseModels(json: unknown): PricedModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: PricedModel[] = [];
  for (const m of data as Array<Record<string, unknown>>) {
    if (typeof m?.id !== 'string' || !m.id) continue;
    const pricing = (m.pricing ?? {}) as Record<string, unknown>;
    const perM = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n * 1e6 : 0;
    };
    const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as unknown[]) : [];
    const caps = (m.capabilities ?? {}) as Record<string, unknown>;
    if (m.mode !== undefined && m.mode !== 'chat') continue;
    out.push({
      id: m.id,
      price: { prompt: perM(pricing.prompt ?? pricing.input_cost_per_token), completion: perM(pricing.completion ?? pricing.output_cost_per_token), context: Number(m.context_length) > 0 ? Number(m.context_length) : 0 },
      tools: params.includes('tools') || caps.supports_function_calling === true,
    });
  }
  return out;
}

export function setPrices(models: PricedModel[], provider: PaidProviderId = activeProvider()): void {
  prices[provider].clear();
  for (const m of models) prices[provider].set(m.id, m.price);
  try {
    localStorage.setItem(stored(PRICES_KEY, provider), JSON.stringify(models.map((m) => [m.id, m.price.prompt, m.price.completion, m.price.context])));
  } catch {
    // too big or blocked: the prices are fetched again next time
  }
  notify();
}

function loadPrices(): void {
  for (const provider of ['openrouter', 'eden'] as const) {
    try {
      const raw = JSON.parse(localStorage.getItem(stored(PRICES_KEY, provider)) ?? '[]') as Array<[string, number, number, number]>;
      for (const [id, prompt, completion, context] of raw) prices[provider].set(id, { prompt, completion, context });
    } catch {
      // no cache
    }
  }
}

export const priceOf = (model: string): Price | null => prices[activeProvider()].get(model) ?? null;

/** The window the page budgets for on a paid model. 0 = automatic: what the model holds, but never more than BUDGET_WINDOW. A chosen size is the page's own limit (OpenRouter has no setting for it), never above what the model holds. */
export const paidWindow = (model: string, chosen = 0): number => {
  const held = priceOf(model)?.context || 0;
  if (chosen > 0) return held ? Math.min(chosen, held) : chosen;
  return Math.min(held || BUDGET_WINDOW, BUDGET_WINDOW);
};

export const tokenCost = (price: Price, promptTokens: number, completionTokens: number): number => (promptTokens * price.prompt + completionTokens * price.completion) / 1e6;

/** Dollars, with as many decimals as it takes to see a small amount. */
export function usd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

const perM = (n: number): string => (n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);

/** "$3.00 in / $15.00 out per million tokens", or "free". */
export function priceText(price: Price | null): string {
  if (!price) return 'price unknown';
  if (!price.prompt && !price.completion) return 'free';
  return `${perM(price.prompt)} in / ${perM(price.completion)} out per 1M tokens`;
}

/** A line for the model list: the name with what it costs. */
export function modelLabel(id: string): string {
  const p = priceOf(id);
  return p ? `${id}  ·  ${priceText(p)}` : id;
}

export interface KeyInfo {
  /** Dollars the key has used (at OpenRouter, over all programs that use it). */
  used: number;
  /** Dollars the key may use, or null when it has no limit. */
  limit: number | null;
  left: number | null;
  free: boolean;
}

export function parseKeyInfo(json: unknown): KeyInfo | null {
  const d = (json as { data?: Record<string, unknown> })?.data;
  if (!d || typeof d !== 'object') return null;
  const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const limit = num(d.limit);
  return { used: num(d.usage) ?? 0, limit, left: num(d.limit_remaining) ?? (limit === null ? null : Math.max(0, limit - (num(d.usage) ?? 0))), free: d.is_free_tier === true };
}

const listeners: Array<() => void> = [];
const notify = (): void => listeners.forEach((l) => l());

/** What OpenRouter's /credits says: the credit bought so far and the part used. The limit on a key is only a ceiling; this is the real money. */
export interface Account {
  credits: number;
  used: number;
  left: number;
}

export function parseCredits(json: unknown): Account | null {
  const d = (json as { data?: Record<string, unknown> })?.data;
  const credits = Number(d?.total_credits);
  const used = Number(d?.total_usage);
  return d && Number.isFinite(credits) && Number.isFinite(used) ? { credits, used, left: Math.max(0, credits - used) } : null;
}

let account: Account | null = null;

/** OpenRouter's own free router: it picks a free model that can use tools. No credit needed. */
export const FREE_MODEL = 'openrouter/free';

/** Below this much real credit a paid model is not asked any more. */
export const MIN_CREDIT = 0.05;

/** The model to really ask: a paid model is swapped for the free router when the account has no credit left, so the helper keeps working. null = keep the chosen model. */
export function creditFallback(model: string, acct: Account | null = activeProvider() === 'openrouter' ? account : null): string | null {
  if (!acct || acct.left >= MIN_CREDIT || model === FREE_MODEL) return null;
  const price = priceOf(model);
  return price && !price.prompt && !price.completion ? null : FREE_MODEL;
}

async function readCredits(apiKey: string): Promise<Account | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(8000) });
    return res.ok ? parseCredits(await res.json()) : null;
  } catch {
    return null;
  }
}

/** Money counted by this page, per paid provider. */
const books: Record<PaidProviderId, { spent: number; session: number; last: number | null }> = { openrouter: { spent: 0, session: 0, last: null }, eden: { spent: 0, session: 0, last: null } };
const book = (): { spent: number; session: number; last: number | null } => books[activeProvider()];

/** What packing and the provider's cache saved on one question. Dollars are estimates (price of the model times the tokens not paid in full). */
export interface Saving {
  before: number;
  after: number;
  cached: number;
  prompt: number;
  dollars: number;
}
const savings: Record<PaidProviderId, { last: Saving | null; total: number }> = { openrouter: { last: null, total: 0 }, eden: { last: null, total: 0 } };
/** The size of the next question before and after packing (set by the chat just before it asks). */
let packed: { before: number; after: number } | null = null;

function savingOf(f: { price: Price | null; pack: { before: number; after: number } | null; cached: number; promptTokens: number }, model: string): Saving {
  const before = f.pack?.before ?? 0;
  const after = f.pack?.after ?? 0;
  const price = f.price?.prompt ?? 0;
  const packDollars = (estimateTokens(Math.max(0, before - after)) * price) / 1e6;
  const cacheDollars = (f.cached * price * (1 - cacheFactor(model))) / 1e6;
  return { before, after, cached: f.cached, prompt: f.promptTokens, dollars: packDollars + cacheDollars };
}
let keyInfo: KeyInfo | null = null;
let keyAsked = -Infinity;
/** The question being answered now: its estimated price so far. */
let flight: { model: string; price: Price | null; promptTokens: number; chars: number; known: number | null; pack: { before: number; after: number } | null; cached: number; reported: number } | null = null;

for (const provider of ['openrouter', 'eden'] as const) {
  try {
    books[provider].spent = Number(localStorage.getItem(stored(SPENT_KEY, provider))) || 0;
  } catch {
    books[provider].spent = 0;
  }
}
loadPrices();

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

export const cost = {
  onChange(listener: () => void): void {
    listeners.push(listener);
  },
  get spent(): number {
    return book().spent;
  },
  get session(): number {
    return book().session;
  },
  get last(): number | null {
    return book().last;
  },
  get budget(): number {
    return paidSlot().budgetUsd;
  },
  get left(): number {
    return Math.max(0, cost.budget - book().spent);
  },
  get key(): KeyInfo | null {
    return activeProvider() === 'openrouter' ? keyInfo : null;
  },
  /** The money really in the OpenRouter account (bought credit minus used): the only money a question can be paid from. */
  get account(): Account | null {
    return activeProvider() === 'openrouter' ? account : null;
  },
  /** What the answer being written has cost so far, as far as it can be told. */
  get inFlight(): number | null {
    if (!flight) return null;
    if (flight.known !== null) return flight.known;
    return flight.price ? tokenCost(flight.price, flight.promptTokens, estimateTokens(flight.chars)) : null;
  },
  get busy(): boolean {
    return !!flight;
  },
  /** Throws when the budget is used up, so no question is sent that could not be paid for. */
  assertWithin(): void {
    if (book().spent >= cost.budget) {
      throw new BudgetError(`The budget of ${usd(cost.budget)} is used up (${usd(book().spent)} spent). Raise the budget or reset the counter in the settings ⚙ to go on.`);
    }
  },
  /** A question goes out. `requestChars` is its size, used for the estimate until the real number arrives. */
  begin(model: string, requestChars: number): void {
    flight = { model, price: priceOf(model), promptTokens: estimateTokens(requestChars), chars: 0, known: null, pack: packed, cached: 0, reported: 0 };
    savings[activeProvider()].last = savingOf(flight, model);
    notify();
  },
  /** More of the answer has arrived. */
  progress(chars: number): void {
    if (!flight) return;
    flight.chars = chars;
    notify();
  },
  /** The server's own number for this question. */
  report(dollars: number): void {
    if (flight) flight.known = dollars;
  },
  /** The real token counts for this question (a service that reports tokens but not dollars): priced with the model's price. */
  tokens(promptTokens: number, completionTokens: number, cachedTokens = 0): void {
    if (!flight) return;
    flight.reported = promptTokens;
    flight.cached = cachedTokens;
    if (flight.known === null && flight.price) flight.known = tokenCost(flight.price, promptTokens - cachedTokens + cachedTokens * cacheFactor(flight.model), completionTokens);
  },
  /** The chat tells how big the next question is before and after packing (see compact.ts). */
  pack(before: number, after: number): void {
    packed = { before, after };
  },
  /** How many of the prompt tokens the provider read from its cache (OpenRouter and OpenAI-style servers say so), also when they report dollars themselves. */
  cached(cachedTokens: number, promptTokens: number): void {
    if (!flight) return;
    flight.cached = cachedTokens;
    flight.reported = promptTokens;
  },
  /** What was saved on the last question and in all (this page, since it was opened). */
  get saving(): { last: Saving | null; total: number } {
    const s = savings[activeProvider()];
    return { last: s.last, total: s.total };
  },
  /** The question is over: add it up. Without a real number the estimate counts, since a started answer is paid for. */
  finish(started: boolean): void {
    if (!flight) return;
    const amount = flight.known ?? (started ? cost.inFlight : null);
    const sv = savings[activeProvider()];
    if (started || flight.known !== null) {
      sv.last = savingOf({ ...flight, promptTokens: flight.reported || flight.promptTokens }, flight.model);
      sv.total += sv.last.dollars;
    }
    flight = null;
    if (amount !== null && amount > 0) {
      const b = book();
      b.spent += amount;
      b.session += amount;
      b.last = amount;
      try {
        localStorage.setItem(stored(SPENT_KEY, activeProvider()), String(b.spent));
      } catch {
        // the total lasts until the page is closed
      }
    }
    notify();
  },
  /** Start counting the budget from zero. */
  reset(): void {
    const b = book();
    b.spent = 0;
    b.session = 0;
    b.last = null;
    savings[activeProvider()] = { last: null, total: 0 };
    try {
      localStorage.removeItem(stored(SPENT_KEY, activeProvider()));
    } catch {
      // nothing stored
    }
    notify();
  },
  async refreshKey(apiKey: string, force = false): Promise<void> {
    // Only OpenRouter can be asked about its key and its credit; Eden AI does not show a balance through its API (the dashboard does).
    if (!apiKey || activeProvider() !== 'openrouter' || (!force && performance.now() - keyAsked < 15000)) return;
    keyAsked = performance.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) });
      keyInfo = res.ok ? parseKeyInfo(await res.json()) : null;
      account = await readCredits(apiKey);
    } catch {
      keyInfo = null;
    }
    notify();
  },
};

/** The line that is always in view while OpenRouter answers: what it costs, what was spent, what is left. */
export function costLine(): string {
  const { spent, last } = book();
  const percent = cost.budget > 0 ? Math.round((spent / cost.budget) * 100) : 100;
  const parts = [`💶 ${usd(spent)} of ${usd(cost.budget)} budget (${percent}%) · ${usd(cost.left)} left`];
  if (last !== null) parts.push(`last answer ${usd(last)}`);
  const chosen = paidSlot().model;
  const swapped = creditFallback(chosen);
  parts.push(swapped ? `now using the free model ${FREE_MODEL} (no account credit for ${modelLabel(chosen)})` : `this model: ${priceText(priceOf(chosen))}`);
  if (cost.busy) {
    const now = cost.inFlight;
    parts.push(now === null ? '⏳ asking… (price of this model unknown)' : `⏳ this answer ≈ ${usd(now)} so far`);
  }
  const sv = cost.saving;
  if (sv.last && sv.last.before > 0) {
    const cut = Math.round((1 - sv.last.after / sv.last.before) * 100);
    parts.push(`✂ packed ${kilo(sv.last.before)} → ${kilo(sv.last.after)} characters (−${cut}%)`);
  }
  if (sv.last && sv.last.cached > 0) parts.push(`♻ cache: ${kilo(sv.last.cached)} of ${kilo(sv.last.prompt)} tokens read cheaply`);
  if (sv.last && sv.last.dollars > 0) parts.push(`🐖 saved ≈ ${usd(sv.last.dollars)} (${usd(sv.total)} in all)`);
  const acct = cost.account;
  const keyNow = cost.key;
  if (activeProvider() === 'eden') parts.push('🏦 balance: see app.edenai.run');
  if (acct) parts.push(acct.left < MIN_CREDIT ? `🏦 ACCOUNT CREDIT ${usd(acct.left)}: add credit at openrouter.ai/credits` : `🏦 account credit ${usd(acct.left)}`);
  if (keyNow) parts.push(keyNow.left !== null ? `key ceiling ${usd(keyNow.left)} (not money)` : `key: ${usd(keyNow.used)} used, no limit`);
  return parts.join(' · ');
}

/** True when more than four fifths of the budget is gone, or the account itself is nearly empty. */
export const costWarn = (): boolean => cost.budget <= 0 || book().spent / cost.budget >= 0.8 || (cost.account !== null && cost.account.left < MIN_CREDIT);
