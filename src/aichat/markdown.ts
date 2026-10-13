/**
 * A tiny, safe renderer for what the helper writes: paragraphs, bullet lists, **bold**, `code` and fenced code
 * blocks. It builds DOM nodes with textContent only, so nothing the model says can ever become markup.
 */

import { CELL_PATH, cellLink } from '../nav';
import { workspace } from '../workspace';

function inline(parent: HTMLElement, text: string): void {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      const text = part.slice(1, -1);
      const code = document.createElement('code');
      // A cell path that really exists becomes a link that flies to the cell.
      const hit = CELL_PATH.test(text) ? workspace.resolve(text, workspace.current) : null;
      // The link keeps the full path, so it still leads to the same cell after the person has moved to another tab.
      if (hit && !('error' in hit)) code.append(cellLink(workspace.pathOf(hit.tab.id, hit.address, hit.tile), text));
      else code.textContent = text;
      parent.appendChild(code);
    } else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      parent.appendChild(b);
    } else {
      parent.appendChild(document.createTextNode(part));
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
