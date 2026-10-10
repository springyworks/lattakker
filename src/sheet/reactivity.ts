/**
 * Dependency-tracked reactivity: addresses read via at()/range() during a cell's run become edges
 * in a graph, so an edit only recomputes the dirty cells and their transitive dependents (in
 * topological order), instead of brute-force re-running every code cell on every edit.
 */

/** Synthetic node for aggregate `game.*` reads that aren't tied to one address. */
export const GAME_NODE = '__game__';

export class DependencyGraph {
  /** address -> set of addresses it reads */
  private dependsOn = new Map<string, Set<string>>();
  /** address -> set of addresses that read it */
  private dependents = new Map<string, Set<string>>();
  /** address -> set of addresses it wrote to last time it ran (e.g. at('L12').print(...)) */
  private writes = new Map<string, Set<string>>();
  private dirty = new Set<string>();
  private currentReads: Set<string> | null = null;
  private currentWrites: Set<string> | null = null;

  /** Call before running a cell's code; collects the reads/writes it makes. */
  beginRun(_address: string): void {
    this.currentReads = new Set();
    this.currentWrites = new Set();
  }

  /** Called from the running cell's at()/range()/game access to record a dependency. */
  trackRead(dep: string): void {
    this.currentReads?.add(dep);
  }

  /** Called when the running cell writes into another cell (print/view/color/textColor/flash). */
  trackWrite(target: string): void {
    this.currentWrites?.add(target);
  }

  /** Call after running a cell; replaces its previous edges with what this run actually read/wrote. */
  endRun(address: string): void {
    const reads = this.currentReads ?? new Set<string>();
    const writes = this.currentWrites ?? new Set<string>();
    this.currentReads = null;
    this.currentWrites = null;
    const previous = this.dependsOn.get(address);
    if (previous) {
      for (const dep of previous) this.dependents.get(dep)?.delete(address);
    }
    this.dependsOn.set(address, reads);
    for (const dep of reads) {
      let set = this.dependents.get(dep);
      if (!set) this.dependents.set(dep, (set = new Set()));
      set.add(address);
    }
    this.writes.set(address, writes);
  }

  /** Union of the last-known write targets of every address in `addresses`. */
  writeTargets(addresses: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const a of addresses) for (const w of this.writes.get(a) ?? []) out.add(w);
    return out;
  }

  markDirty(address: string): void {
    this.dirty.add(address);
  }

  markAllDirty(addresses: Iterable<string>): void {
    for (const a of addresses) this.dirty.add(a);
  }

  /** Forgets everything about an address (e.g. its code was cleared or it was re-keyed away). */
  forget(address: string): void {
    const previous = this.dependsOn.get(address);
    if (previous) for (const dep of previous) this.dependents.get(dep)?.delete(address);
    this.dependsOn.delete(address);
    this.dependents.delete(address);
    this.writes.delete(address);
    this.dirty.delete(address);
  }

  /**
   * Computes the affected subset of `universe` (dirty ∪ transitive dependents, intersected with
   * cells that actually have code to run) in topological order, and clears the dirty set.
   */
  closure(universe: string[]): string[] {
    const known = new Set(universe);
    const affected = new Set<string>();
    const queue: string[] = [...this.dirty].filter((a) => known.has(a) || this.dependents.has(a));
    // Dirty addresses that aren't themselves code cells (e.g. board squares, __game__) still need
    // their dependents visited even though they're not part of the output.
    const seedDependents = (addr: string) => {
      for (const dep of this.dependents.get(addr) ?? []) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    };
    for (const addr of [...this.dirty]) {
      if (known.has(addr) && !affected.has(addr)) {
        affected.add(addr);
      }
      seedDependents(addr);
    }
    while (queue.length) {
      const addr = queue.shift()!;
      seedDependents(addr);
    }
    this.dirty.clear();

    const subset = [...affected].filter((a) => known.has(a));
    return topoSort(subset, this.dependsOn);
  }
}

/** Kahn's algorithm restricted to `subset`; cells in a cycle keep their relative `subset` order. */
function topoSort(subset: string[], dependsOn: Map<string, Set<string>>): string[] {
  const subsetSet = new Set(subset);
  const indegree = new Map<string, number>();
  const edges = new Map<string, Set<string>>(); // dep -> dependents, restricted to subset
  for (const addr of subset) indegree.set(addr, 0);
  for (const addr of subset) {
    for (const dep of dependsOn.get(addr) ?? []) {
      if (!subsetSet.has(dep)) continue;
      indegree.set(addr, (indegree.get(addr) ?? 0) + 1);
      let set = edges.get(dep);
      if (!set) edges.set(dep, (set = new Set()));
      set.add(addr);
    }
  }
  const ready = subset.filter((a) => (indegree.get(a) ?? 0) === 0);
  const order: string[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    const addr = ready.shift()!;
    if (seen.has(addr)) continue;
    seen.add(addr);
    order.push(addr);
    for (const next of edges.get(addr) ?? []) {
      const left = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  if (order.length < subset.length) {
    console.warn('Reactive dependency cycle detected; falling back to grid order for the affected cells.');
    for (const addr of subset) if (!seen.has(addr)) order.push(addr);
  }
  return order;
}
