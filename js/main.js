import { createLoadingProgress, runLoadingTasks } from "./loading-progress.js?v=1";
import { runInBackground } from "./progressive-load.js?v=1";
import { preloadEssential, preloadRemaining, playSound } from "./audio.js?v=9";
import { stopAllVo } from "./vo-bus.js?v=1";
import { loadCategoryVo, warmCategoryVo, playCategoryVo, canonicalCategory } from "./category-vo.js?v=7";
import {
  loadSolveCongratsVo,
  playRandomSolveCongrats,
} from "./solve-congrats-vo.js?v=2";
import { loadMissVo, playMissVo } from "./miss-vo.js?v=4";
import { loadHitVo, playHitVo } from "./hit-vo.js?v=1";
import {
  loadMilestoneVo,
  playOnlyVowelsRemainVo,
  playNoMoreVowelsVo,
} from "./milestone-vo.js?v=2";
import { loadPenaltyVo, playPenaltyVo } from "./penalty-vo.js?v=2";
import { loadWedgeAmountVo, playWedgeAmountVo } from "./wedge-amount-vo.js?v=2";
import { PuzzleBoard } from "./board.js?v=2";
import { createWheel } from "./wheel.js?v=19";
import {
  createGameState,
  loadPuzzle,
  canSpin,
  canSpinFinalEnvelope,
  sealFinalEnvelope,
  revealFinalFreeLetter,
  beginFinalPickPhase,
  needsFinalEnvelopeReveal,
  markFinalEnvelopeRevealed,
  getHiddenTossUpSlots,
  revealTossUpTile,
  beginTossUpReveal,
  isTossUpActive,
  isTossUpAnnounce,
  canGuessLetter,
  canBuyVowel,
  canPickFinalLetter,
  pickFinalLetter,
  revealFinalPendingLetters,
  hasUncalledVowels,
  hasUncalledVowelsInAnswer,
  onlyVowelsRemain,
  canSolve,
  applySpinResult,
  guessConsonant,
  buyVowel,
  attemptSolve,
  startSpin,
  claimCarPrize,
  resolveSolvedRound,
  FINAL_FREE_LETTERS,
  VOWEL_COST,
  TOSS_UP_WIN,
} from "./game-state.js?v=17";
import { loadCarPrizes, pickRandomCar, getAllCars } from "./car-prizes.js?v=2";
import { loadCarPrizeVo, playCarPrizeVo } from "./car-prize-vo.js?v=1";
import { loadTripPrizes, getAllTrips } from "./trip-prizes.js?v=1";
import { loadTripPrizeVo, playTripPrizeVo } from "./trip-prize-vo.js?v=1";
import { showPrizeBanner, prizeSubtitleForWedge } from "./prize-banner.js?v=2";
import {
  loadFinalEnvelopeAmounts,
  buildEnvelopeWedges,
  getFinalEnvelopePrizes,
} from "./final-envelope-wheel.js?v=3";
import { showEnvelopeReveal } from "./final-envelope-ui.js?v=5";
import {
  loadFinalWinVo,
} from "./final-win-vo.js?v=1";
import {
  loadFinalLossVo,
} from "./final-loss-vo.js?v=1";
import {
  loadFinalGoodLuckVo,
  playRandomFinalGoodLuckVo,
} from "./final-good-luck-vo.js?v=2";
import { isVowel, isSolved, revealAllRows } from "./puzzle-layout.js?v=3";
import { stampVersion } from "./version.js?v=1";

const $ = (sel) => document.querySelector(sel);

