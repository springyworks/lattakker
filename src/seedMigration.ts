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

const SPAN_LINE = /^span\([^)\n]*\)[ \t]*$/m;
const spanLine = (code: string): string | undefined => SPAN_LINE.exec(code)?.[0];
/** The code with its `span(...)` line (the block size, which a person changes by dragging) set to another one. */
const withSpan = (code: string, line: string | undefined): string => (line === undefined ? code : code.replace(SPAN_LINE, () => line));

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
    let data = sheet.dataAt(address);
    // A shipped cell this browser never saw (added in a later version) goes into its place; one that was seen and then emptied stays empty.
    // A sheet that was never seeded here (nothing is recorded) is left alone too.
    if (Object.keys(seeds).length > 0 && seeds[address] === undefined && !data?.code.trim()) {
      const row = Number(/\d+/.exec(address)?.[0] ?? 1);
      while (sheet.rowCount < row + 8 && sheet.rowCount < 200) sheet.insertRow(sheet.rowCount - 1);
      data = sheet.dataAt(address);
      if (data) {
        sheet.setCode(address, code);
        seeds[address] = shipped;
        updated++;
      }
      continue;
    }
    if (!data || !data.code.trim()) continue;
    const have = fingerprint(data.code);
    // Blank lines around the code (a cell written through the editor or the MCP bridge) do not make it another version.
    const bare = fingerprint(data.code.trim());
    // A block resized by hand differs from the shipped version only in its span line: it is still that version.
    const mine = spanLine(data.code);
    const sized = mine !== undefined ? withSpan(data.code, spanLine(code)) : data.code;
    const sizedHave = fingerprint(sized);
    const sizedBare = fingerprint(sized.trim());
    if (have === shipped || bare === shipped) {
      seeds[address] = shipped;
    } else if (seeds[address] === have || olderVersions[address]?.some((print) => print === have || print === bare || print === sizedHave || print === sizedBare)) {
      sheet.setCode(address, withSpan(code, mine));
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
    const mine = spanLine(data.code);
    let code = newest.get(fingerprint(data.code));
    if (code === undefined && mine !== undefined) {
      for (const [print, candidate] of newest) {
        if (fingerprint(withSpan(data.code, spanLine(candidate))) === print) {
          code = withSpan(candidate, mine);
          break;
        }
      }
    }
    if (code === undefined) continue;
    sheet.setCode(data.address, code);
    updated++;
  }
  save(tab, seeds);
  return updated;
}
