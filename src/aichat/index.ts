import * as monaco from 'monaco-editor';
import type { installAiSurface } from '../ai/surface';
import type { TabStrip } from '../ui/TabStrip';
import { parseCellUri } from '../editor/monaco';
import { workspace } from '../workspace';
import { Conversation } from './agent';
import { aiBridge, type AskOptions } from './bridge';
import { loadSettings } from './config';
import { AiChatUi } from './ui';
import { startWatcher } from './watcher';
import type { AiContext } from './tools';

type Surface = ReturnType<typeof installAiSurface>;

interface RequestInfo {
  tab: string;
  address: string;
  line: number;
  text: string;
}

/** The cell a Monaco editor with the keyboard focus is editing, if any. */
function editorContext(): AiContext | null {
  const editor = monaco.editor.getEditors().find((e) => e.hasTextFocus());
  const model = editor?.getModel();
  const owner = model ? parseCellUri(model.uri) : null;
  return owner && workspace.get(owner.scope) ? { tab: owner.scope, address: owner.address } : null;
}

/** Where the person is pointing: the cell being edited, else the selected cell of the tab on screen. */
function contextNow(): AiContext {
  const fromEditor = editorContext();
  if (fromEditor) return fromEditor;
  const focus = workspace.focus;
  if (focus && focus.tab === workspace.current) return { tab: focus.tab, address: focus.address };
  return { tab: workspace.current, address: null };
}

/**
 * Sets up the helper: settings from this browser, the chat, the doors into it (the 🤖 button, Alt+I, the
 * `aiBridge` used by menus) and the watcher for "// AI:" lines. Nothing is sent anywhere until a helper has
 * been chosen in the settings.
 */
export function installAiChat(deps: { surface: Surface; strip: TabStrip; say: (text: string) => void }): void {
  loadSettings();
  const { surface, strip } = deps;

  const convo = new Conversation({
    help: () => surface.help(),
    state: () => surface.state(),
    boardText: () => String((surface.board() as { text?: string }).text ?? ''),
  });

  const ui = new AiChatUi(convo, {
    contextNow,
    onSideChange: (open) => strip.setAiOpen(open),
    typeIn: async (path, code) => {
      const result = (await surface.writeCodeLive(path, code)) as { ok: boolean; error?: string };
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
  });
  strip.onAi = () => ui.toggleSide();

  aiBridge.register({
    ask(ctx: AiContext, options: AskOptions) {
      if (options.side && !options.question) {
        ui.openSide();
        return;
      }
      ui.openMini(ctx, options.at ?? null, !options.question);
      if (options.question) void convo.ask(options.question, ctx, () => {}).then((r) => options.done?.(r));
    },
    toggleSide: () => ui.toggleSide(),
    openSettings: () => ui.showSettings(true),
    isBusy: () => convo.busy,
  });

  // Alt+I from anywhere (also inside an editor) opens the side chat; Alt+Shift+I opens the little one at the cell.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyI') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) aiBridge.ask(contextNow(), {});
      else ui.toggleSide();
    },
    true,
  );

  startWatcher({
    say: deps.say,
    requests: () => ((surface.requests(false) as { requests?: RequestInfo[] }).requests ?? []).map((r) => ({ tab: r.tab, address: r.address, line: r.line, text: r.text })),
    reply: (r, text) => (surface.replyToRequest(r.address, r.line, text, r.tab) as { ok: boolean }).ok,
  });
}

export { aiBridge };