const els = {
  category: $("#category-pill"),
  score: $("#score-pill"),
  roundMoney: $("#round-money-pill"),
  message: $("#message-bar"),
  board: $("#puzzle-board"),
  prizeBanner: $("#prize-banner"),
  wheelSection: $("#wheel-section"),
  wheelHost: $("#wheel-host"),
  finalEnvelopePanel: $("#final-envelope-panel"),
  envelopeTray: $("#envelope-tray"),
  sealedEnvelopeNote: $("#sealed-envelope-note"),
  envelopeRevealModal: $("#envelope-reveal-modal"),
  wedgeResult: $("#wedge-result"),
  btnSpin: $("#btn-spin"),
  btnVowel: $("#btn-vowel"),
  btnSolve: $("#btn-solve"),
  btnNew: $("#btn-new"),
  btnRound1: $("#btn-round1"),
  btnRound2: $("#btn-round2"),
  btnFinal: $("#btn-final"),
  btnTossUp: $("#btn-tossup"),
  letterGrid: $("#letter-grid"),
  loadingScreen: $("#loading-screen"),
  modal: $("#solve-modal"),
  solveInput: $("#solve-input"),
  solveTitle: $("#solve-title"),
  btnSolveSubmit: $("#btn-solve-submit"),
  btnSolveCancel: $("#btn-solve-cancel"),
};

const state = createGameState();
let board = new PuzzleBoard(els.board);
let wheelApi = null;
let puzzles = [];
let vowelMode = false;
let currentRound = "round1";
let tossUpRevealActive = false;
let tossUpRevealPaused = false;
let tossUpSessionId = 0;

/** Hidden test cheat: after a spin lands, ←/→ nudge one wedge and re-apply result. */
let cheatNudgeActive = false;
let cheatSnapshot = null;
let cheatNudgeBusy = false;

function captureCheatSnapshot() {
  return {
    roundBank: state.roundBank,
    roundPrize: state.roundPrize,
    pendingPrizeKind: state.pendingPrizeKind,
    carPrize: state.carPrize,
  };
}

function restoreCheatSnapshot() {
  if (!cheatSnapshot) return;
  state.roundBank = cheatSnapshot.roundBank;
  state.roundPrize = cheatSnapshot.roundPrize;
  state.pendingPrizeKind = cheatSnapshot.pendingPrizeKind;
  state.carPrize = cheatSnapshot.carPrize;
}

function enableCheatNudge() {
  cheatSnapshot = captureCheatSnapshot();
  cheatNudgeActive = true;
}

function disableCheatNudge() {
  cheatNudgeActive = false;
  cheatSnapshot = null;
  cheatNudgeBusy = false;
}

function applyCheatedWedge(wedge) {
  restoreCheatSnapshot();
  applySpinResult(state, wedge);
  updateHud();
}

async function handleCheatNudge(delta) {
  if (!cheatNudgeActive || cheatNudgeBusy || !wheelApi?.nudgeWedge) return;
  if (els.modal && !els.modal.classList.contains("is-hidden")) return;

  cheatNudgeBusy = true;
  try {
    const { wedge } = await wheelApi.nudgeWedge(delta);
    applyCheatedWedge(wedge);
  } finally {
    cheatNudgeBusy = false;
  }
}

const ROUND_LABELS = {
  round1: "Round 1",
  round2: "Round 2",
  final: "Final Round",
  tossup: "Toss-Up",
};

function setVowelMode(on) {
  vowelMode = on;
  els.btnVowel.classList.toggle("btn-vowel-active", vowelMode);
  els.letterGrid.classList.toggle("vowel-mode", vowelMode);
}

async function loadPuzzleData() {
  const useTv = new URLSearchParams(location.search).has("tv");
  const candidates = useTv
    ? ["data/puzzles.json", "data/puzzles.sample.json"]
    : ["data/puzzles-cdrom.json", "data/puzzles.json", "data/puzzles.sample.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      puzzles = data.puzzles || data;
      if (puzzles.length) return;
    } catch {
      /* try next */
    }
  }
}

function pickRandomPuzzle() {
  if (!puzzles.length) return null;
  return puzzles[Math.floor(Math.random() * puzzles.length)];
}

function setActiveRoundButton(roundType) {
  for (const btn of [els.btnRound1, els.btnRound2, els.btnFinal, els.btnTossUp]) {
    btn.classList.toggle("is-active", btn.dataset.round === roundType);
  }
}

