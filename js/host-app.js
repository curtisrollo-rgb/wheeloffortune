import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, dataUrl } from "./net/config.js?v=1";
import { createLoadingProgress, runLoadingTasks } from "./loading-progress.js?v=1";
import { PuzzleBoard } from "./board.js?v=2";
import { createWheel } from "./wheel.js?v=15";
import { preloadAll } from "./audio.js?v=8";
import { loadCategoryVo } from "./category-vo.js?v=5";
import { loadMissVo } from "./miss-vo.js?v=4";
import { loadHitVo } from "./hit-vo.js?v=1";
import { loadPenaltyVo } from "./penalty-vo.js?v=2";
import { loadWedgeAmountVo } from "./wedge-amount-vo.js?v=2";
import { loadSolveCongratsVo } from "./solve-congrats-vo.js?v=2";
import { loadCarPrizeVo } from "./car-prize-vo.js?v=1";
import { loadFinalEnvelopeAmounts } from "./final-envelope-wheel.js?v=3";

const $ = (id) => document.getElementById(id);

const els = {
  loadingScreen: $("loading-screen"),
  loadingLabel: $("loading-label"),
  category: $("category-pill"),
  score: $("score-pill"),
  roundMoney: $("round-money-pill"),
  message: $("message-bar"),
  board: $("puzzle-board"),
  wheelHost: $("wheel-host"),
  wedgeResult: $("wedge-result"),
  scoreboard: $("scoreboard"),
  hostRoomCode: $("host-room-code"),
  btnStartGame: $("btn-start-game"),
  btnNewPuzzle: $("btn-new-puzzle"),
};

let client = null;
let board = new PuzzleBoard(els.board);
let wheelApi = null;
const roomCode = getRoomFromUrl();

function hideLoading() {
  document.body.classList.remove("is-loading");
  els.loadingScreen?.classList.add("is-hidden");
}

function setMessage(text) {
  els.message.textContent = text;
}

function renderScoreboard(players = [], activeSeat = null) {
  els.scoreboard.innerHTML = "";
  for (const player of players) {
    const pill = document.createElement("span");
    pill.className = "player-score";
    if (player.seat === activeSeat) pill.classList.add("is-active");
    pill.textContent = `${player.name || player.seat}: $${(player.score || 0).toLocaleString()}`;
    els.scoreboard.appendChild(pill);
  }
}

async function buildRoundOneWheel() {
  const res = await fetch(dataUrl("wedges.json"));
  const wedges = await res.json();
  els.wheelHost.innerHTML = "";
  wheelApi = await createWheel(els.wheelHost, wedges);
}

function onMessage(msg) {
  switch (msg.op) {
    case "hostAttached":
      els.hostRoomCode.textContent = msg.code;
      els.score.textContent = msg.code;
      setMessage("Room connected. Waiting for players…");
      els.btnStartGame.disabled = false;
      renderScoreboard(msg.players || []);
      break;
    case "lobbyUpdate":
      renderScoreboard(msg.players || [], msg.activeSeat);
      setMessage(msg.message || "Waiting for players…");
      els.btnStartGame.disabled = (msg.players || []).length < 2;
      break;
    case "turnChanged":
      renderScoreboard(msg.players || [], msg.seat);
      setMessage(msg.message || `It's ${msg.seat}'s turn.`);
      break;
    case "gameUpdate":
      if (msg.state?.category) els.category.textContent = msg.state.category;
      if (msg.state?.message) setMessage(msg.state.message);
      if (msg.state?.wedgeLabel) els.wedgeResult.textContent = msg.state.wedgeLabel;
      if (msg.state?.rows) board.render(msg.state.rows);
      renderScoreboard(msg.players || [], msg.state?.activeSeat);
      break;
    case "spinResult":
      wheelApi?.spinToIndex?.(msg.index)?.then?.(() => {
        els.wedgeResult.textContent = msg.wedge?.label ?? "—";
      });
      break;
    case "letterResult":
      if (msg.indices?.length) {
        board.revealTiles(msg.indices, msg.rows);
      }
      break;
    case "gameStarted":
      setMessage("Game started!");
      els.btnNewPuzzle.disabled = false;
      break;
    case "error":
      setMessage(msg.message || msg.error || "Connection error.");
      break;
    default:
      break;
  }
}

async function connectToRoom() {
  const wsUrl = getWsUrl();
  if (!roomCode) {
    setMessage("Missing ?room=CODE in the URL. Open this page from the lobby.");
    hideLoading();
    return;
  }
  if (!wsUrl) {
    setMessage("Missing WebSocket URL. Add ?ws=wss://… or set it in the lobby first.");
    hideLoading();
    return;
  }

  els.hostRoomCode.textContent = roomCode;
  els.score.textContent = roomCode;

  client = new WofClient({
    onMessage,
    onClose: () => setMessage("Disconnected from server."),
  });

  try {
    await client.connect(wsUrl);
    client.attachHost(roomCode);
    setMessage(`Connected to room ${roomCode}.`);
  } catch {
    setMessage("Could not connect to game server.");
  }
}

els.btnStartGame.addEventListener("click", () => {
  client?.startGame();
});

els.btnNewPuzzle.addEventListener("click", () => {
  client?.newPuzzle();
});

async function init() {
  const loading = createLoadingProgress(els.loadingScreen);
  await runLoadingTasks(loading, [
    ["Loading sounds…", preloadAll()],
    ["Loading voice…", Promise.all([loadCategoryVo(), loadMissVo(), loadHitVo(), loadPenaltyVo(), loadWedgeAmountVo(), loadSolveCongratsVo(), loadCarPrizeVo()])],
    ["Loading bonus wheel…", loadFinalEnvelopeAmounts()],
    ["Building wheel…", buildRoundOneWheel()],
    ["Connecting…", connectToRoom()],
  ]);
  hideLoading();
}

init().catch((err) => {
  console.error(err);
  hideLoading();
  setMessage(`Failed to load TV display (${err.message}).`);
});
