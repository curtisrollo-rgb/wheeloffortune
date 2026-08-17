import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, dataUrl } from "./net/config.js?v=1";
import { createLoadingProgress, runLoadingTasks } from "./loading-progress.js?v=1";
import { PuzzleBoard } from "./board.js?v=3";
import { createWheel } from "./wheel.js?v=15";
import { preloadAll, playSound } from "./audio.js?v=8";
import { loadCategoryVo } from "./category-vo.js?v=5";
import { loadMissVo } from "./miss-vo.js?v=4";
import { loadHitVo } from "./hit-vo.js?v=1";
import { loadPenaltyVo, playPenaltyVo } from "./penalty-vo.js?v=2";
import { loadWedgeAmountVo, playWedgeAmountVo } from "./wedge-amount-vo.js?v=2";
import { loadSolveCongratsVo, playRandomSolveCongrats } from "./solve-congrats-vo.js?v=2";
import { loadCarPrizeVo } from "./car-prize-vo.js?v=1";
import { loadFinalEnvelopeAmounts } from "./final-envelope-wheel.js?v=3";
import { playHitVo } from "./hit-vo.js?v=1";
import { playMissVo } from "./miss-vo.js?v=4";
import { playCategoryVo } from "./category-vo.js?v=5";
import {
  loadHostVo,
  playWelcomeVo,
  playTurnCueVo,
  playPlayerActionVo,
} from "./host-vo.js?v=2";
import { ROW_WIDTHS } from "./puzzle-layout.js?v=3";
import { stampVersion } from "./version.js?v=1";

function emptyBoardRows() {
  return ROW_WIDTHS.map((w) => "#".repeat(w));
}

function puzzleLayoutKey(rows) {
  if (!rows?.length) return "";
  return rows
    .map((row) =>
      [...row]
        .map((ch) => (ch === "#" || ch === " " ? ch : "_"))
        .join(""),
    )
    .join("|");
}

let boardRevealBusy = false;
let lastPuzzleLayout = "";
let lastPuzzleId = null;
let welcomePlayed = false;
let hostVoChain = Promise.resolve();

function queueHostVo(task) {
  hostVoChain = hostVoChain.then(task).catch((err) => console.warn("Host VO:", err));
  return hostVoChain;
}

function announceAction(msg) {
  const name = msg.name || msg.seat || "Player";
  if (msg.action === "pick" && msg.letter) {
    setMessage(`${name} picks ${String(msg.letter).toUpperCase()}.`);
  } else if (msg.action === "buyVowel" && msg.letter) {
    setMessage(`${name} buys a vowel — ${String(msg.letter).toUpperCase()}.`);
  } else if (msg.action === "solve") {
    setMessage(`${name} is attempting to solve!`);
  } else if (msg.action === "spin") {
    setMessage(`${name} spins the wheel!`);
  }
  return playPlayerActionVo(msg);
}

function applyGameState(state, players = []) {
  if (!state) return;

  if (state.category) els.category.textContent = state.category;
  if (state.puzzleId && state.puzzleId !== lastPuzzleId) {
    lastPuzzleId = state.puzzleId;
    if (state.category) playCategoryVo(state.category);
  }
  if (state.message) setMessage(state.message);
  if (state.wedgeLabel) els.wedgeResult.textContent = state.wedgeLabel;

  if (state.rows?.length && !boardRevealBusy) {
    const layoutKey = puzzleLayoutKey(state.rows);
    if (!lastPuzzleLayout || layoutKey !== lastPuzzleLayout) {
      board.render(state.rows);
      lastPuzzleLayout = layoutKey;
    } else {
      board.rows = state.rows;
    }
  }

  if (typeof state.roundMoney === "number") {
    els.roundMoney.textContent = state.roundMoney > 0 ? `$${state.roundMoney.toLocaleString()}` : "—";
  }
  renderScoreboard(players, state.activeSeat);
}

