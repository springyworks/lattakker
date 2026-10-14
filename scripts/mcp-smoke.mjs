// Plays an outside AI chat against the dev server: node scripts/mcp-smoke.mjs [baseUrl]
// Needs "npm run dev" and a page open at <baseUrl>/?mcp. Only touches the scratch cell and the game, and cleans up.
const base = process.argv[2] ?? 'http://localhost:5178';
const SCRATCH = process.env.SCRATCH ?? 'Z43';
let nextId = 1;
let failures = 0;

const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

async function rpc(method, params, headers = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

async function tool(name, args = {}) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  if (body.error) return { ok: false, error: body.error.message, rpcError: true };
  return JSON.parse(body.result.content[0].text);
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
check('initialize answers with serverInfo', init.body.result?.serverInfo?.name === 'lattakker-sheet');
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
const first = await tool('get_state');
if (first.orientation) {
  check('a first call is answered with the README and the rules', typeof first.read_first === 'string' && first.read_first.includes('README.md') && !!first.rules, first.read_first);
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
