import { describe, expect, it } from 'vitest';
import { runCell } from '../src/sheet/runtime';
import type { SheetCellData } from '../src/sheet/Sheet';
import type { RunContext } from '../src/sheet/tasks';

const run = async (code: string, transpile: () => Promise<{ js: string; errors: string[] }>): Promise<SheetCellData> => {
  const data = { address: 'B1', code, error: null } as unknown as SheetCellData;
  await runCell(data, { cancelled: false } as unknown as RunContext, () => ({}), transpile);
  return data;
};

describe('runCell without the code engine', () => {
  it('says the engine is not answering when TypeScript could not be compiled', async () => {
    const data = await run('const f = (a?, b?) => a', () => Promise.reject(new Error('The TypeScript engine did not answer in time')));
    expect(data.error).toContain('code engine is not answering');
    expect(data.error).toContain('F5');
  });

  it('still runs plain JavaScript without the engine', async () => {
    const data = await run('1 + 1', () => Promise.reject(new Error('down')));
    expect(data.error).toBeNull();
  });
});
