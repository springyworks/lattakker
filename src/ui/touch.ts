import type { Sheet } from '../sheet/Sheet';

/**
 * Small screens: the browser pans natively with one or two fingers (touch-action: pan-x pan-y),
 * and this adds the missing pinch-to-zoom, anchored on the point between the two fingers.
 */
export function installPinchZoom(sheet: Sheet): void {
  const el = sheet.container;
  el.style.touchAction = 'pan-x pan-y';
  let lastDistance = 0;

  const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) lastDistance = distance(e.touches);
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 2 || !lastDistance) return;
      const d = distance(e.touches);
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      sheet.zoomAround(d / lastDistance, mx, my);
      lastDistance = d;
    },
    { passive: true },
  );
  // Trackpad pinch and Ctrl + mouse wheel arrive as wheel events with ctrlKey set.
  el.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      sheet.zoomAround(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    },
    { passive: false },
  );
  el.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) lastDistance = 0;
  });
}

/** Scale that makes the 10-column board exactly fit the width of a narrow screen. */
export function fitBoardToWidth(sheet: Sheet, boardWidth: number): void {
  const width = sheet.container.clientWidth;
  if (width >= boardWidth + 40) return;
  sheet.zoomBy(Math.max(0.4, width / boardWidth) / sheet.graph.getView().getScale());
}

const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 12;
const DOUBLE_GAP_MS = 400;
const DOUBLE_GAP_PX = 44;

/**
 * "Double-tap, then hold" (tap, tap-and-keep-the-finger-down) arms a grab: the finger now carries the
 * thing under it instead of scrolling the sheet. Holding Ctrl (Cmd) does the same with a mouse.
 * A plain double-tap that is released at once still just means "edit this cell".
 */
export function installGrabGesture(sheet: Sheet): void {
  const el = sheet.container;
  let armedPointer: number | null = null;
  let down: { id: number; t: number; x: number; y: number } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;

  sheet.grabArmed = () => armedPointer !== null;

  const setArmed = (id: number | null) => {
    armedPointer = id;
    document.body.classList.toggle('grab-armed', id !== null);
  };

  el.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      const now = performance.now();
      down = { id: e.pointerId, t: now, x: e.clientX, y: e.clientY };
      if (lastTap && now - lastTap.t < DOUBLE_GAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_GAP_PX) {
        setArmed(e.pointerId);
        lastTap = null;
        navigator.vibrate?.(15);
      }
    },
    true,
  );
  const release = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (armedPointer === e.pointerId) {
      setArmed(null);
      down = null;
      return;
    }
    if (down && down.id === e.pointerId) {
      const quick = performance.now() - down.t < TAP_MAX_MS;
      const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_MAX_MOVE;
      lastTap = quick && still && e.type === 'pointerup' ? { t: performance.now(), x: e.clientX, y: e.clientY } : null;
      down = null;
    }
  };
  el.addEventListener('pointerup', release, true);
  el.addEventListener('pointercancel', release, true);

  // Stops the browser from starting to scroll for the held finger; pointer events keep coming.
  el.addEventListener(
    'touchstart',
    (e) => {
      if (armedPointer !== null && e.cancelable) e.preventDefault();
    },
    { passive: false, capture: true },
  );

  const syncCtrl = (e: KeyboardEvent) => document.body.classList.toggle('grab-ctrl', e.ctrlKey || e.metaKey);
  window.addEventListener('keydown', syncCtrl);
  window.addEventListener('keyup', syncCtrl);
  window.addEventListener('blur', () => document.body.classList.remove('grab-ctrl'));
}
