import { describe, expect, it } from 'vitest';
import { findTools, firstSentence, type ServerEntry } from '../src/mcp/findTools';

const catalog: ServerEntry[] = [
  { server: 'weather', description: 'The weather of a place.', tools: [{ name: 'now', description: 'The weather right now at a place. More text.', args: ['place*'] }, { name: 'forecast', description: 'The coming days of weather.', args: ['place*', 'days'] }] },
  { server: 'mail', description: 'Letters between the person, the helper and cells.', tools: [{ name: 'send', description: 'Write a letter to somebody.', args: ['to*', 'text*'] }, { name: 'inbox', description: 'The letters you have not read yet.' }] },
  { server: 'board', description: 'The cells of a tab.', tools: [{ name: 'get_cell', description: 'Read the code of one cell.', args: ['address*'] }, { name: 'list_cells', description: 'All cells with code.' }] },
];

describe('find_tools ranking', () => {
  it('puts the tool whose words match first', () => {
    expect(findTools(catalog, 'weather forecast').hits[0]).toMatchObject({ server: 'weather', tool: 'forecast' });
    expect(findTools(catalog, 'send a letter').hits[0]).toMatchObject({ server: 'mail', tool: 'send' });
  });

  it('knows a name is words: "get cell" finds get_cell, and a plural finds the singular', () => {
    expect(findTools(catalog, 'get cell').hits[0].tool).toBe('get_cell');
    expect(findTools(catalog, 'cells code').hits.map((h) => h.tool)).toContain('list_cells');
  });

  it('gives a ready mcp_call with the required arguments filled as placeholders', () => {
    const hit = findTools(catalog, 'send letter').hits[0];
    expect(hit.mcp_call).toEqual({ server: 'mail', tool: 'send', arguments_json: '{"to":"<to>","text":"<text>"}' });
    expect(findTools(catalog, 'inbox').hits[0].mcp_call.arguments_json).toBe('{}');
  });

  it('says what a tool does in one sentence', () => {
    expect(findTools(catalog, 'weather now').hits[0].about).toBe('The weather right now at a place.');
    expect(firstSentence('x'.repeat(300)).length).toBeLessThanOrEqual(160);
  });

  it('limits the number of hits', () => {
    expect(findTools(catalog, 'cell', 1).hits).toHaveLength(1);
  });

  it('names the servers when nothing matches or no words are given', () => {
    for (const q of ['zzz qqq', '', ' ']) {
      const r = findTools(catalog, q);
      expect(r.hits).toEqual([]);
      expect(r.servers?.map((s) => s.server)).toEqual(['weather', 'mail', 'board']);
      expect(r.note).toBeTruthy();
    }
  });
});
