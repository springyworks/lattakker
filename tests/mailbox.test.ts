import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { covers, isReachable, normalizeAddress, Mailbox } = await import('../src/mcp/mailbox');

describe('isReachable (is there anybody who could read a letter to this name?)', () => {
  const known = ['you', 'outside-ai:copilot-cli@claude', 'ai-chat'];
  it('the person, the helper, the outside group and cells always are', () => {
    for (const to of ['you', 'ai-chat', 'outside-ai', 'lab:A16', 'board:Q12']) expect(isReachable(to, [])).toBe(true);
  });
  it('a shorter address reaches those it covers', () => {
    expect(isReachable('outside-ai:copilot-cli', known)).toBe(true);
    expect(isReachable('outside-ai:copilot-cli@claude', known)).toBe(true);
  });
  it('names nobody has are not reachable: they would wait for ever', () => {
    for (const to of ['sonnet5', '5onvscode-copiot', 'bigbrotherthtatdevelopslattakeer-app', 'outside-ai:other@model']) expect(isReachable(to, known)).toBe(false);
  });
  it('a name that has written a letter is somebody', () => {
    expect(isReachable('codex', [...known, 'codex'])).toBe(true);
  });
});

describe('addresses', () => {
  it('uses the words a small model uses', () => {
    expect(normalizeAddress('Outside')).toBe('outside-ai');
    expect(normalizeAddress(' The Helper ')).toBe('thehelper');
    expect(normalizeAddress('helper')).toBe('ai-chat');
    expect(normalizeAddress('lab:a16')).toBe('lab:A16');
  });
  it('covers means "this or a longer address that continues with : or @"', () => {
    expect(covers('outside-ai', 'outside-ai:x@y')).toBe(true);
    expect(covers('outside', 'outside-ai')).toBe(false);
  });
});

describe('Mailbox.senders', () => {
  it('lists each writer once', () => {
    const box = new Mailbox();
    box.send({ from: 'you', to: ['a'], subject: 's', body: 'b' });
    box.send({ from: 'you', to: ['b'], subject: 's', body: 'b' });
    box.send({ from: 'ai-chat', to: ['you'], subject: 's', body: 'b' });
    expect(box.senders().sort()).toEqual(['ai-chat', 'you']);
  });
});
