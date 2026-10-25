import { describe, expect, it } from 'vitest';
import { fail } from '../src/aichat/providers';

describe('OpenRouter 402', () => {
  it('says it is the key limit, with the sizes and the link, when the key limit is hit', () => {
    const e = fail(402, 'Prompt tokens limit exceeded: 9303 > 9238. To increase, visit https://openrouter.ai/workspaces/default/keys/abc123 and adjust the key\'s total limit');
    expect(e.kind).toBe('blocked');
    expect(e.message).toContain('spending limit of this API key');
    expect(e.message).toContain('9,303');
    expect(e.message).toContain('9,238');
    expect(e.message).toContain('https://openrouter.ai/workspaces/default/keys/abc123');
    expect(e.message).not.toContain('credit is used up');
  });

  it('says there is not enough credit for other 402 answers', () => {
    expect(fail(402, 'Insufficient credits').message).toContain('not enough credit');
  });
});
