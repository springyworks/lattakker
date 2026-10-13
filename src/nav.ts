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
  /** The identity of the cell's code, so "back" still finds the cell after it moved. */
  uid: string | null;
  view: SheetView | null;
}

const MAX_PLACES = 60;

/** A cell path as written in text: /lab/A41, A41 or /lab/A41/3,4 (a bare address needs a capital letter, so "x2" is not a link). */
export const CELL_PATH = /^(?:\/[a-z][a-z0-9-]*\/[A-Za-z]\d{1,3}(?:\/\d+,\d+)?|[A-Z]\d{1,3}(?:\/\d+,\d+)?)$/;

const uidAt = (tab: string, address: string | null): string | null => (address ? workspace.get(tab)?.sheet.dataAt(address)?.uid || null : null);

const places: Place[] = [{ tab: 'board', address: null, uid: null, view: null }];
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
  places.push({ tab, address, uid: uidAt(tab, address), view: null });
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
  const startAddress = workspace.focus?.tab === workspace.current ? workspace.focus.address : null;
  places[0] = { tab: workspace.current, address: startAddress, uid: uidAt(workspace.current, startAddress), view: null };
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
  // The cell may have moved since this place was visited: its identity says where it is now.
  if (place.uid) {
    const now = tab.sheet.addressOfUid(place.uid);
    if (now) place.address = now;
  }
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
  const hit = workspace.resolve(path, workspace.current);
  const here = 'error' in hit ? null : hit;
  a.dataset.path = here ? workspace.pathOf(here.tab.id, here.address, here.tile) : path;
  // A link to a cell that holds code follows that code (its identity) when the cell moves; text typed by hand does not.
  const uid = here?.tab.sheet.dataAt(here.address)?.uid;
  if (uid) {
    a.dataset.uid = uid;
    a.dataset.tile = here!.tile ? `${here!.tile.x},${here!.tile.y}` : '';
    a.dataset.tab = here!.tab.id;
    // The words of the link follow too when they were just the path (or the bare address of it).
    if (label === undefined || label === path) a.dataset.follow = label?.startsWith('/') || label === undefined ? 'path' : 'address';
    links.add(a);
    // The chat is redrawn all the time: links that never made it onto the page, or left it, must not pile up.
    if (links.size > 400) for (const l of links) if (!l.isConnected && l !== a) links.delete(l);
  }
  a.title = `Go to ${a.dataset.path}`;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (!a.classList.contains('cell-link-dead')) nav.goTo(a.dataset.path ?? path);
  });
  return a;
}

/** The links that are on screen and know their cell by identity. Dead ones (their element left the page) are dropped on the next look. */
const links = new Set<HTMLAnchorElement>();

/** Re-reads where every watched link's cell is now: moved cells keep their links working and their words up to date. */
function refreshLinks(): void {
  for (const a of links) {
    if (!a.isConnected) {
      // A link that is not in the page right now (the chat is redrawn all the time) is kept only while its element lives on.
      if (!a.dataset.seen) links.delete(a);
      continue;
    }
    a.dataset.seen = '1';
    const hit = workspace.resolve(`@${a.dataset.uid}`);
    if ('error' in hit) {
      a.classList.add('cell-link-dead');
      a.title = 'This cell is gone (its code was cleared or replaced)';
      continue;
    }
    const tile = a.dataset.tile ? { x: Number(a.dataset.tile.split(',')[0]), y: Number(a.dataset.tile.split(',')[1]) } : null;
    const next = workspace.pathOf(hit.tab.id, hit.address, tile);
    a.classList.remove('cell-link-dead');
    if (next === a.dataset.path) continue;
    a.dataset.path = next;
    a.title = `Go to ${next}`;
    if (a.dataset.follow) a.textContent = a.dataset.follow === 'path' ? next : `${hit.address}${tile ? `/${tile.x},${tile.y}` : ''}`;
    // A short flash, so the person sees that this link just followed its cell.
    a.classList.remove('cell-link-moved');
    void a.offsetWidth;
    a.classList.add('cell-link-moved');
  }
}

workspace.onCellsChanged(refreshLinks);
