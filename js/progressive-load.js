/** Fire-and-forget background loaders — never block the game shell. */

/**
 * @param {Array<() => Promise<unknown> | unknown>} tasks
 */
export function runInBackground(...tasks) {
  for (const task of tasks) {
    Promise.resolve()
      .then(task)
      .catch((err) => console.warn("Background load:", err));
  }
}

/**
 * @param {Array<() => Promise<unknown> | unknown>} tasks
 * @returns {Promise<void>}
 */
export async function runWhenIdle(...tasks) {
  await new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 1200 });
    } else {
      setTimeout(resolve, 60);
    }
  });
  for (const task of tasks) {
    try {
      await task();
    } catch (err) {
      console.warn("Idle load:", err);
    }
  }
}
