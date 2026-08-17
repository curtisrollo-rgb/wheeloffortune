import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, dataUrl } from "./net/config.js?v=1";
import { createLoadingProgress, runLoadingTasks } from "./loading-progress.js?v=1";
import { PuzzleBoard } from "./board.js?v=3";
import { createWheel } from "./wheel.js?v=16";
import { preloadAll, playSound } from "./audio.js?v=8";
import { loadCategoryVo } from "./category-vo.js?v=6";
import { loadMissVo } from "./miss-vo.js?v=4";
import { loadHitVo } from "./hit-vo.js?v=1";
import { loadPenaltyVo, playPenaltyVo } from "./penalty-vo.js?v=2";
import { loadWedgeAmountVo, playWedgeAmountVo } from "./wedge-amount-vo.js?v=2";
import { loadSolveCongratsVo, playRandomSolveCongrats } from "./solve-congrats-vo.js?v=2";
import { loadCarPrizeVo } from "./car-prize-vo.js?v=1";
import { buildEnvelopeWedges, getFinalEnvelopePrizes, loadFinalEnvelopeAmounts } from "./final-envelope-wheel.js?v=3";
import { playHitVo } from "./hit-vo.js?v=1";
import { playMissVo } from "./miss-vo.js?v=4";
import { playCategoryVo, canonicalCategory } from "./category-vo.js?v=6";
import {
  loadHostVo,
  playWelcomeVo,
  playTurnCueVo,
  playPlayerActionVo,
} from "./host-vo.js?v=2";
import { ROW_WIDTHS } from "./puzzle-layout.js?v=3";
import { stampVersion } from "./version.js?v=1";

const ROUND_LABELS = {
  round1: "Round 1",
  round2: "Round 2",
  final: "Final Round",
  tossup: "Toss-Up",
};

const GAME_ORDER = ["tossup", "round1", "round2", "final"];

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
let lastAnnouncedPuzzleId = null;
let welcomePlayed = false;
let hostVoChain = Promise.resolve();
let spinAnimating = false;
let pendingSpinWedge = null;
let pendingGameState = null;
let currentRoundType = "round1";
let latestGameState = null;
let wheelApi = null;
let wheelLoading = null;

function nextRoundType(roundType) {
  const idx = GAME_ORDER.indexOf(roundType);
  if (idx < 0 || idx >= GAME_ORDER.length - 1) return null;
  return GAME_ORDER[idx + 1];
}

function updateNextRoundButton(state) {
  if (!els.btnNextRound) return;
  const next = state?.phase === "ended" ? nextRoundType(state.roundType) : null;
  if (next) {
    els.btnNextRound.disabled = false;
    els.btnNextRound.textContent = `Next: ${ROUND_LABELS[next]}`;
    els.btnNextRound.dataset.nextRound = next;
    for (const btn of [els.btnTossUp, els.btnRound1, els.btnRound2, els.btnFinal]) {
      btn?.classList.toggle("is-suggested", btn?.dataset.round === next);
    }
  } else {
    els.btnNextRound.disabled = true;
    els.btnNextRound.textContent = "Next Round";
    els.btnNextRound.dataset.nextRound = "";
    for (const btn of [els.btnTossUp, els.btnRound1, els.btnRound2, els.btnFinal]) {
      btn?.classList.remove("is-suggested");
    }
  }
}

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

function applySpinWedgeToHud(wedge, state) {
  if (wedge?.label) els.wedgeResult.textContent = wedge.label;
  const money =
    typeof wedge?.value === "number" && wedge.value > 0
      ? wedge.value
      : typeof state?.roundMoney === "number"
        ? state.roundMoney
        : 0;
  if (money > 0) {
    els.roundMoney.textContent = `$${money.toLocaleString()}/letter`;
  } else {
    updateRoundMoneyPill(state);
  }
}

