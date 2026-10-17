// Records a demo video of the page, the way a person would use it, with subtitles that tell the viewer what is going on.
//
//   npm run dev                      (in another terminal: the page must be served)
//   node scripts/demo-show.mjs       [--base http://127.0.0.1:5178] [--headed] [--no-ai] [--out resources/demo]
//
// It starts your installed Google Chrome (no browser download), opens a fresh profile, shows a red cursor and ripples on every click (a
// screen recording does not show the mouse), and uses the page's own subtitle line (window.subtitle, see src/ui/subtitles.ts).
// Output: <out>/lattakker-demo.webm, and an .mp4 next to it when ffmpeg is installed. The folder is kept out of git.
// --no-ai leaves out the part where the helper asks the local model (Ollama, qwen3.5:4b) and writes code by itself.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && !process.argv[i + 1]?.startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const BASE = arg('base', 'http://127.0.0.1:5178').replace(/\/+$/, '');
const OUT = resolve(arg('out', 'resources/demo'));
const WITH_AI = !flag('no-ai');
const MODEL = arg('model', 'qwen3.5:4b');
const SIZE = { width: 1280, height: 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.webm') && f !== 'lattakker-demo.webm') rmSync(join(OUT, f));

const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed'), args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });

// A red cursor with a ripple on every press, drawn in the page (a recording of the screen would not show the mouse). Set the helper's
// settings before the page starts, so the chat is ready for the local model.
await context.addInitScript(
  ({ model, withAi }) => {
    if (withAi && !localStorage.getItem('lattakker:ai:v1')) {
      localStorage.setItem('lattakker:ai:v1', JSON.stringify({ provider: 'local', local: { baseUrl: 'http://localhost:11434/v1', model, context: 0 }, gemini: { model: 'gemini-flash-latest', adultAck: false }, autonomous: true, allowWrite: false, autoPopup: false, v: 2 }));
    }
    const install = () => {
      if (document.getElementById('demo-cursor')) return;
      const style = document.createElement('style');
      style.textContent = '#demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(230,40,40,.55);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;transition:transform .08s}#demo-cursor.down{transform:scale(.6)}.demo-ripple{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:3px solid rgba(230,40,40,.9);z-index:2147483646;pointer-events:none;animation:demo-r .6s ease-out forwards}@keyframes demo-r{to{transform:scale(5);opacity:0}}';
      document.head.append(style);
      const dot = Object.assign(document.createElement('div'), { id: 'demo-cursor' });
      document.body.append(dot);
      window.addEventListener('mousemove', (e) => (dot.style.left = `${e.clientX}px`) && (dot.style.top = `${e.clientY}px`), true);
      window.addEventListener(
        'mousedown',
        (e) => {
          dot.classList.add('down');
          const ripple = Object.assign(document.createElement('div'), { className: 'demo-ripple' });
          ripple.style.left = `${e.clientX}px`;
          ripple.style.top = `${e.clientY}px`;
          document.body.append(ripple);
          setTimeout(() => ripple.remove(), 700);
        },
        true,
      );
      window.addEventListener('mouseup', () => dot.classList.remove('down'), true);
    };
    if (document.body) install();
    else document.addEventListener('DOMContentLoaded', install);
  },
  { model: MODEL, withAi: WITH_AI },
);

const page = await context.newPage();
const done = [];
const skipped = [];

/** A subtitle, then time to read it. */
async function say(text, seconds = Math.max(3, Math.round(text.length / 14 + 1.5))) {
  await page.evaluate(([t, s]) => window.subtitle?.(t, s), [text, seconds]).catch(() => {});
  await sleep(seconds * 1000);
}

/** Where words are on the screen (an SVG label, a cell's text, a button): the middle of them, scrolled into view first. */
async function whereIs(words, { scroll = true } = {}) {
  return page.evaluate(
    ([w, doScroll]) => {
      const place = (el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!(n.textContent || '').includes(w)) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const r = range.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) return r;
        }
        return null;
      };
      const candidates = [...document.querySelectorAll('svg text, svg foreignObject, button, [role=tab], a, label, summary')].filter((e) => (e.textContent || '').includes(w));
      for (const el of candidates) {
        if (doScroll && el.closest('svg') && !el.closest('.tab-strip')) el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = place(el) ?? el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
      return null;
    },
    [words, scroll],
  );
}

