import { jobs } from './jobs';
import { ERR, McpError, type Json, type McpServer } from '../mcp/router';
import { allNotes, dbCollections, dbDelete, dbGet, dbPut, dbQuery, duplicates, forget, getNote, loadMemory, memoryInfo, remember, search, update, type Note } from './memory';

/**
 * The helper's memory as an MCP server called "memory", so the built-in helper and any outside AI that is
 * connected to the page use the very same notes.
 *
 *   resources/list, resources/read {uri}      the notes (uri lattakker-memory:///<id>)
 *   tools/call remember {title,text,tags}     write a note (a note with the same title is updated)
 *   tools/call recall {query,limit}           the notes that fit a question best
 *   tools/call update_note {id,...}           change a note
 *   tools/call forget {id}                    delete one
 *   tools/call find_duplicates                notes that say nearly the same: merge them with update_note + forget
 *   tools/call db_put {collection,id?,data}   store a JSON record in a named collection (a little database)
 *   tools/call db_get {collection,id}, db_query {collection,where?,contains?,limit?}, db_delete {collection,id}, db_collections
 *   tools/call stats                          how many notes, and whether they survive a reload
 */

const URI = 'lattakker-memory:///';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const TOOLS = [
  { name: 'remember', description: 'Keep a short note for later: something useful and lasting (what the person is building, what they find hard, a lesson). Never personal information. A note with the same title is replaced.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'text'] } },
  { name: 'recall', description: 'Find the notes that fit a question or some words.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } },
  { name: 'update_note', description: 'Change the title, text or tags of a note.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['id'] } },
  { name: 'forget', description: 'Delete a note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'find_duplicates', description: 'Pairs of notes that say nearly the same thing. Merge each pair: update_note on one, forget the other.', inputSchema: { type: 'object', properties: {} } },
  { name: 'db_put', description: 'Store a small JSON record in a named collection (lowercase name). With an id it replaces that record, without one a new id is made. Good for structured things: a table of words learned, a list of exercises done.', inputSchema: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' }, data_json: { type: 'string', description: 'The record as JSON text for an object.' } }, required: ['collection', 'data_json'] } },
  { name: 'db_get', description: 'Read one record.', inputSchema: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' } }, required: ['collection', 'id'] } },
  { name: 'db_query', description: 'Find records in a collection: those whose fields equal where_json, and/or whose JSON contains some text.', inputSchema: { type: 'object', properties: { collection: { type: 'string' }, where_json: { type: 'string' }, contains: { type: 'string' }, limit: { type: 'integer' } }, required: ['collection'] } },
  { name: 'db_delete', description: 'Delete one record.', inputSchema: { type: 'object', properties: { collection: { type: 'string' }, id: { type: 'string' } }, required: ['collection', 'id'] } },
  { name: 'db_collections', description: 'The collections of the little database, with how many records each holds and an example.', inputSchema: { type: 'object', properties: {} } },
  { name: 'stats', description: 'How many notes there are and whether they are stored for good in this browser.', inputSchema: { type: 'object', properties: {} } },
];

const brief = (n: Note) => ({ id: n.id, title: n.title, tags: n.tags, source: n.source, updated: new Date(n.updated).toISOString() });

export class MemoryServer implements McpServer {
  readonly name = 'memory';
  readonly description = "The helper's memory: notes (remember, recall) and a little database (db_put, db_query ...), kept in this browser.";

  async handle(method: string, params: Record<string, unknown>, from: string): Promise<Json> {
    await loadMemory();
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { resources: {}, tools: {} }, serverInfo: { name: 'lattakker-memory', title: 'Helper memory', version: '1' } };
      case 'ping':
        return {};
      case 'resources/list':
        return { resources: allNotes().map((n) => ({ uri: `${URI}${n.id}`, name: n.title, description: n.text.slice(0, 90), mimeType: 'application/json' })) };
      case 'resources/read': {
        const id = str(params.uri).replace(URI, '');
        const note = getNote(id);
        if (!note) throw new McpError(ERR.invalidParams, `there is no note ${id}`);
        return { contents: [{ uri: `${URI}${id}`, mimeType: 'application/json', text: JSON.stringify(note) }] };
      }
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(str(params.name), isRecord(params.arguments) ? params.arguments : {}, from);
      default:
        throw new McpError(ERR.methodNotFound, `memory does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>, from: string): Promise<Json> {
    const job = jobs.start('memory', name, { stallAfterSeconds: 20 });
    try {
      return await this.run(name, args, from);
    } finally {
      job.done();
    }
  }

  private async run(name: string, args: Record<string, unknown>, from: string): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const failure = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
    switch (name) {
      case 'remember': {
        const r = await remember({ title: str(args.title), text: str(args.text), tags: args.tags, source: from });
        return r.ok ? reply({ saved: brief(r.note), replacedOldNoteWithSameTitle: r.merged }) : failure(r.error);
      }
      case 'recall': {
        const found = await search(str(args.query), typeof args.limit === 'number' ? args.limit : 5);
        return reply({ notes: found.map((n) => ({ ...brief(n), text: n.text, score: n.score })) });
      }
      case 'update_note': {
        const r = await update(str(args.id), { title: typeof args.title === 'string' ? args.title : undefined, text: typeof args.text === 'string' ? args.text : undefined, tags: args.tags });
        return r.ok ? reply({ updated: brief(r.note) }) : failure(r.error);
      }
      case 'forget':
        return (await forget(str(args.id))) ? reply({ forgotten: str(args.id) }) : failure(`there is no note ${str(args.id)}`);
      case 'find_duplicates': {
        const pairs = await duplicates();
        return reply({ pairs: pairs.map((p) => ({ ...p, titleA: getNote(p.a)?.title, titleB: getNote(p.b)?.title })) });
      }
      case 'db_put': {
        let data: unknown;
        try {
          data = JSON.parse(str(args.data_json) || '{}');
        } catch {
          return failure('data_json must be JSON text for an object, for example {"word":"loop","level":2}');
        }
        const r = await dbPut(str(args.collection), str(args.id) || undefined, data);
        return r.ok ? reply({ stored: r.record.key }) : failure(r.error);
      }
      case 'db_get': {
        const r = await dbGet(str(args.collection), str(args.id));
        return r ? reply({ key: r.key, data: r.data }) : failure('there is no such record');
      }
      case 'db_query': {
        let where: Record<string, unknown> | undefined;
        if (str(args.where_json)) {
          try {
            const v = JSON.parse(str(args.where_json)) as unknown;
            if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
            where = v as Record<string, unknown>;
          } catch {
            return failure('where_json must be JSON text for an object, for example {"level":2}');
          }
        }
        const rows = await dbQuery(str(args.collection), { where, contains: str(args.contains) || undefined, limit: typeof args.limit === 'number' ? args.limit : 20 });
        return reply({ records: rows.map((r) => ({ id: r.id, data: r.data })) });
      }
      case 'db_delete':
        return (await dbDelete(str(args.collection), str(args.id))) ? reply({ deleted: `${str(args.collection)}/${str(args.id)}` }) : failure('there is no such record');
      case 'db_collections':
        return reply({ collections: await dbCollections() });
      case 'stats':
        return reply({ ...memoryInfo(), note: memoryInfo().durable ? 'Stored in this browser (IndexedDB). A backup file can be made in the helper settings.' : 'IndexedDB is not available: notes last only until the page closes.' });
      default:
        throw new McpError(ERR.methodNotFound, `memory has no tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}`);
    }
  }
}
