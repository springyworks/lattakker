import type { JobNode } from './jobs';
import { ammo, kilo } from './ammo';

/**
 * "Why am I waiting, and where?" in plain words. It reads the live job tree (see jobs.ts), follows it down to the
 * job that is really being waited for, and turns what that job says into one sentence, the chain that leads there
 * and, when there is something to try, a hint. Nothing here is guessed: it only rephrases what the jobs reported.
 */

export interface Diagnosis {
  /** From the question down to what is waited for: "chat › local-model qwen3.5:4b". */
  chain: string;
  line: string;
  hint: string;
  level: 'ok' | 'slow' | 'stuck';
}

const isOpen = (n: JobNode): boolean => n.state === 'waiting' || n.state === 'running';

/** The open jobs from the top of the tree to the innermost one. */
function openPath(nodes: JobNode[]): JobNode[] {
  const path: JobNode[] = [];
  let level = nodes;
  for (;;) {
    const next = [...level].reverse().find(isOpen);
    if (!next) return path;
    path.push(next);
    level = next.children;
  }
}

export function diagnose(tree: JobNode[]): Diagnosis | null {
  const path = openPath(tree);
  const leaf = path[path.length - 1];
  if (!leaf) return null;
  const chain = path.map((n) => (n.service === 'chat' ? 'chat' : `${n.service} ${n.title}`.trim())).join(' › ');
  const detail = leaf.detail;
  let line = detail ? `${leaf.service}: ${detail}` : `${leaf.service} is working (${leaf.ageSeconds.toFixed(0)} s)`;
  let hint = '';
  let level: Diagnosis['level'] = leaf.ageSeconds > 20 ? 'slow' : 'ok';

  if (leaf.service === 'local-model') {
    if (/not in memory yet/.test(detail)) {
      line = 'The model is being loaded into this computer’s memory.';
      hint = `The first question after a pause, or a big model, takes a while: this is normal.${/ollama stop/.test(detail) ? ` ${detail.slice(detail.indexOf('Ollama is also'))}` : ''} Press Stop to give up.`;
    } else if (/thinking/.test(detail)) {
      line = `The model is thinking before it writes (${detail.match(/\((\d+) pieces/)?.[1] ?? '…'} pieces so far).`;
      hint = 'A small model may think for a while. Stop ends it.';
    } else if (/receiving the answer/.test(detail)) {
      line = 'The model is writing its answer.';
    } else if (/writing a tool call/.test(detail)) {
      line = 'The model is deciding which tool to use.';
    } else if (/works on the question/.test(detail)) {
      line = 'The model has the question and is working on it; no word has come yet.';
      hint = 'A long conversation takes longer to read. “New conversation” (🗑) makes it quicker.';
    } else if (/nothing has come back/.test(detail)) {
      line = 'The question was sent; the model server has not answered yet.';
      hint = 'If this lasts, check that the server is running (⚙ › Test this model).';
    }
  } else if (leaf.service === 'tool') {
    line = `The helper is using a tool: ${leaf.title}${detail ? ` (${detail.replace(/…$/, '')})` : ''}.`;
  } else if (leaf.service === 'google') {
    line = detail || 'Waiting for Google.';
    if (/busy|again|retry/i.test(detail)) hint = 'Google is busy or a limit was reached; the helper tries again by itself.';
  }

  if (leaf.stalled || path.some((n) => n.stalled)) {
    level = 'stuck';
    line = `Nothing has been heard for ${leaf.quietSeconds} s: it may be stuck. (${line})`;
    hint = 'Press Stop and ask again. If it happens every time, open ⚙ and press “Test this model”.';
  }
  const full = ammo.fullness();
  if (full !== null && full >= 0.9 && ammo.state.window) {
    hint = `${hint ? `${hint} ` : ''}🔋 The model’s memory is almost full (${kilo(ammo.state.used ?? 0)} of ${kilo(ammo.state.window)}): old answers are shortened to make room.`;
  }
  return { chain, line, hint, level };
}
