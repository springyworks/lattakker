import { describe, expect, it } from 'vitest';
import { cacheFactor, compactText, needsCacheMarks, packRequest, pruneJson, withCacheMarks } from '../src/aichat/compact';
import { cost, costLine, setPrices } from '../src/aichat/cost';
import { updateSettings } from '../src/aichat/config';

describe('compactText', () => {
  it('drops empty fields from JSON and puts it on one line, keeping false, 0 and array places', () => {
    const text = JSON.stringify({ path: 'A1', note: null, tags: [], extra: {}, name: '', ok: false, n: 0, list: [null, { a: '', b: 1 }] }, null, 2);
    expect(compactText(text)).toBe('{"path":"A1","ok":false,"n":0,"list":[null,{"b":1}]}');
  });

  it('keeps the code inside strings exactly', () => {
    const code = 'const a = 1;   // keep\n\n\n  return a;\n';
    expect(JSON.parse(compactText(JSON.stringify({ code, spare: null }, null, 2)))).toEqual({ code });
  });

  it('leaves JSON that is cut off, or that holds a huge number, as it is', () => {
    expect(compactText('{"a": 1, "b": "cut… ')).toBe('{"a": 1, "b": "cut…');
    const big = '{ "id": 12345678901234567890, "x": null }';
    expect(compactText(big)).toBe(big);
  });

  it('trims trailing spaces and runs of blank lines in plain text', () => {
    expect(compactText('# Title   \r\n\r\n\r\n\r\nline\t\n  indented\n')).toBe('# Title\n\nline\n  indented');
  });

  it('never makes a text longer', () => {
    const tight = '{"a":1}';
    expect(compactText(tight).length).toBeLessThanOrEqual(tight.length);
  });
});

describe('packRequest', () => {
  const tools = [{ name: 't', description: 'Does   a thing\n  on two lines.', parameters: { type: 'object', properties: {} } }];
  const messages = [
    { role: 'user' as const, text: 'please   keep   my   spacing\n\n\n\nokay' },
    { role: 'assistant' as const, text: '', toolCalls: [{ id: '1', name: 't', args: {} }] },
    { role: 'tool' as const, toolCallId: '1', toolName: 't', text: JSON.stringify({ rows: [1, 2], error: null, hint: '' }, null, 2) },
  ];

  it('packs the instructions, the tool answers and the tool descriptions, not the person’s words', () => {
    const p = packRequest('Rules   \n\n\n\nmore', messages, tools);
    expect(p.system).toBe('Rules\n\nmore');
    expect(p.messages[0].text).toBe(messages[0].text);
    expect(p.messages[2].text).toBe('{"rows":[1,2]}');
    expect(p.tools[0].description).toBe('Does a thing on two lines.');
    expect(p.after).toBeLessThan(p.before);
  });

  it('does not change what it was given', () => {
    const copy = JSON.stringify(messages);
    packRequest('s', messages, tools);
    expect(JSON.stringify(messages)).toBe(copy);
  });

  it('pruneJson leaves scalars alone', () => {
    expect(pruneJson(5)).toBe(5);
    expect(pruneJson('x')).toBe('x');
  });
});

describe('cache marks', () => {
  it('are only asked for Anthropic models', () => {
    expect(needsCacheMarks('anthropic/claude-sonnet-4')).toBe(true);
    expect(needsCacheMarks('openai/gpt-5')).toBe(false);
    expect(cacheFactor('anthropic/claude-sonnet-4')).toBe(0.1);
    expect(cacheFactor('openai/gpt-5')).toBe(0.5);
  });

  it('mark the instructions and the latest question of the person, nothing else', () => {
    const wire = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'second' },
      { role: 'tool', tool_call_id: '1', content: 'result' },
    ];
    const out = withCacheMarks(wire);
    const marked = out.map((m) => Array.isArray(m.content));
    expect(marked).toEqual([true, false, false, true, false]);
    expect(out[0].content).toEqual([{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }]);
    expect(wire[0].content).toBe('rules');
  });
});

describe('the saving in the cost line', () => {
  it('shows what packing and the cache saved, as soon as the question goes out and when it is done', () => {
    updateSettings((s) => (s.provider = 'openrouter'));
    setPrices([{ id: 'acme/big', price: { prompt: 3, completion: 15, context: 100000 }, tools: true }]);
    updateSettings((s) => (s.openrouter.model = 'acme/big'));
    cost.pack(20000, 15000);
    cost.begin('acme/big', 15000);
    expect(costLine()).toContain('✂ packed 20k → 15k characters (−25%)');
    cost.tokens(5000, 100, 4000);
    cost.finish(true);
    const line = costLine();
    expect(line).toContain('♻ cache: 4.0k of 5.0k tokens read cheaply');
    expect(line).toContain('🐖 saved ≈');
    expect(cost.saving.total).toBeGreaterThan(0);
  });
});
