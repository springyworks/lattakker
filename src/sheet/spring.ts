export interface Vec {
  x: number;
  y: number;
}

/**
 * Frame-driven (requestAnimationFrame) spring integrator — distinct from maxGraph's own
 * `Morphing`, which is a fixed linear/eased interpolation between two static points. This one
 * has real velocity, so a moving `setTarget` (cursor-follow) produces physical lag, and `settle`
 * produces a small overshoot/bounce instead of a snap.
 */
export class Spring {
  x: number;
  y: number;
  private vx = 0;
  private vy = 0;
  private target: Vec;
  private raf = 0;
  private onFrame: ((p: Vec) => void) | null = null;
  private onSettled: (() => void) | null = null;

  constructor(
    start: Vec,
    private stiffness = 0.3,
    private damping = 0.72,
  ) {
    this.x = start.x;
    this.y = start.y;
    this.target = { ...start };
  }

  private readonly step = (): void => {
    const ax = (this.target.x - this.x) * this.stiffness;
    const ay = (this.target.y - this.y) * this.stiffness;
    this.vx = (this.vx + ax) * this.damping;
    this.vy = (this.vy + ay) * this.damping;
    this.x += this.vx;
    this.y += this.vy;

    const settled =
      Math.abs(this.vx) < 0.05 &&
      Math.abs(this.vy) < 0.05 &&
      Math.abs(this.target.x - this.x) < 0.3 &&
      Math.abs(this.target.y - this.y) < 0.3;

    if (settled) {
      this.x = this.target.x;
      this.y = this.target.y;
      this.vx = 0;
      this.vy = 0;
    }
    this.onFrame?.({ x: this.x, y: this.y });

    if (settled) {
      this.raf = 0;
      const done = this.onSettled;
      this.onSettled = null;
      done?.();
      return;
    }
    this.raf = requestAnimationFrame(this.step);
  };

  private ensureRunning(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }

  /** Starts the per-frame callback loop (idempotent). */
  start(onFrame: (p: Vec) => void): void {
    this.onFrame = onFrame;
    this.ensureRunning();
  }

  /** Moves the target immediately — used every tick while actively dragging (cursor-follow). */
  setTarget(p: Vec): void {
    this.target = p;
    this.ensureRunning();
  }

  /** Sets a new resting target and resolves once the spring has settled there (bounce included). */
  settle(p: Vec): Promise<void> {
    this.target = p;
    return new Promise((resolve) => {
      this.onSettled = resolve;
      this.ensureRunning();
    });
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onFrame = null;
    this.onSettled = null;
  }
}
