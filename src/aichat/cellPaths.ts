import { parsePath, workspace, type ResolvedPath, type WorkspaceTab } from '../workspace';

/**
 * A bare cell name such as "A16" means "A16 in the tab the person is in", but the same name exists in every tab.
 * Small models (and children) do not say which one they mean, so when the cell is empty here and exactly one
 * other tab has code at that address, that one is meant. Anything unclear is reported, never guessed.
 */

export type SmartHit = ResolvedPath & { note?: string };

const hasCode = (tab: WorkspaceTab, address: string): boolean => !!tab.sheet.dataAt(address)?.code.trim();

export function resolveSmart(path: string, from: string): SmartHit | { error: string } {
  const hit = workspace.resolve(path, from);
  const parts = parsePath(path);
  // Full paths, identities and board squares mean exactly what they say.
  if ('error' in parts || parts.byUid || parts.tab) return hit;
  if (!('error' in hit) && (hit.tab.sheet.isBoardAddress(hit.address) || hasCode(hit.tab, hit.address))) return hit;

  const elsewhere = workspace
    .list()
    .filter((t) => t.id !== from)
    .flatMap((t) => {
      const address = t.sheet.resolve(parts.cell);
      return address && !t.sheet.isBoardAddress(address) && hasCode(t, address) ? [{ tab: t, address }] : [];
    });
  if (elsewhere.length === 1) {
    const { tab, address } = elsewhere[0];
    const full = workspace.pathOf(tab.id, address);
    return { tab, address, tile: parts.tile, note: `${parts.cell} is empty in the ${from} tab, so ${full} (which has code) is meant.` };
  }
  if (elsewhere.length > 1) {
    return { error: `${parts.cell} is empty in the ${from} tab but has code in ${elsewhere.map((e) => workspace.pathOf(e.tab.id, e.address)).join(' and ')}. Ask which one is meant, or use the full path.` };
  }
  return hit;
}

/** Sentences for the model about the bare cell names in a question that do not point where they seem to. */
export function addressHints(question: string, from: string): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const m of question.matchAll(/(^|[^\w/@-])([A-Za-z]\d{1,3})(?![\w/,])/g)) {
    const name = m[2].toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const hit = resolveSmart(name, from);
    if ('error' in hit) {
      if (hit.error.includes('has code in')) hints.push(hit.error);
    } else if (hit.note) hints.push(hit.note);
  }
  return hints.slice(0, 3);
}
