/** Full-width prize reveal banner (Round 2 prize wedges). */

let hideTimer = null;

/** @param {string} [wedgeLabel] @param {"car"|"trip"|"prize"} [kind] */
export function prizeSubtitleForWedge(wedgeLabel, kind) {
  if (kind === "car") return "New Car";
  if (kind === "trip") return "Vacation Trip";
  const label = String(wedgeLabel || "").toUpperCase();
  if (label === "GIFT") return "Gift Card";
  if (label === "SPA") return "Spa Getaway";
  if (label === "TRIP") return "Vacation Trip";
  if (label === "CAR") return "New Car";
  return wedgeLabel || "Bonus Prize";
}

/**
 * @param {HTMLElement} el
 * @param {{ title?: string, subtitle?: string, name: string }} opts
 * @returns {Promise<void>}
 */
export function showPrizeBanner(el, { title = "You Won!", subtitle = "New Car", name }, { displayMs = 5200 } = {}) {
  if (!el) return Promise.resolve();

  const titleEl = el.querySelector(".prize-banner-title");
  const subEl = el.querySelector(".prize-banner-subtitle");
  const nameEl = el.querySelector(".prize-banner-name");
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (nameEl) nameEl.textContent = name;

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
    }, displayMs);
  });
}

export function hidePrizeBanner(el) {
  if (!el) return;
  clearTimeout(hideTimer);
  el.classList.remove("is-visible");
  el.classList.add("is-hidden");
}
