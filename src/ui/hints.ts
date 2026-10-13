const KEY = 'lattakker:hints:v1';

/** Whether the little yellow hint under a hovered cell is shown. A person who knows the cells can switch it off (in the hint itself, or in F1 help). */
let enabled = true;
try {
  enabled = (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { cell?: boolean }).cell !== false;
} catch {
  enabled = true;
}

const listeners: Array<(on: boolean) => void> = [];

export const cellHints = {
  get enabled(): boolean {
    return enabled;
  },
  set(on: boolean): void {
    if (enabled === on) return;
    enabled = on;
    try {
      localStorage.setItem(KEY, JSON.stringify({ cell: on }));
    } catch {
      // not remembered (private window): it still applies until the page is closed
    }
    listeners.forEach((l) => l(on));
  },
  onChange(listener: (on: boolean) => void): void {
    listeners.push(listener);
  },
};
