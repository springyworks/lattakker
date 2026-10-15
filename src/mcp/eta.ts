/**
 * "How much longer should I wait, and how sure is that?": the informative acknowledgement of a request that takes long.
 *
 * Nothing is invented. The estimate comes from what the router has seen: the times of the last answers to the same kind of request.
 * Given that the request has already waited `waited` ms, only the answers that took longer than that still count (the others cannot be
 * this one: they were already over). Among those, the smallest extra wait after which at least `target` of them had arrived gives the pair
 *
 *     (waitMs, p)   "if you wait waitMs more, then, judging by n similar answers, p of them were in by then".
 *
 * That is a statement about the past, not a promise: it says so (`basis`), and with fewer than MIN_SAMPLES answers it does not guess.
 */

export const MIN_SAMPLES = 5;
/** Fewer comparable answers than this and the share means nothing ("100% of 1"). */
export const MIN_COMPARABLE = 3;

export interface Eta {
  /** How much longer to wait, in ms, from now. */
  waitMs: number;
  /** The share (0 to 1) of the comparable earlier answers that had arrived by then. */
  p: number;
  /** How many earlier answers it is based on (those that took longer than the wait so far). */
  basis: number;
  /** How many earlier answers there were in all. */
  history: number;
  /** The median of all of them, for a feel of what is normal. */
  typicalMs: number;
}

/**
 * @param samples the times (ms) of earlier answers of the same kind
 * @param waited how long this request has been waiting already, ms
 * @param target the share the wait should cover (default 0.8)
 * @returns null when there is too little history, or when this request is already slower than almost anything seen (then no honest guess exists)
 */
export function estimate(samples: readonly number[], waited: number, target = 0.8): Eta | null {
  if (samples.length < MIN_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const typicalMs = sorted[Math.floor(sorted.length / 2)];
  const longer = sorted.filter((s) => s > waited);
  if (longer.length < MIN_COMPARABLE) return null;
  // Of the answers that were still not in at `waited`, how many had arrived after `waitMs` more?
  const index = Math.min(longer.length - 1, Math.max(0, Math.ceil(target * longer.length) - 1));
  const waitMs = Math.max(1, Math.round(longer[index] - waited));
  const p = longer.filter((s) => s - waited <= waitMs).length / longer.length;
  return { waitMs, p: Math.round(p * 100) / 100, basis: longer.length, history: sorted.length, typicalMs };
}

/** The words for a person (or a small AI) to read. */
export function sentence(who: string, what: string, elapsedMs: number, remainingMs: number, eta: Eta | null): string {
  const s = (ms: number): string => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
  const base = `${who} is working on ${what}: ${s(elapsedMs)} so far, the deadline is in ${s(Math.max(0, remainingMs))}.`;
  if (!eta) return `${base} No estimate: too little history of similar answers, or this one is already slower than any seen.`;
  return `${base} Wait about ${s(eta.waitMs)} more: ${Math.round(eta.p * 100)}% of ${eta.basis} similar answers that took this long were in by then (typical: ${s(eta.typicalMs)}). That is history, not a promise.`;
}
