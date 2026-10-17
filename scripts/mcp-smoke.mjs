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

// The internal mail: letters between parties. A second outside AI ("smoke-b") plays the other side; the person's side is tested in the page (playwright).
const other = { 'content-type': 'application/json', 'x-mcp-client': 'smoke-b', 'x-mcp-model': 'model-b' };
const asOther = async (name, args = {}) => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: other, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }) });
  const body = await res.json();
  return body.error ? { rpcError: body.error } : JSON.parse(body.result.content[0].text);
};
// A new outside AI must confirm it read the README first (orientation gate); this passes it through.
const gate = await asOther('check_mail');
if (gate.orientation) await asOther('confirm_readme', { summary: 'It is a game and a spreadsheet; I read the README for the smoke test.' });
const mailTool = async (name, args) => (await tool('mcp_request', { server: 'mail', method: 'tools/call', params: { name, arguments: args } })).result;
const sentMail = await tool('send_mail', { to: 'outside-ai:smoke-b', subject: 'Smoke hello', body: 'Hello from the smoke test. Please answer.' });
check('send_mail sends a letter to another AI (a short address covers it)', sentMail.ok === true && /^m-\d+$/.test(sentMail.sent), sentMail.sent);
const waiting = await asOther('check_mail');
check('the other AI sees one unread letter, from the smoke test', waiting.ok === true && waiting.unread >= 1 && waiting.from.includes('outside-ai:smoke@smoke-model'), JSON.stringify(waiting).slice(0, 100));
check('the sender does not get its own letter', (await tool('check_mail')).unread === 0);
const theirList = await asOther('read_mail', { unread_only: true });
const letterId = theirList.letters?.find((l) => l.subject === 'Smoke hello')?.id;
check('read_mail lists it with id, from, subject and a preview', !!letterId && /Hello from the smoke/.test(theirList.letters[0].preview));
const theirLetter = await asOther('read_mail', { id: letterId });
check('read_mail with an id gives the whole letter', theirLetter.letter?.body === 'Hello from the smoke test. Please answer.');
check('reading it makes it read', (await asOther('read_mail', { unread_only: true })).letters.every((l) => l.id !== letterId));
const answered = await asOther('send_mail', { reply_to: letterId, body: 'Answer from smoke-b.' });
check('reply_to answers the sender, same subject', answered.ok === true && answered.to?.[0] === 'outside-ai:smoke@smoke-model' && answered.subject === 'Smoke hello', JSON.stringify(answered).slice(0, 120));
const myMail = await tool('read_mail', { unread_only: true });
const reply = myMail.letters?.find((l) => l.from === 'outside-ai:smoke-b@model-b');
check('the first AI finds the answer in its inbox', !!reply && /Answer from smoke-b/.test(reply.preview), JSON.stringify(reply ?? myMail).slice(0, 100));
const conversation = await tool('read_mail', { id: reply?.id });
check('the answer comes with the conversation it belongs to', conversation.conversation?.some((l) => l.id === sentMail.sent), `${conversation.conversation?.length} earlier`);
// A small AI says things its own way: other names for the same things are understood, mistakes are explained.
const clumsy = await mailTool('send', { recipient: 'outside', text: 'Written the clumsy way.' });
check('mail understands recipient/text and "outside" as the address outside-ai', clumsy.structuredContent?.ok === true && clumsy.structuredContent.to[0] === 'outside-ai', JSON.stringify(clumsy.structuredContent?.to));
const noBody = await mailTool('send', { to: 'you' });
check('a letter without a body is refused with an example', noBody.isError === true && /example/.test(noBody.content[0].text));
const noWho = await mailTool('send', { body: 'to nobody' });
check('a letter without an address is refused with an example', noWho.isError === true && /example/.test(noWho.content[0].text));
const ghost = await mailTool('send', { to: 'nobody-called-this', body: 'Is anybody there?' });
check('a letter to a name nobody has is sent but flagged: nobody will read it, and who to write to instead', ghost.structuredContent?.unreachable?.[0] === 'nobody-called-this' && /outside-ai/.test(ghost.structuredContent?.next ?? ''), JSON.stringify(ghost.structuredContent).slice(0, 110));
const group = await mailTool('send', { to: 'outside-ai', body: 'Hello to every AI.' });
check('a letter to a real address is not flagged', group.structuredContent?.ok === true && !group.structuredContent?.unreachable);
for (const id of [ghost.structuredContent?.sent, group.structuredContent?.sent]) if (id) await mailTool('delete', { id });
check('boxes lists who can be written to', (await mailTool('boxes', {})).structuredContent.usual.length >= 4);
// The person's mailbox: this letter waits for the person in the ✉ panel; the letters sent here are cleaned up.
for (const id of [sentMail.sent, clumsy.structuredContent?.sent, reply?.id]) if (id) await mailTool('delete', { id });
for (const id of [letterId, clumsy.structuredContent?.sent, answered.sent]) if (id) await asOther('mcp_request', { server: 'mail', method: 'tools/call', params: { name: 'delete', arguments: { id } } });
check('delete throws a letter away for the one who deletes it', (await tool('read_mail', {})).letters.every((l) => l.id !== reply?.id));

