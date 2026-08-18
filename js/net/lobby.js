import { WofClient } from "./client.js?v=1";
import { getWsUrl, setWsUrl, pageUrl, buildJoinUrl, wsToHttpUrl } from "./config.js?v=3";
import { renderJoinQr } from "../room-qr.js?v=1";
import { stampVersion } from "../version.js?v=1";

const $ = (id) => document.getElementById(id);

const ROUND_LABELS = {
  tossup: "Toss-Up",
  round1: "Round 1",
  round2: "Round 2",
  final: "Final Round",
};

const els = {
  wsUrl: $("ws-url"),
  btnConnect: $("btn-connect"),
  connStatus: $("conn-status"),
  createPanel: $("create-panel"),
  btnCreate: $("btn-create"),
  roomPanel: $("room-panel"),
  roomCode: $("room-code"),
  joinLinkHint: $("join-link-hint"),
  joinQrCanvas: $("join-qr-canvas"),
  joinQrRoom: $("join-qr-room"),
  joinQrBlock: $("join-qr-block"),
  playerList: $("player-list"),
  btnOpenHost: $("btn-open-host"),
  btnStart: $("btn-start"),
  roomStatus: $("room-status"),
  watchPanel: $("watch-panel"),
  watchList: $("watch-list"),
  watchStatus: $("watch-status"),
  btnRefreshWatch: $("btn-refresh-watch"),
};

let client = null;
let roomCode = "";
let watchPollTimer = null;

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function renderPlayers(players = []) {
  els.playerList.innerHTML = "";
  for (const seat of ["p1", "p2", "p3"]) {
    const li = document.createElement("li");
    const found = players.find((p) => p.seat === seat);
    if (found) {
      li.textContent = `${found.name || seat.toUpperCase()} (${seat.toUpperCase()})`;
    } else {
      li.textContent = `${seat.toUpperCase()} — waiting…`;
      li.classList.add("is-empty");
    }
    els.playerList.appendChild(li);
  }
  els.btnStart.disabled = players.length < 1;
}

function describeRoom(room) {
  const parts = [];
  if (room.gameStarted && room.roundType) {
    parts.push(ROUND_LABELS[room.roundType] || room.roundType);
  } else if (room.hostConnected) {
    parts.push("TV connected");
  } else {
    parts.push("Waiting to start");
  }
  if (room.category) parts.push(room.category);
  const names = (room.players || []).map((p) => p.name || p.seat).join(", ");
  if (names) parts.push(names);
  return parts.join(" · ");
}

function renderWatchList(rooms = []) {
  if (!els.watchList) return;
  els.watchList.innerHTML = "";

  if (!rooms.length) {
    const li = document.createElement("li");
    li.className = "watch-empty";
    li.textContent = "No active games right now.";
    els.watchList.appendChild(li);
    return;
  }

  for (const room of rooms) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "watch-game-btn";
    btn.innerHTML = `
      <span class="watch-game-code">${room.code}</span>
      <span class="watch-game-meta">${describeRoom(room)}</span>
      <span class="watch-game-players">${room.playerCount} player${room.playerCount === 1 ? "" : "s"}</span>
    `;
    btn.addEventListener("click", () => openSpectatorBoard(room.code));
    li.appendChild(btn);
    els.watchList.appendChild(li);
  }
}

function openSpectatorBoard(code) {
  const ws = els.wsUrl.value.trim();
  if (!code || !ws) return;
  const url = pageUrl("host.html", { room: code, ws, spectate: true });
  window.open(url, `wof-watch-${code}`, "noopener");
}

async function fetchOngoingGames() {
  const ws = els.wsUrl.value.trim();
  if (!ws) return [];
  try {
    const res = await fetch(`${wsToHttpUrl(ws)}/rooms`);
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    return data.rooms || [];
  } catch {
    return null;
  }
}

