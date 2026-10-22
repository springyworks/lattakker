/**
 * Cells that talk to each other, inside one tab: a cell `export`s functions and values, another cell `import`s them,
 * written as plain TypeScript. Monaco already treats every cell as a module (file:///cells/<tab>/B2.ts), so the types,
 * the completions and the red underlines come for free; this file makes the same words work when the cells RUN.
 *
 * It is an RPC without the wire: both cells live in one page, so an imported function is the very function of the other
 * cell (no sockets, no copying, no waiting). Two things the wire would have given are kept: the callee is up to date
 * (a call never reaches the code of an older run), and the cells run in dependency order.
 */

import { normaliseAddress } from './address';
import type { RunContext } from './tasks';

// ------------------------------------------------------------------ rewriting import / export

/** What `rewriteModules` found, besides the new JavaScript. */
export interface ModuleRewrite {
  js: string;
  /** The names this cell exports, 'default' included. */
  exports: string[];
  /** The module specifiers this cell imports, as written. */
  imports: string[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** A copy of the code in which the text of strings, comments, regular expressions and templates is blanked (same length, same lines). */
function mask(code: string): string {
  const out = code.split('');
  const n = code.length;
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let last = '';
  const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';

  const template = (): void => {
    const start = i;
    i++;
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') i += 2;
      else if (ch === '`') {
        i++;
        break;
      } else if (ch === '$' && code[i + 1] === '{') {
        i += 2;
        last = '';
        scan(true);
        i++;
      } else i++;
    }
    blank(start + 1, i - 1);
  };

  const scan = (inTemplate: boolean): void => {
    let depth = 0;
    while (i < n) {
      const ch = code[i];
      const next = code[i + 1];
      if (ch === '/' && next === '/') {
        const start = i;
        while (i < n && code[i] !== '\n') i++;
        blank(start, i);
      } else if (ch === '/' && next === '*') {
        const close = code.indexOf('*/', i + 2);
        const stop = close < 0 ? n : close + 2;
        blank(i, stop);
        i = stop;
      } else if (ch === "'" || ch === '"') {
        const start = i;
        i++;
        while (i < n && code[i] !== ch && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1;
        blank(start + 1, i);
        i++;
        last = 'v';
      } else if (ch === '`') {
        template();
        last = 'v';
      } else if (ch === '/' && (last === '' || BEFORE_REGEX.includes(last))) {
        const start = i;
        i++;
        let inClass = false;
        while (i < n && code[i] !== '\n' && (inClass || code[i] !== '/')) {
          if (code[i] === '\\') i++;
          else if (code[i] === '[') inClass = true;
          else if (code[i] === ']') inClass = false;
          i++;
        }
        i++;
        blank(start + 1, i - 1);
        last = 'v';
      } else {
        if (ch === '{') depth++;
        else if (ch === '}') {
          if (inTemplate && depth === 0) return;
          depth--;
        }
        if (!/\s/.test(ch)) last = ch;
        i++;
      }
    }
  };

  scan(false);
  return out.join('');
}

const IDENT = '[A-Za-z_$][\\w$]*';
const IMPORT_FROM = new RegExp(`import\\s*([^;'"\`]*?)\\s*\\bfrom\\s*(['"])( *)\\2[ \\t]*;?`, 'y');
const IMPORT_BARE = /import\s*(['"])( *)\1[ \t]*;?/y;
const EXPORT_DEFAULT_NAMED = new RegExp(`(export\\s+default\\s+)((?:async\\s+)?function\\s*\\*?|class)\\s*(${IDENT})?`, 'y');
const EXPORT_DEFAULT = /export\s+default\b[ \t]*/y;
const EXPORT_LIST = /export\s*\{([^}]*)\}\s*(?:from\s*(['"])( *)\2)?[ \t]*;?/y;
const EXPORT_STAR = new RegExp(`export\\s*\\*\\s*(?:as\\s+(${IDENT})\\s*)?from\\s*(['"])( *)\\2[ \\t]*;?`, 'y');
const EXPORT_DECL = new RegExp(`(export[ \\t]+)(?:async\\s+function\\s*\\*?|function\\s*\\*?|class)\\s*(${IDENT})`, 'y');
const EXPORT_VAR = /export[ \t]+(?:const|let|var)\s+/y;

function sticky(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

/** Splits at commas that are not inside brackets. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** The index of the first `=` outside brackets that starts an initial value or a default (not `=>`, `==`), or -1. */
function topEquals(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === '=' && depth === 0 && text[i + 1] !== '=' && text[i + 1] !== '>' && text[i - 1] !== '=') return i;
  }
  return -1;
}

/** The names a declaration pattern creates: `a`, `{ a, b: c = 1, ...d }`, `[x, [y]]`. */
function bindingNames(target: string): string[] {
  const text = target.trim();
  if (!text) return [];
  if (text[0] !== '{' && text[0] !== '[') return /^[A-Za-z_$][\w$]*$/.test(text) ? [text] : [];
  const object = text[0] === '{';
  const names: string[] = [];
  for (let part of splitTop(text.slice(1, -1))) {
    part = part.trim().replace(/^\.\.\./, '');
    const eq = topEquals(part);
    if (eq >= 0) part = part.slice(0, eq);
    if (object) {
      let depth = 0;
      for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ':' && depth === 0) {
          part = part.slice(i + 1);
          break;
        }
      }
    }
    names.push(...bindingNames(part));
  }
  return names;
}

/** The names declared by `const a = 1, { b } = o, c;` (the text after the keyword, up to the `;`). */
function declaredNames(declarations: string): string[] {
  const names: string[] = [];
  for (const declarator of splitTop(declarations)) {
    const eq = topEquals(declarator);
    names.push(...bindingNames(eq >= 0 ? declarator.slice(0, eq) : declarator));
  }
  return names;
}

/** The end of a statement that starts at `from`: after the first `;` outside brackets, or the end of the line. */
function statementEnd(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth === 0 && ch === ';') return i + 1;
    else if (depth === 0 && ch === '\n') return i;
  }
  return masked.length;
}

const quote = (text: string): string => JSON.stringify(text);

/** `a`, `a as b` -> [from, to]. */
function specifiers(list: string): Array<[string, string]> {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(s);
      return m ? ([m[1], m[2]] as [string, string]) : ([s, s] as [string, string]);
    });
}

