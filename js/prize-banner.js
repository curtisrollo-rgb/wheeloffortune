/** Full-width prize reveal banner (CAR wedge). */

let hideTimer = null;

/**
 * @param {HTMLElement} el
 * @param {{ title?: string, subtitle?: string, name: string }} opts
 * @returns {Promise<void>}
 */
export function showPrizeBanner(el, { title = "You Won!", subtitle = "New Car", name }) {
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
    }, 5200);
  });
}

export function hidePrizeBanner(el) {
  if (!el) return;
  clearTimeout(hideTimer);
  el.classList.remove("is-visible");
  el.classList.add("is-hidden");
}
