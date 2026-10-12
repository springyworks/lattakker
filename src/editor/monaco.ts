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

ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  // Every cell is its own little module so names never clash between cells and `await` works at top level.
  moduleDetection: 3,
  allowNonTsExtensions: true,
  strict: false,
  noImplicitAny: false,
  lib: ['es2020', 'dom'],
} as ts.CompilerOptions);
ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
ts.typescriptDefaults.setEagerModelSync(true);
ts.typescriptDefaults.addExtraLib(CELL_API_DTS, 'file:///cell-api.d.ts');

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

export interface TranspileResult {
  js: string;
  errors: string[];
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
  const getWorker = await typescriptWorker();
  const client = await getWorker(model.uri);
  const uri = model.uri.toString();
  const diagnostics = await client.getSyntacticDiagnostics(uri);
  const errors = diagnostics.map((d) => {
    const pos = d.start != null ? model.getPositionAt(d.start) : null;
    const text = typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText;
    return pos ? `line ${pos.lineNumber}: ${text}` : text;
  });
  const out = await client.getEmitOutput(uri);
  const file = out.outputFiles.find((f) => f.name.endsWith('.js')) ?? out.outputFiles[0];
  let js = file?.text ?? '';
  js = js.replace(/^\s*export\s*\{\s*\};?\s*$/gm, '');
  return { js, errors };
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