function stopTossUpReveal() {
  tossUpRevealActive = false;
  tossUpRevealPaused = false;
}

function pauseTossUpReveal() {
  tossUpRevealPaused = true;
}

function resumeTossUpReveal() {
  tossUpRevealPaused = false;
}

const WHEEL_OVERLAY_HIDE_MS = 1800;
let wheelOverlayTimer = null;

function showWheelOverlay() {
  clearTimeout(wheelOverlayTimer);
  document.body.classList.add("is-wheel-active");
  els.wheelSection?.classList.add("is-wheel-visible");
}

function hideWheelOverlay(delayMs = WHEEL_OVERLAY_HIDE_MS) {
  clearTimeout(wheelOverlayTimer);
  const hide = () => {
    document.body.classList.remove("is-wheel-active");
    els.wheelSection?.classList.remove("is-wheel-visible");
  };
  if (delayMs <= 0) {
    hide();
    return;
  }
  wheelOverlayTimer = setTimeout(hide, delayMs);
}

async function loadWheelForRound(roundType) {
  els.wheelSection.classList.toggle("is-final-round", roundType === "final");
  els.wheelSection.classList.toggle("is-toss-up", roundType === "tossup");

  if (roundType === "tossup") {
    return;
  }

  if (roundType === "final") {
    if (!getFinalEnvelopePrizes().length) {
      await loadFinalEnvelopeAmounts();
    }
    const wedges = buildEnvelopeWedges(undefined, {
      cars: getAllCars(),
      trips: getAllTrips(),
    });
    els.wheelHost.innerHTML = "";
    wheelApi = await createWheel(els.wheelHost, wedges);
    return;
  }

  const url = roundType === "round2" ? "data/wedges-round2.json" : "data/wedges.json";
  const res = await fetch(url);
  const wedges = await res.json();
  els.wheelHost.innerHTML = "";
  wheelApi = await createWheel(els.wheelHost, wedges);
}

