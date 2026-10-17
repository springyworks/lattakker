/**
 * The letter the person is writing but has not sent. It is kept in the browser's own storage while they type, so a reload, a closed
 * window or a letter that arrives in the meantime cannot take it away. Nothing is sent until the person presses Send.
 */

export interface Draft {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

export const DRAFT_KEY = 'lattakker.mail.draft.v1';

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The kept draft, or null when there is none worth keeping (nothing written yet). */
export function loadDraft(store: Store | null): Draft | null {
  try {
    const d = JSON.parse(store?.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    if (!d || typeof d !== 'object' || typeof d.body !== 'string' || !(d.body.trim() || (typeof d.subject === 'string' && d.subject.trim()))) return null;
    return { to: String(d.to ?? ''), subject: String(d.subject ?? ''), body: d.body, ...(typeof d.replyTo === 'string' ? { replyTo: d.replyTo } : {}) };
  } catch {
    return null;
  }
}

/** Keeps the draft; a draft with nothing written in it is forgotten instead. */
export function saveDraft(store: Store | null, draft: Draft): void {
  try {
    if (!draft.body.trim() && !draft.subject.trim()) store?.removeItem(DRAFT_KEY);
    else store?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage may be full or blocked: the draft then lives only until the page is closed.
  }
}

export function clearDraft(store: Store | null): void {
  try {
    store?.removeItem(DRAFT_KEY);
  } catch {
    // nothing stored, nothing to forget
  }
}
