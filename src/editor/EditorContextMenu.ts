import * as monaco from 'monaco-editor';
import { HoverMenu, type MenuItem } from '../ui/HoverMenu';

/**
 * Right-click inside any Monaco editor opens the app's own popup menu (the same look as the
 * sheet's) instead of the browser's. The browser's native menu cannot be opened by a script, so
 * the "Browser menu…" item arms the editor: the very next right-click inside it is left alone and
 * the browser shows its own menu (spelling, Inspect, translate, …). The arming lapses by itself.
 */

const ARM_MS = 15000;

let menu: HoverMenu | null = null;
let armed: { editor: monaco.editor.ICodeEditor; until: number } | null = null;
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

function itemsFor(editor: monaco.editor.ICodeEditor, x: number, y: number): MenuItem[] {
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
    {
      label: 'Browser menu…',
      hint: 'right-click again',
      title: "Go one level deeper: the next right-click in this editor shows the browser's own menu",
      onSelect: () => {
        armed = { editor, until: performance.now() + ARM_MS };
        showNote("Now right-click in the editor again to get the browser's own menu.", x, y);
      },
    },
  ];
}

function onContextMenu(editor: monaco.editor.ICodeEditor, e: MouseEvent): void {
  if (armed && armed.editor === editor && performance.now() < armed.until) {
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
    editor.focus(); // most actions are only "supported" while the editor has focus
    menu?.openAt(x, y, itemsFor(editor, x, y));
  }, 0);
}

/** Gives every Monaco editor created from now on the popup right-click menu. */
export function installEditorContextMenu(): void {
  monaco.editor.onDidCreateEditor((editor) => {
    // The editor's own DOM node does not exist yet when this event fires; its container does.
    const dom = editor.getContainerDomNode();
    // Capture phase: the editor hosts stop contextmenu from bubbling, but this must always see it.
    dom?.addEventListener('contextmenu', (e) => onContextMenu(editor, e), true);
  });
}
