import { WofClient } from "./client.js?v=1";
import { getWsUrl, setWsUrl, getRoomFromUrl, pageUrl } from "./config.js?v=1";
import { stampVersion } from "../version.js?v=1";

const $ = (id) => document.getElementById(id);

const els = {
  wsUrl: $("ws-url"),
  btnConnect: $("btn-connect"),
  connStatus: $("conn-status"),
  joinPanel: $("join-panel"),
  roomCode: $("room-code"),
  playerName: $("player-name"),
  btnJoin: $("btn-join"),
  joinStatus: $("join-status"),
  waitingPanel: $("waiting-panel"),
  activeRoomCode: $("active-room-code"),
  waitingStatus: $("waiting-status"),
  btnOpenController: $("btn-open-controller"),
};

let client = null;
let joined = { room: "", seat: "", name: "" };

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function updateJoinButton() {
  const code = els.roomCode.value.trim();
  const name = els.playerName.value.trim();
  els.btnJoin.disabled = !client?.connected || code.length < 4 || name.length < 1;
}

function openController() {
  if (!joined.room || !joined.seat) return;
  client?.disconnect();
  location.href = pageUrl("controller.html", {
    room: joined.room,
    seat: joined.seat,
    name: joined.name,
    ws: els.wsUrl.value.trim(),
  });
}

function onMessage(msg) {
  switch (msg.op) {
    case "hello":
      stampVersion("#app-version", msg.version);
      break;
    case "joined":
    case "rejoined":
      joined = { room: msg.code, seat: msg.seat, name: msg.name || els.playerName.value.trim() };
      els.joinPanel.hidden = true;
      els.waitingPanel.hidden = false;
      els.activeRoomCode.textContent = joined.room;
      els.btnOpenController.hidden = false;
      setStatus(els.waitingStatus, `Joined as ${joined.name} (${joined.seat.toUpperCase()}).`, "ok");
      if (msg.gameStarted) openController();
      break;
    case "gameStarted":
      openController();
      break;
    case "error":
      setStatus(els.joinStatus, msg.message || msg.error || "Could not join room.", "err");
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
    els.joinPanel.hidden = false;
    updateJoinButton();
  } catch {
    setStatus(els.connStatus, "Could not connect.", "err");
  } finally {
    els.btnConnect.disabled = false;
  }
}

els.btnConnect.addEventListener("click", connect);
els.roomCode.addEventListener("input", updateJoinButton);
els.playerName.addEventListener("input", updateJoinButton);

els.btnJoin.addEventListener("click", () => {
  if (!client?.connected) return;
  const code = els.roomCode.value.trim().toUpperCase();
  const name = els.playerName.value.trim();
  setStatus(els.joinStatus, "Joining…");
  client.joinRoom(code, name);
});

els.btnOpenController.addEventListener("click", openController);

els.wsUrl.value = getWsUrl();
const presetRoom = getRoomFromUrl();
if (presetRoom) els.roomCode.value = presetRoom;

if (els.wsUrl.value) {
  connect().catch(() => {});
}

updateJoinButton();
stampVersion();
