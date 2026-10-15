// Plays an outside AI chat against the dev server: node scripts/mcp-smoke.mjs [baseUrl]
// Needs "npm run dev" and a page open at <baseUrl>/?mcp. Only touches the scratch cell and the game, and cleans up.
const base = process.argv[2] ?? 'http://localhost:5178';
const SCRATCH = process.env.SCRATCH ?? 'Z43';
let nextId = 1;
let failures = 0;
let session = null;

const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

async function rpc(method, params, headers = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  if (method === 'initialize') session = res.headers.get('mcp-session-id');
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

async function tool(name, args = {}) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  if (body.error) return { ok: false, error: body.error.message, rpcError: true };
  return JSON.parse(body.result.content[0].text);
}

const initSent = Date.now();
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0.1', model: 'smoke-model' } });
check('initialize answers with serverInfo', init.body.result?.serverInfo?.name === 'lattakker-sheet');
const initTrace = init.body.result?._meta?.['lattakker/trace'];
check('initialize answer carries the moment of the initiative (Unix ms, inside the call)', typeof initTrace?.startedAt === 'number' && initTrace.startedAt >= initSent && initTrace.startedAt <= Date.now(), JSON.stringify(initTrace));
check('initialize hands out a session id', typeof session === 'string' && session.length > 8, session ?? '');
const note = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
check('notification gets 202', note.status === 202);

const listed = await rpc('tools/list');
const names = (listed.body.result?.tools ?? []).map((t) => t.name);
check('tools/list has the full catalogue', names.length >= 22, `${names.length} tools`);
if (names.length === 0) {
  console.log('No page connected? Open', `${base}/?mcp`, 'and run again.');
  process.exit(1);
}

// First contact: a new participant is told to read the README before its first call is carried out (the page remembers who has).
const firstCall = await tool('get_state');
if (firstCall.orientation) {
  check('a first call is answered with the README and the rules', typeof firstCall.read_first === 'string' && firstCall.read_first.includes('README.md') && !!firstCall.rules, firstCall.read_first);
  const readme = await tool('read_readme');
  check('read_readme fetches the README and lifts the gate', readme.ok === true && readme.parts >= 1 && readme.text.length > 1000, `${readme.source}, part ${readme.part} of ${readme.parts}`);
} else {
  console.log('  (this participant has read the README already: the gate is open)');
}

// Down: AI reads the page.
const state = await tool('get_state');
check('get_state ok', state.ok === true, JSON.stringify(state).slice(0, 90));
const board = await tool('get_board');
check('get_board ok', board.ok === true);
const all = await tool('list_cells');
const cells = all.cells ?? all.result?.cells ?? [];
check('list_cells returns cells with uids', cells.length > 0 && cells.every((c) => /^c-[0-9a-f]{8}$/.test(c.uid)), `${cells.length} cells`);

// Up: AI writes a cell, then reads back what the cell did.
const before = await tool('get_cell', { address: SCRATCH });
check(`${SCRATCH} is free to use`, before.ok === true && !(before.cell?.code ?? before.code), JSON.stringify(before).slice(0, 90));
const written = await tool('set_cell_code', { address: SCRATCH, code: "span(4, 2)\nshow('hello from the outside AI')" });
check('set_cell_code ok', written.ok === true, JSON.stringify(written).slice(0, 110));
const read = await tool('get_cell', { address: SCRATCH });
const cell = read.cell ?? read;
check('get_cell shows the output', JSON.stringify(read).includes('hello from the outside AI'));
const uid = cell.uid;
check('the new cell has a uid', /^c-[0-9a-f]{8}$/.test(uid ?? ''), uid);

// The uid is the stable handle.
const resolved = await tool('resolve_cell', { address_or_uid: uid });
check('resolve_cell finds it by uid', JSON.stringify(resolved).includes(SCRATCH), JSON.stringify(resolved).slice(0, 90));
const rerun = await tool('run_cell', { address: uid });
check('run_cell works by uid', rerun.ok === true);
const rewritten = await tool('set_cell_code', { address: uid, code: "span(4, 2)\nshow('edited by uid')" });
check('set_cell_code works by uid', rewritten.ok === true && JSON.stringify(await tool('get_cell', { address: SCRATCH })).includes('edited by uid'));

