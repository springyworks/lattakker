import { describe, expect, it } from 'vitest';
import { cleanKey } from '../src/aichat/config';

describe('keys', () => {
  it('keeps an OpenRouter key, and only the key', () => {
    expect(cleanKey('openrouter', '  sk-or-v1-abc123_DEF-4  ')).toBe('sk-or-v1-abc123_DEF-4');
    expect(cleanKey('openrouter', 'my key: sk-or-v1-abc123\nand more words')).toBe('sk-or-v1-abc123');
  });

  it('refuses pasted text that is not a key (it made the request fail with "Missing Authentication header")', () => {
    expect(cleanKey('openrouter', 'hi and you are? what model do u use')).toBe('');
  });

  it('keeps an Eden AI key (one long word) and refuses a sentence', () => {
    const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc-DEF_123.xyz';
    expect(cleanKey('eden', `  ${key}\n`)).toBe(key);
    expect(cleanKey('eden', 'hi and you are? what model do u use')).toBe('');
  });

  it('trims the other keys', () => {
    expect(cleanKey('gemini', ' AIza123 ')).toBe('AIza123');
  });
});
