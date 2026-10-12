import * as monaco from 'monaco-editor';
import { HoverMenu, type MenuItem } from '../ui/HoverMenu';
import { aiBridge } from '../aichat/bridge';
import { parseCellUri } from './monaco';

/**
 * Right-click inside any Monaco editor (or any other part of an editor window, via installPopupMenu)
 * opens the app's own popup menu (the same look as the sheet's) instead of the browser's. The
 * browser's native menu cannot be opened by a script, so the "Browser menu…" item arms the element:
 * the very next right-click inside it is left alone and the browser shows its own menu (spelling,
 * Inspect, translate, …). The arming lapses by itself.
 */

const ARM_MS = 15000;

let menu: HoverMenu | null = null;
let armed: { el: HTMLElement; until: number } | null = null;
let note: HTMLDivElement | null = null;
let noteTimer = 0;

function action(editor: monaco.editor.ICodeEditor, id: string, label: string, hint?: string): MenuItem {
  const act = editor.getAction(id);
  return {
    label,
    hint,
    disabled: !act || !act.isSupported(),
    onSelect: () => {
      editor.focus();
      void act?.run();
    },
  };
}

function clipboard(editor: monaco.editor.ICodeEditor, id: string, command: 'cut' | 'copy', label: string, hint: string): MenuItem {
  const hasSelection = !editor.getSelection()?.isEmpty();
  const editable = !editor.getOption(monaco.editor.EditorOption.readOnly);
  return {
    label,
    hint,
    disabled: command === 'cut' ? !hasSelection || !editable : !hasSelection,
    onSelect: () => {
      editor.focus();
      editor.trigger('rccpopup', id, null);
    },
  };
}

function paste(editor: monaco.editor.ICodeEditor): MenuItem {
  return {
    label: 'Paste',
    hint: 'Ctrl+V',
    disabled: !!editor.getOption(monaco.editor.EditorOption.readOnly),
    onSelect: () => {
      editor.focus();
      navigator.clipboard
        .readText()
        .then((text) => {
          const selections = editor.getSelections() ?? [];
          editor.executeEdits('rccpopup', selections.map((range) => ({ range, text, forceMoveMarkers: true })));
        })
        .catch(() => showNote('The browser did not allow reading the clipboard here — press Ctrl+V instead.'));
    },
  };
}

function showNote(text: string, x = window.innerWidth / 2, y = 60): void {
  note?.remove();
  window.clearTimeout(noteTimer);
  const el = document.createElement('div');
  el.className = 'rcc-note';
  el.textContent = text;
  document.body.append(el);
  el.style.left = `${Math.max(6, Math.min(x, window.innerWidth - el.offsetWidth - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, window.innerHeight - el.offsetHeight - 6))}px`;
  note = el;
  noteTimer = window.setTimeout(() => {
    el.remove();
    if (note === el) note = null;
  }, 4000);
}

/** "Ask the AI": about the selected text when there is some, else about the whole cell. */
function askAi(editor: monaco.editor.ICodeEditor): MenuItem {
  const model = editor.getModel();
  const owner = model ? parseCellUri(model.uri) : null;
  return {
    label: '🤖 Ask the AI about this…',
    hint: 'Alt+I',
    disabled: !owner,
    onSelect: () => {
      if (owner) aiBridge.ask({ tab: owner.scope, address: owner.address });
    },
  };
}

function editorItems(editor: monaco.editor.ICodeEditor): MenuItem[] {
  return [
    clipboard(editor, 'editor.action.clipboardCutAction', 'cut', 'Cut', 'Ctrl+X'),
    clipboard(editor, 'editor.action.clipboardCopyAction', 'copy', 'Copy', 'Ctrl+C'),
    paste(editor),
    {
      label: 'Select all',
      hint: 'Ctrl+A',
      onSelect: () => {
        editor.focus();
        editor.trigger('rccpopup', 'editor.action.selectAll', null);
      },
    },
    { separator: true },
    action(editor, 'editor.action.revealDefinition', 'Go to definition', 'F12'),
    action(editor, 'editor.action.goToReferences', 'Find all references', 'Shift+F12'),
    action(editor, 'editor.action.rename', 'Rename symbol', 'F2'),
    action(editor, 'editor.action.quickFix', 'Quick fix', 'Ctrl+.'),
    action(editor, 'editor.action.formatDocument', 'Format code', 'Shift+Alt+F'),
    action(editor, 'editor.action.quickCommand', 'All commands', 'F1'),
    { separator: true },
    askAi(editor),
  ];
}

/**
 * Gives an element the popup right-click menu: `build` lists its own items and "Browser menu…" is
 * added at the end. `before` runs once the click is known (Monaco needs focus first).
 */
export function installPopupMenu(el: HTMLElement, build: () => MenuItem[], before?: () => void): void {
  // Capture phase: the editor windows stop contextmenu from bubbling, but this must always see it.
  el.addEventListener(
    'contextmenu',
    (e) => {
      if (armed && armed.el === el && performance.now() < armed.until) {
        armed = null;
        note?.remove();
        menu?.close();
        return; // not prevented: the browser shows its own menu
      }
      armed = null;
      e.preventDefault();
      menu ??= new HoverMenu();
      const { clientX: x, clientY: y } = e;
      // Monaco moves the cursor to the click in its own (later) handler; build the items after it.
      window.setTimeout(() => {
        before?.();
        const items = build();
        const browser: MenuItem = {
          label: 'Browser menu…',
          hint: 'right-click again',
          title: "Go one level deeper: the next right-click here shows the browser's own menu",
          onSelect: () => {
            armed = { el, until: performance.now() + ARM_MS };
            showNote("Now right-click here again to get the browser's own menu.", x, y);
          },
        };
        menu?.openAt(x, y, items.length ? [...items, { separator: true }, browser] : [browser]);
      }, 0);
    },
    true,
  );
}

/** Gives every Monaco editor created from now on the popup right-click menu. */
export function installEditorContextMenu(): void {
  monaco.editor.onDidCreateEditor((editor) => {
    // The editor's own DOM node does not exist yet when this event fires; its container does.
    installPopupMenu(editor.getContainerDomNode(), () => editorItems(editor), () => editor.focus());
  });
}