async function handleLetterResult(msg) {
  if (msg.hit && msg.indices?.length) {
    boardRevealBusy = true;
    try {
      await board.revealTiles(msg.indices, msg.rows);
      if (msg.solved && msg.rows?.length) {
        await board.revealAll(msg.rows);
        playSound("solve", { volume: 0.55 });
        await playRandomSolveCongrats();
      } else if (msg.count >= 1 && msg.count <= 3) {
        await playHitVo(msg.letter, msg.count);
      }
      if (msg.rows?.length) {
        board.rows = msg.rows;
        lastPuzzleLayout = puzzleLayoutKey(msg.rows);
      }
    } finally {
      boardRevealBusy = false;
    }
    return;
  }

  playMissVo(msg.letter);
}

function boardHasHiddenTiles() {
  return !!els.board.querySelector(".letter-slot");
}

async function maybeRevealSolvedBoard(rows, message) {
  if (!rows?.length || boardRevealBusy) return;
  if (rows.some((row) => row.includes("_"))) return;
  if (!boardHasHiddenTiles()) return;

  boardRevealBusy = true;
  try {
    if (message) setMessage(message);
    await board.revealAll(rows);
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
    board.rows = rows;
    lastPuzzleLayout = puzzleLayoutKey(rows);
  } finally {
    boardRevealBusy = false;
  }
}

async function handleSolveResult(msg) {
  if (!msg.rows?.length) return;
  boardRevealBusy = true;
  try {
    if (msg.message) setMessage(msg.message);
    await board.revealAll(msg.rows);
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
    board.rows = msg.rows;
    lastPuzzleLayout = puzzleLayoutKey(msg.rows);
  } finally {
    boardRevealBusy = false;
  }
}

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
    case "hello":
      stampVersion("#app-version", msg.version);
      break;
    case "hostAttached":
      els.hostRoomCode.textContent = msg.code;
      els.score.textContent = msg.code;
      setMessage("Room connected. Waiting for players…");
      els.btnStartGame.disabled = false;
      renderScoreboard(msg.players || []);
      applyGameState(msg.preview, msg.players);
      break;
    case "lobbyUpdate":
      renderScoreboard(msg.players || [], msg.activeSeat);
      setMessage(msg.message || "Waiting for players…");
      els.btnStartGame.disabled = (msg.players || []).length < 1;
      break;
    case "turnChanged":
      renderScoreboard(msg.players || [], msg.seat);
      setMessage(msg.message || `It's ${msg.name || msg.seat}'s turn.`);
      queueHostVo(async () => {
        await playTurnCueVo(msg.name || msg.seat);
      });
      break;
    case "playerAction":
      queueHostVo(async () => {
        await announceAction(msg);
      });
      break;
    case "gameUpdate":
      applyGameState(msg.state, msg.players);
      if (msg.state?.phase === "ended") {
        maybeRevealSolvedBoard(msg.state.rows, msg.state.message);
      }
      break;
    case "spinResult":
      wheelApi?.spinToIndex?.(msg.index)?.then?.(() => {
        els.wedgeResult.textContent = msg.wedge?.label ?? "—";
        if (msg.wedge?.type === "bankrupt" || msg.wedge?.type === "loseTurn") {
          playPenaltyVo(msg.wedge.type);
        } else if (msg.wedge?.value > 0) {
          playWedgeAmountVo(msg.wedge.value);
        }
      });
      break;
    case "letterResult":
      queueHostVo(async () => {
        await handleLetterResult(msg);
      });
      break;
    case "solveResult":
      queueHostVo(async () => {
        await handleSolveResult(msg);
      });
      break;
    case "gameStarted":
      setMessage("Game started!");
      els.btnNewPuzzle.disabled = false;
      if (msg.state) applyGameState(msg.state, msg.players);
      if (!welcomePlayed) {
        welcomePlayed = true;
        queueHostVo(async () => {
          setMessage("Welcome to Wheel of Fortune!");
          await playWelcomeVo();
        });
      }
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
  stampVersion();
  board.render(emptyBoardRows());
  const loading = createLoadingProgress(els.loadingScreen);
  await runLoadingTasks(loading, [
    ["Loading sounds…", preloadAll()],
    ["Loading voice…", Promise.all([loadCategoryVo(), loadMissVo(), loadHitVo(), loadPenaltyVo(), loadWedgeAmountVo(), loadSolveCongratsVo(), loadCarPrizeVo(), loadHostVo()])],
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
