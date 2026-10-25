import { afterEach, describe, expect, it, vi } from 'vitest';
import { setKey, updateSettings } from '../src/aichat/config';
import { cost, parseModels, setPrices } from '../src/aichat/cost';
import { EdenProvider } from '../src/aichat/providers';

const sse = (...chunks: unknown[]): Response => {
  const body = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('');
  return new Response(new Blob([body]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

describe('Eden AI: real token counts are asked for and priced', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cost.reset();
    updateSettings((s) => (s.provider = 'local'));
  });

  it('sends stream_options.include_usage and counts the answer at the model price', async () => {
    updateSettings((s) => {
      s.provider = 'eden';
      s.eden.model = 'gpt-oss-20b';
    });
    setKey('eden', 'sk-eden-live-0123456789abcdefghij');
    setPrices(parseModels({ data: [{ id: 'gpt-oss-20b', mode: 'chat', context_length: 128000, pricing: { input_cost_per_token: 1e-7, output_cost_per_token: 5e-7 } }] }));
    cost.reset();

    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('location', { href: 'http://localhost:5178/', origin: 'http://localhost:5178' });
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return sse({ choices: [{ delta: { content: 'OK' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 20000, completion_tokens: 2000, total_tokens: 22000 } }, '[DONE]');
      }),
    );

    const reply = await new EdenProvider('gpt-oss-20b', 'sk-eden-live-0123456789abcdefghij').complete('sys', [{ role: 'user', text: 'Say OK.' }], [], new AbortController().signal);

    expect(sent.stream_options).toEqual({ include_usage: true });
    expect(sent.usage).toBeUndefined();
    expect(reply.text).toContain('OK');
    expect(cost.spent).toBeCloseTo((20000 * 0.1 + 2000 * 0.5) / 1e6, 9);
  });
});