function updateHud() {
  els.category.textContent = state.puzzle?.category
    ? `${ROUND_LABELS[state.roundType] || state.roundType} · ${canonicalCategory(state.puzzle.category)}`
    : "—";
  els.score.textContent = `$${state.score.toLocaleString()}`;

  if (state.roundType === "final") {
    if (state.phase === "finalEnvelope") {
      els.roundMoney.textContent = "Spin for envelope";
    } else if (state.phase === "finalRevealFree") {
      els.roundMoney.textContent = "Free letters…";
    } else if (state.finalEnvelopeAmount != null || state.finalEnvelopePrize) {
      if (state.finalEnvelopePrize?.kind === "car") {
        els.roundMoney.textContent = "Bonus sealed ✉ CAR";
      } else if (state.finalEnvelopePrize?.kind === "trip") {
        els.roundMoney.textContent = "Bonus sealed ✉ TRIP";
      } else {
        els.roundMoney.textContent = "Bonus sealed ✉";
      }
    } else if (state.phase === "finalPick") {
      if (state.finalConsonantsLeft > 0) {
        els.roundMoney.textContent = `${state.finalConsonantsLeft} consonant(s) to pick`;
      } else {
        els.roundMoney.textContent = "Pick 1 vowel";
      }
    } else if (state.phase === "finalSolve") {
      els.roundMoney.textContent = "Solve the puzzle!";
    } else {
      els.roundMoney.textContent = "Final Round";
    }
  } else if (state.roundType === "tossup") {
    if (state.phase === "tossUpAnnounce") {
      els.roundMoney.textContent = "Category…";
    } else if (state.phase === "tossUpReveal") {
      els.roundMoney.textContent = `$${TOSS_UP_WIN.toLocaleString()} Toss-Up`;
    } else if (state.phase === "ended") {
      els.roundMoney.textContent = "Toss-Up complete";
    } else {
      els.roundMoney.textContent = "Toss-Up";
    }
  } else {
    const roundLabel = state.roundMoney
      ? `$${state.roundBank.toLocaleString()} (@ $${state.roundMoney}/letter)`
      : state.roundBank
        ? `$${state.roundBank.toLocaleString()}`
        : state.pendingPrizeKind === "car"
          ? "CAR — call a consonant"
          : state.carPrize
            ? `Car: ${state.carPrize.name}`
            : state.roundPrize
              ? `Prize: ${state.roundPrize}`
              : "—";
    els.roundMoney.textContent = roundLabel;
  }

  els.message.textContent = state.message;
  els.wedgeResult.textContent = state.lastWedge?.label ?? "—";

  els.btnSpin.disabled = !canSpin(state) || state.phase === "finalRevealFree";
  els.btnSpin.textContent = canSpinFinalEnvelope(state) ? "Spin Envelope" : "Spin";
  els.btnSpin.hidden = state.roundType === "tossup";
  els.btnVowel.hidden = state.roundType === "final" || state.roundType === "tossup";
  els.btnVowel.disabled = !canBuyVowel(state);
  els.btnSolve.disabled = !canSolve(state);
  els.btnSolve.textContent = isTossUpActive(state) ? "Ring In!" : "Solve";
  els.btnSolve.classList.toggle("btn-ring-in", isTossUpActive(state));

  document.querySelector(".controls")?.classList.toggle("toss-up-mode", state.roundType === "tossup");

  if (vowelMode && (!canBuyVowel(state) || state.roundType === "final")) {
    setVowelMode(false);
  }

  const inVowelMode = vowelMode && canBuyVowel(state);
  const inFinalLetterPhase =
    state.roundType === "final" && (state.phase === "finalPick" || state.phase === "finalSolve");
  els.letterGrid.classList.toggle("final-round-mode", inFinalLetterPhase);
  els.letterGrid.classList.toggle("toss-up-mode", state.roundType === "tossup");

  els.letterGrid.querySelectorAll("button").forEach((btn) => {
    const letter = btn.dataset.letter;
    const used = state.called.has(letter);
    const vowel = isVowel(letter);

    btn.classList.remove("vowel-pick", "vowel-hidden", "final-pick", "final-used", "final-unpicked");

    if (state.roundType === "tossup") {
      btn.disabled = true;
      return;
    }

    if (state.roundType === "final") {
      const picked = state.finalPendingPicks.includes(letter);
      if (used) {
        btn.classList.add("final-used");
        btn.disabled = true;
      } else if (picked) {
        btn.classList.add("final-picked");
        btn.disabled = true;
      } else if (state.phase === "finalPick" && canPickFinalLetter(state, letter)) {
        btn.classList.add("final-pick", "final-unpicked");
        btn.disabled = false;
      } else if (inFinalLetterPhase) {
        btn.classList.add("final-unpicked");
        btn.disabled = true;
      } else {
        btn.disabled = true;
      }
      return;
    }

    if (inVowelMode) {
      if (vowel && !used) {
        btn.classList.add("vowel-pick");
        btn.disabled = false;
      } else {
        btn.disabled = true;
      }
      return;
    }

    btn.disabled =
      used ||
      state.phase === "spinning" ||
      state.phase === "ended" ||
      state.phase === "idle" ||
      vowel ||
      !canGuessLetter(state);
  });
}

