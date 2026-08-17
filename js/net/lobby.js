import { WofClient } from "./client.js?v=1";
import { getWsUrl, setWsUrl, pageUrl, shareJoinUrl } from "./config.js?v=1";

const $ = (id) => document.getElementById(id);

const els = {
  wsUrl: $("ws-url"),
  btnConnect: $("btn-connect"),
  connStatus: $("conn-status"),
  createPanel: $("create-panel"),
  btnCreate: $("btn-create"),
  roomPanel: $("room-panel"),
  roomCode: $("room-code"),
  joinLinkHint: $("join-link-hint"),
  playerList: $("player-list"),
  btnOpenHost: $("btn-open-host"),
  btnStart: $("btn-start"),
  roomStatus: $("room-status"),
};

let client = null;
let roomCode = "";

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

function onMessage(msg) {
  switch (msg.op) {
    case "roomCreated":
      roomCode = msg.code;
      els.roomCode.textContent = roomCode;
      els.roomPanel.hidden = false;
      els.joinLinkHint.textContent = `Players join at: ${shareJoinUrl(roomCode, els.wsUrl.value.trim())}`;
      setStatus(els.roomStatus, "Open the TV display, then share the join link with players.", "ok");
      renderPlayers(msg.players || []);
      break;
    case "lobbyUpdate":
      renderPlayers(msg.players || []);
      setStatus(els.roomStatus, msg.message || "Waiting for players…", "ok");
      break;
    case "gameStarted":
      setStatus(els.roomStatus, "Game started on the TV display.", "ok");
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

els.wsUrl.value = getWsUrl();
if (els.wsUrl.value) {
  connect().catch(() => {});
}

renderPlayers([]);