// The child talks to the AI from a cell: "// AI: ..." comment, answered right below it.
await tool('set_cell_code', { address: SCRATCH, code: "// AI: what does span do?\nspan(4, 2)\nshow('asked')" });
const asked = await tool('wait_for_request', { seconds: 2 });
const req = (asked.requests ?? []).find((r) => r.address === SCRATCH);
check('wait_for_request sees the "// AI:" comment', req?.text === 'what does span do?', JSON.stringify(asked.requests ?? []).slice(0, 90));
const replied = await tool('reply_to_request', { address: SCRATCH, line: req?.line ?? 1, reply: 'span(4, 2) makes the cell 4 squares wide and 2 high.' });
check('reply_to_request ok', replied.ok === true, JSON.stringify(replied).slice(0, 90));
check('the reply is a comment below the question', JSON.stringify(await tool('get_cell', { address: SCRATCH })).includes('// \u21b3 AI: span(4, 2)'));
check('an answered request is not returned again', !((await tool('get_requests')).requests ?? []).some((r) => r.address === SCRATCH));
check('answering twice is refused', (await tool('reply_to_request', { address: SCRATCH, line: req?.line ?? 1, reply: 'again' })).ok === false);

// The game: AI plays, the cells below the board react, the AI reads that back.
const newGame = await tool('new_game');
check('new_game ok', newGame.ok === true);
const counterBefore = JSON.stringify(await tool('get_cell', { address: 'A24' }));
check('start_battle ok', (await tool('start_battle')).ok === true);
const legal = await tool('legal_moves', { from_or_color: 'red' });
const moves = legal.moves ?? legal.legal ?? [];
check('legal_moves returns Red moves', legal.ok === true, `${moves.length} moves`);
const first = moves[0];
if (first) {
  const from = first.from ?? first[0];
  const to = first.to ?? first[1];
  const played = await tool('make_move', { from, to });
  check(`make_move ${from}->${to} ok`, played.ok === true, JSON.stringify(played).slice(0, 90));
  await new Promise((r) => setTimeout(r, 600));
  const counterAfter = JSON.stringify(await tool('get_cell', { address: 'A24' }));
  check('cell A24 reacted to the move', counterBefore !== counterAfter);
  const undone = await tool('undo_move');
  check('undo_move ok', undone.ok === true);
}
check('new_game puts the board back', (await tool('new_game')).ok === true);
check('say_to_player ok', (await tool('say_to_player', { text: 'Hi from the smoke test.' })).ok === true);

// Who is calling: what the client said at initialize is what the page knows, and shows as the origin of the traffic.
const me = await tool('introduce', { note: 'smoke test' });
check('introduce tells the page who calls (client, version, model)', me.ok === true && me.you?.client === 'smoke' && me.you?.version === '0.1' && me.you?.model === 'smoke-model', JSON.stringify(me.you ?? me).slice(0, 120));
check('the origin of its messages is outside-ai:<client>@<model>', me.origin === 'outside-ai:smoke@smoke-model', me.origin);
const viaRouter = await tool('mcp_request', { server: 'router', method: 'tools/call', params: { name: 'callers', arguments: {} } });
const seenCallers = JSON.parse(viaRouter.result?.content?.[0]?.text ?? '{}').callers ?? [];
check('router tool callers lists it', seenCallers.some((c) => c.origin === 'outside-ai:smoke@smoke-model' && c.calls > 3), `${seenCallers.length} callers`);
const hdr = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-mcp-client': 'header-client', 'x-mcp-model': 'header-model' },
  body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: 'introduce', arguments: {} } }),
});
const hdrBody = JSON.parse((await hdr.json()).result?.content?.[0]?.text ?? '{}');
check('headers X-MCP-Client and X-MCP-Model are taken over', hdrBody.origin === 'outside-ai:header-client@header-model', hdrBody.origin);

