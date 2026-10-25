import { describe, expect, it } from 'vitest';
import { fail } from '../src/aichat/providers';
import { parseCredits } from '../src/aichat/cost';

describe('OpenRouter 402', () => {
  it('says the account has no credit, with the sizes, and that a key limit is no money', () => {
    const e = fail(402, 'Prompt tokens limit exceeded: 9303 > 9238. To increase, visit https://openrouter.ai/workspaces/default/keys/abc123 and adjust the key\'s total limit');
    expect(e.kind).toBe('blocked');
    expect(e.message).toContain('no credit left');
    expect(e.message).toContain('9,303');
    expect(e.message).toContain('9,238');
    expect(e.message).toContain('openrouter.ai/credits');
    expect(e.message).toContain('not money');
  });

  it('reads the account from /credits', () => {
    expect(parseCredits({ data: { total_credits: 0, total_usage: 0.13165648 } })).toEqual({ credits: 0, used: 0.13165648, left: 0 });
    expect(parseCredits({ data: { total_credits: 5, total_usage: 1.5 } })?.left).toBeCloseTo(3.5);
    expect(parseCredits({})).toBeNull();
  });
});
