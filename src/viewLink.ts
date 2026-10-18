import { aiBridge } from './aichat/bridge';
import { nav } from './nav';
import { workspace } from './workspace';
import { focusPoints } from './editor/focusPoints';
import { asksForMore, type ViewLink } from './deeplink';

/**
 * The page's side of the link to a view (see deeplink.ts for the link itself): what is in front of you, written as a ViewLink, and a
 * ViewLink put back on the screen when the page has started.
 */

/** The tab, the place, the pointed-at cell, the mode and the open AI chat, as they are right now. */
export function currentViewLink(): ViewLink {
  const tab = workspace.current;
  const sheet = workspace.get(tab)?.sheet;
  const link: ViewLink = { tab };
  if (sheet) {
    const v = sheet.viewState();
    link.view = { scale: v.scale, x: v.left / v.scale, y: v.top / v.scale };
    if (sheet.mode === 'view') link.mode = 'view';
  }
  const focus = workspace.focus;
  if (focus && focus.tab === tab) {
    link.cell = `/${focus.tab}/${focus.address}`;
    // A place the person marked with 📌 in that cell travels with the link.
    const marked = focusPoints.list({ path: link.cell, by: 'person' }).find((p) => p.state !== 'gone');
    if (marked) link.lines = { from: marked.startLine, to: marked.endLine };
  }
  if (aiBridge.sideOpen) link.ai = true;
  return link;
}

/** Whether a link asked for more than the tab: then the splash that zooms in on the game's flag is not wanted. */
export const wantsTheView = asksForMore;

/**
 * Puts the link on the screen. The tab itself is already chosen (by the address, as always). `showMode` switches code and output the way the page's
 * own button does. Returns what it could not do (a cell that does not exist), so the page can say so.
 */
export function applyViewLink(link: ViewLink, env: { showMode(mode: 'run' | 'view'): void }): string[] {
  const missed: string[] = [];
  const tab = workspace.get(link.tab);
  if (link.ai) aiBridge.openSide();
  if (link.mode === 'view') env.showMode('view');
  if (tab && link.view) tab.sheet.jumpTo({ scale: link.view.scale, left: link.view.x * link.view.scale, top: link.view.y * link.view.scale });
  if (link.cell) {
    const hit = workspace.resolve(link.cell);
    if ('error' in hit) missed.push(`the cell ${link.cell} is not on this page`);
    else {
      workspace.setFocus(hit.tab.id, hit.address);
      // With a place given the view stays where it was asked; without one it flies to the cell.
      if (link.view) hit.tab.sheet.flash(hit.address, undefined, 900);
      else nav.goTo(link.cell);
      if (link.lines) {
        const { from, to } = link.lines;
        focusPoints.reveal(`${link.cell}#L${from}${to > from ? `-${to}` : ''}`);
      }
    }
  }
  return missed;
}
