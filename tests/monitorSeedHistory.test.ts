import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MONITOR_DEMOS } from '../src/monitorDemos';
import { MONITOR_OLDER_VERSIONS } from '../src/monitorOlderVersions';
import { fingerprint } from '../src/seedMigration';

const FILE = 'src/monitorDemos.ts';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The cells of MONITOR_DEMOS as they were at a commit (the file is one plain `export const`, see monitorOlderVersions.ts). */
function cellsAt(commit: string): Array<[string, string]> {
  const source = git('show', `${commit}:${FILE}`);
  const array = /export const MONITOR_DEMOS[^=]*=\s*(\[[\s\S]*\n\])\s*;?\s*$/m.exec(source)?.[1];
  return array ? (new Function(`return ${array}`)() as Array<[string, string]>) : [];
}

describe('Monitor cells: every version that was ever committed is brought up to date', () => {
  it('lists each earlier version of a cell, or a browser that saved it keeps it for ever', () => {
    let commits: string[] = [];
    try {
      commits = git('log', '--format=%h', '--', FILE).split('\n').filter(Boolean);
    } catch {
      return;
    }
    if (commits.length < 2) return;

    const current = new Map(MONITOR_DEMOS.map(([address, code]) => [address, fingerprint(code)]));
    const missing: string[] = [];
    for (const commit of commits) {
      for (const [address, code] of cellsAt(commit)) {
        const print = fingerprint(code);
        if (print === current.get(address)) continue;
        if (!MONITOR_OLDER_VERSIONS[address]?.includes(print)) missing.push(`${address}: '${print}' (commit ${commit})`);
      }
    }
    expect(missing, 'add these to MONITOR_OLDER_VERSIONS in src/monitorOlderVersions.ts').toEqual([]);
  });
});
