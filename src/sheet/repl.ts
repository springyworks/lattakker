const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

/** The editor's own compiler turns TypeScript into JavaScript (the same one every cell goes through). */
export type ReplTranspile = (source: string) => Promise<{ js: string; errors: string[] }>;

const DECLARATION = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([\s\S]+?);?\s*$/;
const NAMED = /^(?:async\s+function|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/;

/** What a result looks like on paper. */
export function formatResult(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * A TypeScript read-eval-print loop that keeps its variables between lines. Every line is compiled by `transpile`
 * (so it is TypeScript, not only JavaScript) and run with `globals` (the cell API) in reach. A line that is an
 * expression gives its value; `const x = 5`, `let x = 5`, `var x = 5`, `function f() {}` and `class C {}` stay for the
 * next lines (a declaration with several names or a destructuring does not: it lasts for its own line).
 */
export function createRepl(transpile: ReplTranspile, globals: () => Record<string, unknown>): (line: string) => Promise<string> {
  const scope: Record<string, unknown> = Object.create(null);

  const compile = async (code: string): Promise<string | string[]> => {
    const out = await transpile(code);
    return out.errors.length ? out.errors : out.js.replace(/^\s*["']use strict["'];?\s*$/m, '');
  };

  const execute = async (js: string): Promise<void> => {
    const api = globals();
    const names = Object.keys(api).filter((n) => !(n in scope));
    const fn = new AsyncFunction('__s', ...names, `with (__s) {\n${js}\n}`);
    await fn(scope, ...names.map((n) => api[n]));
  };

  return async (line: string): Promise<string> => {
    const source = line.trim();
    if (!source) return '';
    const declared = DECLARATION.exec(source);
    const named = declared ? null : NAMED.exec(source);
    const attempts = declared
      ? [`__s.${declared[1]} = (${declared[2]})`]
      : named
        ? [`__s.${named[1]} = ${source}`]
        : [`__s.__value = (${source.replace(/;\s*$/, '')})`, source];
    let failure: string[] = [];
    for (const attempt of attempts) {
      const js = await compile(attempt);
      if (Array.isArray(js)) {
        failure = failure.length ? failure : js;
        continue;
      }
      try {
        await execute(js);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const missing = /^(\w+) is not defined$/.exec(message)?.[1];
        const names = Object.keys({ ...globals(), ...scope });
        const near = missing && names.find((n) => n.toLowerCase() === missing.toLowerCase());
        return '?? ' + message + (near ? ` (did you mean ${near}?)` : '');
      }
      const value = scope.__value;
      delete scope.__value;
      return attempt.startsWith('__s.__value') ? formatResult(value) : '';
    }
    return '?? ' + (failure[0] ?? 'SYNTAX ERROR');
  };
}
