import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, dataUrl } from "./net/config.js?v=2";
import { createLoadingProgress, runLoadingTasks } from "./loading-progress.js?v=1";
import { PuzzleBoard } from "./board.js?v=3";
import { createWheel } from "./wheel.js?v=19";
import { runInBackground } from "./progressive-load.js?v=1";
import { preloadEssential, preloadRemaining, playSound } from "./audio.js?v=9";
import { preloadBgm, fadeInBgm, fadeOutBgm, stopBgm } from "./bgm.js?v=1";
import { loadCategoryVo, warmCategoryVo } from "./category-vo.js?v=7";
import { loadMissVo } from "./miss-vo.js?v=4";
import { loadHitVo } from "./hit-vo.js?v=1";
import { loadPenaltyVo, playPenaltyVo } from "./penalty-vo.js?v=2";
import { loadWedgeAmountVo, playWedgeAmountVo } from "./wedge-amount-vo.js?v=2";
import { loadSolveCongratsVo, playRandomSolveCongrats } from "./solve-congrats-vo.js?v=2";
import { loadCarPrizeVo, playCarPrizeVo } from "./car-prize-vo.js?v=1";
import { loadTripPrizeVo, playTripPrizeVo } from "./trip-prize-vo.js?v=1";
import { buildEnvelopeWedges, getFinalEnvelopePrizes, loadFinalEnvelopeAmounts } from "./final-envelope-wheel.js?v=3";
import { showEnvelopeReveal } from "./final-envelope-ui.js?v=1";
import { showPrizeBanner, prizeSubtitleForWedge } from "./prize-banner.js?v=2";
import { showRoundSummary } from "./round-summary.js?v=2";
import { playRoundSummaryVo } from "./round-summary-vo.js?v=1";
import { loadMilestoneVo, playOnlyVowelsRemainVo, playNoMoreVowelsVo } from "./milestone-vo.js?v=1";
import { loadFinalGoodLuckVo, playRandomFinalGoodLuckVo } from "./final-good-luck-vo.js?v=1";
import { loadFinalWinVo } from "./final-win-vo.js?v=1";
import { loadFinalLossVo } from "./final-loss-vo.js?v=1";
import { stopAllVo } from "./vo-bus.js?v=1";
import { playHitVo } from "./hit-vo.js?v=1";
import { playMissVo } from "./miss-vo.js?v=4";
import { playCategoryVo, canonicalCategory } from "./category-vo.js?v=7";
import {
  loadHostVo,
  playWelcomeVo,
  playTurnCueVo,
  playSolveAttemptVo,
  playPlayerActionVo,
} from "./host-vo.js?v=3";
import { ROW_WIDTHS } from "./puzzle-layout.js?v=3";
import { stampVersion } from "./version.js?v=1";

const ROUND_LABELS = {
  round1: "Round 1",
  round2: "Round 2",
  final: "Final Round",
  tossup: "Toss-Up",
};

const GAME_ORDER = ["tossup", "round1", "round2", "final"];
const LETTER_TRACK = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MESSAGE_CLEAR_MS = 4200;
const WHEEL_HIDE_DELAY_MS = 2200;
const WHEEL_DOCK_OPEN_MS = 620;
const TV_BANNER_MS = 3200;
const TV_SUMMARY_MS = 3600;

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
let currentRoundType = "tossup";
let latestGameState = null;
let wheelApi = null;
let wheelLoading = null;
let envelopeRevealShown = false;
let autoAdvanceTimer = null;
let backgroundLoadsStarted = false;
let round2AssetsLoaded = false;
let finalAssetsLoaded = false;
let messageClearTimer = null;
let wheelHideTimer = null;
let finalLetterWaiter = null;
let finalIntroRunning = false;

