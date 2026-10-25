import { describe, expect, it } from 'vitest';
import { BudgetError, cost, costLine, modelLabel, paidWindow, parseKeyInfo, parseModels, priceText, setPrices, tokenCost, usd } from '../src/aichat/cost';
import { updateSettings } from '../src/aichat/config';

const LIST = {
  data: [
    { id: 'acme/big', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools', 'temperature'] },
    { id: 'acme/free:free', context_length: 32768, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    { id: 'acme/notools', context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['temperature'] },
    { id: '', pricing: {} },
  ],
};

describe('OpenRouter model list', () => {
  it('turns dollars per token into dollars per million and notes tool support', () => {
    const models = parseModels(LIST);
    expect(models.map((m) => m.id)).toEqual(['acme/big', 'acme/free:free', 'acme/notools']);
    expect(models[0].price).toEqual({ prompt: 3, completion: 15, context: 200000 });
    expect(models.map((m) => m.tools)).toEqual([true, true, false]);
  });

  it('shows the price next to the model name', () => {
    setPrices(parseModels(LIST));
    expect(modelLabel('acme/big')).toBe('acme/big  ·  $3.00 in / $15.00 out per 1M tokens');
    expect(modelLabel('acme/free:free')).toContain('free');
    expect(modelLabel('unknown/model')).toBe('unknown/model');
  });

  it('never budgets for more than 64k tokens', () => {
    setPrices(parseModels(LIST));
    expect(paidWindow('acme/big')).toBe(65536);
    expect(paidWindow('acme/free:free')).toBe(32768);
  });
});

describe('money formatting', () => {
  it('uses more decimals for small amounts', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(0.0031)).toBe('$0.0031');
    expect(usd(0.1234)).toBe('$0.123');
    expect(usd(12.5)).toBe('$12.50');
  });

  it('prices tokens', () => {
    expect(tokenCost({ prompt: 3, completion: 15, context: 0 }, 1000, 200)).toBeCloseTo(0.006, 6);
    expect(priceText(null)).toBe('price unknown');
  });
});

describe('key info', () => {
  it('reads usage and limit from the key endpoint', () => {
    expect(parseKeyInfo({ data: { usage: 2.5, limit: 10, limit_remaining: 7.5, is_free_tier: false } })).toEqual({ used: 2.5, limit: 10, left: 7.5, free: false });
    expect(parseKeyInfo({ data: { usage: 1, limit: null } })).toEqual({ used: 1, limit: null, left: null, free: false });
    expect(parseKeyInfo({})).toBeNull();
  });
});

describe('budget', () => {
  it('counts the real cost of an answer and stops asking when the budget is gone', () => {
    cost.reset();
    updateSettings((s) => (s.openrouter.budgetUsd = 0.01));
    cost.assertWithin();
    cost.begin('acme/big', 4000);
    expect(costLine()).toContain('⏳');
    cost.report(0.004);
    cost.finish(true);
    expect(cost.spent).toBeCloseTo(0.004, 6);
    expect(cost.last).toBeCloseTo(0.004, 6);
    expect(costLine()).toContain('$0.0040 of $0.010 budget (40%)');
    cost.begin('acme/big', 4000);
    cost.report(0.007);
    cost.finish(true);
    expect(() => cost.assertWithin()).toThrow(BudgetError);
    cost.reset();
    expect(cost.spent).toBe(0);
  });

  it('charges nothing for a question that never started', () => {
    cost.reset();
    cost.begin('acme/big', 4000);
    cost.finish(false);
    expect(cost.spent).toBe(0);
  });

  it('estimates an answer that was cut off', () => {
    setPrices(parseModels(LIST));
    cost.reset();
    cost.begin('acme/big', 3300);
    cost.progress(3300);
    cost.finish(true);
    expect(cost.spent).toBeGreaterThan(0);
    cost.reset();
  });
});
