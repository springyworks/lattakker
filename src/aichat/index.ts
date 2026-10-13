import * as monaco from 'monaco-editor';
import type { installAiSurface } from '../ai/surface';
import type { TabStrip } from '../ui/TabStrip';
import { parseCellUri } from '../editor/monaco';
import { workspace } from '../workspace';
import { nav } from '../nav';
import { Conversation } from './agent';
import { aiBridge, type AskOptions } from './bridge';
import { loadSettings, onSettingsChange } from './config';
import { HelperServer } from './helperServer';
import { StatusServer } from './jobs';
import { MemoryServer } from './memoryServer';
import { loadMemory } from './memory';
import { startMemorySync } from './memorySync';
import { LocalAiServer, probeLocal } from './localAi';
import { router } from '../mcp/router';
import { AiChatUi } from './ui';
import { startWatcher } from './watcher';
import type { AiContext, RunReport } from './tools';

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
  return owner && workspace.get(owner.scope) ? { tab: owner.scope, address: owner.address, line: editor?.getPosition()?.lineNumber ?? null } : null;
}

/** Where the person is pointing: the cell being edited, else the selected cell of the tab on screen. */
function contextNow(): AiContext {
  const fromEditor = editorContext();
  if (fromEditor) return fromEditor;
  const focus = workspace.focus;
  if (focus && focus.tab === workspace.current) return { tab: focus.tab, address: focus.address };
  return { tab: workspace.current, address: null };
}

/** Adds code as new lines right below a line of a cell: in the open editor when there is one (Ctrl+Z undoes it), else in the saved code. */
function addBelowLine(path: string, code: string, line: number): { ok: boolean; error?: string } {
  const hit = workspace.resolve(path);
  if ('error' in hit) return { ok: false, error: hit.error };
  const { tab, address } = hit;
  tab.select();
  if (tab.editor.isOpen && tab.editor.address === address) {
    return tab.editor.insertAfterLine(line, code) ? { ok: true } : { ok: false, error: `line ${line} is not in the editor any more` };
  }
  const d = tab.sheet.dataAt(address);
  if (!d) return { ok: false, error: `${path} is not a cell` };
  const lines = d.code.split('\n');
  if (line > lines.length) return { ok: false, error: `${path} has only ${lines.length} lines` };
  lines.splice(line, 0, ...code.split('\n'));
  tab.sheet.setCode(address, lines.join('\n'));
  tab.editor.open(address);
  return { ok: true };
}

/** What the page's own run/write calls answer, in the shape the tools use. */
function toReport(result: unknown): RunReport {
  const r = result as { ok: boolean; error?: string; output?: string; text?: string; uid?: string | null };
  return { ok: r.ok, error: r.error, output: r.output, text: r.text, uid: r.uid };
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
    liveText: (tab, address) => {
      const editor = workspace.get(tab)?.editor;
      return editor?.isOpen && editor.address === address ? editor.valueText : null;
    },
    run: async (path) => toReport(await surface.runCell(path)),
    write: async (path, code) => {
      const typed = (await surface.writeCodeLive(path, code)) as { ok: boolean; error?: string };
      if (!typed.ok) return { ok: false, error: typed.error };
      // A moment to read what was typed, then keep it (this also restarts the cell) and see how it ran.
      await new Promise((r) => window.setTimeout(r, 1500));
      const hit = workspace.resolve(path);
      if (!('error' in hit) && hit.tab.editor.isOpen && hit.tab.editor.address === hit.address) hit.tab.editor.close(true);
      return toReport(await surface.runCell(path));
    },
  });

  // The memory and the helper are MCP servers too: outside AIs reach them through the page's router (mms.mcp).
  router.register(new MemoryServer());
  router.register(new StatusServer());
  router.register(new HelperServer(convo, contextNow));
  router.register(new LocalAiServer(() => convo.toolHost(), (text) => convo.note(text), 'ai-chat'));
  void loadMemory().then(() => startMemorySync());
  // Is there a local model next to the main helper? Looked up now and whenever the settings change.
  void probeLocal(true);
  onSettingsChange(() => void probeLocal(true));

  const ui = new AiChatUi(convo, {
    contextNow,
    onSideChange: (open) => strip.setAiOpen(open),
    typeIn: async (path, code, afterLine) => {
      if (afterLine) return addBelowLine(path, code, afterLine);
      const result = (await surface.writeCodeLive(path, code)) as { ok: boolean; error?: string };
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    clearCell: (path, code) => {
      const hit = workspace.resolve(path);
      if ('error' in hit) return { ok: false, error: hit.error };
      // Only the helper's own code is taken back: if the person changed the cell since, it is left alone.
      if (hit.tab.sheet.dataAt(hit.address)?.code.trim() !== code.trim()) return { ok: false, error: `${path} was changed after the helper wrote it, so it is left as it is.` };
      const result = surface.clearCell(path) as { ok: boolean; error?: string };
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    goTo: (path) => nav.goTo(path),
  });
  strip.onAi = () => ui.toggleSide();

  aiBridge.register({
    ask(ctx: AiContext, options: AskOptions) {
      if (options.side && !options.question) {
        ui.openSide();
        return;
      }
      ui.openMini(ctx, options.at ?? null, !options.question);
      if (options.question) void convo.ask(options.question, ctx).then((r) => options.done?.(r));
    },
    toggleSide: () => ui.toggleSide(),
    openSettings: () => ui.showSettings(true),
    isBusy: () => convo.busy,
  });

  // Alt+I from anywhere (also inside an editor), or Ctrl+I outside an editor, opens the side chat; Alt+Shift+I opens the little one at the cell.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code !== 'KeyI' || e.metaKey) return;
      const alt = e.altKey && !e.ctrlKey;
      // Ctrl+I outside an editor opens the chat too; inside one, the editor's own Ctrl+I opens it at the cursor.
      const ctrl = e.ctrlKey && !e.altKey && !e.shiftKey && !(e.target as HTMLElement | null)?.closest?.('.monaco-editor');
      if (!alt && !ctrl) return;
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
