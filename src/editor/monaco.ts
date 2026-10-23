import * as monaco from 'monaco-editor';
import { typescript as ts } from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { CELL_API_DTS } from '../sheet/apiTypes';
import { EXAMPLES } from '../examples';
import { RECIPES, exampleRecipes } from '../recipes';
import { coachFor } from './coachHints';
import { THEME } from '../theme';
import { installEditorContextMenu } from './EditorContextMenu';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

/**
 * The cells are checked as strictly as the app itself (`strict`: mistakes with null and undefined, with `this`, with the shape of functions and
 * with arrays are caught), but a child is not asked to write types: the messages of the "implicitly has type any" family are not shown, and a
 * value that has no type is simply `any`, as before. So `const rows = []`, `(n) => n * 2` and `catch (e)` need nothing added.
 * (Strict WITHOUT noImplicitAny is a trap: an empty [] would be a never[] and `a.push(1)` an error. That is why the check is on and its messages are hidden.)
 */
const IMPLICIT_ANY_MESSAGES = [7005, 7006, 7008, 7010, 7011, 7015, 7017, 7018, 7019, 7020, 7022, 7023, 7031, 7034, 7044, 7051, 7053];

ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  // Every cell is its own little module so names never clash between cells and `await` works at top level.
  moduleDetection: 3,
  allowNonTsExtensions: true,
  strict: true,
  // `catch (e)` stays `any`: no need to narrow an `unknown` before printing it.
  useUnknownInCatchVariables: false,
  // The library files by their full names: 'es2020' and 'dom' alone load nothing, and then console, document, setTimeout and fetch are "not found".
  lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
} as ts.CompilerOptions);
ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: IMPLICIT_ANY_MESSAGES });
ts.typescriptDefaults.setEagerModelSync(true);
ts.typescriptDefaults.addExtraLib(CELL_API_DTS, 'file:///cell-api.d.ts');

// The types TypeScript works out are drawn in the code itself (const n: number = ..., (a: string) => ..., function f(): boolean), so you see them
// without hovering. Only drawn: the code stays as it was written. They go together with the paths of imported names (one switch, see below).
const typeHints = (on: boolean): void =>
  ts.typescriptDefaults.setInlayHintsOptions({
    includeInlayVariableTypeHints: on,
    includeInlayFunctionParameterTypeHints: on,
    includeInlayFunctionLikeReturnTypeHints: on,
    includeInlayPropertyDeclarationTypeHints: on,
    includeInlayParameterNameHints: on ? 'literals' : 'none',
  });

// One light theme for every editor (Monaco applies a theme globally). The editor itself is transparent so a
// cell's own fill shows through, but the popup widgets (suggestions, hover, parameter hints) are opaque.
monaco.editor.defineTheme('mms', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000',
    'editor.lineHighlightBackground': '#00000000',
    'editorGutter.background': '#00000000',
    'editor.foreground': THEME.ink,
    'editorWidget.background': '#ffffff',
    'editorWidget.foreground': THEME.ink,
    'editorWidget.border': THEME.inkSoft,
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.foreground': THEME.ink,
    'editorSuggestWidget.border': THEME.inkSoft,
    'editorSuggestWidget.selectedBackground': THEME.selectFill,
    'editorSuggestWidget.selectedForeground': THEME.ink,
    'editorSuggestWidget.highlightForeground': THEME.primary,
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.foreground': THEME.ink,
    'editorHoverWidget.border': THEME.inkSoft,
    'editorHoverWidget.statusBarBackground': THEME.headerFill,
  },
});

// Popups live in one node on <body>, above everything, so no canvas layer can cover or clip them.
const widgetHost = document.createElement('div');
widgetHost.className = 'monaco-editor mms-widgets';
document.body.appendChild(widgetHost);

