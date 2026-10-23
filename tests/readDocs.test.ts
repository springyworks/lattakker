import { describe, expect, it } from 'vitest';
import { readDocs } from '../src/aichat/docs';

describe('read_docs', () => {
  it('an API lookup with words brings a working example cell along', async () => {
    const text = await readDocs({ doc: 'api', query: 'plot' }, 7000);
    expect(text).toContain('plot(');
    expect(text).toContain('A working cell that uses it');
    expect(text.length).toBeLessThanOrEqual(7000);
  });

  it('an API outline (no words) and a tiny budget stay plain', async () => {
    expect(await readDocs({ doc: 'api' }, 7000)).not.toContain('A working cell that uses it');
    expect(await readDocs({ doc: 'api', query: 'plot' }, 1500)).not.toContain('A working cell that uses it');
  });
});
