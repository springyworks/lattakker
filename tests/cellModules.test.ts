import { describe, expect, it } from 'vitest';
import { CellModules, cellOfSpecifier, rewriteModules } from '../src/sheet/cellModules';
import { RunContext } from '../src/sheet/tasks';
import { DependencyGraph, moduleNode } from '../src/sheet/reactivity';
import { colInsertRewrite, mapAddressLiterals } from '../src/sheet/address';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

/** Runs rewritten cell code the way the runner does, with a table of cells to import from. */
async function run(js: string, cells: Record<string, Record<string, unknown>> = {}): Promise<Record<string, unknown>> {
  const exports: Record<string, unknown> = {};
  const out = rewriteModules(js).js;
  const cell = async (spec: string) => {
    const address = cellOfSpecifier(spec);
    if (!address || !cells[address]) throw new Error(`no ${spec}`);
    return cells[address];
  };
  await new AsyncFunction('__exports', '__cell', `"use strict";\n${out}`)(exports, cell);
  return exports;
}

describe('rewriteModules: export', () => {
  it('leaves code without import or export alone', () => {
    const js = 'const a = 1;\nprint(a);';
    expect(rewriteModules(js)).toEqual({ js, exports: [], imports: [] });
  });

  it('publishes functions, even ones declared after the export (hoisting)', async () => {
    const out = await run('export function add(a, b) { return a + b; }\nexport async function later() { return 7; }');
    expect((out.add as (a: number, b: number) => number)(2, 3)).toBe(5);
    expect(await (out.later as () => Promise<number>)()).toBe(7);
  });

  it('publishes const, let and var, several at once, and destructured names', async () => {
    const out = await run('export const a = 1, b = [2, 3];\nexport let c = "x";\nexport var { d, e: f = 5, ...g } = { d: 4, h: 8 };\nexport const [p, [q]] = [1, [2]];');
    expect(out).toMatchObject({ a: 1, b: [2, 3], c: 'x', d: 4, f: 5, g: { h: 8 }, p: 1, q: 2 });
  });

  it('publishes classes', async () => {
    const out = await run('export class Dog { bark() { return "woof"; } }');
    expect(new (out.Dog as new () => { bark(): string })().bark()).toBe('woof');
  });

  it('keeps a value live for readers of the exports object', async () => {
    const out = await run('export let count = 0;\nexport function inc() { count++; }');
    (out.inc as () => void)();
    expect(out.count).toBe(1);
  });

  it('handles export lists, renames and default', async () => {
    const out = await run('const a = 1; function f() { return 2; }\nexport { a, f as g };\nexport default 42;');
    expect(out.a).toBe(1);
    expect((out.g as () => number)()).toBe(2);
    expect(out.default).toBe(42);
  });

  it('handles a named default function and class', async () => {
    const out = await run('export default function hello() { return "hi"; }');
    expect((out.default as () => string)()).toBe('hi');
    const cls = await run('export default class Cat {}');
    expect(typeof cls.default).toBe('function');
  });

  it('reports what it found', () => {
    const r = rewriteModules('import { x } from "./B2";\nexport const y = x;\nexport function z() {}');
    expect(r.exports.sort()).toEqual(['y', 'z']);
    expect(r.imports).toEqual(['./B2']);
  });

  it('ignores the words in strings, comments and templates', () => {
    const js = 'const s = "\\nexport const nope = 1";\n// export const nope\nconst t = `\nexport const nope\n`;\nprint(s, t);';
    expect(rewriteModules(js).exports).toEqual([]);
  });

  it('does not touch exports that are not at the top level of a line', () => {
    const js = 'function f() {\n  const o = { export: 1 };\n  return o.export;\n}\nprint(f());';
    expect(rewriteModules(js).js).toBe(js);
  });

  it('says plainly what it cannot read', () => {
    expect(() => rewriteModules('export 42;')).toThrow(/not understood/);
  });
});

describe('rewriteModules: import', () => {
  const b2 = { add: (a: number, b: number) => a + b, name: 'b2', default: 'dflt' };

  it('takes named values, with renames', async () => {
    const out = await run('import { add, name as n } from "./B2";\nexport const r = add(1, 2) + n;', { B2: b2 });
    expect(out.r).toBe('3b2');
  });

  it('takes a namespace and a default', async () => {
    const out = await run('import dflt, * as all from "./B2";\nexport const r = [dflt, all.name];', { B2: b2 });
    expect(out.r).toEqual(['dflt', 'b2']);
  });

  it('takes default and named together', async () => {
    const out = await run("import d, { name } from './B2';\nexport const r = d + name;", { B2: b2 });
    expect(out.r).toBe('dflt' + 'b2');
  });

  it('runs a bare import for its sake', async () => {
    await expect(run('import "./B2";', { B2: b2 })).resolves.toBeDefined();
    await expect(run('import "./C3";', { B2: b2 })).rejects.toThrow(/no .\/C3/);
  });

  it('re-exports from another cell', async () => {
    const out = await run('export { add as plus } from "./B2";\nexport * from "./B2";', { B2: b2 });
    expect((out.plus as (a: number, b: number) => number)(2, 2)).toBe(4);
    expect(out.name).toBe('b2');
  });

  it('leaves dynamic import() alone', () => {
    const js = 'const m = await import("./x.js");';
    expect(rewriteModules(js).js).toBe(js);
  });

  it('keeps the line numbers', () => {
    const r = rewriteModules('import { a } from "./B2";\n\nexport const x = 1;\nprint(x);');
    expect(r.js.split('\n').slice(0, 4).join('\n').split('\n').length).toBe(4);
    expect(r.js.indexOf('print(x)')).toBeGreaterThan(0);
  });
});

