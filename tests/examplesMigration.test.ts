import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXAMPLES } from '../src/examples';
import { EXAMPLES_REV, migrateExamples } from '../src/examplesMigration';
import { CELL_API_DTS } from '../src/sheet/apiTypes';
import type { Sheet } from '../src/sheet/Sheet';

function fakeSheet(cells: Record<string, string>): Sheet {
  return {
    rowCount: 200,
    insertRow: () => undefined,
    dataAt: (address: string) => ({ address, code: cells[address] ?? '' }),
    setCode: (address: string, code: string) => void (cells[address] = code),
  } as unknown as Sheet;
}

const OLD_A12 = [
  '// old teaching comment',
  'span(4, 2)',
  "const red = game.pieces('red').length",
  "const blue = game.pieces('blue').length",
  'print(`Red has ${red} pieces`)',
  'print(`Blue has ${blue} pieces`)',
  "color(red >= blue ? '#d9e8dd' : '#f0d8d5')",
].join('\n');

const newA12 = EXAMPLES.find(([address]) => address === 'A12')![1];

describe('A12 is the random player', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  });
  afterEach(() => void delete (globalThis as { localStorage?: unknown }).localStorage);

  it('replaces the old piece counter on a saved board that still holds it', () => {
    store.set('lattakker:examples-rev', '9');
    const cells: Record<string, string> = { A12: OLD_A12 };
    const changed = migrateExamples({ restored: true, board: fakeSheet(cells), lab: fakeSheet({}), examples: EXAMPLES, labDemos: [] });
    expect(changed).toBe(1);
    expect(cells.A12).toBe(newA12);
    expect(EXAMPLES_REV).toBeGreaterThanOrEqual(10);
  });

  it('replaces the random player that started at once with the one that starts on hold', () => {
    store.set('lattakker:examples-rev', '10');
    const cells: Record<string, string> = { A12: "span(4, 3)\ntype Side = 'red' | 'blue'" };
    expect(migrateExamples({ restored: true, board: fakeSheet(cells), lab: fakeSheet({}), examples: EXAMPLES, labDemos: [] })).toBe(0);
    expect(newA12).toContain("on(cell, 'click'");
    expect(newA12).toContain('let playing: boolean = false');
  });

  it('leaves A12 alone when the person changed it', () => {
    store.set('lattakker:examples-rev', '9');
    const cells: Record<string, string> = { A12: OLD_A12 + "\nprint('mine')" };
    migrateExamples({ restored: true, board: fakeSheet(cells), lab: fakeSheet({}), examples: EXAMPLES, labDemos: [] });
    expect(cells.A12).toContain("print('mine')");
  });
});

describe('the examples type-check as strictly as the editor', () => {
  /** Runs the compiler with the same options Monaco uses for a cell (strict, each cell a module), plus the cell API declarations. */
  function problems(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'cell-'));
    try {
      writeFileSync(join(dir, 'cell.ts'), code);
      writeFileSync(join(dir, 'cell-api.d.ts'), CELL_API_DTS);
      const tsc = join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js');
      const run = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', '--noImplicitAny', 'false', '--target', 'ES2020', '--module', 'esnext', '--moduleDetection', 'force', '--lib', 'es2022,dom,dom.iterable', '--skipLibCheck', 'false', 'cell.ts', 'cell-api.d.ts'], { cwd: dir, encoding: 'utf8' });
      return run.stdout.split('\n').filter((l) => l.startsWith('cell.ts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('A12 has no type problems and shows its types', () => {
    expect(problems(newA12)).toEqual([]);
    for (const word of ['type Side', 'interface Step', ': Step[]', ': Side[]', ': number', ': string', '): void']) expect(newA12).toContain(word);
  });

  it('A12 does not read the game at its top level (it would re-run after every move)', () => {
    const topLevel = newA12.split('\n').filter((l) => !l.startsWith(' ') && !l.startsWith('//') && !l.startsWith('}'));
    expect(topLevel.filter((l) => /\bgame\.(?!takeOverBlue)/.test(l))).toEqual([]);
  });
});
