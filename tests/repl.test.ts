import { describe, expect, it } from 'vitest';
import { createRepl, formatResult, isIncomplete, scan, type ReplTranspile } from '../src/sheet/repl';

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

  it('runs several statements on one line and gives the last value', async () => {
    const run = createRepl(transpile, () => ({}));
    expect(await run('const a = 1; const b = a + 1; a + b')).toBe('3');
    expect(await run('let t = 0; for (let i = 0; i < 4; i++) { t += i }; t')).toBe('6');
    expect(await run('const s = "a;b"; s.length')).toBe('3');
    expect(await run('const f = (x) => { return x; }; f(7);')).toBe('7');
    expect(await run('const m = `x${1;}`')).toMatch(/^\?\? /);
    expect(await run('1; nothing.at; 2')).toMatch(/^\?\? /);
  });

  it('knows when code is not finished', () => {
    const run = createRepl(transpile, () => ({}));
    for (const open of ['function f() {', 'const a = [1,', 'foo(', '1 +', 'a.', 'const g = () =>', '/* open', 'const t = `x', 'const o = { a: 1,\n b: 2,']) {
      expect(run.incomplete(open), open).toBe(true);
    }
    for (const done of ['', '1 + 1', 'i++', 'const s = "{"', "const r = /[{(]/", 'a // {', 'const t = `${1}`', 'x = { a: [1, 2] };', 'f(a) / 2']) {
      expect(isIncomplete(done), done).toBe(false);
    }
  });

  it('splits only at top-level semicolons', () => {
    expect(scan('a; b').parts).toEqual(['a', 'b']);
    expect(scan('for (;;) {}; c').parts).toEqual(['for (;;) {}', 'c']);
    expect(scan('x = "a;b"; y = /;/; z').parts).toEqual(['x = "a;b"', 'y = /;/', 'z']);
  });
});