// The moment of the initiative is in every message: in the answer's _meta, inside the text of a tool answer, and the same for a whole chain.
const askedAt = Date.now();
const viaWeather = await tool('mcp_request', { server: 'weather', method: 'tools/list', params: {} });
const stamp = viaWeather.result?._meta?.['lattakker/trace'];
check('a router answer carries _meta.lattakker/trace.startedAt in Unix ms', typeof stamp?.startedAt === 'number' && stamp.startedAt >= askedAt - 50 && stamp.startedAt <= Date.now() + 50, JSON.stringify(stamp));
check('the tool answer carries it inside its text too', typeof viaWeather._meta?.['lattakker/trace']?.startedAt === 'number');
const log = (await tool('mcp_request', { server: 'router', method: 'tools/call', params: { name: 'recent', arguments: { n: 60 } } })).result;
const mine = JSON.parse(log.content[0].text).messages.filter((m) => m.method === 'tools/list' && m.to === 'weather' || m.method === 'tools/list' && m.from === 'weather');
check('a request and its answer share the one moment of the initiative', mine.length >= 2 && new Set(mine.slice(-2).map((m) => m.startedAt)).size === 1 && mine.slice(-1)[0].startedAt === stamp.startedAt, mine.slice(-2).map((m) => m.startedAt).join(' '));

// The code server: all the code as text that fits a small memory.
const codeTool = async (name, args) => (await tool('mcp_request', { server: 'code', method: 'tools/call', params: { name, arguments: args } })).result;
const overview = await codeTool('overview', {});
check('code.overview says how big the code is and what to do', /cells hold TypeScript/.test(overview.content[0].text) && /WHAT TO DO/.test(overview.content[0].text));
let cursor;
let parts = 0;
let biggest = 0;
let dumped = '';
do {
  const part = await codeTool('dump', { tab: 'monitor', budget_chars: 3000, ...(cursor ? { cursor } : {}) });
  parts++;
  dumped += part.content[0].text;
  biggest = Math.max(biggest, part.content[0].text.length);
  cursor = part.structuredContent.next;
} while (cursor && parts < 200);
check('code.dump comes in parts that fit the budget and ends with END', parts > 1 && biggest <= 3100 && /END of PART \d+ of \d+/.test(dumped), `${parts} parts, biggest ${biggest}`);
const codeList = (await codeTool('list', { tab: 'monitor' })).content[0].text;
const listedPaths = [...codeList.matchAll(/(\/monitor\/[A-Z]+\d+)/g)].map((m) => m[1]);
check('every cell of the tab is in the dump', listedPaths.length > 0 && listedPaths.every((p) => dumped.includes(`### ${p} `)), `${listedPaths.length} cells`);
const found = await codeTool('search', { query: 'switchboard', include: '/monitor/*', context: 0 });
check('code.search finds text with a path and a line number', /\/monitor\/A1 · \d+ match/.test(found.content[0].text) && /\s\d+: /.test(found.content[0].text), found.content[0].text.split('\n')[0]);
check('code.search refuses a regular expression that can hang', (await codeTool('search', { query: '(a+)+$', regex: true })).isError === true);
const codeRead = await codeTool('read', { path: '/monitor/A1', from_line: 1, lines: 3 });
check('code.read gives numbered lines and where to go on', /^\s+1  /m.test(codeRead.content[0].text) && codeRead.structuredContent.next === 4);
check('code.dump refuses a stale cursor', (await codeTool('dump', { cursor: 'deadbeef:2:3000' })).isError === true);

// Bad input stays polite.
check('bad address gives ok:false, not a crash', (await tool('get_cell', { address: 'not-a-cell' })).ok === false);
const unknown = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
check('unknown tool is a JSON-RPC error', unknown.body.error?.code === -32602);
const foreign = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
check('foreign Origin is refused', foreign.status === 403);
const get = await fetch(`${base}/mcp`);
check('GET is refused', get.status === 405);

// Clean up.
const cleared = await tool('set_cell_code', { address: SCRATCH, code: '' });
check(`${SCRATCH} cleared`, cleared.ok === true);

console.log(failures === 0 ? '\nAll good.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
