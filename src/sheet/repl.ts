const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

/** The editor's own compiler turns TypeScript into JavaScript (the same one every cell goes through). */
export type ReplTranspile = (source: string) => Promise<{ js: string; errors: string[] }>;

const DECLARATION = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([\s\S]+?);?\s*$/;
const NAMED = /^(?:async\s+function|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/;

const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^';
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;
const IDENT = /[\w$]/;

/** What the scanner saw: the top-level statements (cut at `;` outside brackets, strings, comments and templates), whether something is still open, and the last two significant characters. */
export interface Scan {
  parts: string[];
  open: boolean;
  tail: string;
}

/** Walks over TypeScript source without parsing it: enough to find the `;` that really end statements and the brackets, strings and comments that are still open. */
export function scan(src: string): Scan {
  const parts: string[] = [];
  const templates: number[] = [];
  let start = 0;
  let depth = 0;
  let inTemplate = false;
  let commentOpen = false;
  let tail = '';
  let i = 0;
  const mark = (ch: string): void => {
    tail = (tail + ch).slice(-2);
  };
  const regexAllowed = (): boolean => {
    const before = src.slice(0, i).trimEnd();
    if (!before) return true;
    const ch = before[before.length - 1]!;
    if (REGEX_AFTER.includes(ch)) return true;
    return IDENT.test(ch) && REGEX_KEYWORDS.test(before);
  };
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (inTemplate) {
      if (ch === '\\') i += 2;
      else if (ch === '`') {
        inTemplate = false;
        mark('x');
        i++;
      } else if (ch === '$' && next === '{') {
        templates.push(depth);
        depth++;
        inTemplate = false;
        mark('{');
        i += 2;
      } else i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) {
        commentOpen = true;
        i = src.length;
      } else i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      i++;
      mark('x');
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i++;
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      let inClass = false;
      i++;
      while (i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/')) {
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i += src[i] === '\\' ? 2 : 1;
      }
      i++;
      mark('x');
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '}') {
      if (templates.length && templates[templates.length - 1] === depth - 1) {
        templates.pop();
        depth--;
        inTemplate = true;
        i++;
        continue;
      }
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
    if (!/\s/.test(ch)) mark(ch);
    i++;
  }
  parts.push(src.slice(start));
  return { parts: parts.map((p) => p.trim()).filter(Boolean), open: inTemplate || templates.length > 0 || commentOpen || depth > 0, tail };
}

/** True when the code cannot be finished yet: a bracket, string template or comment is open, or it ends on an operator, a comma, a dot or an arrow. */
export function isIncomplete(source: string): boolean {
  const s = scan(source);
  if (s.open) return true;
  if (/(\+\+|--)$/.test(s.tail)) return false;
  return /[+\-*/%&|^<>=,.?:!~]$/.test(s.tail);
}

/** What a dot-command is given: the text after its name, and the whole line. It may return text to print, or a value (shown like a result), or nothing; it may be async. */
export type DotHandler = (args: string, line: string) => unknown;

/** A dot-command as listed by `.help`. */
export interface DotInfo {
  name: string;
  help: string;
}

/** `dot('name', handler, 'what it does')` adds a command (or replaces one of the same name); the returned function takes it away again. `dot.list()` gives them all; `dot.remove(name)` takes one away. */
export interface DotRegistry {
  (name: string, handler: DotHandler, help?: string): () => void;
  list(): DotInfo[];
  remove(name: string): boolean;
}

export type Repl = ((line: string) => Promise<string>) & { incomplete: (source: string) => boolean; dot: DotRegistry };

const DOT_LINE = /^\.([A-Za-z_][\w-]*)(?:\s+([\s\S]*))?$/;
const DOT_NAME = /^[A-Za-z_][\w-]*$/;

/** A line that starts with a dot and a name is a dot-command (never TypeScript: a statement cannot begin with `.name`). */
export const isDotLine = (line: string): boolean => DOT_LINE.test(line.trim());

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
export function createRepl(transpile: ReplTranspile, globals: () => Record<string, unknown>): Repl {
  const scope: Record<string, unknown> = Object.create(null);
  const commands = new Map<string, { handler: DotHandler; help: string }>();

  const register = (name: string, handler: DotHandler, help = ''): (() => void) => {
    if (!DOT_NAME.test(name)) throw new Error(`a dot-command name is letters, digits, _ and -, and starts with a letter: ${JSON.stringify(name)}`);
    if (typeof handler !== 'function') throw new Error('dot(name, handler, help): the handler must be a function');
    const entry = { handler, help };
    commands.set(name, entry);
    return () => void (commands.get(name) === entry && commands.delete(name));
  };
  const dot: DotRegistry = Object.assign(register, {
    list: (): DotInfo[] => [...commands].map(([name, c]) => ({ name, help: c.help })).sort((a, b) => a.name.localeCompare(b.name)),
    remove: (name: string): boolean => commands.delete(name),
  });

  // .help is made from the list of commands, so a command added later shows up in it at once. A cell may replace it with dot('help', ...).
  register('help', () => dot.list().map((c) => `.${c.name}${c.help ? '  ' + c.help : ''}`).join('\n'), 'this list');
  register('dots', () => dot.list().map((c) => c.name).join(' '), 'the names of all dot-commands');

  const dotted = async (line: string): Promise<string> => {
    const [, name = '', args = ''] = DOT_LINE.exec(line.trim()) ?? [];
    const command = commands.get(name);
    if (!command) {
      const near = [...commands.keys()].find((n) => n.toLowerCase() === name.toLowerCase());
      return `?? .${name} is not a dot-command${near ? ` (did you mean .${near}?)` : ''}. .help lists them; dot('${name}', (args) => ..., 'what it does') adds one.`;
    }
    try {
      const value = await command.handler(args.trim(), line.trim());
      return typeof value === 'string' ? value : formatResult(value);
    } catch (err) {
      return '?? .' + name + ': ' + (err instanceof Error ? err.message : String(err));
    }
  };

  const compile = async (code: string): Promise<string | string[]> => {
    const out = await transpile(code);
    return out.errors.length ? out.errors : out.js.replace(/^\s*["']use strict["'];?\s*$/m, '');
  };

  const execute = async (js: string): Promise<void> => {
    const api: Record<string, unknown> = { ...globals(), dot };
    const names = Object.keys(api).filter((n) => !(n in scope));
    const fn = new AsyncFunction('__s', ...names, `with (__s) {\n${js}\n}`);
    await fn(scope, ...names.map((n) => api[n]));
  };

  const runOne = async (source: string): Promise<string> => {
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

  const run = async (line: string): Promise<string> => {
    if (isDotLine(line)) return dotted(line);
    let result = '';
    for (const statement of scan(line).parts) {
      result = await runOne(statement);
      if (result.startsWith('?? ')) return result;
    }
    return result;
  };
  return Object.assign(run, { incomplete: (source: string) => !isDotLine(source) && isIncomplete(source), dot });
}
