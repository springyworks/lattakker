/**
 * Settings of the AI helper. Nothing is ever sent anywhere until a helper has been set up here, and the key (if
 * the helper needs one) lives only in this module's memory unless the person ticks "remember on this computer".
 * Keys are never exposed on window, but code in a cell can read localStorage, so remembering a key is a choice
 * with a cost, and the settings window says so.
 */

export type ProviderId = 'local' | 'gemini' | 'openrouter';

/** 0 = "as the server runs it": no num_ctx is sent, so Ollama never starts a new instance because of this page (a different num_ctx always does). */
export const SERVER_CONTEXT = 0;
export const OLLAMA_CONTEXT_OPTIONS = [SERVER_CONTEXT, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
export const DEFAULT_OLLAMA_CONTEXT = SERVER_CONTEXT;

/** After this many silent minutes the model on this computer is not given up on: the person is asked whether to keep waiting. 0 = never ask (only the Stop button ends the wait). */
export const WAIT_OPTIONS = [0, 2, 5, 10, 20, 30, 60, 120, 240];
export const DEFAULT_WAIT_MINUTES = 10;
/** What the person is willing to spend through OpenRouter before the helper stops asking. */
export const DEFAULT_BUDGET_USD = 10;

/** Used for budgeting when the server's own size is not known yet (before the first answer from /api/ps). */
const ASSUMED_SERVER_WINDOW = 32768;
let serverWindow = 0;

/** Remember the window the server really runs the model with. */
export function noteServerWindow(tokens: number): void {
  if (tokens > 0) serverWindow = tokens;
}

/** How many tokens the model can hold: the chosen size, or the server's own when "as the server" is chosen. */
export function localWindow(chosen: number = getSettings().local.context): number {
  return chosen || serverWindow || ASSUMED_SERVER_WINDOW;
}

export interface AiSettings {
  provider: ProviderId;
  /** An OpenAI-compatible server, for example Ollama (http://localhost:11434/v1) or LM Studio (http://localhost:1234/v1). */
  local: { baseUrl: string; model: string; /** How many tokens the model may remember at once (Ollama's num_ctx). More is smarter but uses more memory. */ context: number; /** Silent minutes before the person is asked whether to keep waiting (0 = never ask). */ waitMinutes: number };
  gemini: { model: string; adultAck: boolean };
  /** OpenRouter: one key, hundreds of models, paid per token. `budgetUsd` is the most the person wants to spend through this page. */
  openrouter: { model: string; budgetUsd: number };
  /** Keep the key in this browser (localStorage) instead of only until the page is closed. */
  remember: boolean;
  /** Pop the little chat up by itself when a "// AI:" question has been left alone for a while. */
  autoPopup: boolean;
  autoSeconds: number;
  /** Let an outside AI (connected over MCP) put questions to this helper. Off unless a person turns it on. */
  allowOutside: boolean;
  /** Let cells and the helper look up the weather (the place name is sent to open-meteo.com). */
  allowWeather: boolean;
  /** Let the helper write code into an EMPTY cell on its own (the person watches it being typed and can undo it). */
  allowWrite: boolean;
  /**
   * Let the helper work on its own: write or add code, let the editor check it for mistakes, run it, read what came out
   * and keep going until it works. On by default; it also lets the helper write (the person watches and can undo).
   */
  autonomous: boolean;
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'local',
  local: { baseUrl: 'http://localhost:11434/v1', model: '', context: DEFAULT_OLLAMA_CONTEXT, waitMinutes: DEFAULT_WAIT_MINUTES },
  gemini: { model: 'gemini-flash-latest', adultAck: false },
  openrouter: { model: '', budgetUsd: DEFAULT_BUDGET_USD },
  remember: false,
  autoPopup: true,
  autoSeconds: 3,
  allowOutside: false,
  allowWeather: true,
  allowWrite: false,
  autonomous: true,
};

const SETTINGS_KEY = 'lattakker:ai:v1';
const KEYS_KEY = 'lattakker:ai:keys';

/** Keys, by provider. Module-private on purpose. */
const keys: Record<ProviderId, string> = { local: '', gemini: '', openrouter: '' };
let settings: AiSettings = structuredClone(DEFAULT_SETTINGS);
const listeners: Array<() => void> = [];

function merge(base: AiSettings, saved: Partial<AiSettings> | null): AiSettings {
  if (!saved || typeof saved !== 'object') return base;
  // Settings saved before version 2 that still hold the old default of 22 seconds get the new default.
  const seconds = (saved as { v?: number }).v === 2 || Number(saved.autoSeconds) !== 22 ? Number(saved.autoSeconds) : base.autoSeconds;
  return {
    provider: saved.provider === 'gemini' || saved.provider === 'openrouter' ? saved.provider : 'local',
    local: { baseUrl: String(saved.local?.baseUrl || base.local.baseUrl), model: String(saved.local?.model ?? ''), context: OLLAMA_CONTEXT_OPTIONS.includes(Number(saved.local?.context)) ? Number(saved.local?.context) : base.local.context, waitMinutes: WAIT_OPTIONS.includes(Number(saved.local?.waitMinutes)) ? Number(saved.local?.waitMinutes) : base.local.waitMinutes },
    gemini: { model: String(saved.gemini?.model || base.gemini.model), adultAck: saved.gemini?.adultAck === true },
    openrouter: { model: String(saved.openrouter?.model ?? ''), budgetUsd: Number.isFinite(Number(saved.openrouter?.budgetUsd)) && Number(saved.openrouter?.budgetUsd) > 0 ? Number(saved.openrouter?.budgetUsd) : base.openrouter.budgetUsd },
    remember: saved.remember === true,
    autoPopup: saved.autoPopup !== false,
    allowOutside: saved.allowOutside === true,
    allowWeather: saved.allowWeather !== false,
    allowWrite: saved.allowWrite === true,
    autonomous: saved.autonomous !== false,
    autoSeconds: Number.isFinite(seconds) ? Math.min(600, Math.max(3, Math.round(seconds))) : base.autoSeconds,
  };
}

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    settings = merge(structuredClone(DEFAULT_SETTINGS), raw ? (JSON.parse(raw) as Partial<AiSettings>) : null);
    if (settings.remember) {
      const saved = JSON.parse(localStorage.getItem(KEYS_KEY) ?? '{}') as Partial<Record<ProviderId, string>>;
      keys.local = typeof saved.local === 'string' ? saved.local : '';
      keys.gemini = typeof saved.gemini === 'string' ? saved.gemini : '';
      keys.openrouter = typeof saved.openrouter === 'string' ? saved.openrouter : '';
    }
  } catch {
    settings = structuredClone(DEFAULT_SETTINGS);
  }
}

