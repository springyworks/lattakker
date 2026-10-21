import type { SheetCellData } from './Sheet';
import type { TranspileResult } from '../editor/monaco';
import type { RunContext } from './tasks';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

export type ApiFactory = (data: SheetCellData, ctx: RunContext) => Record<string, unknown>;
export type Transpiler = (address: string, source: string) => Promise<TranspileResult>;

/** Names that joined the cell API after cells already existed. */
const OPTIONAL_NAMES = new Set(['weather', 'ollama', 'input', 'svg', 'system', 'tabs', 'anim', 'teletype', 'repl']);

/** Runs one cell: transpile its TypeScript, then execute it with the cell API in scope. */
export async function runCell(data: SheetCellData, ctx: RunContext, makeApi: ApiFactory, transpile: Transpiler): Promise<void> {
  const source = data.code;
  if (!source.trim()) return;
  let js = source;
  let engineError: unknown = null;
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
    engineError = err;
  }
  if (ctx.cancelled) return;
  const api = makeApi(data, ctx);
  let names = Object.keys(api);
  let fn: (...values: unknown[]) => Promise<unknown>;
  for (;;) {
    try {
      fn = new AsyncFunction(...names, `"use strict";\n${js}`);
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A cell that already declares its own `input`, `weather` or `ollama` (before they were part of the API) keeps its own.
      const clash = /Identifier '(\w+)' has already been declared/.exec(message)?.[1];
      if (clash && OPTIONAL_NAMES.has(clash) && names.includes(clash)) {
        names = names.filter((n) => n !== clash);
        continue;
      }
      // Without the compiler the TypeScript could not be turned into JavaScript: say that, not what the JavaScript parser made of it.
      data.error = engineError
        ? `The code engine is not answering, so this TypeScript could not be compiled (${engineError instanceof Error ? engineError.message : String(engineError)}). Press F5 to reload the page.`
        : message;
      return;
    }
  }
  await fn(...names.map((n) => api[n]));
}
