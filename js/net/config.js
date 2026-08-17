/** WebSocket + room URL helpers for WoF online play. */

const WS_STORAGE_KEY = "wof-ws-url";

/** Base path for multiplayer HTML pages (e.g. /multiplayer/). */
export function multiplayerBase() {
  return new URL("../multiplayer/", location.href);
}

export function getWsUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("ws");
  if (fromQuery) {
    localStorage.setItem(WS_STORAGE_KEY, fromQuery);
    return fromQuery;
  }
  const saved = localStorage.getItem(WS_STORAGE_KEY);
  if (saved) return saved;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return "ws://localhost:8080";
  }
  return "";
}

export function setWsUrl(url) {
  localStorage.setItem(WS_STORAGE_KEY, url.trim());
}

export function getRoomFromUrl() {
  return new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
}

export function getSeatFromUrl() {
  const seat = new URLSearchParams(location.search).get("seat")?.toLowerCase();
  return seat === "p1" || seat === "p2" || seat === "p3" ? seat : null;
}

export function getNameFromUrl() {
  return new URLSearchParams(location.search).get("name") ?? "";
}

/** Build a URL under multiplayer/ (host.html, join.html, etc.). */
export function pageUrl(page, { room, seat, name, ws } = {}) {
  const u = new URL(page, multiplayerBase());
  if (room) u.searchParams.set("room", room.toUpperCase());
  if (seat) u.searchParams.set("seat", seat);
  if (name) u.searchParams.set("name", name);
  if (ws) u.searchParams.set("ws", ws);
  return u.pathname + u.search;
}

export function shareJoinUrl(room, ws) {
  const origin = location.origin;
  const path = pageUrl("join.html", { room, ws });
  return `${origin}${path}`;
}

/** App root URL (handles /multiplayer/ pages in subdirectories). */
export function appBase() {
  if (location.pathname.includes("/multiplayer/")) {
    return new URL("../", location.href);
  }
  return new URL("./", location.href);
}

/** Resolve repo-root data/ paths. */
export function dataUrl(filename) {
  return new URL(`data/${filename}`, appBase()).href;
}

/** Resolve repo-root assets/ paths. */
export function assetUrl(relativePath) {
  return new URL(relativePath.replace(/^\//, ""), appBase()).href;
}

export function isOnlinePage() {
  return location.pathname.includes("/multiplayer/");
}