describe('importing cells run after the cell they import', () => {
  it('runs the exporter first and wakes the importers when it runs again', () => {
    const g = new DependencyGraph();
    g.beginRun('A1');
    g.trackRead('A1', moduleNode('B2'));
    g.trackRead('A1', 'B2');
    g.beginRun('B2');
    g.markDirty('B2');
    expect(g.closure(['A1', 'B2'])).toEqual(['B2', 'A1']);
  });

  it('does not wake an importer when the other cell only changes its output', () => {
    const g = new DependencyGraph();
    g.beginRun('A1');
    g.trackRead('A1', moduleNode('B2'));
    g.markDependentsDirty('B2');
    expect(g.closure(['A1', 'B2'])).toEqual([]);
  });
});

describe('imports follow their cell when it moves', () => {
  const move = (code: string): string => mapAddressLiterals(code, (ends, _lit, tab) => (tab ? null : colInsertRewrite(1, 1)(ends))).code;

  it("rewrites './B2' like any address", () => {
    expect(move("import { add } from './B2';\nimport b from './a1.ts';")).toBe("import { add } from './C2';\nimport b from './a1.ts';");
  });
});

describe('cellOfSpecifier', () => {
  it('reads ./B2 and ./b2.ts', () => {
    expect(cellOfSpecifier('./B2')).toBe('B2');
    expect(cellOfSpecifier('./b12.ts')).toBe('B12');
    expect(cellOfSpecifier('B2')).toBeNull();
    expect(cellOfSpecifier('../lab/B2')).toBeNull();
    expect(cellOfSpecifier('/lab/B2')).toBeNull();
    expect(cellOfSpecifier('lodash')).toBeNull();
  });
});

describe('CellModules', () => {
  const ctx = (a: string) => new RunContext(a);
  const idle = () => ({ hasCode: true, pending: false });

  it('gives the exports of a finished run at once', async () => {
    const mods = new CellModules();
    const rec = mods.begin('B2', ctx('B2'));
    rec.exports.x = 1;
    mods.settle(rec);
    await expect(mods.load('A1', 'B2', idle)).resolves.toEqual({ x: 1 });
  });

  it('waits for a cell that has not run yet, and for one that is running', async () => {
    const mods = new CellModules();
    const early = mods.load('A1', 'B2', idle);
    const rec = mods.begin('B2', ctx('B2'));
    rec.exports.x = 2;
    const during = mods.load('A1', 'B2', idle);
    mods.settle(rec);
    await expect(early).resolves.toEqual({ x: 2 });
    await expect(during).resolves.toEqual({ x: 2 });
  });

  it('does not hand out the exports of an older run when the cell is about to run again', async () => {
    const mods = new CellModules();
    const old = mods.begin('B2', ctx('B2'));
    old.exports.v = 'old';
    mods.settle(old);
    let pending = true;
    const answer = mods.load('A1', 'B2', () => ({ hasCode: true, pending }));
    pending = false;
    const fresh = mods.begin('B2', ctx('B2'));
    fresh.exports.v = 'new';
    mods.settle(fresh);
    await expect(answer).resolves.toEqual({ v: 'new' });
  });

  it('follows a run that is replaced while it is waited for', async () => {
    const mods = new CellModules();
    const first = mods.begin('B2', ctx('B2'));
    const answer = mods.load('A1', 'B2', idle);
    const second = mods.begin('B2', ctx('B2'));
    second.exports.v = 2;
    mods.settle(second);
    await expect(answer).resolves.toEqual({ v: 2 });
    void first;
  });

  it('passes on the error of a cell that failed', async () => {
    const mods = new CellModules();
    const rec = mods.begin('B2', ctx('B2'));
    mods.settle(rec, new Error('boom'));
    await expect(mods.load('A1', 'B2', idle)).rejects.toThrow(/B2 has an error.*boom/);
  });

  it('refuses an empty cell, itself and a circle', async () => {
    const mods = new CellModules();
    await expect(mods.load('A1', 'B2', () => ({ hasCode: false, pending: false }))).rejects.toThrow(/no code/);
    await expect(mods.load('A1', 'A1', idle)).rejects.toThrow(/itself/);
    const first = mods.load('A1', 'B2', idle, 50);
    await expect(mods.load('B2', 'A1', idle, 50)).rejects.toThrow(/import each other/);
    await expect(first).rejects.toThrow(/did not finish/);
  });

  it('gives up when the other cell never finishes', async () => {
    const mods = new CellModules();
    mods.begin('B2', ctx('B2'));
    await expect(mods.load('A1', 'B2', idle, 30)).rejects.toThrow(/did not finish starting/);
  });
});
