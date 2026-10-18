/**
 * A tiny, safe renderer for what the helper writes: paragraphs, bullet lists, **bold**, `code` and fenced code
 * blocks. It builds DOM nodes with textContent only, so nothing the model says can ever become markup.
 */

import { CELL_PATH, cellLink } from '../nav';
import { workspace } from '../workspace';
import { resolveSmart } from './cellPaths';
import { focusLink } from '../editor/focusPoints';
import { formatFocusRef, parseFocusRef } from '../focusRef';

/**
 * Cell names written in plain text become links. A full path (/lab/A16) always does when the cell exists. A bare
 * name (A16) does when it points at a cell that holds code, in the tab on screen or, if that one is empty, the
 * one other tab that has code there; so "A1" or "I5" in ordinary words are left alone.
 */
const MENTION = /(\/[a-z][a-z0-9-]*\/[A-Za-z]\d{1,3}(?:\/\d+,\d+|#L\d{1,5}(?:C\d{1,4})?(?:-L?\d{1,5}(?:C\d{1,4})?)?)?|(?<![\w/@-])[A-Z]\d{1,3}(?:\/\d+,\d+|#L\d{1,5}(?:C\d{1,4})?(?:-L?\d{1,5}(?:C\d{1,4})?)?)?)(?![\w/])/g;

/** A reference to lines of a cell (/lab/J24#L3-5) as a link that shows them, or null when the text is not one or the cell has no code. */
function focusLinkFor(text: string): HTMLAnchorElement | null {
  const ref = parseFocusRef(text);
  if (!ref) return null;
  const hit = resolveSmart(ref.path, workspace.current);
  if ('error' in hit || !hit.tab.sheet.dataAt(hit.address)?.code.trim()) return null;
  return focusLink(formatFocusRef(workspace.pathOf(hit.tab.id, hit.address), ref), text);
}

export function linkify(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const name = m[1];
    if (name.includes('#')) {
      const link = focusLinkFor(name);
      if (link) {
        parent.appendChild(document.createTextNode(text.slice(last, m.index)));
        parent.appendChild(link);
        last = m.index! + name.length;
      }
      continue;
    }
    const hit = resolveSmart(name, workspace.current);
    const target = 'error' in hit ? null : hit;
    const wanted = target && (name.startsWith('/') || target.tab.sheet.dataAt(target.address)?.code.trim());
    if (!target || !wanted) continue;
    parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    parent.appendChild(cellLink(workspace.pathOf(target.tab.id, target.address, target.tile), name));
    last = m.index! + name.length;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}

function inline(parent: HTMLElement, text: string): void {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      const text = part.slice(1, -1);
      const code = document.createElement('code');
      // A cell path that really exists becomes a link that flies to the cell.
      const place = text.includes('#') ? focusLinkFor(text) : null;
      const hit = !place && CELL_PATH.test(text) ? workspace.resolve(text, workspace.current) : null;
      // The link keeps the full path, so it still leads to the same cell after the person has moved to another tab.
      if (place) code.append(place);
      else if (hit && !('error' in hit)) code.append(cellLink(workspace.pathOf(hit.tab.id, hit.address, hit.tile), text));
      else code.textContent = text;
      parent.appendChild(code);
    } else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      const b = document.createElement('strong');
      linkify(b, part.slice(2, -2));
      parent.appendChild(b);
    } else {
      linkify(parent, part);
    }
  }
}

export function renderMarkdown(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: HTMLElement | null = null;

  const flush = () => {
    if (paragraph.length) {
      const p = document.createElement('p');
      inline(p, paragraph.join(' '));
      out.appendChild(p);
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flush();
      list = null;
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = body.join('\n');
      pre.appendChild(code);
      out.appendChild(pre);
      continue;
    }
    const item = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      if (!list) {
        list = document.createElement('ul');
        out.appendChild(list);
      }
      const li = document.createElement('li');
      inline(li, item[1]);
      list.appendChild(li);
      continue;
    }
    list = null;
    if (!line.trim()) flush();
    else paragraph.push(line.trim());
  }
  flush();
  return out;
}
