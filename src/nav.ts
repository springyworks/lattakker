import { workspace } from './workspace';
import type { SheetView } from './sheet/Sheet';

/**
 * Moving around the page, the way an editor does: a cell link flies to its cell (zooming in), and the
 * ◀ ▶ buttons in the tab strip (and Alt+← / Alt+→) go back and forward through the places that were visited.
 *
 * A place is a tab and, when there is one, a cell. Visiting a tab or following a cell link adds a place;
 * clicking around inside a tab only updates the current place, so "back" means "the last place I came from",
 * not "the last cell I clicked". When a place is left, how it was zoomed and scrolled is kept, and "back"
 * flies there again.
 */

interface Place {
  tab: string;
  address: string | null;
  view: SheetView | null;
}

const MAX_PLACES = 60;

/** A cell path as written in text: /lab/A41, A41 or /lab/A41/3,4 (a bare address needs a capital letter, so "x2" is not a link). */
export const CELL_PATH = /^(?:\/[a-z][a-z0-9-]*\/[A-Za-z]\d{1,3}(?:\/\d+,\d+)?|[A-Z]\d{1,3}(?:\/\d+,\d+)?)$/;

const places: Place[] = [{ tab: 'board', address: null, view: null }];
let index = 0;
let installed = false;
/** True while this module itself switches tabs, so that the switch is not recorded a second time. */
let quiet = false;
const listeners: Array<() => void> = [];

/** Tells the person something went wrong (set by the page). */
let tell: (text: string) => void = () => {};

const changed = (): void => listeners.forEach((l) => l());
const here = (): Place => places[index];

/** Remembers how the tab we are looking at is zoomed and scrolled. Call it just before leaving the tab. */
function saveView(): void {
  const place = here();
  const sheet = workspace.get(place.tab)?.sheet;
  if (sheet && workspace.current === place.tab) place.view = sheet.viewState();
}

function add(tab: string, address: string | null): void {
  const place = here();
  if (place.tab === tab && place.address === address) return;
  places.splice(index + 1);
  places.push({ tab, address, view: null });
  if (places.length > MAX_PLACES) places.shift();
  index = places.length - 1;
  changed();
}

function select(id: string): void {
  quiet = true;
  try {
    workspace.get(id)?.select();
  } finally {
    quiet = false;
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  places[0] = { tab: workspace.current, address: workspace.focus?.tab === workspace.current ? workspace.focus.address : null, view: null };
  // Switching tabs is a new place; the cell that was pointed at in that tab comes along.
  workspace.onCurrentChange((id) => {
    if (quiet) return;
    const focus = workspace.focus;
    add(id, focus && focus.tab === id ? focus.address : null);
  });
  // Pointing at another cell in the same tab only moves the current place.
  workspace.onFocusChange((focus) => {
    if (focus && focus.tab === here().tab && here().address !== focus.address) here().address = focus.address;
  });
}

async function show(place: Place): Promise<void> {
  const tab = workspace.get(place.tab);
  if (!tab) return;
  select(place.tab);
  if (place.address) workspace.setFocus(place.tab, place.address);
  if (place.view) await tab.sheet.flyTo(place.view);
  else if (place.address) await tab.sheet.flyToCell(place.address);
}

export const nav = {
  /** What the page says when a link does not lead anywhere. */
  setTeller(fn: (text: string) => void): void {
    tell = fn;
  },

  /** Must run once the tabs exist. */
  install,

  /** Call just before a tab is left, while its scroll position still exists. */
  beforeLeave: saveView,

  /** Follows a cell path: opens its tab, flies to the cell and zooms in on it. Returns false when there is no such cell. */
  goTo(path: string): boolean {
    install();
    const hit = workspace.resolve(path, workspace.current);
    if ('error' in hit) {
      tell(hit.error);
      return false;
    }
    saveView();
    select(hit.tab.id);
    add(hit.tab.id, hit.address);
    workspace.setFocus(hit.tab.id, hit.address, hit.tile);
    void hit.tab.sheet.flyToCell(hit.address);
    return true;
  },

  get canBack(): boolean {
    return index > 0;
  },

  get canForward(): boolean {
    return index < places.length - 1;
  },

  back(): void {
    if (index <= 0) return;
    saveView();
    index--;
    changed();
    void show(here());
  },

  forward(): void {
    if (index >= places.length - 1) return;
    saveView();
    index++;
    changed();
    void show(here());
  },

  onChange(listener: () => void): void {
    listeners.push(listener);
  },
};

/** A blue link to a cell: `<a class="cell-link">` that flies to it. The text is the path unless another label is given. */
export function cellLink(path: string, label?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'cell-link';
  a.href = '#';
  a.textContent = label ?? path;
  a.title = `Go to ${path}`;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    nav.goTo(path);
  });
  return a;
}
