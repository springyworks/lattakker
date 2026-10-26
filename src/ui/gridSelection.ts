/**
 * Copying what is selected on a character grid (a tile terminal like /lab/K1, a teletype paper like /lab/A1). Those letters are
 * drawn by the sheet, so the browser has no text to select; the sheet keeps its own selection and offers it here. Ctrl+C
 * (Cmd+C) copies it before a terminal can take the key as its own ^C.
 */

export interface GridSelectionSource {
  text(): string;
  copy(text: string): void;
}

const sources = new Set<GridSelectionSource>();
let listening = false;

export function addGridSelectionSource(source: GridSelectionSource): () => void {
  sources.add(source);
  if (!listening) {
    listening = true;
    window.addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'c' || window.getSelection()?.toString()) return;
        for (const s of sources) {
          const text = s.text();
          if (!text) continue;
          e.preventDefault();
          e.stopImmediatePropagation();
          s.copy(text);
          return;
        }
      },
      true,
    );
  }
  return () => void sources.delete(source);
}
