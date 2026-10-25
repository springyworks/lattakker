import { getSettings } from './config';
import { estimateTokens } from './ammo';

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

const PRICES_KEY = 'lattakker:ai:prices';
const SPENT_KEY = 'lattakker:ai:spent';
/** Never let the page assume a window bigger than this for budgeting: a long chat on a big model gets expensive. */
export const BUDGET_WINDOW = 65536;

const prices = new Map<string, Price>();

/** OpenRouter's list of models: prices come as dollars per token, in strings. */
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
    out.push({
      id: m.id,
      price: { prompt: perM(pricing.prompt), completion: perM(pricing.completion), context: Number(m.context_length) > 0 ? Number(m.context_length) : 0 },
      tools: params.includes('tools'),
    });
  }
  return out;
}

export function setPrices(models: PricedModel[]): void {
  prices.clear();
  for (const m of models) prices.set(m.id, m.price);
  try {
    localStorage.setItem(PRICES_KEY, JSON.stringify(models.map((m) => [m.id, m.price.prompt, m.price.completion, m.price.context])));
  } catch {
    // too big or blocked: the prices are fetched again next time
  }
  notify();
}

function loadPrices(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(PRICES_KEY) ?? '[]') as Array<[string, number, number, number]>;
    for (const [id, prompt, completion, context] of raw) prices.set(id, { prompt, completion, context });
  } catch {
    // no cache
  }
}

export const priceOf = (model: string): Price | null => prices.get(model) ?? null;

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
export function creditFallback(model: string, acct: Account | null = account): string | null {
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

let spent = 0;
let session = 0;
let last: number | null = null;
let keyInfo: KeyInfo | null = null;
let keyAsked = -Infinity;
/** The question being answered now: its estimated price so far. */
let flight: { price: Price | null; promptTokens: number; chars: number; known: number | null } | null = null;

try {
  spent = Number(localStorage.getItem(SPENT_KEY)) || 0;
} catch {
  spent = 0;
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
    return spent;
  },
  get session(): number {
    return session;
  },
  get last(): number | null {
    return last;
  },
  get budget(): number {
    return getSettings().openrouter.budgetUsd;
  },
  get left(): number {
    return Math.max(0, cost.budget - spent);
  },
  get key(): KeyInfo | null {
    return keyInfo;
  },
  /** The money really in the OpenRouter account (bought credit minus used): the only money a question can be paid from. */
  get account(): Account | null {
    return account;
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
    if (spent >= cost.budget) {
      throw new BudgetError(`The budget of ${usd(cost.budget)} is used up (${usd(spent)} spent). Raise the budget or reset the counter in the settings ⚙ to go on.`);
    }
  },
  /** A question goes out. `requestChars` is its size, used for the estimate until the real number arrives. */
  begin(model: string, requestChars: number): void {
    flight = { price: priceOf(model), promptTokens: estimateTokens(requestChars), chars: 0, known: null };
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
  /** The question is over: add it up. Without a real number the estimate counts, since a started answer is paid for. */
  finish(started: boolean): void {
    if (!flight) return;
    const amount = flight.known ?? (started ? cost.inFlight : null);
    flight = null;
    if (amount !== null && amount > 0) {
      spent += amount;
      session += amount;
      last = amount;
      try {
        localStorage.setItem(SPENT_KEY, String(spent));
      } catch {
        // the total lasts until the page is closed
      }
    }
    notify();
  },
  /** Start counting the budget from zero. */
  reset(): void {
    spent = 0;
    session = 0;
    last = null;
    try {
      localStorage.removeItem(SPENT_KEY);
    } catch {
      // nothing stored
    }
    notify();
  },
  async refreshKey(apiKey: string, force = false): Promise<void> {
    if (!apiKey || (!force && performance.now() - keyAsked < 15000)) return;
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
  const percent = cost.budget > 0 ? Math.round((spent / cost.budget) * 100) : 100;
  const parts = [`💶 ${usd(spent)} of ${usd(cost.budget)} budget (${percent}%) · ${usd(cost.left)} left`];
  if (last !== null) parts.push(`last answer ${usd(last)}`);
  const chosen = getSettings().openrouter.model;
  const swapped = creditFallback(chosen);
  parts.push(swapped ? `now using the free model ${FREE_MODEL} (no account credit for ${modelLabel(chosen)})` : `this model: ${priceText(priceOf(chosen))}`);
  if (cost.busy) {
    const now = cost.inFlight;
    parts.push(now === null ? '⏳ asking… (price of this model unknown)' : `⏳ this answer ≈ ${usd(now)} so far`);
  }
  if (account) parts.push(account.left < MIN_CREDIT ? `🏦 ACCOUNT CREDIT ${usd(account.left)}: add credit at openrouter.ai/credits` : `🏦 account credit ${usd(account.left)}`);
  if (keyInfo) parts.push(keyInfo.left !== null ? `key ceiling ${usd(keyInfo.left)} (not money)` : `key: ${usd(keyInfo.used)} used, no limit`);
  return parts.join(' · ');
}

/** True when more than four fifths of the budget is gone, or the account itself is nearly empty. */
export const costWarn = (): boolean => cost.budget <= 0 || spent / cost.budget >= 0.8 || (account !== null && account.left < MIN_CREDIT);
