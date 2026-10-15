/**
 * The page heals itself when the code engine (Monaco's TypeScript worker) does not start, for example because the page was loaded
 * while the dev server was busy or restarting. Two things can show it here, and each one starts the same recovery:
 *
 *  - the engine says its worker did not answer ('lattakker:engine-stuck', see editor/monaco.ts);
 *  - the page started but tabs with code have no finished run after a while (watchCells, called from main.ts).
 *
 * The recovery reloads the page (saved work stays), but only when the dev server answers again, and at most MAX_RELOADS times in ten
 * minutes, so a server that stays down does not make a loop. After that it says so, and keeps watching.
 *
 * A third case cannot be handled in a module: when a file of the page itself fails to load (the engine's worker is imported
 * statically), not one module runs. That is why index.html has a small plain script that does the same when window.sheet never appears.
 */

const MAX_RELOADS = 5;
const WINDOW_MS = 600000;
const KEY = 'lattakker:stall-reloads';

let say: (text: string, tone: 'info' | 'bad') => void = (text) => banner(text);
let recovering = false;
let bannerEl: HTMLDivElement | null = null;

/** A plain note at the top of the page: there when the HUD is not (the page did not start). */
function banner(text: string): void {
  if (!document.body) return;
  bannerEl ??= document.createElement('div');
  bannerEl.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99999;max-width:80vw;padding:8px 14px;border-radius:8px;background:#7a2e2a;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)';
  bannerEl.textContent = text;
  if (!bannerEl.isConnected) document.body.append(bannerEl);
}

async function serverAnswers(): Promise<boolean> {
  try {
    const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function recover(why: string): Promise<void> {
  if (recovering) return;
  recovering = true;
  console.error(`Lattakker: ${why}`);
  let recent: number[] = [];
  try {
    recent = (JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as number[]).filter((t) => Date.now() - t < WINDOW_MS);
  } catch {
    recent = [];
  }
  if (recent.length >= MAX_RELOADS) {
    say('⚠ The cells did not start running and the page already reloaded itself several times. Press the orange ⟳ Reload button (or F5) when the dev server is calm. Your cells stay saved.', 'bad');
    window.setTimeout(() => (recovering = false), 60000);
    return;
  }
  say('The code engine did not start (the dev server was probably busy). Reloading by itself in a moment…', 'info');
  // Reloading into a server that is not there is worse than waiting: wait until it answers (at most a minute).
  for (let i = 0; i < 20 && !(await serverAnswers()); i++) await new Promise((r) => window.setTimeout(r, 3000));
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...recent, Date.now()]));
  } catch {
    // Without sessionStorage the reload still happens, it just cannot be counted.
  }
  location.reload();
}

window.addEventListener('lattakker:engine-stuck', () => void recover('the TypeScript engine did not answer'));

/** Called by the page when it is up: how to say things to the person, and how to tell which tabs have code but no finished run. */
export function watchCells(env: { stalled(): string[]; say(text: string, tone: 'info' | 'bad'): void }): void {
  say = env.say;
  window.setTimeout(function check() {
    if (document.visibilityState === 'visible') {
      const stuck = env.stalled();
      if (stuck.length) void recover(`cells are loaded but none has finished running in ${stuck.join(', ')}`);
    }
    window.setTimeout(check, 15000);
  }, 12000);
}
