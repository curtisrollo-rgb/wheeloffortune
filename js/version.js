/** Client build version — keep in sync with server/package.json. */
export const APP_VERSION = "0.2.25";

/** @param {string} [selector] @param {string} [serverVersion] */
export function stampVersion(selector = "#app-version", serverVersion = "") {
  const el = document.querySelector(selector);
  if (!el) return;
  const server = serverVersion ? ` · Server v${serverVersion}` : "";
  el.textContent = `Client v${APP_VERSION}${server}`;
}