function shuffleLetters(letters) {
  const list = [...letters];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startNewPuzzle(roundType = currentRound) {
  stopAllVo();
  stopTossUpReveal();
  disableCheatNudge();
  tossUpSessionId += 1;
  const sessionId = tossUpSessionId;
  setVowelMode(false);
  currentRound = roundType;
  setActiveRoundButton(roundType);
  const entry = pickRandomPuzzle();
  if (!entry) {
    els.message.textContent = "No puzzles loaded.";
    return;
  }
  const layout = loadPuzzle(state, entry, { roundType });
  board.render(layout.rows);
  closeSolveModal();
  updateHud();

  if (roundType === "tossup") {
    startTossUpAfterCategory(entry, sessionId);
    return;
  }

  await warmCategoryVo(entry.category);
  playCategoryVo(entry.category);
}

async function startTossUpAfterCategory(entry, sessionId) {
  const category = canonicalCategory(entry.category);
  state.message = `The category is ${category}…`;
  updateHud();
  await warmCategoryVo(entry.category);
  await playCategoryVo(entry.category);

  if (sessionId !== tossUpSessionId) return;
  if (state.roundType !== "tossup" || state.phase !== "tossUpAnnounce") return;

  beginTossUpReveal(state);
  updateHud();
  revealTossUpLettersSequence();
}

async function revealTossUpLettersSequence() {
  stopTossUpReveal();
  tossUpRevealActive = true;

  while (tossUpRevealActive && state.phase === "tossUpReveal") {
    while (tossUpRevealPaused && tossUpRevealActive) {
      await sleep(100);
    }
    if (!tossUpRevealActive || state.phase !== "tossUpReveal") return;

    const hidden = getHiddenTossUpSlots(state);
    if (!hidden.length) break;

    const slot = hidden[Math.floor(Math.random() * hidden.length)];
    const result = revealTossUpTile(state, slot);
    if (result.ok && result.indices?.length) {
      state.message = state.tossUpLockedOut
        ? `Revealing ${result.letter}… (you're locked out)`
        : `Revealing ${result.letter}…`;
      updateHud();
      await board.revealTiles(result.indices, state.rows);
    }
    await sleep(450);
  }

  if (state.phase !== "tossUpReveal") return;

  if (state.tossUpLockedOut && getHiddenTossUpSlots(state).length === 0) {
    state.rows = revealAllRows(state.rows, state.puzzle.answer);
    state.phase = "ended";
    state.message = `Locked out. The answer was: ${state.puzzle.answer}`;
    await board.revealAll(state.rows);
    updateHud();
    return;
  }

  state.message = state.tossUpLockedOut
    ? "Locked out — watch the rest of the puzzle reveal."
    : "All letters out — ring in to solve!";
  updateHud();
}

async function revealFinalFreeLettersSequence() {
  await playRandomFinalGoodLuckVo();

  const letters = shuffleLetters(FINAL_FREE_LETTERS.split(""));
  for (const letter of letters) {
    state.message = `Revealing ${letter}…`;
    updateHud();

    const result = revealFinalFreeLetter(state, letter);
    if (result.ok && result.indices?.length) {
      await board.revealTiles(result.indices, state.rows);
    } else {
      playSound("miss", { volume: 0.25 });
    }
    await sleep(320);
  }

  const outcome = beginFinalPickPhase(state);
  updateHud();

  if (outcome.autoSolved) {
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
    await maybeRevealFinalEnvelope();
  }
}

async function maybeRevealFinalEnvelope() {
  if (!needsFinalEnvelopeReveal(state)) return;

  const amount = state.finalEnvelopeAmount ?? 0;
  const prize = state.finalEnvelopePrize;
  const won = state.finalWon === true;
  markFinalEnvelopeRevealed(state);
  await showEnvelopeReveal(els.envelopeRevealModal, { amount, won, prize });

  if (won) {
    if (prize?.kind === "car") {
      state.message = `Final Round won! You take home a ${prize.name}!`;
    } else if (prize?.kind === "trip") {
      state.message = `Final Round won! You take home ${prize.label}!`;
    } else {
      state.message = `Final Round won! $${amount.toLocaleString()} added to your total.`;
    }
  } else if (prize?.kind === "car") {
    state.message = `The envelope held a ${prize.name} — solve next time!`;
  } else if (prize?.kind === "trip") {
    state.message = `The envelope held ${prize.label} — solve next time!`;
  } else {
    state.message = `The envelope held $${amount.toLocaleString()} — solve next time!`;
  }
  updateHud();
}

async function handleFinalEnvelopeSpin() {
  if (!canSpinFinalEnvelope(state) || !wheelApi) return;

  els.btnSpin.disabled = true;
  setVowelMode(false);
  state.message = "Spinning for your bonus envelope…";
  updateHud();
  showWheelOverlay();

  try {
    const { index, wedge } = await wheelApi.spinRandom();
    sealFinalEnvelope(state, index, wedge);
    updateHud();
    await revealFinalFreeLettersSequence();
  } finally {
    hideWheelOverlay();
  }
}

async function switchRound(roundType) {
  if (roundType !== currentRound) {
    currentRound = roundType;
    await loadWheelForRound(roundType);
  }
  startNewPuzzle(roundType);
}

async function switchToTossUp() {
  stopTossUpReveal();
  if (currentRound !== "tossup") {
    currentRound = "tossup";
    await loadWheelForRound("tossup");
  }
  startNewPuzzle("tossup");
}

async function revealCarPrize() {
  const car = pickRandomCar();
  if (!car) {
    state.message = "CAR wedge hit, but no car prizes loaded.";
    updateHud();
    return null;
  }

  claimCarPrize(state, car);
  updateHud();
  playSound("solve", { volume: 0.45 });
  const bannerPromise = showPrizeBanner(els.prizeBanner, {
    title: "You Won!",
    subtitle: "New Car",
    name: car.name,
  });
  await playCarPrizeVo(car.id);
  await bannerPromise;
  return car;
}

async function revealTripPrize(trip) {
  if (!trip?.label) return;
  playSound("solve", { volume: 0.45 });
  const bannerPromise = showPrizeBanner(els.prizeBanner, {
    title: "You Won!",
    subtitle: "Vacation Trip",
    name: trip.label,
  });
  if (trip.id) await playTripPrizeVo(trip.id);
  await bannerPromise;
}

async function revealGenericPrize(prizeReveal) {
  if (!prizeReveal?.name) return;
  playSound("solve", { volume: 0.45 });
  await showPrizeBanner(els.prizeBanner, {
    title: "You Won!",
    subtitle: prizeReveal.subtitle || prizeSubtitleForWedge(prizeReveal.wedgeLabel, "prize"),
    name: prizeReveal.name,
  });
}

async function handlePrizeReveal(result) {
  if (result.prizeKind === "car" || result.prizeReveal?.kind === "car") {
    await revealCarPrize();
  } else if (result.prizeReveal?.kind === "trip") {
    await revealTripPrize(result.prizeReveal.trip || state.tripPrize);
  } else if (result.prizeReveal) {
    await revealGenericPrize(result.prizeReveal);
  } else if (result.needsCarReveal) {
    await revealCarPrize();
  }

  if (result.solvedAfterCar) {
    resolveSolvedRound(state);
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
  } else if (result.onlyVowelsReached) {
    await playOnlyVowelsRemainVo();
  }
  updateHud();
}

async function handleSpin() {
  if (canSpinFinalEnvelope(state)) {
    await handleFinalEnvelopeSpin();
    return;
  }
  if (!canSpin(state) || !wheelApi) return;
  disableCheatNudge();
  setVowelMode(false);
  startSpin(state);
  updateHud();
  showWheelOverlay();

  try {
    const { wedge } = await wheelApi.spinRandom();
    enableCheatNudge();
    applySpinResult(state, wedge);

    if (wedge.type === "bankrupt" || wedge.type === "loseTurn") {
      await playPenaltyVo(wedge.type);
    } else if (wedge.type === "prize") {
      if (wedge.prizeKind === "car") {
        playSound("land", { volume: 0.45 });
      } else {
        playSound("solve", { volume: 0.35 });
      }
    } else if (wedge.value > 0) {
      playWedgeAmountVo(wedge.value);
    }

    updateHud();
  } finally {
    hideWheelOverlay();
  }
}

async function handleLetter(letter) {
  if (state.called.has(letter)) return;
  disableCheatNudge();

  let result;

  if (state.roundType === "final") {
    if (state.phase !== "finalPick") return;
    result = pickFinalLetter(state, letter);
    if (!result?.ok) return;

    playSound("tick", { volume: 0.35 });

    if (result.readyToReveal) {
      updateHud();
      state.message = "Revealing your letters…";
      updateHud();
      const revealResult = revealFinalPendingLetters(state);
      if (revealResult.indices?.length) {
        playSound("land", { volume: 0.45 });
        await board.revealTiles(revealResult.indices, state.rows);
      } else {
        playSound("miss", { volume: 0.4 });
      }
      if (revealResult.solved) {
        playSound("solve", { volume: 0.55 });
        await playRandomSolveCongrats();
        await maybeRevealFinalEnvelope();
      }
    }

    updateHud();
    return;
  }

  if (isVowel(letter)) {
    if (!vowelMode || !canBuyVowel(state)) return;
    playSound("vowel", { volume: 0.5 });
    result = buyVowel(state, letter);
  } else {
    if (!canGuessLetter(state)) return;
    result = guessConsonant(state, letter);
    if (result.ok && !result.hit && !result.turnLost) {
      playSound("miss", { volume: 0.55 });
      await playMissVo(letter);
    } else if (result.ok && !result.hit) {
      playSound("miss", { volume: 0.6 });
    }
  }

  if (!result?.ok) return;

  if (result.indices?.length) {
    await board.revealTiles(result.indices, state.rows);
  }

  if (result.needsPrizeReveal || result.needsCarReveal) {
    await handlePrizeReveal(result);
    return;
  }

  if (result.hit && result.count >= 1 && result.count <= 3 && !result.solved) {
    await playHitVo(letter, result.count);
  }

  if (result.onlyVowelsReached) {
    await playOnlyVowelsRemainVo();
  } else if (result.noMoreVowels) {
    await playNoMoreVowelsVo();
  }

  if (result.solved) {
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
  } else if (isVowel(letter) && result.ok && !result.hit && !result.turnLost) {
    await playMissVo(letter);
  }

  if (isVowel(letter)) {
    if (!hasUncalledVowels(state)) {
      setVowelMode(false);
    } else if (vowelMode && result.hit && hasUncalledVowelsInAnswer(state)) {
      state.message = `Pick a vowel ($${VOWEL_COST}).`;
    }
  }

  updateHud();
}

function handleBuyVowelClick() {
  disableCheatNudge();
  if (vowelMode) {
    setVowelMode(false);
    updateHud();
    return;
  }

  if (state.phase !== "guess" && !(state.phase === "idle" && onlyVowelsRemain(state))) {
    return;
  }
  if (isSolved(state.rows)) return;

  if (!hasUncalledVowels(state)) {
    state.message = "No More Vowels";
    updateHud();
    return;
  }

  if (state.roundBank < VOWEL_COST) {
    state.message = `Need $${VOWEL_COST} in your round bank to buy a vowel.`;
    updateHud();
    return;
  }

  setVowelMode(true);
  state.message = `Pick a vowel ($${VOWEL_COST}).`;
  updateHud();
}

function openSolveModal() {
  if (!canSolve(state)) return;
  disableCheatNudge();
  setVowelMode(false);
  if (isTossUpActive(state)) {
    pauseTossUpReveal();
    playSound("land", { volume: 0.5 });
  }
  els.modal.classList.remove("is-hidden");
  els.solveInput.value = "";
  if (isTossUpActive(state)) {
    els.solveTitle.textContent = "Ring In!";
    els.solveInput.placeholder = "Answer immediately…";
  } else {
    els.solveTitle.textContent = "Solve the Puzzle";
    els.solveInput.placeholder = "Type the full phrase…";
  }
  els.solveInput.focus();
}

function closeSolveModal() {
  els.modal.classList.add("is-hidden");
  if (isTossUpActive(state)) {
    resumeTossUpReveal();
  }
}

async function handleSolveSubmit() {
  const isTossUp = state.roundType === "tossup";
  const result = attemptSolve(state, els.solveInput.value);
  closeSolveModal();

  if (result.correct) {
    stopTossUpReveal();
    await board.revealAll(state.rows);
    playSound("solve", { volume: 0.55 });
    await playRandomSolveCongrats();
    if (!isTossUp) {
      await maybeRevealFinalEnvelope();
    }
  } else if (result.ok) {
    playSound("miss", { volume: 0.6 });
    if (isTossUp && result.lockedOut) {
      resumeTossUpReveal();
      if (getHiddenTossUpSlots(state).length === 0) {
        state.rows = revealAllRows(state.rows, state.puzzle.answer);
        state.phase = "ended";
        state.message = `Locked out. The answer was: ${state.puzzle.answer}`;
        stopTossUpReveal();
        await board.revealAll(state.rows);
      }
    } else if (result.revealAnswer) {
      await board.revealAll(state.rows);
    }
    if (!isTossUp) {
      await maybeRevealFinalEnvelope();
    }
  }
  updateHud();
}

function buildLetterGrid() {
  els.letterGrid.innerHTML = "";
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "letter-btn";
    btn.dataset.letter = letter;
    btn.textContent = letter;
    btn.addEventListener("click", () => handleLetter(letter));
    els.letterGrid.appendChild(btn);
  }
}