// The smoke test inside the router: harmless read-only traffic to every server, then a report with its own checks.
const routerCall = async (name, args) => JSON.parse((await tool('mcp_request', { server: 'router', method: 'tools/call', params: { name, arguments: args } })).result.content[0].text);
const snapshotBefore = (await codeTool('overview', {})).structuredContent.snapshot;
const exerciseReport = await routerCall('exercise', { seconds: 2, per_second: 6 });
check('router.exercise sends read-only traffic and all its own checks pass', exerciseReport.ok === true && exerciseReport.sent >= 6 && exerciseReport.errors === 0, `${exerciseReport.sent} sent, ${exerciseReport.answered} answered, ${exerciseReport.errors} failed`);
check('the exercise ran under one moment of initiative', exerciseReport.checks.some((c) => /same moment/.test(c.name) && c.ok));
const pendingList = await routerCall('pending', {});
check('router.pending lists what is waiting, with Unix ms times', typeof pendingList.now === 'number' && Array.isArray(pendingList.pending) && pendingList.pending.every((p) => p.deadline > p.sentAt && p.sentAt >= p.startedAt));
check('the exercise changed no code (the fingerprint of all cells is the same before and after)', (await codeTool('overview', {})).structuredContent.snapshot === snapshotBefore, snapshotBefore);

// Standing directives: what the owner told every AI is in the published rules (and an ended one is not).
const rulesText = await (await fetch(`${base}/ai/rules.md`)).text();
check('ai/rules.md carries the standing directives with their strength scale', !/Standing directives/.test(rulesText) || (/0 to 100 %/.test(rulesText) && /\d+\. \[\d+ % · /.test(rulesText)));
check('ai/everything.md has the same section', (await (await fetch(`${base}/ai/everything.md`)).text()).includes('Standing directives') === /Standing directives/.test(rulesText));

// The scratch-tab habit (a directive): "ensure" makes the tab once, its first cell runs, and "close" removes it again.
const tabs = (name, args) => tool('mcp_request', { server: 'tabs', method: 'tools/call', params: { name, arguments: args } }).then((r) => r.result?.structuredContent ?? r);
const TAB = 'smoke-scratch';
const made = await tabs('ensure', { id: TAB, title: 'Smoke', icon: '🧫', select: false, cells: { A1: "span(6, 2)\nprint(`sum: ${[1, 2, 3].reduce((a, b) => a + b, 0)}`)" } });
check('tabs.ensure makes a new tab with its first cell', made.tab?.id === TAB && made.firstCell === `/${TAB}/A1`, JSON.stringify(made).slice(0, 90));
const again = await tabs('ensure', { id: TAB, title: 'Other title', cells: { A1: 'print("should not replace")' } });
check('tabs.ensure again changes nothing (safe to repeat)', again.tab?.id === TAB && again.tab?.title === 'Smoke');
const ran = await tool('run_cell', { address: 'A1', tab: TAB });
check('the demonstration in the new tab runs and prints', ran.ok === true && /sum: 6/.test(ran.output ?? ''), JSON.stringify(ran).slice(0, 90));
const closed = await tabs('close', { id: TAB });
check('tabs.close removes the tab again', JSON.stringify(closed).includes('"ok":false') === false && !JSON.stringify(await tabs('list', {})).includes(`"${TAB}"`));

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