async function glide(x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
  await sleep(150);
}

async function clickWords(words, { double = false, scroll = true } = {}) {
  const at = await whereIs(words, { scroll });
  if (!at) throw new Error(`cannot find "${words}" on the screen`);
  await glide(at.x, at.y);
  await sleep(250);
  if (double) await page.mouse.dblclick(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await sleep(500);
  return at;
}

async function clickAt(x, y, double = false) {
  await glide(x, y);
  await sleep(200);
  if (double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
  await sleep(500);
}

async function typeHuman(text, delay = 55) {
  await page.keyboard.type(text, { delay });
}

/** One part of the show: if it fails, the film goes on, and the end says what was left out. */
async function part(name, fn) {
  try {
    await fn();
    done.push(name);
  } catch (err) {
    skipped.push(`${name}: ${String(err.message ?? err).split('\n')[0]}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

// ------------------------------------------------------------------ the show

await page.goto(`${BASE}/?mcp`);
await sleep(3500);
await part('the start screen', async () => {
  await say('Lattakker: a board game and a spreadsheet of small TypeScript programs, in one web page.', 5);
  await page.mouse.click(640, 360);
  await sleep(1200);
});

await part('the game board', async () => {
  await say('The game board. Red is you, Blue is the computer. Every cell below the board can hold code.', 5);
  const piece = await whereIs('Scout', { scroll: false });
  if (piece) await glide(piece.x, piece.y);
  await sleep(1200);
});

await part('the Lab and the Monitor tabs', async () => {
  await say('Tabs hold more sheets. The Lab is full of live demos...', 3.5);
  await clickWords('Lab');
  await sleep(2500);
  await page.mouse.wheel(0, 500);
  await sleep(1500);
  await say('...and the Monitor draws the page\u2019s own message traffic while it happens.', 4);
  await clickWords('Monitor');
  await sleep(3500);
});

await part('a scratch tab', async () => {
  await say('A scratch tab is the place to try things. Anyone, an AI too, can make one with a single request.', 5);
  await page.evaluate(() => window.mcpRouter.request('you', 'tabs', 'tools/call', { name: 'ensure', arguments: { id: 'scratch', title: 'Scratch', icon: '🧫', select: true } }));
  await sleep(1500);
});

await part('typing code, and the editor finds the mistake', async () => {
  await say('Double-click a cell to write TypeScript in it. Watch the editor.', 4);
  await clickAt(150, 160, true);
  await sleep(1500);
  await typeHuman("span(6, 4)\nconst n: number = 'five'\nprint(n * 2)");
  await sleep(1200);
  await say('The editor underlines the mistake at once: a word where a number is expected.', 5);
  await sleep(1500);
  await page.keyboard.press('Control+A');
  await typeHuman('span(6, 4)\nconst n = 5\nprint(n * 2)');
  await sleep(800);
  await say('Fixed. Esc keeps the code and runs the cell.', 3);
  await page.keyboard.press('Escape');
  await sleep(2500);
  await say('The cell shows what it printed: 10.', 3);
});

await part('mail with a kept draft', async () => {
  await say('The page has its own mail, between the person, the helper, AIs outside the page and cells.', 5);
  await clickWords('✉', { scroll: false });
  await sleep(800);
  await page.click('.mail-new');
  await sleep(500);
  await clickAt(...(await centerOf('.mail-to')));
  await page.keyboard.press('Control+A');
  await typeHuman('outside-ai', 70);
  await clickAt(...(await centerOf('.mail-sub')));
  await typeHuman('Hello from the demo', 50);
  await clickAt(...(await centerOf('.mail-write')));
  await say('What you write is kept in the browser as you type: a reload cannot take it away.', 5);
  await typeHuman('Hello AIs! This letter is for every AI outside the page.', 45);
  await sleep(800);
  await say('Ctrl+Enter sends it.', 2.5);
  await page.keyboard.press('Control+Enter');
  await sleep(1500);
  await page.click('.mail-x');
  await sleep(600);
});

await part('the GUI deep-drill key', async () => {
  await say('Something looks wrong and you cannot put it into words? One key, Ctrl+Alt+Shift+G.', 5);
  await page.keyboard.press('Control+Alt+Shift+G');
  await sleep(800);
  await clickAt(...(await centerOf('.report-words')));
  await typeHuman('Demo: the screen as a text tree, for any AI.', 50);
  await say('It copies the whole screen as text to the clipboard, with your own words on top. Paste it into any AI.', 6);
  await page.keyboard.press('Escape');
  await sleep(500);
});

await part('an outside AI shows a sign of life', async () => {
  await say('An AI outside the page can drive it over MCP. The page shows what it has seen of it: when it last called, and what.', 6);
  const call = async (name, args = {}, id = 1) => {
    const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mcp-client': 'demo-ai', 'x-mcp-model': 'show', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) });
    return res.json();
  };
  let session = null;
  const init = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo-ai', version: '1', model: 'show' } } }) });
  session = init.headers.get('mcp-session-id');
  await call('read_readme', {}, 1);
  await call('introduce', { client: 'demo-ai', model: 'show', note: 'reading the README for the film' }, 2);
  await call('subtitle', { text: 'This subtitle was sent by the outside AI, over MCP.', seconds: 4 }, 3);
  await sleep(4500);
  await say('At the bottom: who, when it last called, what it asked, and the note it gave about itself.', 5);
});

if (WITH_AI) {
  await part('the helper writes code by itself', async () => {
    await clickWords('Lab', { scroll: false });
    await sleep(1200);
    await say('Now the helper. It runs on a model on this computer. Ask it to make something.', 5);
    await page.keyboard.press('Alt+I');
    await sleep(1200);
    await clickAt(...(await centerOf('.ai-side .ai-input')));
    await typeHuman('Write a small program in an empty cell that prints the squares of the numbers 1 to 5. Check it and make sure it works.', 35);
    await sleep(500);
    await say('The helper writes the code where you can watch, the editor checks it, it runs it, and it keeps fixing until it works.', 6);
    await page.keyboard.press('Enter');
    const started = Date.now();
    await sleep(3000);
    while (Date.now() - started < 150_000 && (await page.locator('.ai-status').count())) {
      const line = await page.evaluate(() => document.querySelector('.ai-side .ai-live')?.textContent?.slice(0, 150) ?? '');
      if (line && Date.now() - started < 60_000) await page.evaluate((t) => window.subtitle?.(t, 4), `Status: ${line}`).catch(() => {});
      await sleep(4000);
    }
    await say('Done. The card shows the code, what it printed, and an undo button.', 5);
  });
}

await page.evaluate(() => window.subtitle?.('')).catch(() => {});
await say('That was Lattakker: a game, a spreadsheet, and a place where people and AIs work side by side.', 6);
await sleep(1000);

const video = page.video();
await context.close();
await browser.close();
const raw = video ? await video.path() : null;
if (raw && existsSync(raw)) {
  const webm = join(OUT, 'lattakker-demo.webm');
  renameSync(raw, webm);
  console.log(`video: ${webm}`);
  try {
    const mp4 = join(OUT, 'lattakker-demo.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4]);
    console.log(`video: ${mp4}`);
  } catch {
    console.log('(ffmpeg not found: only the .webm was made)');
  }
}
console.log(`parts shown: ${done.join(' · ') || 'none'}`);
if (skipped.length) console.log(`parts left out:\n  ${skipped.join('\n  ')}`);

async function centerOf(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no ${selector}`);
  return [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
}
