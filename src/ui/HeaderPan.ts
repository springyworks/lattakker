import type { Sheet } from '../sheet/Sheet';

/** How far the pointer must travel before a press on a header becomes a pull (less than that is still a click). */
const PULL_PX = 5;
/** Per 16 ms, how much of its speed the sheet keeps after a let-go. */
const KEEP = 0.93;
const STOP_SPEED = 0.03;

/**
 * The borders with the column letters and row numbers (A1, B7 ...) are a handle on the whole sheet: press one with the left
 * mouse button and pull, and the sheet follows the pointer in both directions, wherever on the screen the pointer goes
 * (the headers stay at the edges and tell where you are). Let go while moving and it glides on a little. A press without a
 * pull is the click it always was (flash the column, jump home ...).
 */
export function installHeaderPan(sheet: Sheet): void {
  const c = sheet.container;
  let press: { id: number; x: number; y: number; left: number; top: number } | null = null;
  let pulling = false;
  let glide = 0;
  // Where the sheet actually was (not the pointer: at an edge of the sheet the pointer can go on while the sheet cannot).
  const trail: Array<{ t: number; x: number; y: number }> = [];

  const hitHeader = (e: PointerEvent): boolean => {
    const rect = c.getBoundingClientRect();
    const cell = sheet.graph.getCellAt(e.clientX - rect.left + c.scrollLeft, e.clientY - rect.top + c.scrollTop);
    return (cell?.getId() ?? '').startsWith('hdr:');
  };

  const stopGlide = (): void => {
    if (glide) cancelAnimationFrame(glide);
    glide = 0;
  };

  const finish = (): void => {
    press = null;
    pulling = false;
    document.body.classList.remove('hdr-pull');
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
  };

  const onMove = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!pulling) {
      if (Math.hypot(dx, dy) < PULL_PX) return;
      pulling = true;
      document.body.classList.add('hdr-pull');
      // A flight that is still running (a zoom, a "go to") gives way to the hand.
      sheet.jumpTo(sheet.viewState());
    }
    e.preventDefault();
    c.scrollLeft = press.left - dx;
    c.scrollTop = press.top - dy;
    const now = performance.now();
    trail.push({ t: now, x: c.scrollLeft, y: c.scrollTop });
    while (trail.length > 2 && now - trail[0].t > 90) trail.shift();
  };

  const onUp = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    const wasPulling = pulling;
    const first = trail[0];
    const last = trail[trail.length - 1];
    finish();
    if (!wasPulling) return;
    // Swallow the click that ends a pull: it was not a click on a header.
    const eat = (ev: Event): void => ev.stopPropagation();
    window.addEventListener('click', eat, true);
    window.setTimeout(() => window.removeEventListener('click', eat, true), 60);
    if (!first || !last || last.t - first.t < 16 || performance.now() - last.t > 80) return;
    let vx = (last.x - first.x) / (last.t - first.t);
    let vy = (last.y - first.y) / (last.t - first.t);
    let before = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(48, now - before);
      before = now;
      const k = Math.pow(KEEP, dt / 16);
      vx *= k;
      vy *= k;
      const x = c.scrollLeft;
      const y = c.scrollTop;
      c.scrollLeft = x + vx * dt;
      c.scrollTop = y + vy * dt;
      // Stopped by an edge of the sheet, or out of speed.
      const moved = Math.hypot(c.scrollLeft - x, c.scrollTop - y);
      glide = Math.hypot(vx, vy) > STOP_SPEED && moved > 0.1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  };

  c.addEventListener(
    'pointerdown',
    (e) => {
      stopGlide();
      if (e.button !== 0 || e.pointerType !== 'mouse' || press || !hitHeader(e)) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, left: c.scrollLeft, top: c.scrollTop };
      trail.length = 0;
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    },
    true,
  );
  c.addEventListener('wheel', stopGlide, { passive: true });
}
