/**
 * Settings of the AI helper. Nothing is ever sent anywhere until a helper has been set up here, and the key (if
 * the helper needs one) lives only in this module's memory unless the person ticks "remember on this computer".
 * Keys are never exposed on window, but code in a cell can read localStorage, so remembering a key is a choice
 * with a cost, and the settings window says so.
 */

export type ProviderId = 'local' | 'gemini';

/** 0 = "as the server runs it": no num_ctx is sent, so Ollama never starts a new instance because of this page (a different num_ctx always does). */
export const SERVER_CONTEXT = 0;
export const OLLAMA_CONTEXT_OPTIONS = [SERVER_CONTEXT, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
export const DEFAULT_OLLAMA_CONTEXT = SERVER_CONTEXT;

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
  local: { baseUrl: string; model: string; /** How many tokens the model may remember at once (Ollama's num_ctx). More is smarter but uses more memory. */ context: number };
  gemini: { model: string; adultAck: boolean };
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
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'local',
  local: { baseUrl: 'http://localhost:11434/v1', model: '', context: DEFAULT_OLLAMA_CONTEXT },
  gemini: { model: 'gemini-flash-latest', adultAck: false },
  remember: false,
  autoPopup: true,
  autoSeconds: 3,
  allowOutside: false,
  allowWeather: true,
  allowWrite: false,
};

const SETTINGS_KEY = 'lattakker:ai:v1';
const KEYS_KEY = 'lattakker:ai:keys';

/** Keys, by provider. Module-private on purpose. */
const keys: Record<ProviderId, string> = { local: '', gemini: '' };
let settings: AiSettings = structuredClone(DEFAULT_SETTINGS);
const listeners: Array<() => void> = [];

function merge(base: AiSettings, saved: Partial<AiSettings> | null): AiSettings {
  if (!saved || typeof saved !== 'object') return base;
  // Settings saved before version 2 that still hold the old default of 22 seconds get the new default.
  const seconds = (saved as { v?: number }).v === 2 || Number(saved.autoSeconds) !== 22 ? Number(saved.autoSeconds) : base.autoSeconds;
  return {
    provider: saved.provider === 'gemini' ? 'gemini' : 'local',
    local: { baseUrl: String(saved.local?.baseUrl || base.local.baseUrl), model: String(saved.local?.model ?? ''), context: OLLAMA_CONTEXT_OPTIONS.includes(Number(saved.local?.context)) ? Number(saved.local?.context) : base.local.context },
    gemini: { model: String(saved.gemini?.model || base.gemini.model), adultAck: saved.gemini?.adultAck === true },
    remember: saved.remember === true,
    autoPopup: saved.autoPopup !== false,
    allowOutside: saved.allowOutside === true,
    allowWeather: saved.allowWeather !== false,
    allowWrite: saved.allowWrite === true,
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

export const getSettings = (): AiSettings => settings;
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
  return 'Google (generativelanguage.googleapis.com)';
}