function updateRoundMoneyPill(state) {
  if (!state) return;
  if (state.roundType === "final") {
    if (state.phase === "finalEnvelope") {
      els.roundMoney.textContent = "Spin for envelope";
    } else if (state.phase === "finalRevealFree") {
      els.roundMoney.textContent = "Free letters…";
    } else if (state.phase === "finalPick") {
      els.roundMoney.textContent =
        state.finalConsonantsLeft > 0
          ? `${state.finalConsonantsLeft} consonant(s) to pick`
          : "Pick 1 vowel";
    } else if (state.phase === "finalSolve") {
      els.roundMoney.textContent = "Solve the puzzle!";
    } else {
      els.roundMoney.textContent = "Final Round";
    }
    return;
  }
  if (state.roundType === "tossup") {
    if (state.phase === "tossUpAnnounce") {
      els.roundMoney.textContent = "Category…";
    } else if (state.phase === "tossUpCountdown") {
      els.roundMoney.textContent = "Get ready…";
    } else if (state.phase === "tossUpReveal") {
      els.roundMoney.textContent = "$1,000 Toss-Up";
    } else {
      els.roundMoney.textContent = "Toss-Up";
    }
    return;
  }
  if (typeof state.roundMoney === "number" && state.roundMoney > 0) {
    els.roundMoney.textContent = `$${state.roundMoney.toLocaleString()}/letter`;
  } else if (state.roundBank > 0) {
    els.roundMoney.textContent = `$${state.roundBank.toLocaleString()}`;
  } else if (state.roundPrize) {
    els.roundMoney.textContent = `Prize: ${state.roundPrize}`;
  } else {
    els.roundMoney.textContent = "—";
  }
}

function setRoundTabsEnabled(enabled) {
  for (const btn of [els.btnTossUp, els.btnRound1, els.btnRound2, els.btnFinal]) {
    if (btn) btn.disabled = !enabled;
  }
}

function syncRoundTabs(roundType) {
  currentRoundType = roundType || currentRoundType;
  for (const btn of [els.btnTossUp, els.btnRound1, els.btnRound2, els.btnFinal]) {
    btn?.classList.toggle("is-active", btn?.dataset.round === currentRoundType);
  }
}

function maybeAnnounceCategory(state) {
  if (!state?.started || !state?.category || !state?.puzzleId) return;
  if (state.puzzleId === lastAnnouncedPuzzleId) return;

  lastAnnouncedPuzzleId = state.puzzleId;
  const withWelcome = !welcomePlayed;
  if (withWelcome) welcomePlayed = true;

  const isTossUpAnnounce = state.roundType === "tossup" && state.phase === "tossUpAnnounce";
  const label = canonicalCategory(state.category);

  queueHostVo(async () => {
    if (withWelcome) {
      setMessage("Welcome to Wheel of Fortune!");
      await playWelcomeVo();
    }
    setMessage(
      withWelcome
        ? `Welcome to Wheel of Fortune! The category is ${label}.`
        : `The category is ${label}.`,
    );
    await playCategoryVo(state.category, { intro: withWelcome ? "first" : "next" });
    if (isTossUpAnnounce) client?.beginTossUp();
  });
}

function applyGameState(state, players = []) {
  if (!state) return;
  latestGameState = state;

  if (state.started) setRoundTabsEnabled(true);

  if (state.roundType && state.roundType !== currentRoundType) {
    syncRoundTabs(state.roundType);
    updateWheelSection(state.roundType);
    wheelLoading = loadWheelForRound(state.roundType);
  }

  if (state.category) {
    const label = ROUND_LABELS[state.roundType] || state.roundType;
    els.category.textContent = `${label} · ${state.category}`;
  }
  if (state.puzzleId && state.puzzleId !== lastPuzzleId) {
    lastPuzzleId = state.puzzleId;
    lastPuzzleLayout = "";
  }
  maybeAnnounceCategory(state);
  if (state.message) setMessage(state.message);

  if (!spinAnimating) {
    if (state.wedgeLabel) els.wedgeResult.textContent = state.wedgeLabel;
    updateRoundMoneyPill(state);
  }

  if (state.rows?.length && !boardRevealBusy) {
    const layoutKey = puzzleLayoutKey(state.rows);
    if (!lastPuzzleLayout || layoutKey !== lastPuzzleLayout) {
      board.render(state.rows);
      lastPuzzleLayout = layoutKey;
    } else {
      board.rows = state.rows;
    }
  }

  renderScoreboard(players, state.activeSeat);
  updateNextRoundButton(state);
}

