/**
 * The helper's memory: small notes (a title, some text, tags) kept in this browser's IndexedDB, so what was
 * learned survives a reload. All notes are also held in memory while the page is open, which makes searching
 * instant. If the browser wipes its storage the memory starts empty again, so the settings offer a backup to a
 * file on the computer (and loading it back). Nothing here ever leaves the page by itself.
 */

export interface Note {
  id: string;
  title: string;
  text: string;
  tags: string[];
  /** Who wrote it: 'ai-chat' (the helper), 'ai' (an outside AI) or 'you'. */
  source: string;
  created: number;
  updated: number;
}

const DB = 'lattakker-memory';
const STORE = 'notes';
export const MAX_NOTES = 2000;
export const MAX_TEXT = 4000;

const notes = new Map<string, Note>();
const listeners: Array<() => void> = [];
let db: IDBDatabase | null = null;
let loaded: Promise<void> | null = null;
/** False when IndexedDB is not available: the notes then last only until the page closes. */
let durable = false;

const words = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 1);

/** Notes about a person are not kept: the helper talks with children. */
const PRIVATE = [/[\w.+-]+@[\w-]+\.[\w.]+/, /\+?\d[\d\s().-]{8,}\d/, /\b(my|his|her) (home )?address\b/i, /\bpassword\b/i, /\bapi[_ -]?key\b/i];

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Opens the store and reads every note. Safe to call again and again. */
export function loadMemory(): Promise<void> {
  loaded ??= (async () => {
    db = await open();
    durable = db !== null;
    if (db) {
      try {
        for (const n of await request(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<Note[]>)) notes.set(n.id, n);
      } catch {
        durable = false;
      }
    }
    changed();
  })();
  return loaded;
}

function changed(): void {
  listeners.forEach((l) => l());
}

export const onMemoryChange = (l: () => void): void => void listeners.push(l);

async function write(note: Note | null, removeId?: string): Promise<void> {
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    if (note) tx.objectStore(STORE).put(note);
    if (removeId) tx.objectStore(STORE).delete(removeId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    durable = false;
  }
}

export const memoryInfo = (): { count: number; durable: boolean; chars: number } => ({ count: notes.size, durable, chars: [...notes.values()].reduce((a, n) => a + n.title.length + n.text.length, 0) });

export const allNotes = (): Note[] => [...notes.values()].sort((a, b) => b.updated - a.updated);

export const getNote = (id: string): Note | undefined => notes.get(id);

function check(title: string, text: string): string | null {
  if (!title.trim() || !text.trim()) return 'a note needs a title and some text';
  if (title.length > 120) return 'the title is too long (120 characters at most)';
  if (text.length > MAX_TEXT) return `the text is too long (${MAX_TEXT} characters at most): split it into notes`;
  if (PRIVATE.some((re) => re.test(`${title}\n${text}`))) return 'this looks like personal information (an e-mail, a phone number, an address, a password or a key): such things are not kept';
  return null;
}

const cleanTags = (tags: unknown): string[] => (Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 8);