// The text beside the suggestion list (Monaco's "show more", which Ctrl+Space opens) is opened the first time a list
// appears, so the documentation is there without asking. It uses only Monaco's public command, and only once: after that
// Monaco remembers whether the person wants it, and closing it with its x stays closed.
let docsOpened = false;
new MutationObserver(() => {
  if (docsOpened) return;
  const list = widgetHost.querySelector('.suggest-widget.visible');
  if (!list) return;
  docsOpened = true;
  if (!list.classList.contains('shows-details')) monaco.editor.getEditors().find((e) => e.hasTextFocus())?.trigger('lattakker', 'toggleSuggestionDetails', {});
}).observe(widgetHost, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

// Pointing at an entry of the list shows its text, as the hover does: the highlighted entry follows the mouse. It moves
// the highlight with Monaco's own "next" and "previous" commands, one step at a time. Only a real mouse move counts,
// because the list scrolls under a still mouse when the highlight moves, and that must not start a chase.
let followedAt = 0;
widgetHost.addEventListener('mousemove', (e) => {
  const row = (e.target as HTMLElement).closest('.suggest-widget .monaco-list-row');
  if (!row || (e.movementX === 0 && e.movementY === 0) || performance.now() - followedAt < 120) return;
  const list = row.closest('.suggest-widget');
  const focused = list?.querySelector('.monaco-list-row.focused');
  const want = Number(row.getAttribute('data-index'));
  const have = Number(focused?.getAttribute('data-index'));
  if (!Number.isFinite(want) || !Number.isFinite(have) || want === have || Math.abs(want - have) > 40) return;
  const editor = monaco.editor.getEditors().find((ed) => ed.hasTextFocus());
  if (!editor) return;
  followedAt = performance.now();
  for (let i = 0; i < Math.abs(want - have); i++) editor.trigger('lattakker', want > have ? 'selectNextSuggestion' : 'selectPrevSuggestion', {});
});

/**
 * The text beside the suggestion list says the same as the hover: the signature as highlighted code, the documentation
 * (with its @param lines), and the 💡 line for the words a child meets first. Monaco's own TypeScript list gives the
 * signature as plain text and the documentation without the kid line, and it shows "Loading..." until the engine
 * answers (for ever, when the engine is stuck). So the answer of the engine is reshaped here, and an answer that does
 * not come is replaced by a plain sentence after a few seconds.
 *
 * This has to be in place before the TypeScript support registers its list, which it does when the first TypeScript
 * model is made: that is why this is at the top of the file, and why it wraps the registration.
 */
const ENGINE_PATIENCE_MS = 6000;
/** The first list of a page also loads the engine and the browser's type library, which can take a while. */
const ENGINE_LIST_PATIENCE_MS = 15000;

function reshapeDetails(item: monaco.languages.CompletionItem, answer: monaco.languages.CompletionItem | null | undefined): monaco.languages.CompletionItem {
  const uri = (item as { uri?: monaco.Uri }).uri;
  if (!uri || !isCodeUri(uri)) return answer ?? item;
  if (!answer) {
    return { ...item, detail: undefined, documentation: { value: '_The TypeScript engine is slow to answer. Press Esc, then type the dot again._' } };
  }
  const signature = (answer.detail ?? '').trim();
  const documentation = typeof answer.documentation === 'string' ? answer.documentation : (answer.documentation?.value ?? '');
  // A word that is a member (after a dot) is not the global of the same name, so it gets no kid line.
  const model = monaco.editor.getModel(uri);
  const range = item.range && 'startColumn' in item.range ? item.range : null;
  const member = !!model && !!range && /\.\s*$/.test(model.getLineContent(range.startLineNumber).slice(0, range.startColumn - 1));
  const kid = member ? undefined : KID_WORDS[typeof item.label === 'string' ? item.label : item.label.label];
  const parts = [signature && '```typescript\n' + signature + '\n```', documentation.trim(), kid && '---\n💡 ' + kid].filter(Boolean);
  if (!parts.length) return answer;
  return { ...answer, detail: undefined, documentation: { value: parts.join('\n\n') } };
}

const registerCompletions = monaco.languages.registerCompletionItemProvider.bind(monaco.languages);
(monaco.languages as { registerCompletionItemProvider: typeof registerCompletions }).registerCompletionItemProvider = (selector, provider) => {
  const resolve = provider.resolveCompletionItem?.bind(provider);
  if (!resolve) return registerCompletions(selector, provider);
  const wrapped = Object.create(provider) as monaco.languages.CompletionItemProvider;
  // The list itself says "Loading..." until the engine answers, so it gets the same patience: no answer, no list (and no stuck sign).
  const provide = provider.provideCompletionItems.bind(provider);
  wrapped.provideCompletionItems = (model, position, context, token) =>
    Promise.race([Promise.resolve(provide(model, position, context, token)), new Promise<undefined>((done) => window.setTimeout(() => done(undefined), ENGINE_LIST_PATIENCE_MS))]);
  wrapped.resolveCompletionItem = async (item, token) => {
    const answer = await Promise.race([
      Promise.resolve(resolve(item, token)).catch(() => null),
      new Promise<null>((done) => window.setTimeout(() => done(null), ENGINE_PATIENCE_MS)),
    ]);
    return reshapeDetails(item, answer);
  };
  return registerCompletions(selector, wrapped);
};

/** Editor features that help a child write code; everything that only adds noise stays off. */
const KID_FRIENDLY: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: 'mms',
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: 'on',
  fixedOverflowWidgets: true,
  overflowWidgetsDomNode: widgetHost,
  quickSuggestions: { other: true, comments: false, strings: true },
  quickSuggestionsDelay: 80,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'on',
  tabCompletion: 'on',
  snippetSuggestions: 'inline',
  wordBasedSuggestions: 'off',
  suggestFontSize: 13,
  suggest: { showIcons: true, showWords: false, preview: true, showStatusBar: true },
  parameterHints: { enabled: true, cycle: true },
  hover: { enabled: 'on', delay: 250 },
  autoClosingBrackets: 'always',
  autoClosingQuotes: 'always',
  autoIndent: 'full',
  formatOnType: true,
  formatOnPaste: true,
  matchBrackets: 'always',
  bracketPairColorization: { enabled: true },
  renderLineHighlight: 'none',
  occurrencesHighlight: 'off',
  contextmenu: false,
  links: false,
  colorDecorators: false,
  unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
  lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.OnCode },
  codeLens: true,
  stickyScroll: { enabled: false },
};

