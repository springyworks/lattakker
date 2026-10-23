/**
 * The "📍 /lab/J24" locator, as a small button you can put anywhere a cell is named: a click copies the path (the same text the tab strip
 * copies), and the chip says "copied ✓" for a moment. Paste the path into the AI chat, a mail or an `at('/lab/J24')`.
 */

const FLASH_MS = 1100;

/** Copies text to the clipboard; false when the browser did not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Makes `chip` a copy button. `show` is what it says normally; `path` is what a click copies (absolute, so it works from any tab). */
export function bindPathChip(chip: HTMLElement, show: () => string, path: () => string): void {
  let timer = 0;
  const paint = (flash = false): void => {
    chip.textContent = flash ? 'copied ✓' : show();
    chip.title = `${path()}: click to copy this path`;
  };
  chip.classList.add('path-chip');
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  const copy = (): void => {
    void copyText(path());
    window.clearTimeout(timer);
    paint(true);
    timer = window.setTimeout(() => paint(), FLASH_MS);
  };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    copy();
  });
  chip.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    copy();
  });
  // A chip inside a bar that can be dragged or double-clicked must not start that.
  for (const type of ['pointerdown', 'dblclick']) chip.addEventListener(type, (e) => e.stopPropagation());
  chip.repaint = () => paint();
  paint();
}

declare global {
  interface HTMLElement {
    /** Set by bindPathChip: say the path again (it may have changed). */
    repaint?: () => void;
  }
}
