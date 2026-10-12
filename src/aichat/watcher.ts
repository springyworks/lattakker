import { isConfigured, getSettings } from './config';
import { aiBridge } from './bridge';
import { workspace } from '../workspace';

/**
 * Watches for "// AI: ..." lines left in cells. When one has stayed untouched for a while (22 seconds unless
 * the settings say otherwise), the little chat pops up by itself, asks the question and writes the answer
 * back under the line. The same lines can be answered by an outside assistant that is connected over MCP;
 * when one is listening (wait_for_request), this helper stays quiet so nobody answers twice.
 */

interface Request {
  tab: string;
  address: string;
  line: number;
  text: string;
}

export interface WatcherHost {
  /** The open "// AI:" lines of every tab (the live text of an open editor included). */
  requests(): Request[];
  reply(request: Request, text: string): boolean;
  say(text: string): void;
}

const TICK_MS = 1000;
const MAX_REPLY = 560;

export function startWatcher(host: WatcherHost): void {
  /** key -> when this exact question was first seen. */
  const seen = new Map<string, number>();
  const fired = new Set<string>();
  let hinted = false;

  const tick = (): void => {
    const now = performance.now();
    const open = host.requests();
    const keys = new Set<string>();
    for (const r of open) {
      const key = `${r.tab}/${r.address}:${r.text}`;
      keys.add(key);
      if (!seen.has(key)) seen.set(key, now);
    }
    // A question that is gone (answered, edited, deleted) is forgotten, so asking the same thing again works.
    for (const key of [...seen.keys()]) {
      if (!keys.has(key)) {
        seen.delete(key);
        fired.delete(key);
      }
    }
    const settings = getSettings();
    if (!settings.autoPopup || document.hidden || aiBridge.isBusy()) return;
    if (workspace.list().some((t) => t.editor.aiListening())) return;
    for (const r of open) {
      const key = `${r.tab}/${r.address}:${r.text}`;
      if (fired.has(key) || now - (seen.get(key) ?? now) < settings.autoSeconds * 1000) continue;
      fired.add(key);
      if (!isConfigured()) {
        if (!hinted) {
          hinted = true;
          host.say('A “// AI:” question is waiting. To get an answer here, set up a helper with the 🤖 AI button (⚙ settings).');
        }
        continue;
      }
      aiBridge.ask(
        { tab: r.tab, address: r.address, line: r.line },
        {
          question: r.text,
          at: { x: window.innerWidth - 380, y: 90 },
          done: (reply) => {
            if (!reply.ok) return;
            const text = reply.text.length > MAX_REPLY ? `${reply.text.slice(0, MAX_REPLY)}…` : reply.text;
            // The line may have moved while the helper thought: find the same question again.
            const again = host.requests().find((x) => x.tab === r.tab && x.address === r.address && x.text === r.text);
            if (again) host.reply(again, text);
          },
        },
      );
      break;
    }
  };

  window.setInterval(tick, TICK_MS);
}
