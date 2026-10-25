/**
 * A call to the TypeScript engine has a time to answer. The engine does one thing at a time, so on a page with a hundred cells the calls
 * stand in a queue: a call is not stuck because its own answer takes long, only when the engine has answered nothing at all for
 * `waitMs`. Every answer anywhere restarts the wait of every call that is still waiting. A worker that never started answers nothing,
 * so its calls still run out of time, and the page is told ('lattakker:engine-stuck') and recovers by itself (stallWatch.ts).
 */
let lastAnswer = performance.now();

export function answered<T>(work: Promise<T>, waitMs: number, onStuck: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let timer = 0;
    const check = (): void => {
      const quiet = performance.now() - Math.max(started, lastAnswer);
      if (quiet < waitMs) {
        timer = window.setTimeout(check, waitMs - quiet);
        return;
      }
      onStuck();
      reject(new Error('The TypeScript engine did not answer in time'));
    };
    timer = window.setTimeout(check, waitMs);
    work.then(
      (value) => {
        lastAnswer = performance.now();
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}
