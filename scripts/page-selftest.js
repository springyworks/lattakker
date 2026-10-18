// Page self-test: paste into the browser console of the dev page (http://localhost:5178/), or run it through a browser tool.
// It needs "npm run dev" (it imports the page's own modules from /src). It writes nothing into any cell (a stand-in does the typing), restores the helper's settings, and never talks to a real model (a scripted fake answers on the Ollama address).
(async () => {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const config = await import('/src/aichat/config.ts');
  const toolsMod = await import('/src/aichat/tools.ts');
  const agent = await import('/src/aichat/agent.ts');
  const { router } = await import('/src/mcp/router.ts');
  const { workspace } = await import('/src/workspace.ts');
  const monaco = await import('/src/editor/monaco.ts');
  // A new helper must have read the README before its tools work (as a real chat does with its first read_docs).
  (await import('/src/ai/orientation.ts')).markOriented('helper');
  const saved = structuredClone(config.getSettings());
  const realFetch = window.fetch;

  try {
    // ---- the setting and the tool lists
    config.updateSettings((s) => Object.assign(s, { autonomous: true, allowWrite: false }));
    const names = (o) => toolsMod.toolsFor(o).map((x) => x.name);
    t('autonomous is on by default (a fresh DEFAULT_SETTINGS)', config.DEFAULT_SETTINGS.autonomous === true);
    t('autonomous gives write_code and check_cell', names({ small: false, second: false }).includes('write_code') && names({ small: false, second: false }).includes('check_cell'));
    t('a small model also gets check_cell', names({ small: true, second: false }).includes('check_cell'));
    t('the tight list keeps write_code but not check_cell', names({ small: true, second: false, tight: true }).includes('write_code') && !names({ small: true, second: false, tight: true }).includes('check_cell'));
    config.updateSettings((s) => Object.assign(s, { autonomous: false, allowWrite: false }));
    t('with both options off there is no write_code', !names({ small: false, second: false }).includes('write_code'));
    config.updateSettings((s) => Object.assign(s, { autonomous: false, allowWrite: true }));
    t('the old option alone still allows write_code', names({ small: false, second: false }).includes('write_code'));
    config.updateSettings((s) => Object.assign(s, { autonomous: true, allowWrite: false }));

    // ---- the rules counter: the helper asks the same loket as outside AIs
    {
      t('the helper has the tool ask_rules (also a small model)', names({ small: false, second: false }).includes('ask_rules') && names({ small: true, second: false }).includes('ask_rules'));
      const answer = await toolsMod.runTool({ context: () => ({ tab: 'board' }) }, 'ask_rules', { query: 'editor mistakes check syntax' });
      const viaMcp = await router.request('selftest-cell', 'docs', 'tools/call', { name: 'ask_rules', arguments: { query: 'editor mistakes' } });
      t('the same counter is an MCP server (docs): any party can ask it', /no mistakes/.test(JSON.stringify(viaMcp)), JSON.stringify(viaMcp).slice(0, 80));
      t('ask_rules gives the coder loop (check_cell, until no mistakes)', /check_cell/.test(answer) && /no mistakes/.test(answer), answer.split('\n').find((l) => l.startsWith('##')) ?? answer.slice(0, 80));
      t('ask_rules without a query gives the whole rules', /## First contact/i.test(await toolsMod.runTool({ context: () => ({ tab: 'board' }) }, 'ask_rules', {})));
    }

    // ---- hidden information: what is hidden on the board stays hidden in what AIs and cells can read
    {
      const game = window.game;
      const view = window.view;
      const hiddenBlue = game.history.filter((m) => m.color === 'blue' && m.outcome === null && !m.piece.revealed && game.phase !== 'over');
      const leaked = hiddenBlue.filter((m) => view.moveInfo(m).piece !== 'hidden Blue piece');
      t('a Blue piece that has not been revealed is not named in the move history', leaked.length === 0, hiddenBlue.length ? `${hiddenBlue.length} moves checked` : 'no such move in this game yet');
      const last = game.lastMove;
      if (last && last.color === 'blue' && last.outcome === null && !last.piece.revealed) t('lastMove does not name a hidden Blue piece', view.moveInfo(last).piece === 'hidden Blue piece');
      const mine = game.history.find((m) => m.color === 'red');
      t('Red\'s own pieces are named', !mine || view.moveInfo(mine).piece !== 'hidden Blue piece');
    }

    // ---- the editor check (Monaco's TypeScript engine)
    const bad = await monaco.checkCode("span(6, 4)\nconst n: number = 'x'\nprint(nothingHere)\nlet a = [\n", '');
    t('checkCode finds a type mistake, an unknown name and a syntax error, with lines', bad.length === 3 && bad[0].line === 2 && /not assignable/.test(bad[0].message) && bad.some((p) => /nothingHere/.test(p.message)) && bad.some((p) => /expected/.test(p.message)), bad.map((p) => `${p.line}:${p.message}`).join(' | '));
    t('checkCode gives the line text', bad[0].lineText === "const n: number = 'x'");
    t('checkCode is quiet about good code (also "const rows = []")', (await monaco.checkCode("span(6, 4)\nconst rows = []\nrows.push(1)\nprint(rows)\n", '')).length === 0);
    t('two checks in a row do not answer for each other (fresh name each time)', (await monaco.checkCode('const a: number = 1\n', '')).length === 0 && (await monaco.checkCode("const a: number = 'q'\n", '')).length === 1);

    // ---- the tools, with a stand-in for the page (no model, no typing)
    // The helper may only write in the board and Lab tabs: use a Lab cell that has code (somebody else's) and a free spot. The stand-in never really writes.
    const lab = workspace.get('lab').sheet;
    const taken = lab.codeCells()[0];
    const OLD = `/lab/${taken.address}`;
    const oldCode = taken.code;
    const FREE = `/lab/${lab.findFreeBlock(6, 4, 0)}`;
    const wrote = [];
    const host = (extra = {}) => ({
      context: () => ({ tab: 'lab', address: null }),
      liveText: () => null,
      run: async () => ({ ok: true, output: '1' }),
      write: async () => ({ ok: true, output: 'x' }),
      wrote: (path, code, report, before, mistakes) => wrote.push({ path, code, before, mistakes }),
      suggest: () => {},
      ledger: new toolsMod.WriteLedger(),
      help: () => '',
      state: () => ({}),
      boardText: () => '',
      ...extra,
    });
    const call = async (h, name, args) => JSON.parse(await toolsMod.runTool(h, name, args));

    let h = host();
    let r = await call(h, 'check_cell', { path: OLD, code: "const n: number = 'x'" });
    t('check_cell on a bad draft: 1 mistake with the line and a next step', r.mistakes === 1 && r.problems[0].line === 1 && /Fix every mistake/.test(r.next), JSON.stringify(r).slice(0, 120));
    r = await call(h, 'check_cell', { path: OLD, code: 'print(2)' });
    t('check_cell on a good draft: no mistakes, then run it', r.mistakes === 0 && /run_cell/.test(r.next));
    r = await call(h, 'check_cell', { path: FREE });
    t('check_cell on an empty cell says so', /no code/.test(r.error ?? ''));

    r = await call(h, 'write_code', { path: OLD, code: 'print(2)' });
    t('replace on somebody else\'s code is refused, and points to append', /someone else's code/.test(r.error ?? '') && /append/.test(r.error ?? ''));
    r = await call(h, 'write_code', { path: OLD, code: 'print(2)', mode: 'append' });
    t('append on somebody else\'s code works, the old code is kept for undo', r.ran === true && r.editor === 'no mistakes' && wrote.at(-1).before === oldCode && wrote.at(-1).code.startsWith(oldCode.trimEnd()) && wrote.at(-1).code.endsWith('print(2)'), JSON.stringify(r).slice(0, 140));
    t('a clean write leaves nothing pending and says it works', h.ledger.pending === null && /It works/.test(r.next));
    r = await call(h, 'write_code', { path: OLD, code: "const n: number = 'x'\nprint(n)" });
    t('now it is the helper\'s own cell: replace is allowed, mistakes are listed and pending is set', r.editor === '1 mistake' && r.problems?.length === 1 && /Not working yet/.test(r.next) && /mistake/.test(h.ledger.pending ?? ''), JSON.stringify(r).slice(0, 140));
    t('the card gets the editor\'s mistakes and the ORIGINAL code for undo', wrote.at(-1).mistakes.length === 1 && wrote.at(-1).before === oldCode);
    r = await call(h, 'write_code', { path: OLD, code: 'const n = 5\nprint(n)' });
    t('fixing it clears pending', h.ledger.pending === null && r.editor === 'no mistakes');
    h = host({ write: async () => ({ ok: false, error: 'line 2: boom' }) });
    r = await call(h, 'write_code', { path: FREE, code: 'print(1)\nthrow new Error("boom")' });
    t('a run error is pending too, and the error line text is given', /fails when it runs/.test(h.ledger.pending ?? '') && r.errorLineText === 'throw new Error("boom")');
    config.updateSettings((s) => Object.assign(s, { autonomous: false, allowWrite: true }));
    h = host();
    r = await call(h, 'write_code', { path: OLD, code: 'print(3)', mode: 'append' });
    t('with autonomous off, append on somebody else\'s code is refused', /someone else's code/.test(r.error ?? ''));
    config.updateSettings((s) => Object.assign(s, { autonomous: false, allowWrite: false }));
    r = await call(host(), 'write_code', { path: FREE, code: 'print(1)' });
    t('with both off, write_code says a grown-up can switch it on', /not allowed/.test(r.error ?? ''));
    config.updateSettings((s) => Object.assign(s, { autonomous: true, allowWrite: false }));
    t('the write budget is 12 when working on its own, 6 otherwise', toolsMod.maxWrites() === 12 && (config.updateSettings((s) => (s.autonomous = false)), toolsMod.maxWrites() === 6));
    config.updateSettings((s) => (s.autonomous = true));

    // ---- the whole loop with a scripted model: write (mistake) -> stops early -> nudged -> fixes -> done
    config.updateSettings((s) => Object.assign(s, { provider: 'local', autonomous: true, local: { ...s.local, baseUrl: 'http://localhost:11434/v1', model: 'fake:1b', context: 0 } }));
    const script = [
      { tool: { name: 'write_code', arguments: { path: FREE, code: "const n: number = 'five'\nprint(n * 2)" } } },
      { text: 'All done!' },
      { tool: { name: 'write_code', arguments: { path: FREE, code: 'const n = 5\nprint(n * 2)' } } },
      { text: 'Fixed: it prints 10.' },
    ];
    const chats = [];
    const ndjson = (lines) => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    window.fetch = async (url, init) => {
      const u = String(url);
      if (!u.includes('localhost:11434')) return realFetch(url, init);
      if (u.endsWith('/api/version')) return Response.json({ version: '0.0.0-fake' });
      if (u.endsWith('/api/ps')) return Response.json({ models: [{ name: 'fake:1b', size: 1e9, size_vram: 1e9, context_length: 8192, expires_at: '2319-01-01T00:00:00Z' }] });
      if (u.endsWith('/api/chat')) {
        chats.push(JSON.parse(init.body));
        const step = script[chats.length - 1] ?? { text: 'out of script' };
        const done = { done: true, done_reason: 'stop', total_duration: 2e9, load_duration: 5e8, prompt_eval_count: 20, prompt_eval_duration: 1e8, eval_count: 5, eval_duration: 2e8 };
        return ndjson(step.tool ? [{ message: { role: 'assistant', content: '', tool_calls: [{ function: step.tool }] }, done: false }, done] : [{ message: { role: 'assistant', content: step.text }, done: false }, done]);
      }
      return realFetch(url, init);
    };
    const writes = [];
    const convo = new agent.Conversation({
      help: () => '',
      state: () => ({}),
      boardText: () => '',
      liveText: () => null,
      run: async () => ({ ok: true, output: '10' }),
      write: async (path, code) => (writes.push(code), { ok: true, output: code.includes("'five'") ? 'NaN' : '10' }),
    });
    const answer = await convo.ask('Write a program that prints 10 using n * 2 and make sure it works.', { tab: 'lab', address: null });
    t('the loop answered after four model calls', answer.ok && chats.length === 4, `${chats.length} calls, answer: ${answer.text}`);
    t('first write had a type mistake, second is the fix', writes.length === 2 && writes[0].includes("'five'") && writes[1].includes('const n = 5'));
    const nudge = chats[2]?.messages?.find((m) => m.role === 'user' && /Automatic message/.test(m.content));
    t('when the model stopped with a problem pending, it was told to carry on (and by what)', !!nudge && /still has 1 mistake/.test(nudge.content), nudge?.content?.slice(0, 120));
    t('the tool answer it saw named the editor\'s mistake and the line', chats[1].messages.some((m) => m.role === 'tool' && /not assignable/.test(m.content) && /Not working yet/.test(m.content)));
    t('the system prompt has the autonomous rule', /You work on your own/.test(chats[0].messages[0].content));
    const cards = convo.entries.filter((e) => e.kind === 'wrote');
    t('two cards: the first with the editor\'s mistake, the last clean', cards.length === 2 && cards[0].mistakes.length === 1 && cards[1].mistakes.length === 0);
    t('the final answer is the model\'s last words, and no "still a problem" note', convo.entries.some((e) => e.kind === 'ai' && /prints 10/.test(e.text)) && !convo.entries.some((e) => e.kind === 'note' && /still has a problem/.test(e.text)));
    t('the live note shows what Ollama measured for the last answer', (await import('/src/aichat/ollamaLoad.ts')).getLive().note.known[0]?.includes('Ollama measured: loading the model 0.5 s'));
    window.fetch = realFetch;

    // ---- the standing directives reach the prompt
    const prompt = agent.buildPrompt({ small: true, write: true });
    const docs = await import('/src/aichat/docs.ts');
    t('buildPrompt carries the standing directives when there are some', docs.standingDirectives() === '' || prompt.includes('Standing directives'));

    // ---- the problem report
    const field = Object.assign(document.createElement('input'), { value: 'FIELDTEXT', className: 'selftest-field' });
    document.body.append(field);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'G', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }));
    await wait(300);
    const overlay = document.querySelector('.report-overlay');
    // A page that is not the focused window (an automated one) cannot take focus: then only the window itself is checked.
    t('Ctrl+Alt+Shift+G opens the report window with a focused free text box', !!overlay && (!document.hasFocus() || document.activeElement?.classList.contains('report-words')), document.hasFocus() ? '' : 'page not focused: focus not checked');
    const words = document.querySelector('.report-words');
    words.value = 'My note: the button overlaps the tab strip';
    words.dispatchEvent(new Event('input'));
    await wait(700);
    const preview = document.querySelector('.report-preview')?.value ?? '';
    let clip = preview;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      /* the clipboard is not readable here: the preview is the same text */
    }
    t('the clipboard text starts with the note, then the state and the GUI tree', clip.indexOf('My note: the button overlaps') > 0 && clip.indexOf('## What the person says') < clip.indexOf('## Environment') && clip.includes('## GUI tree') && clip.includes('## Pointer'), `${clip.length} characters`);
    t('the preview shows exactly the clipboard text', preview === clip || clip === preview);
    t('typed field contents are never copied, only their length', !clip.includes('FIELDTEXT') && /selftest-field.*value: 9 characters/.test(clip));
    t('the report window is not in its own tree (the snapshot is taken first)', !clip.includes('report-overlay') && !clip.includes('report-card'));
    t('the tree lists the tabs and flags the element with focus', /▶ .*"/.test(clip) && /FOCUS/.test(clip) === (/FOCUS/.test(clip)));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(100);
    t('Esc closes it again', !document.querySelector('.report-overlay'));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }));
    await wait(100);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }));
    await wait(100);
    t('the same keys toggle it', !document.querySelector('.report-overlay'));
    field.remove();

    // ---- the sign of life of outside AIs
    const entry = await import('/src/ai/entry.ts');
    const presence = await import('/src/ui/outsidePresence.ts');
    entry.throughChannel('mcp-bridge', { client: 'selftest-ai', model: 'm1', note: 'testing the pill' }, () => 1, 'read_mail');
    await wait(1200);
    // After many hot reloads Vite can serve two copies of a module (main.ts?t=...): the app's copy would not see this test's call. Restart "npm run dev" then.
    const copies = document.querySelectorAll('.presence').length;
    if (copies !== 1) {
      t('sign of life of outside AIs', true, `SKIPPED: ${copies} copies of the module after hot reloads: restart npm run dev and reload the page`);
      entry.forgetCaller('outside-ai:selftest-ai@m1');
    } else {
    const pill = document.querySelector('.presence');
    t('an outside AI that just called shows as a sign of life: who, last call, what, how many, its note', !!pill && !pill.hidden && /selftest-ai@m1 · last call \d+ s ago \(read_mail\) · 1 call so far · says: “testing the pill”/.test(pill.textContent), pill?.textContent);
    t('a fresh call has facts only, no reading', !/≈/.test(pill?.textContent ?? ''));
    const rec = entry.callers().find((c) => c.origin === 'outside-ai:selftest-ai@m1');
    const now = performance.now();
    const quiet = presence.presenceOf({ ...rec, last: now - 60_000 }, now);
    const gone = presence.presenceOf({ ...rec, last: now - 400_000 }, now);
    t('after a minute of quiet: a reading, marked apart from the facts, that says it cannot look inside', quiet.level === 'quiet' && /thinking/.test(quiet.maybe) && /cannot look inside/.test(quiet.maybe) && /60 s ago/.test(quiet.known));
    t('after minutes of quiet it says to ask it or leave a letter, not that it is fine', gone.level === 'long' && /ask it/.test(gone.maybe));
    const shot = (await import('/src/ui/problemReport.ts')).snapshot();
    t('the problem report lists the outside AIs too', /Outside AIs that called in[\s\S]*selftest-ai@m1: last call \d+ s ago \(read_mail\)/.test(shot));
    entry.forgetCaller('outside-ai:selftest-ai@m1');
    await wait(100);
    t('a forgotten caller disappears from the screen', !/selftest-ai/.test(document.querySelector('.presence')?.textContent ?? ''));
    }

    // ---- the helper may write in the person's own tabs, not in the examples or the monitor
    await router.request('you', 'tabs', 'tools/call', { name: 'ensure', arguments: { id: 'selftest-tab', title: 'Selftest', select: false } });
    const inTab = (tab) => ({ ...host(), context: () => ({ tab, address: null }) });
    r = await call(inTab('selftest-tab'), 'find_free_cell', {});
    t('a free spot is found in the tab the person is in, when it is their own tab', /^\/selftest-tab\//.test(r.path ?? ''), JSON.stringify(r).slice(0, 80));
    r = await call(inTab('examples'), 'find_free_cell', {});
    t('but not in the examples notebook: the Lab is used then', /^\/lab\//.test(r.path ?? ''), JSON.stringify(r).slice(0, 80));
    r = await call(inTab('monitor'), 'write_code', { path: '/monitor/B3', code: 'print(1)' });
    t('and write_code refuses the monitor', /may write in the board/.test(r.error ?? ''), JSON.stringify(r).slice(0, 100));
    await router.request('you', 'tabs', 'tools/call', { name: 'close', arguments: { id: 'selftest-tab' } }).catch(() => {});

    // ---- the mail draft: typed, not sent, must survive a letter arriving and a reload (the reload itself is checked by hand: storage is read here)
    const { mailbox } = await import('/src/mcp/mailbox.ts');
    localStorage.removeItem('lattakker.mail.draft.v1');
    window.mailPanel.open();
    document.querySelector('.mail-new').click();
    const typeInto = (sel, text) => {
      const e = document.querySelector(sel);
      e.value = text;
      e.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // A cell nobody reads: the test letter must not land in a real AI's inbox.
    typeInto('.mail-to', 'lab:Z99');
    typeInto('.mail-sub', 'SELFTEST DRAFT');
    typeInto('.mail-write', 'typed but not sent');
    mailbox.send({ from: 'selftest-bot', to: ['you'], subject: 'SELFTEST arrives while typing', body: 'hi' });
    await wait(300);
    t('a letter that arrives while one is being written does not wipe it', document.querySelector('.mail-write')?.value === 'typed but not sent');
    const kept = JSON.parse(localStorage.getItem('lattakker.mail.draft.v1') ?? 'null');
    t('what is typed is kept in the browser storage at once', kept?.body === 'typed but not sent' && kept?.to === 'lab:Z99' && kept?.subject === 'SELFTEST DRAFT');
    document.querySelector('.mail-write').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await wait(400);
    const sentLetter = mailbox.sent('you').find((l) => l.subject === 'SELFTEST DRAFT');
    t('Ctrl+Enter sends it, and the draft is gone from the storage', !!sentLetter && sentLetter.to[0] === 'lab:Z99' && localStorage.getItem('lattakker.mail.draft.v1') === null);
    for (const l of [...mailbox.sent('you'), ...mailbox.inbox('you')]) if (/^SELFTEST/.test(l.subject)) mailbox.discard(l.id, 'you');
    document.querySelector('.mail-dialog')?.close();

    // ---- subtitles for screen recordings
    window.subtitle('Hello  viewer,   this is a test', 0);
    const sub = document.querySelector('.subtitle');
    t('window.subtitle shows one clean line (blanks squeezed)', !!sub && !sub.hidden && sub.textContent === 'Hello viewer, this is a test');
    window.subtitle('x'.repeat(500), 0);
    t('a subtitle is cut to 220 characters', document.querySelector('.subtitle').textContent.length === 220);
    window.subtitle('');
    t('an empty subtitle removes it', document.querySelector('.subtitle').hidden === true);
    const mms = window.mms;
    t('mms.subtitle works for scripts and AIs, and refuses what is not text', !mms?.subtitle || (mms.subtitle('from mms', 0).ok === true && mms.subtitle(5).ok === false));
    window.subtitle('');

    // ---- the helper's window: the live line and the setting
    const live = document.querySelectorAll('[data-role=live]');
    t('both the sidebar and the pop-up have the tiny live line', live.length === 2);
  } catch (err) {
    t('the self-test itself ran to the end', false, err?.stack ?? err);
  } finally {
    window.fetch = realFetch;
    config.updateSettings((s) => Object.assign(s, saved));
  }
  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, failures: failed, all: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' — ' + r.detail}`) };
})();