const EXAMPLE_RECIPES = exampleRecipes(EXAMPLES);

/** Cell editors (on the sheet) and gallery editors (Examples tab) get the same kid help. */
export function isCodeUri(uri: monaco.Uri): boolean {
  return uri.path.startsWith('/cells/') || uri.path.startsWith('/gallery/');
}

// Recipes and the sheet's examples join the completion list of every cell editor (floating pane and inline).
monaco.languages.registerCompletionItemProvider('typescript', {
  provideCompletionItems(model, position) {
    if (!isCodeUri(model.uri)) return { suggestions: [] };
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const recipes = RECIPES.map((r) => ({
      label: r.label,
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'recipe',
      documentation: r.doc,
      insertText: r.body,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: '1' + r.label,
      range,
    }));
    const examples = EXAMPLE_RECIPES.map((r) => ({
      label: r.label,
      kind: monaco.languages.CompletionItemKind.File,
      detail: 'example',
      documentation: r.doc,
      insertText: r.code,
      sortText: '9' + r.label,
      range,
    }));
    return { suggestions: [...recipes, ...examples] };
  },
});

/** Plain-words explanations for the words a child meets first. They are added under the normal TypeScript hover. */
const KID_WORDS: Record<string, string> = {
  const: '**const** gives a value a name that never changes.\n\n`const red = 5` ➜ `red` is 5 from now on.',
  let: '**let** gives a value a name that you may change later.\n\n`let score = 0` then `score = score + 1`.',
  if: '**if** only does something when a test is true.\n\n`if (score > 3) { print(\'Win!\') }`',
  else: '**else** is what happens when the `if` test was *not* true.',
  for: '**for** repeats something. `for (const p of game.pieces(\'red\'))` visits every red piece, one by one.',
  of: '**of** reads: "for each one in this list".',
  while: '**while** keeps repeating as long as the test stays true. Careful: it must stop one day!',
  await: '**await** waits for a slow thing (like `sleep(\'1s\')`) *without* freezing the game.',
  async: '**async** marks a function that is allowed to use `await`.',
  return: '**return** hands an answer back from a function.',
  function: '**function** is a little machine: give it something, get something back.',
  true: '**true** and **false** are the two yes/no answers.',
  false: '**true** and **false** are the two yes/no answers.',
  null: '**null** means "nothing here".',
  undefined: '**undefined** means "nobody told me yet".',
  Math: '**Math** has number tools: `Math.max(2, 9)`, `Math.random()`, `Math.round(2.6)`, `Math.sin(x)`.',
  print: '🖨️ **print** writes a line in this cell. Call it again to add another line.',
  show: '🪧 **show** replaces everything in this cell with new text. Great for a clock or a score.',
  color: '🎨 **color** paints the background of a cell. Try `color(\'pink\')` or a code like `#ffd6d6`.',
  span: '📐 **span** makes this cell bigger: `span(4, 2)` is 4 columns wide and 2 rows tall.',
  at: '👉 **at** points at another cell: `at(\'A12\').text` reads what is written there.',
  range: '🧺 **range** is a bunch of cells at once: `range(\'A1:J10\')` is the whole board.',
  game: '🎲 **game** knows everything about the battle: pieces, whose turn it is, who won.',
  every: '⏰ **every** does something again and again: `every(\'1s\', () => ...)` is once a second.',
  after: '⏳ **after** does something once, later: `after(\'4s\', () => ...)`.',
  sleep: '😴 **sleep** pauses *this* cell only. Use it with `await`.',
  on: '👀 **on** watches a cell and runs your code when it changes.',
  plot: '📈 **plot** draws a graph: `plot(Math.sin)` or `plot([3, 1, 4, 1, 5])`.',
  memory: '🧠 **memory** is this cell\'s notebook. It keeps its notes between runs.',
  cell: '🔲 **cell** is *this* cell: its address, its size, who reads it.',
  run: 'ℹ️ **run** tells you why this cell is running now (edited, moved, or the game moved on).',
};

