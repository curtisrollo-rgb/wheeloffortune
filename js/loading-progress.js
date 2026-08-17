/** Full-screen loading overlay with labeled progress bar. */

/**
 * @param {HTMLElement} root
 */
export function createLoadingProgress(root) {
  const labelEl = root.querySelector("#loading-label");
  const barEl = root.querySelector("#loading-bar");
  const pctEl = root.querySelector("#loading-percent");

  let total = 1;
  let done = 0;

  function render(label, pct) {
    if (labelEl && label) labelEl.textContent = label;
    if (barEl) barEl.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    root.setAttribute("aria-valuenow", String(pct));
  }

  return {
    setTotal(n) {
      total = Math.max(1, n);
    },
    /** @param {string} label */
    update(label) {
      const pct = Math.min(99, Math.round((done / total) * 100));
      render(label, pct);
    },
    /** @param {string} [label] */
    step(label) {
      done = Math.min(total, done + 1);
      const pct = Math.min(100, Math.round((done / total) * 100));
      render(label || (labelEl?.textContent ?? "Loading…"), pct);
    },
    finish(label = "Ready!") {
      done = total;
      render(label, 100);
    },
    hide() {
      root.classList.add("is-hidden");
      document.body.classList.remove("is-loading");
    },
    show() {
      root.classList.remove("is-hidden");
      document.body.classList.add("is-loading");
    },
  };
}

/** Run tasks in parallel; advance the bar as each finishes. */
export async function runLoadingTasks(loading, tasks) {
  loading.setTotal(tasks.length);
  loading.show();
  loading.update(tasks[0]?.[0] ?? "Loading…");

  let finished = 0;
  await Promise.all(
    tasks.map(async ([label, task]) => {
      try {
        await task;
      } finally {
        finished += 1;
        loading.step(label);
      }
    }),
  );
  loading.finish("Ready!");
  await new Promise((r) => setTimeout(r, 180));
  loading.hide();
}