function wireEvents() {
  els.btnSpin.addEventListener("click", handleSpin);
  els.btnVowel.addEventListener("click", handleBuyVowelClick);
  els.btnSolve.addEventListener("click", openSolveModal);
  els.btnNew.addEventListener("click", () => startNewPuzzle());
  els.btnRound1.addEventListener("click", () => switchRound("round1"));
  els.btnRound2.addEventListener("click", () => switchRound("round2"));
  els.btnFinal.addEventListener("click", () => switchRound("final"));
  els.btnTossUp.addEventListener("click", () => switchToTossUp());
  els.btnSolveSubmit.addEventListener("click", handleSolveSubmit);
  els.btnSolveCancel.addEventListener("click", closeSolveModal);
  els.solveInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSolveSubmit();
    if (e.key === "Escape") closeSolveModal();
  });

  document.addEventListener("keydown", (e) => {
    if (!cheatNudgeActive) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (els.modal && !els.modal.classList.contains("is-hidden")) return;
    if (document.activeElement === els.solveInput) return;
    e.preventDefault();
    handleCheatNudge(e.key === "ArrowLeft" ? -1 : 1);
  });
}

async function init() {
  stampVersion();
  buildLetterGrid();
  wireEvents();

  const loading = createLoadingProgress(els.loadingScreen);
  await runLoadingTasks(loading, [
    ["Loading essentials…", Promise.all([
      preloadEssential(),
      loadCategoryVo(),
      loadMissVo(),
      loadHitVo(),
    ])],
    ["Loading puzzles…", loadPuzzleData()],
    ["Building wheel…", loadWheelForRound("round1")],
  ]);
  runInBackground(
    () => preloadRemaining(),
    () => loadSolveCongratsVo(),
    () => loadMilestoneVo(),
    () => loadPenaltyVo(),
    () => loadWedgeAmountVo(),
    () => loadFinalEnvelopeAmounts(),
    () => loadFinalGoodLuckVo(),
    () => loadFinalWinVo(),
    () => loadFinalLossVo(),
    () => loadCarPrizes(),
    () => loadTripPrizes(),
    () => loadCarPrizeVo(),
    () => loadTripPrizeVo(),
  );

  startNewPuzzle("round1");
}

init().catch((err) => {
  console.error(err);
  document.body.classList.remove("is-loading");
  els.loadingScreen?.classList.add("is-hidden");
  els.message.textContent = "Failed to load game.";
});