/**
 * Turns the import and export statements of a cell's JavaScript (what TypeScript made of it) into calls the cell runner
 * understands: `import { add } from './B2'` waits for the cell B2 and takes `add` from it; `export function add(...)` keeps the
 * function and publishes it, so the other cell can use it.
 */
export function rewriteModules(js: string): ModuleRewrite {
  const none: ModuleRewrite = { js, exports: [], imports: [] };
  if (!/\b(?:import|export)\b/.test(js)) return none;
  const m = mask(js);
  const edits: Edit[] = [];
  const published: Array<{ name: string; local: string }> = [];
  const imports: string[] = [];
  let temp = 0;
  /** The text of the string that a `from '...'` ended in: the match ends in `'` + spaces + `'` + optional `;`. */
  const specifierOf = (at: number, match: RegExpExecArray, q: string, gap: string): string => {
    const close = at + match[0].lastIndexOf(q);
    return js.slice(close - gap.length, close);
  };

  let depth = 0;
  let lineStart = true;
  for (let i = 0; i < m.length; i++) {
    const ch = m[i];
    if (ch === '\n') {
      lineStart = true;
      continue;
    }
    if (/\s/.test(ch)) continue;
    const first = lineStart;
    lineStart = false;
    if ('([{'.includes(ch)) {
      depth++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      continue;
    }
    if (depth !== 0 || !first || !/[ie]/.test(ch)) continue;
    const isImport = m.startsWith('import', i) && !/[\w$]/.test(m[i + 6] ?? '');
    const isExport = m.startsWith('export', i) && !/[\w$]/.test(m[i + 6] ?? '');
    if (!isImport && !isExport) continue;

    if (isImport) {
      // import(...) and import.meta are not statements.
      if (/^import\s*[(.]/.test(m.slice(i, i + 12))) continue;
      const bare = sticky(IMPORT_BARE, m, i);
      if (bare) {
        const path = specifierOf(i, bare, bare[1], bare[2]);
        imports.push(path);
        edits.push({ start: i, end: i + bare[0].length, text: `await __cell(${quote(path)});` });
        i += bare[0].length - 1;
        continue;
      }
      const from = sticky(IMPORT_FROM, m, i);
      if (!from) throw new Error('This import is not understood: cells are imported like  import { name } from "./B2"');
      const path = specifierOf(i, from, from[2], from[3]);
      imports.push(path);
      const clause = from[1].trim();
      const parts = /^([A-Za-z_$][\w$]*)?\s*,?\s*(?:\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?$/.exec(clause);
      if (!parts) throw new Error(`This import is not understood: ${clause}`);
      const holder = `__mod${++temp}`;
      let text = `const ${holder} = await __cell(${quote(path)});`;
      if (parts[1]) text += ` const ${parts[1]} = ${holder}.default;`;
      if (parts[2]) text += ` const ${parts[2]} = ${holder};`;
      if (parts[3] !== undefined) {
        const named = specifiers(parts[3]).map(([a, b]) => (a === b ? a : `${a}: ${b}`));
        if (named.length) text += ` const { ${named.join(', ')} } = ${holder};`;
      }
      edits.push({ start: i, end: i + from[0].length, text });
      i += from[0].length - 1;
      continue;
    }

    // export
    const named = sticky(EXPORT_DEFAULT_NAMED, m, i);
    if (named && named[3] && named[3] !== 'extends') {
      published.push({ name: 'default', local: named[3] });
      edits.push({ start: i, end: i + named[1].length, text: '' });
      i += named[0].length - 1;
      continue;
    }
    const plainDefault = sticky(EXPORT_DEFAULT, m, i);
    if (plainDefault) {
      edits.push({ start: i, end: i + plainDefault[0].length, text: '__exports.default = ' });
      i += plainDefault[0].length - 1;
      continue;
    }
    const list = sticky(EXPORT_LIST, m, i);
    if (list) {
      const pairs = specifiers(list[1]);
      let text = '';
      if (list[2]) {
        const path = specifierOf(i, list, list[2], list[3]);
        imports.push(path);
        const holder = `__mod${++temp}`;
        text = `{ const ${holder} = await __cell(${quote(path)}); `;
        for (const [a, b] of pairs) text += `Object.defineProperty(__exports, ${quote(b)}, { enumerable: true, get: () => ${holder}[${quote(a)}] }); `;
        text += '}';
        for (const [, b] of pairs) published.push({ name: b, local: '' });
      } else {
        for (const [a, b] of pairs) published.push({ name: b, local: a });
      }
      edits.push({ start: i, end: i + list[0].length, text });
      i += list[0].length - 1;
      continue;
    }
    const star = sticky(EXPORT_STAR, m, i);
    if (star) {
      const path = specifierOf(i, star, star[2], star[3]);
      imports.push(path);
      const text = star[1]
        ? `__exports[${quote(star[1])}] = await __cell(${quote(path)});`
        : `Object.assign(__exports, await __cell(${quote(path)}));`;
      published.push({ name: star[1] ?? '*', local: '' });
      edits.push({ start: i, end: i + star[0].length, text });
      i += star[0].length - 1;
      continue;
    }
    const decl = sticky(EXPORT_DECL, m, i);
    if (decl) {
      published.push({ name: decl[2], local: decl[2] });
      edits.push({ start: i, end: i + decl[1].length, text: '' });
      i += decl[0].length - 1;
      continue;
    }
    const variable = sticky(EXPORT_VAR, m, i);
    if (variable) {
      const bodyStart = i + variable[0].length;
      const bodyEnd = statementEnd(m, bodyStart);
      for (const name of declaredNames(m.slice(bodyStart, bodyEnd).replace(/;\s*$/, ''))) published.push({ name, local: name });
      const lead = /^export[ \t]+/.exec(m.slice(i))![0].length;
      edits.push({ start: i, end: i + lead, text: '' });
      i = bodyEnd - 1;
      continue;
    }
    throw new Error(`This export is not understood: ${js.slice(i, i + 40).split('\n')[0]}`);
  }

  if (!edits.length) return none;
  let out = '';
  let from = 0;
  for (const e of edits) {
    out += js.slice(from, e.start) + e.text;
    from = e.end;
  }
  out += js.slice(from);
  const names = new Set<string>();
  for (const p of published) {
    names.add(p.name);
    if (p.local) out += `\n;Object.defineProperty(__exports, ${quote(p.name)}, { enumerable: true, get: () => ${p.local} });`;
  }
  return { js: out, exports: [...names], imports };
}

// -------------------------------------------------------------------------- the registry

/** One run of a cell as a module: what it published, and whether its top level has finished. */
export interface ModuleRecord {
  readonly address: string;
  readonly ctx: RunContext;
  readonly exports: Record<string, unknown>;
  status: 'running' | 'ready' | 'failed';
  error: string;
  /** Settles when this run is over, or is replaced by a newer run of the same cell. */
  readonly settled: Promise<void>;
  wake: () => void;
}

/** What the sheet says about a cell an importer is waiting for. */
export interface Probe {
  /** The cell holds code. */
  hasCode: boolean;
  /** It is going to run again soon (its code or something it reads changed) and has not started yet. */
  pending: boolean;
}

/** How long an import waits for the other cell to finish its top level. */
export const IMPORT_WAIT_MS = 5000;

/** The published exports of the cells of one sheet. */
export class CellModules {
  private readonly records = new Map<string, ModuleRecord>();
  private readonly bells = new Map<string, { ring: () => void; rung: Promise<void> }>();
  /** Who waits for whom right now (importer -> cells), to spot two cells that import each other. */
  private readonly waits = new Map<string, Set<string>>();

  /** A cell starts running: it will publish into the new record, and anyone waiting on the old one looks again. */
  begin(address: string, ctx: RunContext): ModuleRecord {
    const old = this.records.get(address);
    let wake: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const record: ModuleRecord = { address, ctx, exports: {}, status: 'running', error: '', settled, wake };
    this.records.set(address, record);
    old?.wake();
    this.ring(address);
    return record;
  }

  /** The top level of the run is over (with the error's message when it failed). */
  settle(record: ModuleRecord, error?: unknown): void {
    if (error === undefined) record.status = 'ready';
    else {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    }
    record.wake();
  }

  /** The cell was emptied: nothing is published any more. */
  forget(address: string): void {
    const old = this.records.get(address);
    this.records.delete(address);
    old?.wake();
    this.ring(address);
  }

  /** The record of the latest run, if any. */
  current(address: string): ModuleRecord | undefined {
    return this.records.get(address);
  }

  private bell(address: string): Promise<void> {
    let bell = this.bells.get(address);
    if (!bell) {
      let ring: () => void = () => {};
      const rung = new Promise<void>((resolve) => {
        ring = resolve;
      });
      bell = { ring, rung };
      this.bells.set(address, bell);
    }
    return bell.rung;
  }

  private ring(address: string): void {
    const bell = this.bells.get(address);
    if (!bell) return;
    this.bells.delete(address);
    bell.ring();
  }

  /** Does `from` wait (through others) for `target`? */
  private reaches(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of this.waits.get(from) ?? []) if (this.reaches(next, target, seen)) return true;
    return false;
  }

  /**
   * What `importer` gets from `import ... from './<address>'`: the exports of the latest finished run of that cell. When the other cell
   * has not run yet (or is about to run again) this waits for it, like a module that is evaluated before its importer.
   */
  async load(importer: string, address: string, probe: () => Probe, waitMs = IMPORT_WAIT_MS): Promise<Record<string, unknown>> {
    if (importer === address) throw new Error(`${address} cannot import itself`);
    if (this.reaches(address, importer)) {
      throw new Error(`${importer} and ${address} import each other, so neither can start first. Move the shared part into a third cell.`);
    }
    let set = this.waits.get(importer);
    if (!set) this.waits.set(importer, (set = new Set()));
    set.add(address);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), waitMs);
    });
    try {
      for (;;) {
        const record = this.records.get(address);
        const state = probe();
        if (!state.hasCode) throw new Error(`${address} has no code, so there is nothing to import from it`);
        if (record && !state.pending) {
          if (record.status === 'ready') return record.exports;
          if (record.status === 'failed') throw new Error(`${address} has an error, so ${importer} cannot use it: ${record.error}`);
        }
        const answer = await Promise.race([record && !state.pending ? record.settled : this.bell(address), timeout]);
        if (answer === 'late') {
          throw new Error(`${address} did not finish starting in time (is it waiting forever, or does it import ${importer} back?)`);
        }
      }
    } finally {
      clearTimeout(timer);
      set.delete(address);
    }
  }
}

/** './B2' (or './B2.ts') -> 'B2'; null for anything that is not a cell of this tab. */
export function cellOfSpecifier(spec: string): string | null {
  const m = /^\.\/([A-Za-z]{1,3}\d{1,3})(?:\.ts)?$/.exec(spec.trim());
  return m ? normaliseAddress(m[1]) : null;
}