monaco.languages.registerHoverProvider('typescript', {
  provideHover(model, position) {
    if (!isCodeUri(model.uri)) return null;
    const word = model.getWordAtPosition(position);
    const text = word && KID_WORDS[word.word];
    if (!word || !text) return null;
    const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
    if (before.includes('//')) return null;
    return {
      range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
      contents: [{ value: '💡 ' + text }],
    };
  },
});

// The coach: a friendly hint above each line that has an error (CodeLens). It follows the TypeScript markers,
// a little after the child stops typing so half-written words do not flash.
const coachChanged = new monaco.Emitter<monaco.languages.CodeLensProvider>();
let coachTimer = 0;
monaco.editor.onDidChangeMarkers((uris) => {
  if (!uris.some(isCodeUri)) return;
  window.clearTimeout(coachTimer);
  coachTimer = window.setTimeout(() => coachChanged.fire(coachProvider), 700);
});

/** The coach's hint lines per error line of a cell model (line number -> hints). */
export function coachLines(model: monaco.editor.ITextModel): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (model.isDisposed()) return out;
  for (const marker of monaco.editor.getModelMarkers({ resource: model.uri })) {
    if (marker.severity !== monaco.MarkerSeverity.Error || out.has(marker.startLineNumber) || marker.endLineNumber > model.getLineCount()) continue;
    const code = Number(typeof marker.code === 'object' ? marker.code?.value : marker.code);
    const bad = model.getValueInRange(new monaco.Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn));
    const hints = coachFor({ code, message: marker.message, bad: bad.length <= 40 ? bad : '', line: model.getLineContent(marker.startLineNumber) });
    if (hints.length) out.set(marker.startLineNumber, hints);
  }
  return out;
}

const coachProvider: monaco.languages.CodeLensProvider = {
  onDidChange: coachChanged.event,
  provideCodeLenses(model) {
    if (!isCodeUri(model.uri)) return { lenses: [], dispose() {} };
    const lenses: monaco.languages.CodeLens[] = [];
    for (const [line, hints] of coachLines(model)) {
      for (const title of hints) lenses.push({ range: new monaco.Range(line, 1, line, 1), command: { id: '', title } });
    }
    return { lenses, dispose() {} };
  },
};
monaco.languages.registerCodeLensProvider('typescript', coachProvider);

const models = new Map<string, monaco.editor.ITextModel>();

/** Each sheet (the game board's, the lab's) has its own scope so A12 on one sheet is not A12 on the other. */
export function cellUri(address: string, scope = ''): monaco.Uri {
  return monaco.Uri.parse(`file:///cells/${scope ? scope + '/' : ''}${address}.ts`);
}

/** Which sheet and which cell a model belongs to, or null when it is not a cell model. */
export function parseCellUri(uri: monaco.Uri): { scope: string; address: string } | null {
  const m = /^\/cells\/(?:([a-z]+)\/)?([A-Z]+\d+)\.ts$/.exec(uri.path);
  return m ? { scope: m[1] ?? '', address: m[2] } : null;
}

