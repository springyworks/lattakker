/**
 * Cells that the page itself ships (the Monitor's drawing and graphs) are saved in the browser like every other cell, and a saved sheet is restored
 * as it was: so a browser that saved the Monitor once would keep that version for ever and never see an improvement (the switchboard, say).
 *
 * This brings the new version in, carefully: a shipped cell is replaced only when it still holds, letter for letter, a version that WAS shipped
 * (one the page itself seeded, or one listed as an older version). Anything a person changed, even a comment, is never touched. A cell the person
 * emptied stays empty. The fingerprints (FNV-1a of the exact code) are kept in this browser: which version each cell was seeded with. A copy moved to another address is brought up to date too, when it is a listed older version.
 */

import type { Sheet } from './sheet/Sheet';

const KEY = (tab: string): string => `lattakker:seeds:${tab}`;

/** A short fingerprint of the exact code. */
export function fingerprint(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function load(tab: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY(tab)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function save(tab: string, seeds: Record<string, string>): void {
  try {
    localStorage.setItem(KEY(tab), JSON.stringify(seeds));
  } catch {
    // Not remembered: the older versions that are listed still get recognised next time.
  }
}

/** Notes which version each cell was just seeded with (a first visit, or "restore"). */
export function recordSeeds(tab: string, seed: ReadonlyArray<readonly [string, string]>): void {
  save(tab, Object.fromEntries(seed.map(([address, code]) => [address, fingerprint(code)])));
}

/**
 * For a sheet that was restored from the browser's saved cells: replaces the shipped cells that are still an earlier shipped version.
 * `olderVersions` lists, per address, the fingerprints of versions that were shipped before this one. Returns how many cells were updated.
 */
export function refreshSeeded(sheet: Sheet, tab: string, seed: ReadonlyArray<readonly [string, string]>, olderVersions: Readonly<Record<string, readonly string[]>> = {}): number {
  const seeds = load(tab);
  let updated = 0;
  for (const [address, code] of seed) {
    const shipped = fingerprint(code);
    const data = sheet.dataAt(address);
    if (!data || !data.code.trim()) continue;
    const have = fingerprint(data.code);
    if (have === shipped) {
      seeds[address] = shipped;
    } else if (seeds[address] === have || olderVersions[address]?.includes(have)) {
      sheet.setCode(address, code);
      seeds[address] = shipped;
      updated++;
    }
  }
  // A block moved by hand lives at another address but is still, letter for letter, an old shipped version: bring it up to date where it stands.
  const seedAddresses = new Set(seed.map(([address]) => address));
  const newest = new Map<string, string>();
  for (const [address, code] of seed) {
    for (const print of olderVersions[address] ?? []) newest.set(print, code);
  }
  for (const data of sheet.codeCells()) {
    if (seedAddresses.has(data.address)) continue;
    const code = newest.get(fingerprint(data.code));
    if (code === undefined) continue;
    sheet.setCode(data.address, code);
    updated++;
  }
  save(tab, seeds);
  return updated;
}
