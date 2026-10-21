import { describe, expect, it } from 'vitest';
import { createRepl, formatResult, type ReplTranspile } from '../src/sheet/repl';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (code: string) => unknown;

// Stands in for the editor's compiler: it only checks the syntax.
const transpile: ReplTranspile = async (source) => {
  try {
    new AsyncFunction(source);
    return { js: '"use strict";\n' + source, errors: [] };
  } catch (err) {
    return { js: '', errors: [(err as Error).message] };
  }
};

describe('repl()', () => {
  it('gives the value of an expression', async () => {
    const run = createRepl(transpile, () => ({}));
    expect(await run('6 * 7')).toBe('42');
    expect(await run('"a" + "b"')).toBe('"ab"');
    expect(await run('')).toBe('');
  });

  it('keeps declarations for the next lines', async () => {
    const run = createRepl(transpile, () => ({}));
    expect(await run('const x = 6 * 7')).toBe('');
    expect(await run('x + 1')).toBe('43');
    await run('function twice(n) { return n * 2 }');
    expect(await run('twice(x)')).toBe('84');
    await run('x = 1');
    expect(await run('x')).toBe('1');
  });

  it('sees the cell API and awaits', async () => {
    const run = createRepl(transpile, () => ({ ping: async () => 'pong' }));
    expect(await run('await ping()')).toBe('"pong"');
  });

  it('runs statements and reports errors as text', async () => {
    const run = createRepl(transpile, () => ({}));
    await run('const n = 3');
    expect(await run('if (n > 2) { globalThis.__repl_seen = n }')).toBe('');
    expect((globalThis as Record<string, unknown>).__repl_seen).toBe(3);
    expect(await run('nothing.at')).toMatch(/^\?\? /);
    expect(await run('1 +')).toMatch(/^\?\? /);
  });

  it('formats results', () => {
    expect(formatResult(undefined)).toBe('');
    expect(formatResult({ a: 1 })).toBe('{"a":1}');
    expect(formatResult(() => 1)).toBe('[function anonymous]');
  });
});