export function modelFor(address: string, source: string, scope = ''): monaco.editor.ITextModel {
  const key = `${scope}/${address}`;
  let model = models.get(key);
  if (!model) {
    model = monaco.editor.createModel(source, 'typescript', cellUri(address, scope));
    models.set(key, model);
  } else if (model.getValue() !== source) {
    model.setValue(source);
  }
  return model;
}

/** Keeps the editor's picture of a cell true to its code, for the cells that import it (a model is made only for a cell that holds code). */
export function syncModel(address: string, source: string, scope = ''): void {
  if (source.trim() || models.has(`${scope}/${address}`)) modelFor(address, source, scope);
}

// ------------------------------------------------------------------ cells that import cells

/** The addresses a cell's code imports from: `import { f } from './B2'` gives B2. */
function importedCells(code: string): string[] {
  return [...code.matchAll(/\bfrom\s*['"]\.\/([A-Za-z]{1,3}\d{1,3})(?:\.ts)?['"]/g)].map((m) => m[1].toUpperCase());
}

/** The names a cell exports, as far as a quick look at its code can tell (for the list of cells to import from). */
function exportedNames(code: string): string[] {
  const names = new Set<string>();
  for (const m of code.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const part of m[1].split(',')) if (part.trim()) names.add(part.trim().split(/\s+as\s+/).pop()!);
  if (/^export\s+default\b/m.test(code)) names.add('default');
  return [...names];
}

// The editor re-checks a cell when the cell itself is edited, not when a cell it imports from is. So when a cell's code changes,
// the cells of the same tab that import it are checked again (changing the diagnostics options makes Monaco re-check every model).
const recheckTimers = new Map<string, number>();
monaco.editor.onDidCreateModel((model) => {
  const parsed = parseCellUri(model.uri);
  if (!parsed) return;
  model.onDidChangeContent(() => {
    const key = `${parsed.scope}/${parsed.address}`;
    window.clearTimeout(recheckTimers.get(key));
    recheckTimers.set(
      key,
      window.setTimeout(() => {
        recheckTimers.delete(key);
        const affected = monaco.editor.getModels().some((other) => {
          const o = parseCellUri(other.uri);
          return !!o && o.scope === parsed.scope && o.address !== parsed.address && importedCells(other.getValue()).includes(parsed.address);
        });
        if (affected) ts.typescriptDefaults.setDiagnosticsOptions({ ...ts.typescriptDefaults.getDiagnosticsOptions() });
      }, 400),
    );
  });
});

// ------------------------------------------------------------------ show where an imported name comes from

const SOURCES_KEY = 'lattakker.showImportSources';
let showSources = localStorage.getItem(SOURCES_KEY) !== 'off';
typeHints(showSources);
const sourcesChanged = new monaco.Emitter<void>();

/** Whether the editor draws the types and where imported names come from (`./A4.add(2, 3)`). One switch for both, on by default. */
export const importSourcesShown = (): boolean => showSources;

export function setImportSourcesShown(on: boolean): void {
  showSources = on;
  localStorage.setItem(SOURCES_KEY, on ? 'on' : 'off');
  typeHints(on);
  sourcesChanged.fire();
}

interface ImportedName {
  local: string;
  address: string;
  /** Offset just after the local name in the import line. */
  end: number;
}

/** The names a cell imports from other cells, with where each stands in the import line, and the import lines' ranges. */
function importedNames(code: string): { names: ImportedName[]; lines: Array<[number, number]> } {
  const names: ImportedName[] = [];
  const lines: Array<[number, number]> = [];
  for (const m of code.matchAll(/^[ \t]*import\s+(?:type\s+)?([^'"\n;]*?)\s*from\s*['"]\.\/([A-Za-z]{1,3}\d{1,3})(?:\.ts)?['"]/gm)) {
    const address = m[2].toUpperCase();
    lines.push([m.index!, m.index! + m[0].length]);
    const clause = m[1];
    const clauseAt = m.index! + m[0].indexOf(clause);
    const brace = clause.indexOf('{');
    const dflt = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (dflt) names.push({ local: dflt[1], address, end: clauseAt + dflt[0].replace(/\s*,$/, '').length });
    if (brace < 0) continue;
    let at = clauseAt + brace + 1;
    for (const part of clause.slice(brace + 1, clause.indexOf('}', brace)).split(',')) {
      const word = /([A-Za-z_$][\w$]*)\s*$/.exec(part);
      if (word && !/^type\s*$/.test(part)) names.push({ local: word[1], address, end: at + word.index + word[1].length });
      at += part.length + 1;
    }
  }
  return { names, lines };
}

/** What the TypeScript worker says about the name at an offset, cut down to the part after the name: `(a: number): number`. */
async function typeAfterName(model: monaco.editor.ITextModel, name: string, end: number): Promise<string> {
  try {
    const getWorker = await typescriptWorker();
    const client = await getWorker(model.uri);
    const info = await client.getQuickInfoAtPosition(model.uri.toString(), end - 1);
    const first = (info?.displayParts ?? []).map((p: { text: string }) => p.text).join('').split('\n')[0];
    const rest = first.replace(/^\(alias\)\s*/, '').replace(new RegExp(`^(?:[a-z]+\\s+)*${name.replace(/\$/g, '\\$')}`), '');
    return rest.trim();
  } catch {
    return '';
  }
}

monaco.languages.registerInlayHintsProvider('typescript', {
  onDidChangeInlayHints: sourcesChanged.event,
  async provideInlayHints(model, range) {
    if (!showSources || !parseCellUri(model.uri)) return { hints: [], dispose() {} };
    const code = model.getValue();
    const { names, lines } = importedNames(code);
    const hints: monaco.languages.InlayHint[] = [];
    const byName = new Map(names.map((n) => [n.local, n]));
    if (byName.size) {
      const inImport = (offset: number): boolean => lines.some(([from, to]) => offset >= from && offset < to);
      const word = new RegExp(`(?<![\\w$.'"\`])(?:${[...byName.keys()].map((n) => n.replace(/\$/g, '\\$')).join('|')})(?![\\w$'"\`:])`, 'g');
      for (const m of code.matchAll(word)) {
        const offset = m.index!;
        const pos = model.getPositionAt(offset);
        if (pos.lineNumber < range.startLineNumber || pos.lineNumber > range.endLineNumber || inImport(offset)) continue;
        if (/\/\/|^\s*\*|\/\*/.test(model.getLineContent(pos.lineNumber).slice(0, pos.column - 1))) continue;
        hints.push({ position: pos, label: `./${byName.get(m[0])!.address}.`, tooltip: `${m[0]} comes from the cell ${byName.get(m[0])!.address}` });
      }
    }
    for (const n of names) {
      const pos = model.getPositionAt(n.end);
      if (pos.lineNumber < range.startLineNumber || pos.lineNumber > range.endLineNumber) continue;
      const type = await typeAfterName(model, n.local, n.end);
      if (type) hints.push({ position: pos, label: type.startsWith(':') ? type : ` ${type}`, paddingLeft: true, tooltip: `The type of ${n.local}, as the cell ${n.address} exports it` });
    }
    return { hints, dispose() {} };
  },
});

/** Inside `from '|'` the cells of the same tab are offered, with what each one exports. */
monaco.languages.registerCompletionItemProvider('typescript', {
  triggerCharacters: ["'", '"', '.', '/'],
  provideCompletionItems(model, position) {
    const self = parseCellUri(model.uri);
    if (!self) return { suggestions: [] };
    const before = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column));
    const open = /(?:\bfrom|\bimport)\s*(['"])([^'"]*)$/.exec(before);
    if (!open) return { suggestions: [] };
    const after = model.getValueInRange(new monaco.Range(position.lineNumber, position.column, position.lineNumber, model.getLineMaxColumn(position.lineNumber)));
    const tail = /^[^'"]*/.exec(after)![0].length;
    const range = new monaco.Range(position.lineNumber, position.column - open[2].length, position.lineNumber, position.column + tail);
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const other of monaco.editor.getModels()) {
      const o = parseCellUri(other.uri);
      const code = other.getValue();
      if (!o || o.scope !== self.scope || o.address === self.address || !code.trim()) continue;
      const names = exportedNames(code);
      suggestions.push({
        label: { label: `./${o.address}`, description: names.length ? names.join(', ') : 'exports nothing yet' },
        kind: monaco.languages.CompletionItemKind.Module,
        insertText: `./${o.address}`,
        range,
        detail: names.length ? `Cell ${o.address} exports: ${names.join(', ')}` : `Cell ${o.address} has no export yet (write  export function ...  in it)`,
        sortText: (names.length ? '0' : '1') + o.address.padStart(6, '0'),
      });
    }
    return { suggestions };
  },
});

export interface TranspileResult {
  js: string;
  errors: string[];
}

/**
 * The worker of the TypeScript engine can fail to load (the dev server was busy or restarting at that moment): its calls then never answer,
 * and every cell would wait for ever. So each call has a time to answer; when it does not, the page is told ('lattakker:engine-stuck',
 * see the watchdog in main.ts) and it recovers by itself.
 */
const ENGINE_WAIT_MS = 15000;

function answered<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('lattakker:engine-stuck'));
      reject(new Error('The TypeScript engine did not answer in time'));
    }, ENGINE_WAIT_MS);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The TypeScript language service starts lazily; the first request can arrive before it has registered. */
export async function typescriptWorker(): Promise<Awaited<ReturnType<typeof ts.getTypeScriptWorker>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ts.getTypeScriptWorker();
    } catch (err) {
      if (attempt >= 40) throw err;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }
}