export async function remember(input: { title: string; text: string; tags?: unknown; source: string }): Promise<{ ok: true; note: Note; merged: boolean } | { ok: false; error: string }> {
  await loadMemory();
  const problem = check(input.title, input.text);
  if (problem) return { ok: false, error: problem };
  const now = Date.now();
  const same = [...notes.values()].find((n) => n.title.trim().toLowerCase() === input.title.trim().toLowerCase());
  if (!same && notes.size >= MAX_NOTES) return { ok: false, error: `the memory is full (${MAX_NOTES} notes): forget or merge some first` };
  const note: Note = same
    ? { ...same, text: input.text.trim(), tags: cleanTags(input.tags).length ? cleanTags(input.tags) : same.tags, updated: now }
    : { id: `n-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: input.title.trim(), text: input.text.trim(), tags: cleanTags(input.tags), source: input.source, created: now, updated: now };
  notes.set(note.id, note);
  await write(note);
  changed();
  return { ok: true, note, merged: !!same };
}

export async function update(id: string, change: { title?: string; text?: string; tags?: unknown }): Promise<{ ok: true; note: Note } | { ok: false; error: string }> {
  await loadMemory();
  const old = notes.get(id);
  if (!old) return { ok: false, error: `there is no note ${id}` };
  const title = change.title ?? old.title;
  const text = change.text ?? old.text;
  const problem = check(title, text);
  if (problem) return { ok: false, error: problem };
  const note = { ...old, title: title.trim(), text: text.trim(), tags: change.tags === undefined ? old.tags : cleanTags(change.tags), updated: Date.now() };
  notes.set(id, note);
  await write(note);
  changed();
  return { ok: true, note };
}

export async function forget(id: string): Promise<boolean> {
  await loadMemory();
  if (!notes.delete(id)) return false;
  await write(null, id);
  changed();
  return true;
}

export async function wipe(): Promise<void> {
  await loadMemory();
  const ids = [...notes.keys()];
  notes.clear();
  for (const id of ids) await write(null, id);
  changed();
}

/** Notes that fit a question best: words in the title and tags count more than words in the text. */
export async function search(query: string, limit = 5): Promise<Array<Note & { score: number }>> {
  await loadMemory();
  const q = new Set(words(query));
  if (!q.size) return allNotes().slice(0, limit).map((n) => ({ ...n, score: 0 }));
  const scored = [...notes.values()].map((n) => {
    const title = new Set(words(n.title));
    const tags = new Set(n.tags.flatMap(words));
    const text = new Set(words(n.text));
    let score = 0;
    for (const w of q) score += (title.has(w) ? 3 : 0) + (tags.has(w) ? 2 : 0) + (text.has(w) ? 1 : 0);
    return { ...n, score };
  });
  return scored.filter((n) => n.score > 0).sort((a, b) => b.score - a.score || b.updated - a.updated).slice(0, Math.max(1, Math.min(20, limit)));
}

/** Pairs of notes that say nearly the same thing, so they can be merged. */
export async function duplicates(): Promise<Array<{ a: string; b: string; similarity: number }>> {
  await loadMemory();
  const list = [...notes.values()].map((n) => ({ id: n.id, set: new Set(words(`${n.title} ${n.text}`)) }));
  const found: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const common = [...list[i].set].filter((w) => list[j].set.has(w)).length;
      const union = list[i].set.size + list[j].set.size - common;
      const similarity = union ? common / union : 0;
      if (similarity >= 0.6) found.push({ a: list[i].id, b: list[j].id, similarity: Math.round(similarity * 100) / 100 });
    }
  }
  return found.sort((x, y) => y.similarity - x.similarity).slice(0, 20);
}

// ------------------------------------------------------------ backup to a file

export const exportJson = (): string => JSON.stringify({ app: 'lattakker-memory', version: 1, saved: new Date().toISOString(), notes: allNotes() }, null, 2);

/** Reads a backup. Notes with an id that already exists are replaced only when the backup's copy is newer. */
export async function importJson(text: string): Promise<{ ok: boolean; added: number; error?: string }> {
  await loadMemory();
  let data: { app?: string; notes?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return { ok: false, added: 0, error: 'this is not a memory backup (the file is not JSON)' };
  }
  if (data.app !== 'lattakker-memory' || !Array.isArray(data.notes)) return { ok: false, added: 0, error: 'this is not a memory backup of this app' };
  let added = 0;
  for (const raw of data.notes as Partial<Note>[]) {
    if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.text !== 'string' || check(raw.title, raw.text)) continue;
    const old = notes.get(raw.id);
    const updated = Number(raw.updated) || Date.now();
    if (old && old.updated >= updated) continue;
    if (!old && notes.size >= MAX_NOTES) break;
    const note: Note = { id: raw.id, title: raw.title.trim(), text: raw.text.trim(), tags: cleanTags(raw.tags), source: typeof raw.source === 'string' ? raw.source.slice(0, 20) : 'you', created: Number(raw.created) || updated, updated };
    notes.set(note.id, note);
    await write(note);
    added++;
  }
  changed();
  return { ok: true, added };
}

/** Asks the browser not to clear this site's storage when it is short of space. */
export async function keepSafe(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function isKeptSafe(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
