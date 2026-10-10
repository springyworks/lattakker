import * as monaco from 'monaco-editor';
import { typescript as ts } from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { CELL_API_DTS } from '../sheet/apiTypes';
import { THEME } from '../theme';

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
  lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
  stickyScroll: { enabled: false },
};

/** Small ready-made pieces of code shown in the completion list. */
const SNIPPETS: Array<{ label: string; doc: string; body: string }> = [
  { label: 'print text', doc: 'Show text in this cell', body: "print('${1:Hello}')" },
  { label: 'if', doc: 'Do something only when a test is true', body: 'if (${1:condition}) {\n  ${2}\n}' },
  { label: 'for each square', doc: 'Visit every square of the board', body: "for (const square of range('A1:J10')) {\n  ${1:square.color('#d9e8dd')}\n}" },
  { label: 'for each red piece', doc: 'Visit every piece of the Red army', body: "for (const piece of game.pieces('red')) {\n  ${1:print(piece.name, piece.address)}\n}" },
  { label: 'colour my cell', doc: 'Change the background colour of this cell', body: "color('${1:#d9e8dd}')" },
  { label: 'count pieces', doc: 'Count the pieces of one colour', body: "const ${1:count} = game.pieces('${2:red}').length\nprint(${1:count})" },
  { label: 'read another cell', doc: 'Look at another cell by address', body: "const ${1:other} = at('${2:A12}')\nprint(${1:other}.text)" },
];

monaco.languages.registerCompletionItemProvider('typescript', {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return {
      suggestions: SNIPPETS.map((snip) => ({
        label: snip.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: snip.doc,
        insertText: snip.body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      })),
    };
  },
});

const models = new Map<string, monaco.editor.ITextModel>();

export function modelFor(address: string, source: string): monaco.editor.ITextModel {
  let model = models.get(address);
  if (!model) {
    model = monaco.editor.createModel(source, 'typescript', monaco.Uri.parse(`file:///cells/${address}.ts`));
    models.set(address, model);
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
async function typescriptWorker(): Promise<Awaited<ReturnType<typeof ts.getTypeScriptWorker>>> {
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
export async function transpile(address: string, source: string): Promise<TranspileResult> {
  const model = modelFor(address, source);
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

/** A small, directly-editable Monaco instance hosted inline on the sheet canvas for a code cell. */
export function createCellViewEditor(host: HTMLElement, model: monaco.editor.ITextModel): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, {
    ...KID_FRIENDLY,
    model,
    fontSize: 12,
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

export { monaco };
