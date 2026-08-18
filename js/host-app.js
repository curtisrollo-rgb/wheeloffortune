import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, getSpectateFromUrl, dataUrl } from "./net/config.js?v=3";
import { createLoadingProgress, runLoadingTasks } from "./loading-progress.js?v=1";
import { PuzzleBoard } from "./board.js?v=4";
import { createWheel } from "./wheel.js?v=20";
import { runInBackground } from "./progressive-load.js?v=1";
import { preloadEssential, preloadRemaining, playSound } from "./audio.js?v=9";
import { preloadBgm, fadeInBgm, fadeOutBgm, stopBgm } from "./bgm.js?v=1";
import { loadCategoryVo, warmCategoryVo } from "./category-vo.js?v=8";
import { loadMissVo } from "./miss-vo.js?v=4";
import { loadHitVo } from "./hit-vo.js?v=1";
import { loadPenaltyVo, playPenaltyVo } from "./penalty-vo.js?v=2";
import { loadWedgeAmountVo, playWedgeAmountVo } from "./wedge-amount-vo.js?v=2";
import { loadSolveCongratsVo, playRandomSolveCongrats } from "./solve-congrats-vo.js?v=2";
import { loadCarPrizeVo, playCarPrizeVo } from "./car-prize-vo.js?v=1";
import { loadTripPrizeVo, playTripPrizeVo } from "./trip-prize-vo.js?v=1";
import { loadSpaPrizeVo, playSpaPrizeVo } from "./spa-prize-vo.js?v=1";
import { buildEnvelopeWedges, getFinalEnvelopePrizes, loadFinalEnvelopeAmounts } from "./final-envelope-wheel.js?v=3";
import { showEnvelopeReveal } from "./final-envelope-ui.js?v=1";
import { showPrizeBanner, prizeSubtitleForWedge } from "./prize-banner.js?v=2";
import { showRoundSummary } from "./round-summary.js?v=2";
import { playRoundSummaryVo } from "./round-summary-vo.js?v=2";
import { loadMilestoneVo, playOnlyVowelsRemainVo, playNoMoreVowelsVo } from "./milestone-vo.js?v=2";
import { loadFinalGoodLuckVo, playRandomFinalGoodLuckVo } from "./final-good-luck-vo.js?v=1";
import { loadFinalWinVo } from "./final-win-vo.js?v=1";
import { loadFinalLossVo } from "./final-loss-vo.js?v=1";
import { stopAllVo } from "./vo-bus.js?v=1";
import { playHitVo } from "./hit-vo.js?v=1";
import { playMissVo } from "./miss-vo.js?v=4";
import { playCategoryVo, canonicalCategory } from "./category-vo.js?v=8";
import {
  loadHostVo,
  playWelcomeVo,
  playTurnCueVo,
  playSolveAttemptVo,
  playPlayerActionVo,
} from "./host-vo.js?v=5";
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
const SPIN_ANIMATION_TIMEOUT_MS = 14000;
const HOST_VO_TIMEOUT_MS = 12000;
const BOARD_REVEAL_TIMEOUT_MS = 12000;
const HOST_STUCK_CHECK_MS = 4000;
const HOST_RECONNECT_BASE_MS = 1200;
const HOST_RECONNECT_MAX_MS = 15000;

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
let spinStartedAt = 0;
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
let roundCountdownActive = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let stuckFlagTimer = null;
let boardRevealStartedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`${label} timed out after ${ms}ms`);
    }),
  ]);
}

function resetHostSyncFlags(reason) {
  if (spinAnimating || boardRevealBusy) {
    console.warn("Resetting stuck TV display flags:", reason, {
      spinAnimating,
      boardRevealBusy,
    });
  }
  spinAnimating = false;
  spinStartedAt = 0;
  boardRevealBusy = false;
  boardRevealStartedAt = 0;
  pendingSpinWedge = null;
}

function finishSpinAnimation({ applyPending = true } = {}) {
  spinAnimating = false;
  spinStartedAt = 0;
  pendingSpinWedge = null;
  if (applyPending) flushPendingGameState();
  hideWheelDock();
}

