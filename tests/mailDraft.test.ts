import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, DRAFT_KEY, loadDraft, saveDraft } from '../src/mcp/mailDraft';

const data = new Map<string, string>();
const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };

beforeEach(() => data.clear());

describe('the unsent letter', () => {
  it('is kept while typing and comes back after a reload', () => {
    saveDraft(store, { to: 'outside-ai', subject: 'Do you hang?', body: 'Tell me honestly.' });
    expect(loadDraft(store)).toEqual({ to: 'outside-ai', subject: 'Do you hang?', body: 'Tell me honestly.' });
  });
  it('keeps what an answer answers', () => {
    saveDraft(store, { to: 'x', subject: 'Re: y', body: 'z', replyTo: 'm-3' });
    expect(loadDraft(store)?.replyTo).toBe('m-3');
  });
  it('is not kept when nothing is written, and is forgotten when emptied', () => {
    saveDraft(store, { to: 'ai-chat', subject: '', body: '  ' });
    expect(loadDraft(store)).toBeNull();
    saveDraft(store, { to: 'ai-chat', subject: '', body: 'hello' });
    expect(loadDraft(store)).not.toBeNull();
    saveDraft(store, { to: 'ai-chat', subject: '', body: '' });
    expect(data.has(DRAFT_KEY)).toBe(false);
  });
  it('a subject alone is worth keeping', () => {
    saveDraft(store, { to: 'a', subject: 'Remember', body: '' });
    expect(loadDraft(store)?.subject).toBe('Remember');
  });
  it('is gone once sent or cancelled', () => {
    saveDraft(store, { to: 'a', subject: '', body: 'x' });
    clearDraft(store);
    expect(loadDraft(store)).toBeNull();
  });
  it('survives rubbish in the storage, a missing storage and a storage that throws', () => {
    data.set(DRAFT_KEY, '{not json');
    expect(loadDraft(store)).toBeNull();
    data.set(DRAFT_KEY, JSON.stringify({ body: 5 }));
    expect(loadDraft(store)).toBeNull();
    expect(loadDraft(null)).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadDraft(broken)).toBeNull();
    expect(() => saveDraft(broken, { to: 'a', subject: '', body: 'x' })).not.toThrow();
    expect(() => clearDraft(broken)).not.toThrow();
  });
});