async function refreshWatchList() {
  if (!els.watchPanel || els.watchPanel.hidden) return;
  setStatus(els.watchStatus, "Loading games…");
  const rooms = await fetchOngoingGames();
  if (rooms === null) {
    setStatus(els.watchStatus, "Could not load game list.", "err");
    renderWatchList([]);
    return;
  }
  renderWatchList(rooms);
  setStatus(
    els.watchStatus,
    rooms.length
      ? `${rooms.length} game${rooms.length === 1 ? "" : "s"} — click to watch the big board.`
      : "No active games — create one above or check back soon.",
    "ok",
  );
}

function startWatchPolling() {
  stopWatchPolling();
  if (els.watchPanel) els.watchPanel.hidden = false;
  refreshWatchList();
  watchPollTimer = window.setInterval(refreshWatchList, 8000);
}

function stopWatchPolling() {
  if (watchPollTimer) {
    window.clearInterval(watchPollTimer);
    watchPollTimer = null;
  }
}

async function showRoomJoinQr(code) {
  if (!code) return;
  const ws = els.wsUrl.value.trim();
  const url = await buildJoinUrl(code, ws);
  if (els.joinQrRoom) els.joinQrRoom.textContent = code;
  if (els.joinQrCanvas) {
    await renderJoinQr(els.joinQrCanvas, url, { size: 200 });
  }
  if (els.joinQrBlock) els.joinQrBlock.hidden = false;
  if (els.joinLinkHint) {
    els.joinLinkHint.textContent = url.length > 72 ? `${url.slice(0, 68)}…` : url;
    els.joinLinkHint.title = url;
  }
}

function onMessage(msg) {
  switch (msg.op) {
    case "hello":
      stampVersion("#app-version", msg.version);
      break;
    case "roomCreated":
      roomCode = msg.code;
      els.roomCode.textContent = roomCode;
      els.roomPanel.hidden = false;
      showRoomJoinQr(roomCode).catch(() => {});
      setStatus(els.roomStatus, "Scan the QR code or share the link — then open the TV display.", "ok");
      renderPlayers(msg.players || []);
      refreshWatchList();
      break;
    case "lobbyUpdate":
      renderPlayers(msg.players || []);
      setStatus(els.roomStatus, msg.message || "Waiting for players…", "ok");
      break;
    case "playerJoined":
      renderPlayers(msg.players || []);
      setStatus(els.roomStatus, `${msg.name || msg.seat} joined.`, "ok");
      refreshWatchList();
      break;
    case "gameStarted":
      setStatus(els.roomStatus, "Game started on the TV display.", "ok");
      refreshWatchList();
      break;
    case "error":
      setStatus(els.roomStatus, msg.message || msg.error || "Something went wrong.", "err");
      break;
    default:
      break;
  }
}

async function connect() {
  const url = els.wsUrl.value.trim();
  if (!url) {
    setStatus(els.connStatus, "Enter a WebSocket URL first.", "err");
    return;
  }
  setWsUrl(url);
  setStatus(els.connStatus, "Connecting…");
  els.btnConnect.disabled = true;

  client = new WofClient({ onMessage, onClose: () => setStatus(els.connStatus, "Disconnected.", "err") });
  try {
    await client.connect(url);
    setStatus(els.connStatus, "Connected.", "ok");
    els.createPanel.hidden = false;
    startWatchPolling();
  } catch {
    setStatus(els.connStatus, "Could not connect. Is the server running?", "err");
  } finally {
    els.btnConnect.disabled = false;
  }
}

els.btnConnect.addEventListener("click", connect);

els.btnCreate.addEventListener("click", () => {
  if (!client?.connected) return;
  client.createRoom();
  setStatus(els.roomStatus, "Creating room…");
});

els.btnOpenHost.addEventListener("click", () => {
  if (!roomCode) return;
  const url = pageUrl("host.html", { room: roomCode, ws: els.wsUrl.value.trim() });
  window.open(url, "wof-host", "noopener");
});

els.btnStart.addEventListener("click", () => {
  if (!client?.connected || !roomCode) return;
  client.startGame();
});

els.btnRefreshWatch?.addEventListener("click", () => {
  refreshWatchList();
});

els.wsUrl.value = getWsUrl();
if (els.wsUrl.value) {
  connect().catch(() => {});
}

renderPlayers([]);
stampVersion();
