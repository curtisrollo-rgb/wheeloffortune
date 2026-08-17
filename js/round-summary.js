/** Round-end summary overlay on the TV display. */

let hideTimer = null;

/**
 * @param {HTMLElement} el
 * @param {{
 *   roundLabel?: string,
 *   title?: string,
 *   winnerName?: string,
 *   amount?: number,
 *   detail?: string,
 * }} opts
 * @returns {Promise<void>}
 */
export function showRoundSummary(el, {
  roundLabel = "Round",
  title = "Puzzle Complete",
  winnerName = "",
  amount = 0,
  detail = "",
} = {}) {
  if (!el) return Promise.resolve();

  const roundEl = el.querySelector(".round-summary-round");
  const titleEl = el.querySelector(".round-summary-title");
  const winnerEl = el.querySelector(".round-summary-winner");
  const amountEl = el.querySelector(".round-summary-amount");
  const detailEl = el.querySelector(".round-summary-detail");

  if (roundEl) roundEl.textContent = roundLabel;
  if (titleEl) titleEl.textContent = title;
  if (winnerEl) winnerEl.textContent = winnerName || "No winner";
  if (amountEl) {
    amountEl.textContent = amount > 0 ? `$${amount.toLocaleString()}` : "";
    amountEl.classList.toggle("is-hidden", amount <= 0);
  }
  if (detailEl) {
    detailEl.textContent = detail;
    detailEl.classList.toggle("is-hidden", !detail);
  }

  clearTimeout(hideTimer);
  el.classList.remove("is-hidden");
  el.classList.remove("is-visible");
  void el.offsetWidth;
  el.classList.add("is-visible");

  return new Promise((resolve) => {
    hideTimer = window.setTimeout(() => {
      el.classList.remove("is-visible");
      hideTimer = window.setTimeout(() => {
        el.classList.add("is-hidden");
        resolve();
      }, 450);
    }, 4800);
  });
}

export function hideRoundSummary(el) {
  if (!el) return;
  clearTimeout(hideTimer);
  el.classList.remove("is-visible");
  el.classList.add("is-hidden");
}