/** TypeScript -> JavaScript using Monaco's own TypeScript worker. */
const transpiled = new Map<string, TranspileResult>();

export async function transpile(address: string, source: string, scope = ''): Promise<TranspileResult> {
  // A cell that other cells import from must be known to the editor even when its transpiled code is already cached.
  modelFor(address, source, scope);
  // Cells re-run often with the same code: skipping the worker keeps their output from blinking.
  const hit = transpiled.get(source);
  if (hit) return hit;
  const result = await transpileUncached(address, source, scope);
  if (transpiled.size >= 300) transpiled.clear();
  transpiled.set(source, result);
  return result;
}

async function transpileUncached(address: string, source: string, scope: string): Promise<TranspileResult> {
  const model = modelFor(address, source, scope);
  const getWorker = await answered(typescriptWorker());
  const client = await answered(getWorker(model.uri));
  const uri = model.uri.toString();
  const diagnostics = await answered(client.getSyntacticDiagnostics(uri));
  const errors = diagnostics.map((d) => {
    const pos = d.start != null ? model.getPositionAt(d.start) : null;
    const text = typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText;
    return pos ? `line ${pos.lineNumber}: ${text}` : text;
  });
  const out = await answered(client.getEmitOutput(uri));
  const file = out.outputFiles.find((f) => f.name.endsWith('.js')) ?? out.outputFiles[0];
  let js = file?.text ?? '';
  js = js.replace(/^\s*export\s*\{\s*\};?\s*$/gm, '');
  return { js, errors };
}

