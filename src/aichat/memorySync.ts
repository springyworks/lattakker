import { exportJson, importJson, loadMemory, onMemoryChange, replaceFrom } from './memory';

/**
 * One memory for everything. While the dev server runs, the helper's notes and database are also kept in one
 * file on the computer (see scripts/memory-file.ts), so every page, whichever port it was opened on, uses the same
 * memory, and so can the command line or an AI in the editor, by reading the file.
 *
 *  - When a page starts it merges the file into what it has (the newer copy of a note wins) and writes the result.
 *  - Every change is written to the file a moment later.
 *  - When the page gets the focus back it looks at the file; if another page changed it, the file wins, so a note
 *    forgotten in one page is gone in the others.
 *
 * Without the dev server (the published page) nothing here runs: the memory stays in the browser, and the backup
 * button is the way to move it.
 */

const URL_PATH = '/__lattakker/memory';
const PUSH_DELAY_MS = 800;

export const memoryFileState = { file: '' as string, error: '' as string };

let applying = false;
let timer = 0;
/** The `saved` stamp of the file as this page last saw it or wrote it. */
let seen = '';

const stamp = (text: string): string => {
  try {
    return String((JSON.parse(text) as { saved?: unknown }).saved ?? '');
  } catch {
    return '';
  }
};

async function pull(): Promise<string | null> {
  try {
    const res = await fetch(URL_PATH, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    memoryFileState.file = decodeURIComponent(res.headers.get('X-Memory-File') ?? '');
    return await res.text();
  } catch {
    return null;
  }
}

async function push(): Promise<void> {
  const text = exportJson();
  try {
    const res = await fetch(URL_PATH, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`the memory file answered ${res.status}`);
    seen = stamp(text);
    memoryFileState.error = '';
  } catch (err) {
    memoryFileState.error = err instanceof Error ? err.message : String(err);
  }
}

async function refresh(): Promise<void> {
  // A change of this page that has not been written yet must not be thrown away.
  if (timer) return;
  const text = await pull();
  if (text === null || stamp(text) === seen || !stamp(text)) return;
  applying = true;
  try {
    if (await replaceFrom(text)) seen = stamp(text);
  } finally {
    applying = false;
  }
}

export async function startMemorySync(): Promise<void> {
  if (!import.meta.env.DEV) return;
  await loadMemory();
  const text = await pull();
  // No answer: not the dev server (or an old one): the memory simply stays in the browser.
  if (text === null) return;
  applying = true;
  try {
    if (stamp(text)) await importJson(text);
  } finally {
    applying = false;
  }
  await push();
  onMemoryChange(() => {
    if (applying) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      void push();
    }, PUSH_DELAY_MS);
  });
  window.addEventListener('focus', () => void refresh());
}