function markBoardRevealBusy() {
  boardRevealBusy = true;
  boardRevealStartedAt = Date.now();
}

function clearBoardRevealBusy() {
  boardRevealBusy = false;
  boardRevealStartedAt = 0;
}

function checkStuckHostFlags() {
  const now = Date.now();
  if (spinAnimating && spinStartedAt && now - spinStartedAt > SPIN_ANIMATION_TIMEOUT_MS) {
    finishSpinAnimation();
  }
  if (boardRevealBusy && boardRevealStartedAt && now - boardRevealStartedAt > BOARD_REVEAL_TIMEOUT_MS) {
    clearBoardRevealBusy();
    flushPendingGameState();
  }
}

function startStuckFlagWatch() {
  if (stuckFlagTimer) return;
  stuckFlagTimer = setInterval(checkStuckHostFlags, HOST_STUCK_CHECK_MS);
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

async function animateFinalFreeLetter(msg) {
  markBoardRevealBusy();
  try {
    setMessage(`Revealing ${msg.letter}…`);
    if (msg.indices?.length) {
      await withTimeout(
        board.revealTiles(msg.indices, msg.rows),
        BOARD_REVEAL_TIMEOUT_MS,
        "Final free letter",
      );
    } else {
      playSound("miss", { volume: 0.22 });
    }
    if (msg.rows?.length) {
      board.rows = msg.rows;
      lastPuzzleLayout = puzzleLayoutKey(msg.rows);
    }
    if (msg.autoSolved) {
      await withTimeout(board.revealAll(msg.rows), BOARD_REVEAL_TIMEOUT_MS, "Final auto solve");
      playSound("solve", { volume: 0.55 });
      await playRandomSolveCongrats();
      stopBgm();
    }
  } finally {
    clearBoardRevealBusy();
  }
}

function clearAutoAdvance() {
  /* Round auto-advance is server-driven via roundCountdown op. */
}

function scheduleAutoAdvance(_state) {
  /* Server broadcasts roundCountdown and auto-advances after 10s. */
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
  else if (state?.spaPrize?.label) detail = `Plus: ${state.spaPrize.display || state.spaPrize.label}`;
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

async function revealSpaPrize(spa) {
  if (!spa?.label && !spa?.display) return;
  await revealPrizeFromLetter({
    kind: "spa",
    subtitle: "Spa Getaway",
    name: spa.display || spa.label,
    id: spa.id,
  });
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
  } else if (state.spaPrize?.label && state.roundWinnerSeat && !state.spaPrizeClaimed) {
    await revealSpaPrize(state.spaPrize);
  }

  const summary = buildRoundSummary(state, players);
  await playRoundSummaryVo(summary);
  await showRoundSummary(els.roundSummary, summary, { displayMs: TV_SUMMARY_MS });
  scheduleAutoAdvance(state);
}

function formatCarDisplay(car) {
  if (!car) return "Bonus Car";
  if (car.make && car.model) return `${car.make} ${car.model}`;
  return car.name || "Bonus Car";
}

async function revealPrizeFromLetter(prizeReveal) {
  if (!prizeReveal?.name && !prizeReveal?.make) return;
  playSound("solve", { volume: 0.45 });
  const displayName =
    prizeReveal.kind === "car"
      ? formatCarDisplay(prizeReveal)
      : prizeReveal.name;
  const bannerPromise = showPrizeBanner(
    els.prizeBanner,
    {
      title: "You Won!",
      subtitle: prizeReveal.subtitle || prizeSubtitleForWedge(prizeReveal.wedgeLabel, prizeReveal.kind),
      name: displayName,
    },
    { displayMs: TV_BANNER_MS },
  );
  if (prizeReveal.kind === "car" && prizeReveal.id) {
    await playCarPrizeVo(prizeReveal.id);
  } else if (prizeReveal.kind === "trip" && prizeReveal.id) {
    await playTripPrizeVo(prizeReveal.id);
  } else if (prizeReveal.kind === "spa" && prizeReveal.id) {
    await playSpaPrizeVo(prizeReveal.id);
  }
  await bannerPromise;
}

async function revealCarPrize(car) {
  await revealPrizeFromLetter({
    kind: "car",
    subtitle: "New Car",
    name: formatCarDisplay(car),
    make: car.make,
    model: car.model,
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
  hostVoChain = hostVoChain
    .then(() => withTimeout(Promise.resolve().then(task), HOST_VO_TIMEOUT_MS, "Host VO"))
    .catch((err) => console.warn("Host VO:", err));
  return hostVoChain;
}

function announceAction(msg) {
  const name = msg.name || msg.seat || "Player";
  if (msg.action === "pick" && msg.letter) {
    setMessage(`${name} chose ${String(msg.letter).toUpperCase()}.`);
  } else if (msg.action === "buyVowel" && msg.letter) {
    setMessage(`${name} chose ${String(msg.letter).toUpperCase()} (vowel).`);
  } else if (msg.action === "solve") {
    setMessage(`${name} is attempting to solve!`);
  } else if (msg.action === "spin") {
    setMessage(`${name} spins the wheel!`);
    if (els.wedgeResult) els.wedgeResult.textContent = "—";
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
  runInBackground(() => loadCarPrizeVo(), () => loadTripPrizeVo(), () => loadSpaPrizeVo());
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
  const isFinalReveal = state.roundType === "final" && state.phase === "finalPuzzleReveal";
  const label = canonicalCategory(state.category);

  queueHostVo(async () => {
    if (withWelcome && !isFinalReveal) {
      setMessage("Welcome to Wheel of Fortune!");
      await playWelcomeVo();
    }
    await warmCategoryVo(state.category);
    setMessage(
      isFinalReveal
        ? `The category is ${label}.`
        : withWelcome
          ? `Welcome to Wheel of Fortune! The category is ${label}.`
          : `The category is ${label}.`,
    );
    await playCategoryVo(state.category, { intro: withWelcome && !isFinalReveal ? "first" : "next" });
    if (isTossUpAnnounce) client?.beginTossUp();
  });
}

function applyGameState(state, players = [], { skipSpinHud = false } = {}) {
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
  if (state.message && !roundCountdownActive) setMessage(state.message);

  if (!spinAnimating && !skipSpinHud) {
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
  if (pending.state?.phase === "ended") {
    queueHostVo(async () => {
      await handleRoundEnd(pending.state, pending.players);
    });
  }
}

async function handleLetterResult(msg) {
  if (msg.finalPick) return;

  if (msg.finalReveal && msg.steps?.length) {
    markBoardRevealBusy();
    try {
      for (const step of msg.steps) {
        setMessage(`Revealing ${step.letter}…`);
        if (step.indices?.length) {
          await withTimeout(
            board.revealTiles(step.indices, step.rows),
            BOARD_REVEAL_TIMEOUT_MS,
            "Final reveal",
          );
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
        await withTimeout(board.revealAll(msg.rows), BOARD_REVEAL_TIMEOUT_MS, "Final solve reveal");
        playSound("solve", { volume: 0.55 });
        await playRandomSolveCongrats();
        stopBgm();
      }
    } finally {
      clearBoardRevealBusy();
    }
    return;
  }

  if (msg.hit && msg.letter) {
    const called = new Set(latestGameState?.called || []);
    called.add(String(msg.letter).toUpperCase());
    renderLetterTrack([...called]);
  }

  if (msg.hit && msg.indices?.length) {
    markBoardRevealBusy();
    try {
      await withTimeout(
        board.revealTiles(msg.indices, msg.rows),
        BOARD_REVEAL_TIMEOUT_MS,
        "Letter reveal",
      );
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
      clearBoardRevealBusy();
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

  markBoardRevealBusy();
  try {
    if (message) setMessage(message);
    await withTimeout(board.revealAll(rows), BOARD_REVEAL_TIMEOUT_MS, "Solve reveal");
    playSound("solve", { volume: 0.55 });
    if (!skipCongrats) {
      await playRandomSolveCongrats();
    }
    board.rows = rows;
    lastPuzzleLayout = puzzleLayoutKey(rows);
  } finally {
    clearBoardRevealBusy();
  }
}

async function handleSolveResult(msg) {
  stopBgm();
  hideFinalTimer();
  if (!msg.rows?.length) return;
  markBoardRevealBusy();
  try {
    if (msg.message) setMessage(msg.message);
    await withTimeout(board.revealAll(msg.rows), BOARD_REVEAL_TIMEOUT_MS, "Solve result");
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
    board.rows = msg.rows;
    lastPuzzleLayout = puzzleLayoutKey(msg.rows);
  } finally {
    clearBoardRevealBusy();
  }
}

async function handleTossUpTile(msg) {
  if (!msg.indices?.length) return;
  markBoardRevealBusy();
  try {
    await withTimeout(
      board.revealTiles(msg.indices, msg.rows),
      BOARD_REVEAL_TIMEOUT_MS,
      "Toss-up tile",
    );
    if (msg.rows?.length) {
      board.rows = msg.rows;
      lastPuzzleLayout = puzzleLayoutKey(msg.rows);
    }
  } finally {
    clearBoardRevealBusy();
  }
}

async function handleFinalFreeReveal(msg) {
  markBoardRevealBusy();
  try {
    await withTimeout(handleFinalFreeRevealInner(msg), BOARD_REVEAL_TIMEOUT_MS * 2, "Final free reveal");
  } finally {
    clearBoardRevealBusy();
  }
}

async function handleFinalFreeRevealInner(msg) {
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
}

const $ = (id) => document.getElementById(id);

const els = {
  loadingScreen: $("loading-screen"),
  loadingLabel: $("loading-label"),
  roundLabel: $("round-label"),
  turnBanner: $("turn-banner"),
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
  spectatorBanner: $("spectator-banner"),
};

let client = null;
let board = new PuzzleBoard(els.board);
const roomCode = getRoomFromUrl();
const isSpectator = getSpectateFromUrl();

function handleRoomAttached(msg, { spectating = false } = {}) {
  updateJoinQr(msg.code).catch(() => {});
  setMessage(
    spectating
      ? `Watching room ${msg.code} — read only.`
      : "Room connected. Waiting for players…",
  );
  if (!spectating) els.btnStartGame.disabled = false;
  renderScoreboard(msg.players || []);
  if (msg.wedgeManifest?.length) {
    wheelLoading = ensureWheelManifest(msg.wedgeManifest);
  }
  applyGameState(msg.preview, msg.players);
}

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

function setMessage(text, { holdMs = MESSAGE_CLEAR_MS } = {}) {
  if (!els.message) return;
  els.message.textContent = text || "";
  clearTimeout(messageClearTimer);
  if (text) {
    els.message.classList.add("is-visible");
    if (holdMs > 0) {
      messageClearTimer = setTimeout(() => {
        els.message.classList.remove("is-visible");
      }, holdMs);
    }
  } else {
    els.message.classList.remove("is-visible");
  }
}

function renderTurnBanner(players = [], activeSeat = null, state = latestGameState) {
  if (!els.turnBanner) return;
  const active = players.find((p) => p.seat === activeSeat);
  const showTurn =
    active &&
    state?.started &&
    state?.phase !== "ended" &&
    state?.roundType !== "tossup";

  if (!showTurn) {
    els.turnBanner.textContent = "";
    els.turnBanner.classList.remove("is-visible");
    return;
  }

  els.turnBanner.textContent = `${active.name || active.seat}'s Turn`;
  els.turnBanner.classList.add("is-visible");
}

function renderScoreboard(players = [], activeSeat = null) {
  renderTurnBanner(players, activeSeat);
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
  if (spinAnimating) return;
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
      handleRoomAttached(msg);
      break;
    case "spectatorAttached":
      handleRoomAttached(msg, { spectating: true });
      break;
    case "lobbyUpdate":
      renderScoreboard(msg.players || [], msg.activeSeat);
      setMessage(msg.message || "Waiting for players…");
      els.btnStartGame.disabled = (msg.players || []).length < 1;
      break;
    case "roundChanged":
      roundCountdownActive = false;
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
    case "roundCountdown":
      roundCountdownActive = msg.remaining > 0;
      if (msg.remaining > 0) {
        const nextLabel = msg.nextLabel || ROUND_LABELS[msg.nextRound] || msg.nextRound || "next round";
        setMessage(`${nextLabel} starts in ${msg.remaining}…`, { holdMs: 1100 });
      } else {
        roundCountdownActive = false;
        setMessage(`Starting ${msg.nextLabel || ROUND_LABELS[msg.nextRound] || "next round"}…`);
      }
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
        applyGameState(msg.state, msg.players, { skipSpinHud: true });
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
      spinStartedAt = Date.now();
      pendingSpinWedge = msg.wedge;
      if (els.wedgeResult) els.wedgeResult.textContent = "—";
      showWheelDock();
      withTimeout(
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
            finishSpinAnimation();
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
          finishSpinAnimation();
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
          }
        })(),
        SPIN_ANIMATION_TIMEOUT_MS,
        "Spin animation",
      ).catch((err) => {
        console.warn("Spin animation:", err);
        finishSpinAnimation();
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
          markBoardRevealBusy();
          try {
            await withTimeout(board.revealAll(msg.rows), BOARD_REVEAL_TIMEOUT_MS, "Toss-up complete");
            board.rows = msg.rows;
            lastPuzzleLayout = puzzleLayoutKey(msg.rows);
          } finally {
            clearBoardRevealBusy();
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
    case "finalEnvelopeSealed":
      if (spinAnimating) finishSpinAnimation();
      setMessage("Bonus envelope sealed!");
      break;
    case "finalRstlneStart":
      if (spinAnimating) finishSpinAnimation();
      setMessage(msg.message || "Let's get you R, S, T, L, N, and E!");
      break;
    case "finalFreeLetter":
      queueHostVo(async () => {
        await animateFinalFreeLetter(msg);
      });
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
          markBoardRevealBusy();
          try {
            await withTimeout(board.revealAll(msg.rows), BOARD_REVEAL_TIMEOUT_MS, "Final timer expired");
            board.rows = msg.rows;
            lastPuzzleLayout = puzzleLayoutKey(msg.rows);
          } finally {
            clearBoardRevealBusy();
          }
        }
        if (msg.message) setMessage(msg.message);
        await playMissVo();
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

function scheduleHostReconnect() {
  if (reconnectTimer || !roomCode) return;
  const delay = Math.min(
    HOST_RECONNECT_MAX_MS,
    HOST_RECONNECT_BASE_MS * 2 ** reconnectAttempts,
  );
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnectAttempts += 1;
    const wsUrl = getWsUrl();
    if (!wsUrl) return;
    setMessage(`Reconnecting to room ${roomCode}…`);
    try {
      await client.connect(wsUrl);
      if (isSpectator) {
        client.attachSpectator(roomCode);
      } else {
        client.attachHost(roomCode);
      }
      reconnectAttempts = 0;
      resetHostSyncFlags("reconnect");
      setMessage(`Reconnected to room ${roomCode}.`);
    } catch {
      scheduleHostReconnect();
    }
  }, delay);
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
    onOpen: () => {
      reconnectAttempts = 0;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    },
    onClose: () => {
      resetHostSyncFlags("disconnect");
      setMessage("Disconnected from server. Reconnecting…");
      scheduleHostReconnect();
    },
  });

  try {
    await client.connect(wsUrl);
    if (isSpectator) {
      client.attachSpectator(roomCode);
    } else {
      client.attachHost(roomCode);
    }
    setMessage(
      isSpectator
        ? `Connecting to watch room ${roomCode}…`
        : `Connected to room ${roomCode}.`,
    );
    startStuckFlagWatch();
  } catch {
    setMessage("Could not connect to game server.");
    scheduleHostReconnect();
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
  if (isSpectator) {
    document.body.classList.add("is-spectator-mode");
    els.spectatorBanner?.classList.remove("is-hidden");
    if (els.spectatorBanner && roomCode) {
      els.spectatorBanner.textContent = `Watching room ${roomCode} — read only`;
    }
  }
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
