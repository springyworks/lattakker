// A small shootout between Eden AI models: the same few programming and maths tasks, checked by this script, with the time and the money each model took.
//   EDEN_KEY=<your key> npm run shootout                       (the default shortlist)
//   EDEN_KEY=<your key> npm run shootout -- gpt-oss-20b kimi-k2.7-code   (your own models)
// The key is read from the environment only. It is never written anywhere. Started by scripts/shootout.mjs (Vite runs the TypeScript).
import vm from 'node:vm';

const BASE = 'https://api.edenai.run/v3';
const KEY = process.env.EDEN_KEY ?? '';
const SHORTLIST = ['gpt-oss-20b', 'gpt-oss-120b', 'deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k2.7-code', 'glm-5.3-flash', 'minimax-m3.1-flash', 'claude-haiku-5.5'];
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : SHORTLIST;

type Case = [args: unknown[], expected: unknown];
type Task = { name: string; prompt: string; check: (answer: string) => boolean };

const ONLY_CODE = 'Reply with ONLY one fenced code block of plain JavaScript (no types, no explanation).';
const ANSWER_LINE = 'Think it through, then finish with a last line exactly like: ANSWER: <value>';

/** The model's code is run in a fresh sandbox and every case must give exactly the expected value. */
function codeTask(name: string, fn: string, ask: string, cases: Case[]): Task {
  return {
    name,
    prompt: `${ask}\n${ONLY_CODE}`,
    check(answer) {
      const code = answer.match(/```(?:\w+)?\n([\s\S]*?)```/)?.[1] ?? answer;
      try {
        const sandbox = vm.createContext({});
        vm.runInContext(`${code}\n;globalThis.__fn = ${fn};`, sandbox, { timeout: 2000 });
        const f = (sandbox as { __fn: (...a: unknown[]) => unknown }).__fn;
        return cases.every(([args, expected]) => JSON.stringify(f(...structuredClone(args))) === JSON.stringify(expected));
      } catch {
        return false;
      }
    },
  };
}

/** A maths question with one exact answer, read from the last "ANSWER:" line. */
function mathTask(name: string, ask: string, answer: string): Task {
  return {
    name,
    prompt: `${ask}\n${ANSWER_LINE}`,
    check(text) {
      const last = [...text.matchAll(/ANSWER:\s*\**\s*([^\n]+)/gi)].pop()?.[1] ?? '';
      return last.replace(/[*$\s`]/g, '').replace(/\.$/, '') === answer;
    },
  };
}

const digitSum = [...(2n ** 100n).toString()].reduce((sum, d) => sum + Number(d), 0);

const TASKS: Task[] = [
  codeTask('LIS length', 'lis', 'Write function lis(a) returning the length of the longest STRICTLY increasing subsequence of the number array a (O(n log n) is nicer).', [
    [[[10, 9, 2, 5, 3, 7, 101, 18]], 4],
    [[[]], 0],
    [[[5, 5, 5]], 1],
    [[[1, 2, 3, 4, 5, 6]], 6],
    [[[3, 2, 1]], 1],
  ]),
  codeTask('merge intervals', 'mergeIntervals', 'Write function mergeIntervals(iv) that takes an array of [start, end] pairs (unsorted, may touch or overlap; touching ones like [1,2],[2,3] merge) and returns the merged array sorted by start. It must not modify the input.', [
    [[[[8, 10], [1, 3], [2, 6], [15, 18]]], [[1, 6], [8, 10], [15, 18]]],
    [[[[1, 2], [2, 3]]], [[1, 3]]],
    [[[]], []],
    [[[[1, 10], [2, 3]]], [[1, 10]]],
  ]),
  codeTask('calculator', 'calc', 'Write function calc(s) that evaluates an arithmetic expression string with + - * / (no unary minus), integers and decimals, parentheses and spaces, with correct precedence. Do not use eval or Function.', [
    [['1+2*3'], 7],
    [['(1+2)*3'], 9],
    [['10/4-1'], 1.5],
    [[' 2 * (3 + (4 - 1)) / 3 '], 4],
    [['8/2/2'], 2],
    [['2-3-4'], -5],
  ]),
  mathTask('multiples', 'How many positive integers n <= 1000 are divisible by 3 or by 5 but NOT divisible by 15?', '401'),
  mathTask('digit sum', 'What is the sum of the decimal digits of 2^100?', String(digitSum)),
  mathTask('dice', 'Two fair six-sided dice are rolled. Given that at least one shows a 6, what is the probability that the sum is at least 10? Give a reduced fraction a/b.', '5/11'),
];

interface ListedModel {
  id: string;
  pricing?: { input_cost_per_token?: number; output_cost_per_token?: number };
}

/** Dollars per million tokens, from Eden AI's public list (it needs no key). */
async function prices(): Promise<Map<string, [number, number]>> {
  const list = ((await (await fetch(`${BASE}/models?view=models`)).json()) as { data: ListedModel[] }).data;
  return new Map(list.map((m) => [m.id, [(m.pricing?.input_cost_per_token ?? 0) * 1e6, (m.pricing?.output_cost_per_token ?? 0) * 1e6]]));
}

type Reply = { text: string; seconds: number; promptTokens: number; completionTokens: number; error?: string };

async function ask(model: string, prompt: string): Promise<Reply> {
  const start = performance.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4000, temperature: 0.2 }),
    signal: AbortSignal.timeout(150_000),
  });
  const json = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const seconds = (performance.now() - start) / 1000;
  if (!res.ok) return { text: '', seconds, promptTokens: 0, completionTokens: 0, error: `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}` };
  return { text: json.choices?.[0]?.message?.content ?? '', seconds, promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 };
}

if (!KEY) {
  console.error('Set EDEN_KEY first (a key from app.edenai.run), for example:\n  EDEN_KEY=... npm run shootout');
  process.exit(1);
}

const price = await prices();
for (const m of MODELS) if (!price.has(m)) console.error(`note: "${m}" is not in Eden AI's list; its cost will show as $0`);

const rows = await Promise.all(
  MODELS.map(async (model) => {
    const [perIn, perOut] = price.get(model) ?? [0, 0];
    const marks: string[] = [];
    let seconds = 0;
    let dollars = 0;
    for (const task of TASKS) {
      const reply = await ask(model, task.prompt);
      seconds += reply.seconds;
      dollars += (reply.promptTokens * perIn + reply.completionTokens * perOut) / 1e6;
      if (reply.error) {
        marks.push('E');
        console.error(`${model} / ${task.name}: ${reply.error.replaceAll(KEY, '[key]')}`);
      } else marks.push(task.check(reply.text) ? '✓' : '✗');
    }
    return { model, marks, seconds, dollars, passed: marks.filter((m) => m === '✓').length };
  }),
);

rows.sort((a, b) => b.passed - a.passed || a.dollars - b.dollars);
console.log(`tasks: ${TASKS.map((t) => t.name).join(' | ')}`);
for (const r of rows) console.log(`${r.model.padEnd(22)} ${r.marks.join(' ')}  ${r.passed}/${TASKS.length}  ${(r.seconds / TASKS.length).toFixed(1)}s/task  $${r.dollars.toFixed(4)}`);
console.log(`total $${rows.reduce((sum, r) => sum + r.dollars, 0).toFixed(4)}`);
