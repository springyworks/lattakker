/**
 * Subtitles on the screen, for whoever records it: a screen-grab video of the page can tell the viewer what is going on.
 * One line (or two) at the bottom, large and calm, on top of everything but never in the way of a click.
 * `window.subtitle('text')` shows it (it goes away by itself after a reading time), `window.subtitle('')` removes it; the MCP tool
 * `subtitle` and `mms.subtitle(text, seconds)` do the same for an AI or a script that makes the video.
 */

const MAX_CHARS = 220;

const root = Object.assign(document.createElement('div'), { className: 'subtitle', hidden: true });
root.setAttribute('role', 'status');
root.setAttribute('aria-live', 'polite');
document.body.append(root);

let timer = 0;

/** Reading time for a text: a little over 14 characters a second, at least 3 seconds. */
const readingSeconds = (text: string): number => Math.max(3, Math.round(text.length / 14 + 1.5));

/** Shows a subtitle; `seconds` = how long (default: a reading time), 0 = until the next one. An empty text removes it. */
export function showSubtitle(text: string, seconds?: number): void {
  window.clearTimeout(timer);
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  root.hidden = !clean;
  root.textContent = clean;
  if (!clean) return;
  const s = seconds === undefined ? readingSeconds(clean) : seconds;
  if (s > 0) timer = window.setTimeout(() => (root.hidden = true), s * 1000);
}

(window as unknown as { subtitle?: typeof showSubtitle }).subtitle = showSubtitle;