const AUTO_ADVANCE_MS = 5500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFinalTimer(ms) {
  const sec = Math.max(0, Math.ceil((ms || 0) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function showFinalTimer(ms) {
  if (!els.finalTimer) return;
  els.finalTimer.textContent = formatFinalTimer(ms);
  els.finalTimer.classList.remove("is-hidden");
  els.finalTimer.classList.toggle("is-low", ms <= 10000);
}

function hideFinalTimer() {
  els.finalTimer?.classList.add("is-hidden");
}

function waitForFinalLetterAdvance() {
  return new Promise((resolve) => {
    finalLetterWaiter = resolve;
    client?.advanceFinalRstlne();
  });
}

async function runFinalRoundIntro() {
  if (finalIntroRunning) return;
  finalIntroRunning = true;
  try {
    flushPendingGameState();
    await hostVoChain;
    await sleep(400);
    setMessage("Let's get you R, S, T, L, N, and E!");
    client?.beginFinalRstlne();
    await sleep(700);

    for (let i = 0; i < 6; i++) {
      const msg = await waitForFinalLetterAdvance();
      boardRevealBusy = true;
      try {
        setMessage(`Revealing ${msg.letter}…`);
        if (msg.indices?.length) {
          await board.revealTiles(msg.indices, msg.rows);
        } else {
          playSound("miss", { volume: 0.22 });
        }
        if (msg.rows?.length) {
          board.rows = msg.rows;
          lastPuzzleLayout = puzzleLayoutKey(msg.rows);
        }
        await sleep(360);
        if (msg.autoSolved) {
          await board.revealAll(msg.rows);
          playSound("solve", { volume: 0.55 });
          await playRandomSolveCongrats();
          stopBgm();
          return;
        }
      } finally {
        boardRevealBusy = false;
      }
    }
  } finally {
    finalIntroRunning = false;
  }
}

function clearAutoAdvance() {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

function scheduleAutoAdvance(state) {
  clearAutoAdvance();
  if (state?.phase !== "ended") return;
  const next = nextRoundType(state.roundType);
  if (!next || !client?.connected) return;
  autoAdvanceTimer = setTimeout(() => {
    switchRound(next);
  }, AUTO_ADVANCE_MS);
}

function needsFinalEnvelopeReveal(state) {
  return (
    state?.roundType === "final" &&
    state?.phase === "ended" &&
    state.finalEnvelopeIndex != null &&
    !envelopeRevealShown
  );
}

async function maybeRevealFinalEnvelope(state) {
  if (!needsFinalEnvelopeReveal(state)) return;
  envelopeRevealShown = true;
  const amount = state.finalEnvelopeAmount ?? 0;
  const prize = state.finalEnvelopePrize;
  const won = state.finalWon === true;
  await showEnvelopeReveal(els.envelopeRevealModal, { amount, won, prize });
}

function formatScoresLine(players = []) {
  if (!players.length) return "";
  return players.map((p) => `${p.name} $${(p.score || 0).toLocaleString()}`).join(" · ");
}

function buildRoundSummary(state, players = []) {
  const roundLabel = ROUND_LABELS[state?.roundType] || state?.roundType || "Round";
  const winner = players.find((p) => p.seat === state?.roundWinnerSeat);
  const winnerName = winner?.name || state?.roundWinnerSeat || "";
  const scoresLine = formatScoresLine(players);

  if (state?.roundType === "final") {
    let detail = state.finalWon ? "" : "The envelope is revealed below.";
    if (state.finalWon && state.finalEnvelopePrize?.kind === "car") {
      detail = `Bonus: ${state.finalEnvelopePrize.name}`;
    } else if (state.finalWon && state.finalEnvelopePrize?.kind === "trip") {
      detail = `Bonus: ${state.finalEnvelopePrize.label}`;
    }
    return {
      roundLabel,
      title: state.finalWon ? "Final Round Won!" : "Final Round Over",
      winnerName: winnerName || winner?.name || "Finalist",
      amount: state.finalWon ? (state.finalEnvelopeAmount ?? 0) : 0,
      detail,
      scoresLine,
    };
  }

  if (state?.roundType === "tossup") {
    if (state.roundWinnerSeat) {
      return {
        roundLabel,
        title: "Toss-Up Winner!",
        winnerName,
        amount: state.roundWinAmount || 1000,
        detail: "",
        scoresLine,
      };
    }
    return {
      roundLabel,
      title: "Toss-Up Complete",
      winnerName: "No winner",
      amount: 0,
      detail: "Nobody rang in with the right answer.",
      scoresLine,
    };
  }

  let detail = "";
  if (state?.carPrize?.name) detail = `Plus: ${state.carPrize.name}`;
  else if (state?.tripPrize?.label) detail = `Plus: ${state.tripPrize.label}`;
  else if (state?.roundPrize) detail = `Prize: ${state.roundPrize}`;

  return {
    roundLabel,
    title: "Round Winner!",
    winnerName: winnerName || "Winner",
    amount: state?.roundWinAmount || 0,
    detail,
    scoresLine,
  };
}

async function revealTripPrize(trip) {
  if (!trip?.label) return;
  await revealPrizeFromLetter({
    kind: "trip",
    subtitle: "Vacation Trip",
    name: trip.label,
    id: trip.id,
  });
}

async function handleRoundEnd(state, players = []) {
  const isFinalLoss = state?.roundType === "final" && state.finalWon === false;
  await maybeRevealSolvedBoard(state.rows, state.message, { skipCongrats: isFinalLoss });

  if (state.roundType === "final") {
    await maybeRevealFinalEnvelope(state);
  } else if (state.tripPrize?.label && state.roundWinnerSeat && !state.tripPrizeClaimed) {
    await revealTripPrize(state.tripPrize);
  }

  const summary = buildRoundSummary(state, players);
  await playRoundSummaryVo(summary);
  await showRoundSummary(els.roundSummary, summary, { displayMs: TV_SUMMARY_MS });
  scheduleAutoAdvance(state);
}

async function revealPrizeFromLetter(prizeReveal) {
  if (!prizeReveal?.name) return;
  playSound("solve", { volume: 0.45 });
  const bannerPromise = showPrizeBanner(
    els.prizeBanner,
    {
      title: "You Won!",
      subtitle: prizeReveal.subtitle || prizeSubtitleForWedge(prizeReveal.wedgeLabel, prizeReveal.kind),
      name: prizeReveal.name,
    },
    { displayMs: TV_BANNER_MS },
  );
  if (prizeReveal.kind === "car" && prizeReveal.id) {
    await playCarPrizeVo(prizeReveal.id);
  } else if (prizeReveal.kind === "trip" && prizeReveal.id) {
    await playTripPrizeVo(prizeReveal.id);
  }
  await bannerPromise;
}

async function revealCarPrize(car) {
  await revealPrizeFromLetter({
    kind: "car",
    subtitle: "New Car",
    name: car.name,
    id: car.id || "car-round2",
  });
}

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
    showWheelDock();
    return Promise.resolve();
  }
  return playPlayerActionVo(msg);
}

function scheduleHostBackgroundLoads() {
  if (backgroundLoadsStarted) return;
  backgroundLoadsStarted = true;
  runInBackground(
    () => preloadRemaining(),
    () => loadPenaltyVo(),
    () => loadWedgeAmountVo(),
    () => loadSolveCongratsVo(),
    () => loadMilestoneVo(),
  );
}

function scheduleRound2Assets() {
  if (round2AssetsLoaded) return;
  round2AssetsLoaded = true;
  runInBackground(() => loadCarPrizeVo(), () => loadTripPrizeVo());
}

function scheduleFinalAssets() {
  if (finalAssetsLoaded) return;
  finalAssetsLoaded = true;
  runInBackground(
    () => loadFinalEnvelopeAmounts(),
    () => loadFinalGoodLuckVo(),
    () => loadFinalWinVo(),
    () => loadFinalLossVo(),
  );
}

function scheduleWheelForRound(roundType) {
  if (roundType === "tossup") return;
  if (roundType === "final") {
    scheduleFinalAssets();
  }
  runInBackground(async () => {
    if (roundType === "final" && !getFinalEnvelopePrizes().length) {
      await loadFinalEnvelopeAmounts();
    }
    await loadWheelForRound(roundType);
  });
}

function onRoundTypeProgressiveLoad(roundType) {
  if (roundType === "round1" || roundType === "round2") scheduleRound2Assets();
  if (roundType === "round2" || roundType === "final") scheduleFinalAssets();
  scheduleWheelForRound(roundType);
}

function applySpinWedgeToHud(wedge, state) {
  if (wedge?.label) els.wedgeResult.textContent = wedge.label;
  if (wedge?.type === "bankrupt" || wedge?.type === "loseTurn") {
    setMessage(wedge.label);
    return;
  }
  if (typeof wedge?.value === "number" && wedge.value > 0) {
    setMessage(`${wedge.label} — $${wedge.value.toLocaleString()} per letter`);
    return;
  }
  if (wedge?.type === "prize") {
    setMessage(`Prize wedge: ${wedge.prize || wedge.label || "Prize"}`);
    return;
  }
  if (wedge?.type === "bonusEnvelope") {
    setMessage("Bonus envelope sealed!");
  }
}

function updateRoundMoneyPill(_state) {
  /* Status pill removed from big board — wedge/message toasts carry live info. */
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
  if (state.puzzleHidden) return;
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
    await warmCategoryVo(state.category);
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

  if (state.roundType && state.roundType !== currentRoundType && !spinAnimating) {
    syncRoundTabs(state.roundType);
    updateWheelSection(state.roundType);
    wheelLoading = loadWheelForRound(state.roundType);
    onRoundTypeProgressiveLoad(state.roundType);
  }

  if (state.category) {
    if (els.roundLabel) {
      els.roundLabel.textContent = ROUND_LABELS[state.roundType] || state.roundType || "Round";
    }
    els.category.textContent = canonicalCategory(state.category);
  } else if (els.roundLabel && state.roundType) {
    els.roundLabel.textContent = ROUND_LABELS[state.roundType] || state.roundType;
  }

  renderLetterTrack(state.called || []);

  if (state.puzzleId && state.puzzleId !== lastPuzzleId) {
    lastPuzzleId = state.puzzleId;
    lastAnnouncedPuzzleId = null;
    lastPuzzleLayout = "";
    envelopeRevealShown = false;
    clearAutoAdvance();
    stopAllVo();
  }
  maybeAnnounceCategory(state);
  if (state.message) setMessage(state.message);

  if (!spinAnimating) {
    if (state.wedgeLabel) els.wedgeResult.textContent = state.wedgeLabel;
    updateRoundMoneyPill(state);
  }

  if (state.rows?.length && !boardRevealBusy) {
    const layoutKey = puzzleLayoutKey(state.rows);
    if (state.puzzleHidden) {
      board.render(emptyBoardRows());
      lastPuzzleLayout = puzzleLayoutKey(emptyBoardRows());
    } else if (!lastPuzzleLayout || layoutKey !== lastPuzzleLayout) {
      board.render(state.rows);
      lastPuzzleLayout = layoutKey;
    } else {
      board.rows = state.rows;
    }
  }

  if (state.roundType === "final" && state.phase === "finalSolve" && state.finalTimerRemainingMs > 0) {
    showFinalTimer(state.finalTimerRemainingMs);
  } else if (state.phase !== "finalSolve") {
    hideFinalTimer();
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
  if (msg.finalPick) return;

  if (msg.finalReveal && msg.steps?.length) {
    boardRevealBusy = true;
    try {
      for (const step of msg.steps) {
        setMessage(`Revealing ${step.letter}…`);
        if (step.indices?.length) {
          await board.revealTiles(step.indices, step.rows);
        } else {
          playSound("miss", { volume: 0.25 });
        }
        await sleep(420);
        if (step.rows?.length) {
          board.rows = step.rows;
          lastPuzzleLayout = puzzleLayoutKey(step.rows);
        }
      }
      if (msg.solved && msg.rows?.length) {
        await board.revealAll(msg.rows);
        playSound("solve", { volume: 0.55 });
        await playRandomSolveCongrats();
        stopBgm();
      }
    } finally {
      boardRevealBusy = false;
    }
    return;
  }

  if (msg.hit && msg.letter) {
    const called = new Set(latestGameState?.called || []);
    called.add(String(msg.letter).toUpperCase());
    renderLetterTrack([...called]);
  }

  if (msg.hit && msg.indices?.length) {
    boardRevealBusy = true;
    try {
      await board.revealTiles(msg.indices, msg.rows);
      if (msg.prizeReveal) {
        await revealPrizeFromLetter(msg.prizeReveal);
      } else if (msg.carWon && msg.carPrize) {
        await revealCarPrize(msg.carPrize);
      }
      if (msg.solved && msg.rows?.length) {
        await board.revealAll(msg.rows);
        playSound("solve", { volume: 0.55 });
        await playRandomSolveCongrats();
        if (msg.rows?.length) {
          board.rows = msg.rows;
          lastPuzzleLayout = puzzleLayoutKey(msg.rows);
        }
      } else if (msg.count >= 1 && msg.count <= 3 && !msg.prizeReveal && !msg.carWon) {
        await playHitVo(msg.letter, msg.count);
      }
      if (msg.onlyVowelsRemain) {
        await playOnlyVowelsRemainVo();
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

  await playMissVo(msg.letter);
  playSound("miss", { volume: 0.55 });
  if (msg.noMoreVowels) {
    await playNoMoreVowelsVo();
  }
}

function boardHasHiddenTiles() {
  return !!els.board.querySelector(".letter-slot");
}

async function maybeRevealSolvedBoard(rows, message, { skipCongrats = false } = {}) {
  if (!rows?.length || boardRevealBusy) return;
  if (rows.some((row) => row.includes("_"))) return;
  if (!boardHasHiddenTiles()) return;

  boardRevealBusy = true;
  try {
    if (message) setMessage(message);
    await board.revealAll(rows);
    playSound("solve", { volume: 0.55 });
    if (!skipCongrats) {
      await playRandomSolveCongrats();
    }
    board.rows = rows;
    lastPuzzleLayout = puzzleLayoutKey(rows);
  } finally {
    boardRevealBusy = false;
  }
}

async function handleSolveResult(msg) {
  stopBgm();
  hideFinalTimer();
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
  boardRevealBusy = true;
  try {
    await playRandomFinalGoodLuckVo();

    if (msg.steps?.length) {
      for (const step of msg.steps) {
        setMessage(`Revealing ${step.letter}…`);
        if (step.indices?.length) {
          await board.revealTiles(step.indices, step.rows);
        } else {
          playSound("miss", { volume: 0.25 });
        }
        await sleep(320);
      }
    } else if (msg.indices?.length) {
      await board.revealTiles(msg.indices, msg.rows);
    }

    if (msg.rows?.length) {
      board.rows = msg.rows;
      lastPuzzleLayout = puzzleLayoutKey(msg.rows);
    }

    if (msg.autoSolved) {
      await board.revealAll(msg.rows);
      playSound("solve", { volume: 0.55 });
      await playRandomSolveCongrats();
    }
  } finally {
    boardRevealBusy = false;
  }
}

const $ = (id) => document.getElementById(id);

const els = {
  loadingScreen: $("loading-screen"),
  loadingLabel: $("loading-label"),
  roundLabel: $("round-label"),
  category: $("category-pill"),
  message: $("message-bar"),
  board: $("puzzle-board"),
  letterTrack: $("letter-track"),
  wheelSection: $("wheel-section"),
  wheelHost: $("wheel-host"),
  wedgeResult: $("wedge-result"),
  scoreboard: $("scoreboard"),
  btnFullscreen: $("btn-fullscreen"),
  btnStartGame: $("btn-start-game"),
  btnNewPuzzle: $("btn-new-puzzle"),
  btnTossUp: $("btn-tossup"),
  btnRound1: $("btn-round1"),
  btnRound2: $("btn-round2"),
  btnFinal: $("btn-final"),
  btnNextRound: $("btn-next-round"),
  tossupCountdown: $("tossup-countdown"),
  finalTimer: $("final-timer"),
  prizeBanner: $("prize-banner"),
  roundSummary: $("round-summary"),
  envelopeRevealModal: $("envelope-reveal-modal"),
};

let client = null;
let board = new PuzzleBoard(els.board);
const roomCode = getRoomFromUrl();

function hideLoading() {
  document.body.classList.remove("is-loading");
  els.loadingScreen?.classList.add("is-hidden");
}

async function updateJoinQr(_code) {
  /* QR lives on lobby page only — big board is view-only. */
}

function showWheelDock() {
  if (latestGameState?.roundType === "tossup") return;
  clearTimeout(wheelHideTimer);
  document.body.classList.add("is-wheel-active");
  els.wheelSection?.classList.add("is-wheel-visible");
}

function hideWheelDock(delayMs = WHEEL_HIDE_DELAY_MS) {
  clearTimeout(wheelHideTimer);
  const hide = () => {
    if (spinAnimating && delayMs > 0) return;
    document.body.classList.remove("is-wheel-active");
    els.wheelSection?.classList.remove("is-wheel-visible");
  };
  if (delayMs <= 0) {
    hide();
    return;
  }
  wheelHideTimer = setTimeout(hide, delayMs);
}

async function ensureWheelReady(roundType) {
  if (wheelLoading) await wheelLoading;
  if (wheelApi?.spinToIndex) return;
  const type = roundType || latestGameState?.roundType || currentRoundType;
  if (type && type !== "tossup") {
    await loadWheelForRound(type);
  }
}

function renderLetterTrack(called = []) {
  if (!els.letterTrack) return;
  const used = new Set((called || []).map((ch) => String(ch).toUpperCase()));
  els.letterTrack.innerHTML = "";
  for (const letter of LETTER_TRACK) {
    const item = document.createElement("span");
    item.className = "letter-track-item";
    item.textContent = letter;
    if (used.has(letter)) item.classList.add("is-called");
    els.letterTrack.appendChild(item);
  }
}

function setMessage(text) {
  if (!els.message) return;
  els.message.textContent = text || "";
  clearTimeout(messageClearTimer);
  if (text) {
    els.message.classList.add("is-visible");
    messageClearTimer = setTimeout(() => {
      els.message.classList.remove("is-visible");
    }, MESSAGE_CLEAR_MS);
  } else {
    els.message.classList.remove("is-visible");
  }
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

function manifestMatchesWheel(manifest, wedges = []) {
  if (!manifest?.length || manifest.length !== wedges.length) return false;
  return manifest.every((entry, i) => {
    const w = wedges[i];
    return w && entry.label === w.label && (entry.backgroundColor || "") === (w.backgroundColor || "");
  });
}

async function loadWheelFromManifest(manifest) {
  if (!manifest?.length) return;
  const job = (async () => {
    updateWheelSection(currentRoundType);
    els.wheelHost.innerHTML = "";
    wheelApi = await createWheel(els.wheelHost, manifest);
  })();
  wheelLoading = job;
  try {
    await job;
  } finally {
    if (wheelLoading === job) wheelLoading = null;
  }
}

async function ensureWheelManifest(manifest) {
  if (!manifest?.length) return;
  if (manifestMatchesWheel(manifest, wheelApi?.wedges)) return;
  await loadWheelFromManifest(manifest);
}

function onMessage(msg) {
  switch (msg.op) {
    case "hello":
      stampVersion("#app-version", msg.version);
      break;
    case "hostAttached":
      updateJoinQr(msg.code).catch(() => {});
      setMessage("Room connected. Waiting for players…");
      els.btnStartGame.disabled = false;
      renderScoreboard(msg.players || []);
      if (msg.wedgeManifest?.length) {
        wheelLoading = ensureWheelManifest(msg.wedgeManifest);
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
      envelopeRevealShown = false;
      clearAutoAdvance();
      stopAllVo();
      stopBgm();
      hideFinalTimer();
      hideWheelDock(0);
      syncRoundTabs(msg.roundType);
      if (msg.wedgeManifest?.length) {
        wheelLoading = ensureWheelManifest(msg.wedgeManifest);
      } else {
        wheelLoading = loadWheelForRound(msg.roundType);
      }
      if (msg.state) applyGameState(msg.state, msg.players);
      else setMessage(`Switched to ${ROUND_LABELS[msg.roundType] || msg.roundType}.`);
      onRoundTypeProgressiveLoad(msg.roundType);
      break;
    case "turnChanged":
      renderScoreboard(msg.players || [], msg.seat);
      setMessage(msg.message || `It's ${msg.name || msg.seat}'s turn.`);
      queueHostVo(async () => {
        if (msg.cue === "none") return;
        if (msg.cue === "solve") {
          await playSolveAttemptVo(msg.name || msg.seat);
          return;
        }
        if (latestGameState?.roundType === "tossup") return;
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
        queueHostVo(async () => {
          await handleRoundEnd(msg.state, msg.players);
        });
      }
      break;
    case "spinResult":
      spinAnimating = true;
      pendingSpinWedge = msg.wedge;
      showWheelDock();
      (async () => {
        if (msg.roundType) syncRoundTabs(msg.roundType);
        if (msg.wedgeManifest?.length) {
          await ensureWheelManifest(msg.wedgeManifest);
        } else if (msg.roundType && msg.roundType !== currentRoundType) {
          await loadWheelForRound(msg.roundType);
        } else {
          await ensureWheelReady(msg.roundType);
        }
        if (!wheelApi?.spinToIndex) {
          console.warn("Spin animation: wheel not ready");
          spinAnimating = false;
          flushPendingGameState();
          hideWheelDock(800);
          return;
        }
        await sleep(WHEEL_DOCK_OPEN_MS);
        await wheelApi.spinToIndex(msg.index);
        const wedge = msg.wedge;
        const state = pendingGameState?.state ?? latestGameState;
        applySpinWedgeToHud(wedge, {
          ...state,
          roundMoney: wedge?.value ?? state?.roundMoney ?? 0,
          wedgeLabel: wedge?.label,
        });
        spinAnimating = false;
        pendingSpinWedge = null;
        flushPendingGameState();
        hideWheelDock();
        if (wedge?.type === "bankrupt" || wedge?.type === "loseTurn") {
          playPenaltyVo(wedge.type);
        } else if (wedge?.type === "prize") {
          if (wedge.prizeKind === "car") {
            playSound("land", { volume: 0.45 });
          } else if (wedge.prizeKind === "trip") {
            playSound("solve", { volume: 0.4 });
          } else {
            playSound("solve", { volume: 0.35 });
          }
        } else if (wedge?.value > 0) {
          playWedgeAmountVo(wedge.value);
        } else if (wedge?.type === "bonusEnvelope") {
          playSound("land", { volume: 0.55 });
          await runFinalRoundIntro();
        }
      })().catch((err) => {
        console.warn("Spin animation:", err);
        spinAnimating = false;
        flushPendingGameState();
        hideWheelDock(600);
      });
      break;
    case "buzzWinner":
      stopBgm();
      setMessage(`${msg.name || msg.seat} rang in to solve!`);
      playSound("buzz", { volume: 0.55 });
      break;
    case "solveWrong":
      queueHostVo(async () => {
        if (msg.message) setMessage(msg.message);
        await playMissVo();
        if (msg.resumeFinalTimer) {
          setMessage(`${msg.name || msg.seat}'s solve was wrong — time still running!`);
        }
      });
      break;
    case "tossUpComplete":
      queueHostVo(async () => {
        if (msg.rows?.length) {
          boardRevealBusy = true;
          try {
            await board.revealAll(msg.rows);
            board.rows = msg.rows;
            lastPuzzleLayout = puzzleLayoutKey(msg.rows);
          } finally {
            boardRevealBusy = false;
          }
        }
        if (msg.message) setMessage(msg.message);
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
        playSound("land", { volume: 0.5 });
        fadeInBgm({ volume: 0.18 });
      }
      break;
    case "tossUpTile":
      queueHostVo(async () => {
        await handleTossUpTile(msg);
      });
      break;
    case "finalFreeLetter":
      if (finalLetterWaiter) {
        finalLetterWaiter(msg);
        finalLetterWaiter = null;
      }
      break;
    case "finalPickStart":
      fadeInBgm({ volume: 0.2 });
      setMessage("Pick 3 consonants and 1 vowel!");
      break;
    case "finalTimerStart":
      showFinalTimer(msg.remainingMs);
      break;
    case "finalTimerTick":
      showFinalTimer(msg.remainingMs);
      break;
    case "finalTimerExpired":
      stopBgm();
      hideFinalTimer();
      queueHostVo(async () => {
        if (msg.rows?.length) {
          boardRevealBusy = true;
          try {
            await board.revealAll(msg.rows);
            board.rows = msg.rows;
            lastPuzzleLayout = puzzleLayoutKey(msg.rows);
          } finally {
            boardRevealBusy = false;
          }
        }
        if (msg.message) setMessage(msg.message);
        await playMissVo();
      });
      break;
    case "finalFreeReveal":
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
  clearAutoAdvance();
  envelopeRevealShown = false;
  stopAllVo();
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

els.btnFullscreen?.addEventListener("click", () => {
  const root = document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  } else {
    root.requestFullscreen?.().catch(() => {});
  }
});

async function init() {
  stampVersion();
  setRoundTabsEnabled(false);
  board.render(emptyBoardRows());
  renderLetterTrack([]);
  const loading = createLoadingProgress(els.loadingScreen);
  await runLoadingTasks(loading, [
    ["Loading essentials…", Promise.all([
      preloadEssential(),
      preloadBgm(),
      loadCategoryVo(),
      loadHostVo(),
      loadMissVo(),
      loadHitVo(),
    ])],
    ["Connecting…", connectToRoom()],
  ]);
  scheduleHostBackgroundLoads();
  onRoundTypeProgressiveLoad("tossup");
}

init().catch((err) => {
  console.error(err);
  hideLoading();
  setMessage(`Failed to load TV display (${err.message}).`);
});