function persist(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, v: 2 }));
    if (settings.remember) localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    else localStorage.removeItem(KEYS_KEY);
  } catch {
    // storage blocked: the settings simply last until the page is closed
  }
}

/** The silence after which the person is asked whether to keep waiting, in milliseconds (0 = never). */
export const patienceMs = (): number => settings.local.waitMinutes * 60000;

export const getSettings = (): AiSettings => settings;

/** May the helper write code itself? Yes when the person allowed it, or when it may work on its own. */
export const canWrite = (): boolean => settings.allowWrite || settings.autonomous;
export const getKey = (provider: ProviderId): string => keys[provider];

export function updateSettings(change: (s: AiSettings) => void): void {
  change(settings);
  settings = merge(structuredClone(DEFAULT_SETTINGS), settings);
  persist();
  listeners.forEach((l) => l());
}

export function setKey(provider: ProviderId, key: string): void {
  keys[provider] = key.trim();
  persist();
  listeners.forEach((l) => l());
}

/** Forget everything: settings, keys, and what is stored in this browser. */
export function forgetAll(): void {
  keys.local = '';
  keys.gemini = '';
  keys.openrouter = '';
  settings = structuredClone(DEFAULT_SETTINGS);
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(KEYS_KEY);
  } catch {
    // nothing stored, nothing to forget
  }
  listeners.forEach((l) => l());
}

export function onSettingsChange(listener: () => void): void {
  listeners.push(listener);
}

/** True when the chosen helper has what it needs to answer (a model, and a key or the adult acknowledgement). */
export function isConfigured(): boolean {
  if (settings.provider === 'local') return !!settings.local.baseUrl && !!settings.local.model;
  if (settings.provider === 'openrouter') return !!keys.openrouter && !!settings.openrouter.model;
  return !!keys.gemini && settings.gemini.adultAck && !!settings.gemini.model;
}

/** Where a request goes, in words, for the "what is sent" line. */
export function destination(): string {
  if (settings.provider === 'local') {
    try {
      return new URL(settings.local.baseUrl).host;
    } catch {
      return settings.local.baseUrl;
    }
  }
  if (settings.provider === 'openrouter') return 'OpenRouter (openrouter.ai), which passes it on to the model\'s maker';
  return 'Google (generativelanguage.googleapis.com)';
}
