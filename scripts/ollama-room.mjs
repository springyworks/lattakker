// Several agents share ONE Ollama model and see each other's messages: node scripts/ollama-room.mjs [--agents 3] [--rounds 2] [--model qwen3.6:latest] [--url http://localhost:11434]
//
// Ollama itself keeps no chat between clients: every request carries its whole conversation, and the server has no idea who else is talking.
// What the clients share is the loaded model (one copy in memory) and, with OLLAMA_NUM_PARALLEL=1, one slot: requests wait in line.
// "Seeing each other" therefore lives in a layer above: here a room (a shared transcript) that every agent reads before it speaks.
// The room goes FIRST in the prompt and the agent's own instruction LAST, so all agents start with the same tokens and the server
// can reuse what it already computed for them (look at "read ms": the time spent reading the prompt; it should stay small for the agents that follow the first one).
//
// It sends no num_ctx on purpose: a request with another context size than the loaded one makes Ollama reload the model.
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const URL_ = arg('url', 'http://localhost:11434').replace(/\/+$/, '');
const MODEL = arg('model', 'qwen3.6:latest');
const AGENTS = Math.min(Math.max(Number(arg('agents', 3)), 1), 6);
const ROUNDS = Math.min(Math.max(Number(arg('rounds', 2)), 1), 5);
const TIMEOUT_MS = Number(arg('timeout', 120)) * 1000;

const ROLES = [
  ['Ada', 'the planner: propose the next small step'],
  ['Bo', 'the builder: say how you would build that step'],
  ['Cy', 'the critic: name one risk in what was said'],
  ['Di', 'the tester: say how you would check it'],
  ['Ed', 'the writer: summarise the room in one line'],
  ['Flo', 'the child: ask one simple question about it'],
].slice(0, AGENTS);

const SYSTEM = 'You are one of several AI agents in a shared room. Everybody sees the whole transcript. Answer with ONE short sentence (at most 25 words), no lists, and build on what the others said.';
const TOPIC = 'Topic: how can a child learn to program by moving pieces on a board?';

const get = async (path) => {
  const res = await fetch(URL_ + path, { signal: AbortSignal.timeout(2000) });
  return res.json();
};
const loaded = async () => ((await get('/api/ps')).models ?? []).map((m) => `${m.name} (ctx ${m.context_length})`).join(', ') || 'nothing';

// 1. The ping first: no answer within 2 s means Ollama is not running, and nothing below would ever finish.
const t0 = performance.now();
try {
  const v = await get('/api/version');
  console.log(`ping: Ollama ${v.version} answered in ${(performance.now() - t0).toFixed(1)} ms`);
} catch {
  console.error('ping: no answer from', URL_, '(is "ollama serve" running?)');
  process.exit(2);
}
const before = await loaded();
console.log('in memory before:', before);
if (before === 'nothing') {
  console.error(`${MODEL} is not loaded. Load it first (and wait): curl ${URL_}/api/generate -d '{"model":"${MODEL}","prompt":"","keep_alive":-1}'`);
  process.exit(3);
}

const room = [TOPIC];
const start = performance.now();
const clock = () => `${((performance.now() - start) / 1000).toFixed(1).padStart(5)}s`;
const stats = [];

async function speak([name, role], round) {
  const sent = performance.now();
  const transcript = room.join('\n');
  const body = {
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: -1,
    options: { temperature: 0.5, num_predict: 60 },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Room so far:\n${transcript}\n\nYou are ${name}, ${role}. Speak now.` },
    ],
  };
  console.log(`${clock()}  ${name} asks (round ${round}, sees ${room.length - 1} messages)`);
  const res = await fetch(`${URL_}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json();
  if (data.error) throw new Error(`${name}: ${data.error}`);
  const said = String(data.message?.content ?? '').trim().replace(/\s+/g, ' ');
  room.push(`${name}: ${said}`);
  const waited = (performance.now() - sent) / 1000;
  // total_duration also counts the time spent waiting in line, so the work is the parts that were really computed.
  const readMs = (data.prompt_eval_duration ?? 0) / 1e6;
  const worked = ((data.load_duration ?? 0) + (data.prompt_eval_duration ?? 0) + (data.eval_duration ?? 0)) / 1e9;
  stats.push({ name, round, waited, worked, readMs });
  console.log(`${clock()}  ${name}: ${said}\n         (waited ${waited.toFixed(1)} s in all, worked ${worked.toFixed(1)} s: read ${data.prompt_eval_count} prompt tokens in ${readMs.toFixed(0)} ms, wrote ${data.eval_count} tokens)`);
}

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n--- round ${round}: ${AGENTS} agents ask at the same moment ---`);
  await Promise.all(ROLES.map((role) => speak(role, round)));
}

const after = await loaded();
console.log('\n=== what happened ===');
console.log('in memory after :', after, after === before ? '(same model, same context: nothing was reloaded)' : '(CHANGED!)');
const wall = (performance.now() - start) / 1000;
const work = stats.reduce((a, s) => a + s.worked, 0);
console.log(`wall time ${wall.toFixed(1)} s, summed work ${work.toFixed(1)} s: ${work / wall > 1.3 ? 'overlapped (parallel slots)' : 'one after the other (one slot: requests wait in line)'}`);
const order = [...stats].sort((a, b) => a.waited - b.waited).map((x) => `${x.name} ${x.waited.toFixed(1)}s`).join(', ');
console.log('who was answered when (waited):', order);
console.log('the room:\n  ' + room.join('\n  '));