function flushPendingGameState() {
  if (!pendingGameState) return;
  const pending = pendingGameState;
  pendingGameState = null;
  applyGameState(pending.state, pending.players);
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

async function handleTossUpTile(msg) {
  if (!msg.indices?.length) return;
  boardRevealBusy = true;
  try {
    await board.revealTiles(msg.indices, msg.rows);
    if (msg.rows?.length) {
      board.rows = msg.rows;
      lastPuzzleLayout = puzzleLayoutKey(msg.rows);
    }
  } finally {
    boardRevealBusy = false;
  }
}

async function handleFinalFreeReveal(msg) {
  if (!msg.indices?.length) return;
  boardRevealBusy = true;
  try {
    await board.revealTiles(msg.indices, msg.rows);
    if (msg.rows?.length) {
      board.rows = msg.rows;
      lastPuzzleLayout = puzzleLayoutKey(msg.rows);
    }
    if (msg.autoSolved) {
      await board.revealAll(msg.rows);
      playSound("solve", { volume: 0.55 });
    }
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
  wheelSection: $("wheel-section"),
  wheelHost: $("wheel-host"),
  wedgeResult: $("wedge-result"),
  scoreboard: $("scoreboard"),
  hostRoomCode: $("host-room-code"),
  btnStartGame: $("btn-start-game"),
  btnNewPuzzle: $("btn-new-puzzle"),
  btnTossUp: $("btn-tossup"),
  btnRound1: $("btn-round1"),
  btnRound2: $("btn-round2"),
  btnFinal: $("btn-final"),
  btnNextRound: $("btn-next-round"),
  tossupCountdown: $("tossup-countdown"),
};

let client = null;
let board = new PuzzleBoard(els.board);
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

function updateWheelSection(roundType) {
  els.wheelSection?.classList.toggle("is-toss-up", roundType === "tossup");
  els.wheelSection?.classList.toggle("is-final-round", roundType === "final");
}

async function loadWheelForRound(roundType) {
  updateWheelSection(roundType);
  currentRoundType = roundType;
  if (roundType === "tossup") return;

  if (roundType === "final") {
    if (!getFinalEnvelopePrizes().length) await loadFinalEnvelopeAmounts();
    const wedges = buildEnvelopeWedges();
    els.wheelHost.innerHTML = "";
    wheelApi = await createWheel(els.wheelHost, wedges);
    return;
  }

  const file = roundType === "round2" ? "wedges-round2.json" : "wedges.json";
  const res = await fetch(dataUrl(file));
  const wedges = await res.json();
  els.wheelHost.innerHTML = "";
  wheelApi = await createWheel(els.wheelHost, wedges);
}

async function loadWheelFromManifest(manifest) {
  if (!manifest?.length) return;
  els.wheelHost.innerHTML = "";
  wheelApi = await createWheel(els.wheelHost, manifest);
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
      if (msg.wedgeManifest?.length) {
        loadWheelFromManifest(msg.wedgeManifest);
      }
      applyGameState(msg.preview, msg.players);
      break;
    case "lobbyUpdate":
      renderScoreboard(msg.players || [], msg.activeSeat);
      setMessage(msg.message || "Waiting for players…");
      els.btnStartGame.disabled = (msg.players || []).length < 1;
      break;
    case "roundChanged":
      lastPuzzleLayout = "";
      if (msg.wedgeManifest?.length) {
        loadWheelFromManifest(msg.wedgeManifest);
      } else {
        loadWheelForRound(msg.roundType);
      }
      syncRoundTabs(msg.roundType);
      if (msg.state) applyGameState(msg.state, msg.players);
      else setMessage(`Switched to ${ROUND_LABELS[msg.roundType] || msg.roundType}.`);
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
      if (spinAnimating) {
        pendingGameState = { state: msg.state, players: msg.players };
        break;
      }
      applyGameState(msg.state, msg.players);
      if (msg.state?.phase === "ended") {
        maybeRevealSolvedBoard(msg.state.rows, msg.state.message);
      }
      break;
    case "spinResult":
      spinAnimating = true;
      pendingSpinWedge = msg.wedge;
      (async () => {
        if (wheelLoading) await wheelLoading;
        if (msg.roundType && msg.roundType !== currentRoundType) {
          await loadWheelForRound(msg.roundType);
        }
        let rest = await wheelApi?.spinToIndex?.(msg.index);
        if (rest && rest.index !== msg.index && wheelApi?.ensureIndex) {
          rest = await wheelApi.ensureIndex(msg.index);
        }
        const wedge = msg.wedge ?? rest?.wedge;
        const state = pendingGameState?.state ?? latestGameState;
        applySpinWedgeToHud(wedge, {
          ...state,
          roundMoney: wedge?.value ?? state?.roundMoney ?? 0,
          wedgeLabel: wedge?.label,
        });
        spinAnimating = false;
        pendingSpinWedge = null;
        flushPendingGameState();
        if (wedge?.type === "bankrupt" || wedge?.type === "loseTurn") {
          playPenaltyVo(wedge.type);
        } else if (wedge?.value > 0) {
          playWedgeAmountVo(wedge.value);
        } else if (wedge?.type === "bonusEnvelope") {
          playSound("land", { volume: 0.55 });
        }
      })().catch((err) => {
        console.warn("Spin animation:", err);
        spinAnimating = false;
        flushPendingGameState();
      });
      break;
    case "tossUpCountdown":
      if (msg.count > 0) {
        els.tossupCountdown.textContent = String(msg.count);
        els.tossupCountdown.classList.remove("is-hidden");
        setMessage(msg.count === 3 ? "Get ready…" : `${msg.count}…`);
        playSound("tick", { volume: 0.45 });
      } else {
        els.tossupCountdown.classList.add("is-hidden");
        setMessage("Toss-Up! Ring in when you know it!");
      }
      break;
    case "tossUpTile":
      queueHostVo(async () => {
        await handleTossUpTile(msg);
      });
      break;
    case "finalFreeReveal":
      queueHostVo(async () => {
        await handleFinalFreeReveal(msg);
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
      setRoundTabsEnabled(true);
      if (els.btnNextRound) els.btnNextRound.disabled = true;
      if (msg.state) applyGameState(msg.state, msg.players);
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

function switchRound(roundType) {
  if (!client?.connected) {
    setMessage("Not connected to server.");
    return;
  }
  setMessage(`Switching to ${ROUND_LABELS[roundType] || roundType}…`);
  try {
    client.setRound(roundType);
  } catch {
    setMessage("Could not send round change — check connection.");
  }
}

els.btnStartGame.addEventListener("click", () => {
  client?.startGame();
});

els.btnNewPuzzle.addEventListener("click", () => {
  client?.newPuzzle();
});

for (const btn of [els.btnTossUp, els.btnRound1, els.btnRound2, els.btnFinal]) {
  btn?.addEventListener("click", () => {
    const roundType = btn.dataset.round;
    if (roundType) switchRound(roundType);
  });
}

els.btnNextRound?.addEventListener("click", () => {
  const next = els.btnNextRound.dataset.nextRound;
  if (next) switchRound(next);
});

async function init() {
  stampVersion();
  setRoundTabsEnabled(false);
  board.render(emptyBoardRows());
  const loading = createLoadingProgress(els.loadingScreen);
  await runLoadingTasks(loading, [
    ["Loading sounds…", preloadAll()],
    ["Loading voice…", Promise.all([loadCategoryVo(), loadMissVo(), loadHitVo(), loadPenaltyVo(), loadWedgeAmountVo(), loadSolveCongratsVo(), loadCarPrizeVo(), loadHostVo()])],
    ["Loading bonus wheel…", loadFinalEnvelopeAmounts()],
    ["Building wheel…", loadWheelForRound("round1")],
    ["Connecting…", connectToRoom()],
  ]);
  hideLoading();
}

init().catch((err) => {
  console.error(err);
  hideLoading();
  setMessage(`Failed to load TV display (${err.message}).`);
});
