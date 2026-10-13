import { destination, getSettings } from './config';

/**
 * A short, honest description of the model that answers: who makes it, which one, and a rough guess how well it
 * writes code. The guess comes from the model's name only (families, sizes, "lite", "coder"): how smart a model
 * feels depends on the task and on who is asking, so the text says "a guess".
 */

export interface ModelInfo {
  company: string;
  model: string;
  /** Where the question goes: "Google (online)" or "this computer". */
  where: string;
  /** What it is good at, in a few words. */
  skill: string;
  /** "Google · gemini-flash-lite-latest", for the little line under an answer. */
  short: string;
  /** The whole line for the header. */
  line: string;
}

const FAMILIES: Array<[RegExp, string]> = [
  [/gemini|gemma/, 'Google'],
  [/qwen/, 'Alibaba'],
  [/llama/, 'Meta'],
  [/mistral|mixtral|codestral|ministral/, 'Mistral AI'],
  [/phi\d?/, 'Microsoft'],
  [/deepseek/, 'DeepSeek'],
  [/granite/, 'IBM'],
  [/gpt-oss|gpt-/, 'OpenAI'],
  [/claude/, 'Anthropic'],
  [/glm/, 'Zhipu AI'],
  [/starcoder/, 'BigCode'],
];

function skillOf(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('gemini')) {
    if (/pro/.test(n)) return 'strongest, a bit slower: writes good code';
    if (/lite/.test(n)) return 'fastest and simplest: short, easy code';
    if (/flash/.test(n)) return 'fast all-rounder: writes good code';
    return 'writes code';
  }
  if (/coder|code|starcoder|codestral/.test(n)) return 'made for code: writes good code';
  const size = /(\d+(?:\.\d+)?)\s*b\b/.exec(n);
  if (size) {
    const b = Number(size[1]);
    if (b >= 14) return 'big model: writes good code';
    if (b >= 7) return 'medium model: writes simple code';
    return 'small model: tiny snippets only';
  }
  return 'size unknown: try it on a small piece of code first';
}

export function describeModel(): ModelInfo {
  const s = getSettings();
  const gemini = s.provider === 'gemini';
  const model = (gemini ? s.gemini.model : s.local.model) || '(no model chosen)';
  const lower = model.toLowerCase();
  const company = gemini ? 'Google' : (FAMILIES.find(([re]) => re.test(lower))?.[1] ?? 'unknown maker');
  const host = destination();
  const where = gemini ? 'Google (online)' : /^(localhost|127\.|\[::1\])/.test(host) ? 'this computer' : host;
  const skill = skillOf(model);
  const short = `${company} · ${model}`;
  return { company, model, where, skill, short, line: `${company} · ${model} · ${where} · ${skill} (a guess from the name)` };
}

/** A model on this computer whose name says it has fewer than 14 billion parameters: it gets a shorter list of tools and plainer instructions. */
export function isSmallModel(): boolean {
  const s = getSettings();
  if (s.provider !== 'local') return false;
  const size = /(\d+(?:\.\d+)?)\s*b\b/.exec(s.local.model.toLowerCase());
  return !!size && Number(size[1]) < 14;
}