/** One thing the editor underlines in a cell: the same list the person sees as red and yellow squiggles. */
export interface CodeProblem {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  code: number;
  /** The text of that line, so the problem can be found without counting. */
  lineText: string;
  /** The editor's light bulb for this mistake: what each quick fix does, with the line as it would read after it when the fix stays on one line. */
  fixes?: string[];
}

/** The shape of the TypeScript worker's quick-fix answer (its typing is `any`). */
interface WorkerTextChange {
  span: { start: number; length: number };
  newText: string;
}
interface WorkerCodeFix {
  description: string;
  changes: Array<{ textChanges: WorkerTextChange[] }>;
}

/** The light bulb's fixes, said so a model can copy them: what the fix does, and the fixed line when the fix stays on one line. */
function bulbText(source: string, fixes: readonly WorkerCodeFix[], max = 2): string[] {
  const out: string[] = [];
  for (const fix of fixes.slice(0, max)) {
    const changes = (fix.changes ?? []).flatMap((c) => c.textChanges ?? []).sort((a, b) => a.span.start - b.span.start);
    let line: string | null = null;
    if (changes.length && !changes.some((c) => c.newText.includes('\n'))) {
      let text = source;
      for (const c of [...changes].reverse()) text = text.slice(0, c.span.start) + c.newText + text.slice(c.span.start + c.span.length);
      // Nothing before the first change moved, so the line it is on can be counted in the original offsets.
      line = text.split('\n')[source.slice(0, changes[0].span.start).split('\n').length - 1]?.trim().slice(0, 160) ?? null;
    }
    out.push(line ? `${fix.description} → the line would read: ${line}` : fix.description);
  }
  return out;
}

