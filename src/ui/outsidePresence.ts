import { callers, onCallers, type CallerRecord } from '../ai/entry';

/**
 * A sign of life for outside AIs (the ones that drive this page over MCP): "how do I know it is not hanging?".
 * The page cannot look inside an AI, so it shows only what it has seen itself: when the AI last made a call and what that
 * call was, how many calls so far, and the note the AI gave about itself (introduce). What that quiet could mean is written
 * apart, marked as a reading (≈), never as a fact (✔).
 */

const SHOW_FOR_MS = 30 * 60 * 1000;
const MAX_SHOWN = 3;

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};

/** The facts and (apart from them) the reading, for one caller, `now` being performance.now(). */
export function presenceOf(c: CallerRecord, now: number): { known: string; maybe: string; level: 'fresh' | 'quiet' | 'long' } {
  const age = now - c.last;
  const known = `${c.origin.replace(/^outside-ai:?/, '') || 'an outside AI'} · last call ${ago(age)} ago${c.doing ? ` (${c.doing})` : ''} · ${c.calls} call${c.calls === 1 ? '' : 's'} so far${c.note ? ` · says: “${c.note}”` : ''}`;
  if (age < 20_000) return { known, maybe: '', level: 'fresh' };
  if (age < 180_000) return { known, maybe: 'probably thinking, or waiting for a tool of its own: Lattakker cannot look inside it', level: 'quiet' };
  return { known, maybe: 'it may be finished, stuck or gone: ask it, or leave it a letter (✉)', level: 'long' };
}

const root = Object.assign(document.createElement('div'), { className: 'presence', hidden: true });
root.title = '✔ = what this page saw itself: when the AI last called in and what it asked. ≈ = a reading of that quiet, not a fact. An AI can add a note about what it is doing with the tool "introduce".';
document.body.append(root);

function paint(): void {
  const now = performance.now();
  const recent = callers().filter((c) => now - c.last < SHOW_FOR_MS).slice(0, MAX_SHOWN);
  root.hidden = recent.length === 0;
  root.textContent = '';
  for (const c of recent) {
    const p = presenceOf(c, now);
    const line = Object.assign(document.createElement('div'), { className: `presence-line ${p.level}` });
    line.append(Object.assign(document.createElement('span'), { textContent: `🤖 ✔ ${p.known}` }));
    if (p.maybe) line.append(Object.assign(document.createElement('span'), { className: 'presence-maybe', textContent: ` ≈ ${p.maybe}` }));
    root.append(line);
  }
}

onCallers(paint);
window.setInterval(paint, 1000);
