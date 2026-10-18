/**
 * Find a tool by a few words. A small model that does not know which of the dozens of MCP tools it needs asks
 * `find_tools` (a tool of the router) and gets a short list of candidates, each with a ready-made mcp_call line.
 * Pure: it ranks a catalog and touches nothing else, so it can be tested without a page.
 */

export interface ToolEntry {
  name: string;
  description: string;
  /** Names of the arguments; a required one ends with "*". */
  args?: string[];
}

export interface ServerEntry {
  server: string;
  description: string;
  tools: ToolEntry[];
}

export interface ToolHit {
  server: string;
  tool: string;
  about: string;
  /** The same in the words of mcp_call, ready to copy. */
  mcp_call: { server: string; tool: string; arguments_json: string };
  score: number;
}

export interface FoundTools {
  query: string;
  hits: ToolHit[];
  /** Said when nothing matched: the servers to look at instead. */
  note?: string;
  servers?: Array<{ server: string; for: string }>;
}

/** Lowercase words of two or more characters; a plural "s" is dropped so "cells" finds "cell". */
const words = (text: string): string[] => [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)))];

/** The first sentence of a description, at most 160 characters. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

function exampleArguments(args: string[] | undefined): string {
  const required = (args ?? []).filter((a) => a.endsWith('*')).map((a) => a.slice(0, -1));
  if (!required.length) return '{}';
  return JSON.stringify(Object.fromEntries(required.map((a) => [a, `<${a}>`])));
}

/** A tool name is a few words too: "get_cell" is "get" and "cell". */
function score(server: ServerEntry, tool: ToolEntry, query: string[]): number {
  const name = tool.name.toLowerCase();
  const nameWords = words(name.replace(/[_-]+/g, ' '));
  const serverName = server.server.toLowerCase();
  const text = `${tool.description} ${server.description}`.toLowerCase();
  let total = 0;
  let found = 0;
  for (const w of query) {
    let s = 0;
    if (name === w) s += 12;
    else if (nameWords.includes(w)) s += 8;
    else if (name.includes(w)) s += 5;
    if (serverName === w) s += 4;
    else if (serverName.includes(w)) s += 2;
    s += Math.min(3, text.split(w).length - 1);
    if (s) found++;
    total += s;
  }
  return found === 0 ? 0 : found === query.length ? total + 6 : total;
}

/** The best `n` tools for a few words, best first. No words, or no hit, names the servers instead. */
export function findTools(catalog: ServerEntry[], query: string, n = 6): FoundTools {
  const q = words(query);
  const hits: ToolHit[] = [];
  if (q.length) {
    for (const server of catalog) {
      for (const tool of server.tools) {
        const s = score(server, tool, q);
        if (s > 0) hits.push({ server: server.server, tool: tool.name, about: firstSentence(tool.description), mcp_call: { server: server.server, tool: tool.name, arguments_json: exampleArguments(tool.args) }, score: s });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.server.localeCompare(b.server) || a.tool.localeCompare(b.tool));
  const top = hits.slice(0, Math.max(1, Math.min(20, Math.floor(n))));
  if (top.length) return { query, hits: top };
  return {
    query,
    hits: [],
    note: q.length ? 'No tool matches these words. Try other words, or look at the servers: mcp_call with only a server gives its tools.' : 'Give a few words about what you want to do, for example "weather", "write cell code" or "send a letter".',
    servers: catalog.map((s) => ({ server: s.server, for: firstSentence(s.description) })),
  };
}