const flatten = (text: string | { messageText: string; next?: unknown[] }): string => {
  if (typeof text === 'string') return text;
  const parts = [text.messageText];
  let next = text.next as Array<{ messageText: string; next?: unknown[] }> | undefined;
  while (next?.length && parts.length < 4) {
    parts.push(next[0].messageText);
    next = next[0].next as typeof next;
  }
  return parts.join(' ');
};

/**
 * What the editor would underline in this code (mistakes of syntax and of types, as strict as the cells themselves), asked of the
 * TypeScript worker on a scratch copy, so an open editor is never touched. Errors first, at most `limit` of them.
 */
let scratchCount = 0;

export async function checkCode(source: string, scope = '', limit = 8): Promise<CodeProblem[]> {
  // A new name every time: the worker keeps the text it last saw under a name, and would answer for the old text.
  const uri = monaco.Uri.parse(`file:///cells/${scope ? scope + '/' : ''}Z${++scratchCount}.ts`);
  const model = monaco.editor.createModel(source, 'typescript', uri);
  try {
    const getWorker = await answered(typescriptWorker());
    const client = await answered(getWorker(uri));
    const [syntax, semantic] = await answered(Promise.all([client.getSyntacticDiagnostics(uri.toString()), client.getSemanticDiagnostics(uri.toString())]));
    const found: CodeProblem[] = [];
    const spans = new Map<CodeProblem, { start: number; length: number }>();
    for (const d of [...syntax, ...semantic]) {
      // Categories: 0 warning, 1 error, 2 suggestion, 3 message. Suggestions and the "implicit any" family are not shown to anybody.
      if (d.category > 1 || IMPLICIT_ANY_MESSAGES.includes(d.code)) continue;
      const pos = model.getPositionAt(d.start ?? 0);
      const problem: CodeProblem = { line: pos.lineNumber, column: pos.column, severity: d.category === 1 ? 'error' : 'warning', message: flatten(d.messageText as never), code: d.code, lineText: model.getLineContent(pos.lineNumber).trim().slice(0, 160) };
      found.push(problem);
      spans.set(problem, { start: d.start ?? 0, length: d.length ?? 0 });
    }
    const kept = found.sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning') || a.line - b.line).slice(0, limit);
    // The editor's light bulb for each mistake that is shown: the same quick fixes a person gets. A bulb that
    // does not answer only means less help, so it is never an error; a few mistakes is enough to keep it quick.
    for (const problem of kept.filter((p) => p.severity === 'error').slice(0, 4)) {
      const span = spans.get(problem)!;
      try {
        const fixes = (await answered(client.getCodeFixesAtPosition(uri.toString(), span.start, span.start + span.length, [problem.code], {}))) as readonly WorkerCodeFix[];
        const said = bulbText(source, fixes);
        if (said.length) problem.fixes = said;
      } catch {
        // no bulb for this one
      }
    }
    return kept;
  } finally {
    model.dispose();
  }
}

export function createEditor(host: HTMLElement, model: monaco.editor.ITextModel): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, {
    ...KID_FRIENDLY,
    model,
    fontSize: 14,
    lineNumbersMinChars: 3,
    padding: { top: 6 },
  });
}

/** The editor of a notebook block (Examples tab): big enough to read, with line numbers, and it never traps the mouse wheel. */
export function createNotebookEditor(host: HTMLElement, model: monaco.editor.ITextModel): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, {
    ...KID_FRIENDLY,
    model,
    fontSize: 13,
    codeLens: false,
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: false,
    overviewRulerLanes: 0,
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    scrollbar: { alwaysConsumeMouseWheel: false },
  });
}

/** A small, directly-editable Monaco instance hosted inline on the sheet canvas for a code cell. */
export function createCellViewEditor(host: HTMLElement, model: monaco.editor.ITextModel): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, {
    ...KID_FRIENDLY,
    model,
    fontSize: 12,
    codeLens: false,
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    overviewRulerLanes: 0,
    padding: { top: 2, bottom: 2 },
    scrollbar: { horizontal: 'hidden', vertical: 'hidden' },
  });
}

installEditorContextMenu();

export { monaco };
