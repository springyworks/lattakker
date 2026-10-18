import { describe, expect, it } from 'vitest';
import { ERR, McpError, McpRouter, type McpServer } from '../src/mcp/router';

const echo: McpServer = { name: 'echo', handle: (method) => (method === 'slow' ? new Promise(() => {}) : { ok: true }) };
const make = (): McpRouter => {
  const r = new McpRouter();
  r.register(echo);
  r.register({ name: 'router', handle: () => ({}) });
  return r;
};
const code = async (p: Promise<unknown>): Promise<number | null> => p.then(() => null, (e: unknown) => (e instanceof McpError ? e.code : -1));

describe('run-away', () => {
  it('holds a caller that repeats the same call, and says so in words', async () => {
    const r = make();
    for (let i = 0; i < 39; i++) expect(await code(r.request('lab:A1', 'echo', 'ping', {}))).toBeNull();
    expect(await code(r.request('lab:A1', 'echo', 'ping', {}))).toBe(ERR.runaway);
    expect(await code(r.request('lab:A1', 'echo', 'other', {}))).toBe(ERR.runaway);
    expect(await code(r.request('lab:B2', 'echo', 'ping', {}))).toBeNull();
    expect(r.holding()[0]).toMatchObject({ who: 'lab:A1' });
    expect(r.admit('lab:A1', undefined, 'x')).toMatch(/running away.*home square/);
  });

  it('holds a caller that makes far too many different calls', async () => {
    const r = make();
    let refused = 0;
    for (let i = 0; i < 230; i++) if ((await code(r.request('lab:A1', 'echo', 'ping', { n: i }))) === ERR.runaway) refused++;
    expect(refused).toBeGreaterThan(0);
  });

  it('never refuses the router itself, the person, or the router\'s own probes', async () => {
    const r = make();
    for (let i = 0; i < 60; i++) {
      expect(await code(r.request('lab:A1', 'router', 'ping', {}))).toBeNull();
      expect(await code(r.request('exercise', 'echo', 'ping', {}))).toBeNull();
      expect(r.admit('you', undefined, 'same')).toBeNull();
    }
  });

  it('the home cut stops waiting requests and holds busy callers, but a new question from the person starts clean', async () => {
    const r = make();
    const waiting = code(r.request('lab:A1', 'echo', 'slow', {}));
    for (let i = 0; i < 6; i++) await r.request('outside-ai:x', 'echo', 'ping', { i });
    const person = r.origin('you');
    for (let i = 0; i < 6; i++) await r.request('ai-chat', 'echo', 'ping', { i }, person);
    const cut = r.cut('home');
    expect(await waiting).toBe(ERR.runaway);
    expect(cut.stopped).toBe(1);
    expect(await code(r.request('outside-ai:x', 'echo', 'ping', {}))).toBe(ERR.runaway);
    expect(await code(r.request('ai-chat', 'echo', 'ping', {}, person))).toBe(ERR.runaway);
    await new Promise((res) => setTimeout(res, 5));
    expect(await code(r.request('ai-chat', 'echo', 'ping', {}, r.origin('you')))).toBeNull();
  });
});
