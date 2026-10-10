import type { SheetCellData } from './Sheet';
import type { TranspileResult } from '../editor/monaco';
import type { RunContext } from './tasks';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

export type ApiFactory = (data: SheetCellData, ctx: RunContext) => Record<string, unknown>;
export type Transpiler = (address: string, source: string) => Promise<TranspileResult>;

/** Runs one cell: transpile its TypeScript, then execute it with the cell API in scope. */
export async function runCell(data: SheetCellData, ctx: RunContext, makeApi: ApiFactory, transpile: Transpiler): Promise<void> {
  const source = data.code;
  if (!source.trim()) return;
  let js = source;
  try {
    const result = await transpile(data.address, source);
    if (result.errors.length) {
      data.error = result.errors[0];
      return;
    }
    js = result.js;
  } catch (err) {
    // Transpiler unavailable: try to run the source as plain JavaScript.
    console.warn('transpile failed, running as JS', err);
  }
  if (ctx.cancelled) return;
  const api = makeApi(data, ctx);
  const names = Object.keys(api);
  const values = names.map((n) => api[n]);
  let fn: (...values: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction(...names, `"use strict";\n${js}`);
  } catch (err) {
    data.error = err instanceof Error ? err.message : String(err);
    return;
  }
  await fn(...values);
}
