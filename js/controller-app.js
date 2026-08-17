import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, getSeatFromUrl, getNameFromUrl } from "./net/config.js?v=1";
import { stampVersion } from "./version.js?v=1";
import { runInBackground } from "./progressive-load.js?v=1";
import { preloadEssential, preloadRemaining, playSound } from "./audio.js?v=9";

const VOWELS = "AEIOU";

const $ = (id) => document.getElementById(id);

const els = {
  playerTitle: $("player-title"),
  controllerMeta: $("controller-meta"),
  turnBanner: $("turn-banner"),
  spinPanel: $("spin-panel"),
  letterPanel: $("letter-panel"),
  actionPanel: $("action-panel"),
  spinGaugeFill: $("spin-gauge-fill"),
  btnSpinHold: $("btn-spin-hold"),
  spinHint: $("spin-hint"),
  letterGrid: $("letter-grid"),
  btnVowel: $("btn-vowel"),
  btnSolve: $("btn-solve"),
  tossupPanel: $("tossup-panel"),
  tossupHint: $("tossup-hint"),
  btnBuzzLarge: $("btn-buzz-large"),
  tossupSolvePanel: $("tossup-solve-panel"),
  tossupSolveInput: $("tossup-solve-input"),
  btnTossupSolveSubmit: $("btn-tossup-solve-submit"),
  finalSolvePanel: $("final-solve-panel"),
  finalTimerDisplay: $("final-timer-display"),
  btnFinalSolve: $("btn-final-solve"),
  controllerStatus: $("controller-status"),
  solveModal: $("solve-modal"),
  solveInput: $("solve-input"),
  btnSolveSubmit: $("btn-solve-submit"),
  btnSolveCancel: $("btn-solve-cancel"),
};

let client = null;
let mySeat = getSeatFromUrl();
let myName = getNameFromUrl() || "Player";
let roomCode = getRoomFromUrl();
let isMyTurn = false;
let vowelMode = false;
let spinPower = 0;
let spinDirection = 1;
let spinAnim = null;
/** @type {null | Record<string, unknown>} */
let gameState = null;
let audioReady = false;
let awaitingSolveResult = false;

function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  preloadEssential().catch(() => {});
  runInBackground(() => preloadRemaining());
}

function sfx(name, opts = {}) {
  unlockAudio();
  playSound(name, opts);
}

function isVowel(letter) {
  return VOWELS.includes(letter);
}

function setStatus(text) {
  els.controllerStatus.textContent = text;
}

function setVowelMode(on) {
  vowelMode = on;
  els.btnVowel.classList.toggle("btn-vowel-active", vowelMode);
  els.btnVowel.textContent = vowelMode ? "Cancel Vowel" : "Buy Vowel ($250)";
  els.letterGrid.classList.toggle("vowel-mode", vowelMode);
  updateControls();
}

function setTurnActive(active) {
  isMyTurn = active;
  if (gameState?.roundType === "tossup") {
    els.turnBanner.textContent = active
      ? "You rang in — type your answer!"
      : gameState?.phase === "tossUpCountdown"
        ? "Get ready…"
        : "Toss-Up in progress…";
  } else {
    els.turnBanner.textContent = active ? "Your turn!" : "Waiting for other players…";
  }
  els.turnBanner.classList.toggle("is-your-turn", active);
  if (!active) setVowelMode(false);
  updateControls();
  if (active && navigator.vibrate) navigator.vibrate([80, 40, 80]);
}

function syncCalledLetters(called = [], pending = []) {
  const used = new Set([...called, ...pending]);
  for (const btn of els.letterGrid.querySelectorAll(".letter-btn")) {
    btn.dataset.used = used.has(btn.dataset.letter) ? "1" : "";
  }
}

function isTossUpMode(state = gameState) {
  return state?.roundType === "tossup";
}

function formatFinalTimer(ms) {
  const sec = Math.max(0, Math.ceil((ms || 0) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function applyFinalLayout() {
  const isFinal = gameState?.roundType === "final";
  if (!isFinal) {
    document.body.classList.remove("is-final-mode", "is-final-solve-mode");
    els.finalSolvePanel?.classList.add("is-hidden");
    return;
  }

  const envelope = gameState?.phase === "finalEnvelope";
  const pick = gameState?.phase === "finalPick";
  const solve = gameState?.phase === "finalSolve";
  const mine = isMyTurn && client?.connected;

  document.body.classList.toggle("is-final-mode", isFinal);
  document.body.classList.toggle("is-final-solve-mode", solve && mine);

  els.spinPanel?.classList.toggle("is-hidden", !envelope);
  els.letterPanel?.classList.toggle("is-hidden", !pick);
  els.actionPanel?.classList.toggle("is-hidden", !isFinal ? false : pick || solve);
  els.finalSolvePanel?.classList.toggle("is-hidden", !solve || !mine);

  if (solve && mine && gameState?.finalTimerRemainingMs != null) {
    const label = formatFinalTimer(gameState.finalTimerRemainingMs);
    if (els.finalTimerDisplay) els.finalTimerDisplay.textContent = label;
    if (gameState.finalTimerPaused) {
      setStatus("Enter your solve!");
    } else {
      setStatus(`${label} — tap SOLVE when ready!`);
    }
  }

  if (els.btnFinalSolve) {
    els.btnFinalSolve.disabled = !mine || !gameState?.canSolve;
  }
}

function applyTossUpLayout() {
  const tossup = isTossUpMode();
  const countdown = gameState?.phase === "tossUpCountdown";
  const reveal = gameState?.phase === "tossUpReveal";
  const locked = new Set(gameState?.tossUpLockedSeats || []);
  const canRing = client?.connected && !!gameState?.canRingIn && !locked.has(mySeat);
  const solving = tossup && reveal && gameState?.activeSeat === mySeat;

  document.body.classList.toggle("is-tossup-mode", tossup);

  els.spinPanel?.classList.toggle("is-hidden", tossup);
  els.letterPanel?.classList.toggle("is-hidden", tossup);
  els.actionPanel?.classList.toggle("is-hidden", tossup);
  els.tossupPanel?.classList.toggle("is-hidden", !tossup || solving);
  els.tossupSolvePanel?.classList.toggle("is-hidden", !solving);

  if (els.btnBuzzLarge) els.btnBuzzLarge.disabled = !canRing;

  if (tossup && countdown) {
    els.tossupHint.textContent = "Get ready…";
  } else if (tossup && reveal && !solving) {
    els.tossupHint.textContent = locked.has(mySeat)
      ? "You're locked out for this Toss-Up."
      : "Ring in when you know the answer!";
  }

  if (solving && els.tossupSolveInput && document.activeElement !== els.tossupSolveInput) {
    els.tossupSolveInput.focus();
  }
}

function updateControls() {
  const connected = client?.connected;
  const tossup = isTossUpMode();
  const mine = isMyTurn && connected;
  const locked = new Set(gameState?.tossUpLockedSeats || []);
  const canRing = connected && !!gameState?.canRingIn && !locked.has(mySeat);
  const canSpin = mine && !!gameState?.canSpin && !vowelMode;
  const canBuy = mine && !!gameState?.canBuyVowel;
  const canGuess = mine && (!!gameState?.canGuess || !!gameState?.canPickFinal);
  const canSolve = mine && !!gameState?.canSolve;

  applyTossUpLayout();
  applyFinalLayout();

  if (tossup) return;

  const isFinal = gameState?.roundType === "final";
  const finalEnvelopeSpin = isFinal && gameState?.phase === "finalEnvelope" && gameState?.canSpin;

  if (els.btnSpinHold) {
    els.btnSpinHold.textContent = finalEnvelopeSpin ? "Hold to Spin Envelope" : "Hold to Spin";
    els.btnSpinHold.disabled = !canSpin;
  }
  if (els.spinHint) {
    if (finalEnvelopeSpin) {
      els.spinHint.textContent = "Seal your bonus envelope — category comes next.";
    } else if (isFinal && gameState?.phase === "finalPuzzleReveal") {
      els.spinHint.textContent = "Watch the board — category coming up…";
    } else if (isFinal && gameState?.phase === "finalRevealFree") {
      els.spinHint.textContent = "Free letters R, S, T, L, N, E revealing…";
    } else if (!isFinal) {
      els.spinHint.textContent = "Release to set your spin strength.";
    }
  }

  const inFinalPick = !!gameState?.canPickFinal;
  els.letterGrid?.classList.toggle("final-round-mode", inFinalPick);

  if (vowelMode && !canBuy) setVowelMode(false);

  els.btnSpinHold.disabled = !canSpin;
  els.btnVowel.disabled = !mine || (!vowelMode && !canBuy);
  els.btnSolve.disabled = !canSolve;

  const called = new Set(gameState?.called || []);
  const inVowelMode = vowelMode && canBuy;

  for (const btn of els.letterGrid.querySelectorAll(".letter-btn")) {
    const letter = btn.dataset.letter;
    const pending = new Set(gameState?.finalPendingPicks || []);
    const used = called.has(letter) || pending.has(letter) || btn.dataset.used === "1";
    const vowel = isVowel(letter);

    btn.classList.remove("vowel-pick", "vowel-hidden", "final-pick", "final-unpicked", "final-used");

    if (!mine && !gameState?.canPickFinal) {
      btn.disabled = true;
      continue;
    }

    if (inVowelMode) {
      if (vowel && !used) {
        btn.classList.add("vowel-pick");
        btn.disabled = false;
      } else {
        if (!vowel) btn.classList.add("vowel-hidden");
        btn.disabled = true;
      }
      continue;
    }

    if (gameState?.canPickFinal) {
      const isFinalVowel = vowel && gameState.finalConsonantsLeft === 0;
      const isFinalConsonant = !vowel && (gameState.finalConsonantsLeft ?? 0) > 0;
      btn.disabled = used || (!isFinalVowel && !isFinalConsonant);
      if (!btn.disabled) btn.classList.add("final-pick", "final-unpicked");
      else if (used) btn.classList.add("final-used");
      else btn.classList.add("final-unpicked");
      continue;
    }

    btn.disabled =
      used ||
      vowel ||
      !canGuess ||
      gameState?.phase === "ended" ||
      gameState?.phase === "spinning";
  }
}

function buildLetterGrid() {
  els.letterGrid.innerHTML = "";
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn letter-btn";
    btn.dataset.letter = letter;
    btn.textContent = letter;
    btn.disabled = true;
    btn.addEventListener("click", () => handleLetter(letter));
    els.letterGrid.appendChild(btn);
  }
}

function handleLetter(letter) {
  if (!client?.connected) return;

  if (gameState?.canPickFinal && isMyTurn) {
    client.guessLetter(letter);
    setStatus(`Picked ${letter}.`);
    return;
  }

  if (!isMyTurn) return;

  if (vowelMode) {
    if (!isVowel(letter)) return;
    sfx("vowel", { volume: 0.5 });
    client.buyVowel(letter);
    setStatus(`Buying vowel ${letter}…`);
    return;
  }

  if (isVowel(letter)) return;
  sfx("tick", { volume: 0.45 });
  client.guessLetter(letter);
  setStatus(`Called ${letter}.`);
}

function syncTurnFromState(state) {
  if (!mySeat || !state?.started) return;
  if (state.roundType === "tossup") {
    setTurnActive(state.activeSeat === mySeat);
    return;
  }
  if (!state.activeSeat) return;
  const mine = state.activeSeat === mySeat;
  if (mine === isMyTurn) return;
  setTurnActive(mine);
}

function actionFlags(state) {
  if (!state?.started) {
    return { canSpin: false, canGuess: false, canBuyVowel: false, canSolve: false, canRingIn: false, canPickFinal: false };
  }
  const locked = new Set(state.tossUpLockedSeats || []);
  const canRingIn = !!state.canRingIn && !locked.has(mySeat);
  const mine = state.activeSeat === mySeat;
  return {
    canSpin: mine && !!state.canSpin,
    canGuess: mine && !!state.canGuess,
    canBuyVowel: mine && !!state.canBuyVowel,
    canSolve: mine && !!state.canSolve && (state.roundType !== "tossup" || state.activeSeat === mySeat),
    canRingIn,
    canPickFinal: mine && !!state.canPickFinal,
  };
}

function applyGameState(state) {
  gameState = state ? { ...state, ...actionFlags(state) } : null;
  syncCalledLetters(state?.called || [], state?.finalPendingPicks || []);
  syncTurnFromState(state);
  if (vowelMode && !gameState?.canBuyVowel) setVowelMode(false);
  updateControls();

  if (state?.roundType === "tossup") {
    if (state.phase === "tossUpCountdown") {
      setStatus("Get ready…");
    } else if (state.phase === "tossUpReveal" && state.activeSeat !== mySeat) {
      setStatus(state.message || "Toss-Up in progress…");
    }
    return;
  }

  if (state?.roundType === "final") {
    if (state.phase === "finalEnvelope" && isMyTurn) {
      setStatus("Spin to seal your bonus envelope!");
    } else if (state.phase === "finalPuzzleReveal") {
      setStatus("Watch the board — category coming up…");
    } else if (state.phase === "finalRevealFree") {
      setStatus("R, S, T, L, N, and E are being revealed…");
    } else if (state.phase === "finalPick" && isMyTurn) {
      const cLeft = state.finalConsonantsLeft ?? 0;
      const vLeft = state.finalVowelsLeft ?? 0;
      if (cLeft > 0) {
        setStatus(`Pick ${cLeft} consonant${cLeft === 1 ? "" : "s"}…`);
      } else if (vLeft > 0) {
        setStatus("Pick 1 vowel…");
      } else {
        setStatus("Pick 3 consonants and 1 vowel.");
      }
    }
    return;
  }

  if (!isMyTurn || !state) return;

  if (state.roundMoney > 0 && state.roundBank > 0) {
    setStatus(`$${state.roundBank.toLocaleString()} bank · $${state.roundMoney}/letter`);
  } else if (state.roundMoney > 0) {
    setStatus(`$${state.roundMoney} per letter — pick a consonant.`);
  } else if (state.roundBank > 0) {
    setStatus(`Round bank: $${state.roundBank.toLocaleString()}`);
  } else if (state.phase === "idle") {
    setStatus("Spin the wheel!");
  } else if (state.message) {
    setStatus(state.message);
  }
}

function startSpinGauge() {
  if (!isMyTurn || spinAnim || vowelMode || !gameState?.canSpin) return;
  spinPower = 0;
  spinDirection = 1;
  els.btnSpinHold.classList.add("is-holding");
  spinAnim = window.setInterval(() => {
    spinPower += spinDirection * 0.035;
    if (spinPower >= 1) {
      spinPower = 1;
      spinDirection = -1;
    } else if (spinPower <= 0) {
      spinPower = 0;
      spinDirection = 1;
    }
    els.spinGaugeFill.style.width = `${Math.round(spinPower * 100)}%`;
  }, 40);
}

function stopSpinGauge() {
  if (!spinAnim) return;
  window.clearInterval(spinAnim);
  spinAnim = null;
  els.btnSpinHold.classList.remove("is-holding");
  if (!isMyTurn || !client?.connected || vowelMode) return;
  sfx("spin", { volume: 0.55 });
  client.spin(Number(spinPower.toFixed(3)));
  setStatus(`Spin sent (${Math.round(spinPower * 100)}% power).`);
  els.spinGaugeFill.style.width = "0%";
  spinPower = 0;
}

function openSolveModal() {
  if (!client?.connected || !gameState?.canSolve) return;
  setVowelMode(false);
  client.solveIntent();
  els.solveModal.classList.remove("is-hidden");
  els.solveInput.value = "";
  els.solveInput.focus();
  setStatus("Attempting to solve…");
}

function closeSolveModal() {
  els.solveModal.classList.add("is-hidden");
}

function submitSolve() {
  const text = els.solveInput.value.trim();
  if (!text || !client?.connected) return;
  awaitingSolveResult = true;
  client.solve(text);
  closeSolveModal();
  setStatus("Solve submitted.");
}

function submitTossUpSolve() {
  const text = els.tossupSolveInput?.value.trim();
  if (!text || !client?.connected) return;
  awaitingSolveResult = true;
  client.solve(text);
  els.tossupSolveInput.value = "";
  setStatus("Answer submitted.");
}

function ringIn() {
  if (!client?.connected || !gameState?.canRingIn) return;
  sfx("buzz", { volume: 0.65 });
  client.buzz();
  setStatus("Ringing in…");
  if (navigator.vibrate) navigator.vibrate(120);
}

function showWrongSolveFeedback(text, { mine = false } = {}) {
  els.turnBanner.textContent = text;
  els.turnBanner.classList.toggle("is-wrong", mine);
  setStatus(text);
  if (mine) {
    window.setTimeout(() => els.turnBanner.classList.remove("is-wrong"), 4500);
  }
}

function onMessage(msg) {
  switch (msg.op) {
    case "hello":
      stampVersion("#app-version", msg.version);
      break;
    case "joined":
    case "rejoined":
      mySeat = msg.seat;
      roomCode = msg.code;
      myName = msg.name || myName;
      els.playerTitle.textContent = myName;
      els.controllerMeta.textContent = `Room ${roomCode} · ${mySeat.toUpperCase()}`;
      if (msg.gameStarted) setStatus("Game in progress — waiting for state…");
      else setStatus("Connected. Waiting for host…");
      break;
    case "gameStarted":
      setStatus("Game started!");
      break;
    case "turnChanged":
      if (msg.seat) mySeat = mySeat || msg.seat;
      setTurnActive(msg.seat === mySeat);
      if (msg.seat === mySeat) setStatus(msg.message || "Your turn!");
      break;
    case "tossUpCountdown":
      if (msg.count > 0) {
        setStatus(`Get ready… ${msg.count}`);
      } else {
        setStatus("Letters revealing — ring in when you know it!");
      }
      break;
    case "gameUpdate":
      if (awaitingSolveResult && msg.state?.tossUpLockedSeats?.includes(mySeat)) {
        awaitingSolveResult = false;
        sfx("miss", { volume: 0.55 });
        showWrongSolveFeedback("Wrong! Locked out of this Toss-Up.", { mine: true });
        setTurnActive(false);
      }
      applyGameState(msg.state);
      break;
    case "solveWrong":
      awaitingSolveResult = false;
      if (msg.seat === mySeat) {
        sfx("miss", { volume: 0.55 });
        if (msg.resumeFinalTimer) {
          showWrongSolveFeedback("Wrong answer — time still running!", { mine: true });
          if (gameState?.finalTimerRemainingMs != null) {
            setStatus(`${formatFinalTimer(gameState.finalTimerRemainingMs)} left — tap SOLVE to try again!`);
          }
        } else if (msg.lockedOut) {
          showWrongSolveFeedback("Wrong answer — locked out of this Toss-Up.", { mine: true });
          setTurnActive(false);
        } else {
          showWrongSolveFeedback("Wrong answer — you lose your turn.", { mine: true });
        }
      } else {
        setStatus(msg.message || `${msg.name || msg.seat}'s solve was wrong.`);
      }
      break;
    case "buzzWinner":
      if (msg.seat === mySeat) {
        setTurnActive(true);
        setStatus("You rang in! Type your answer below.");
        els.tossupSolveInput?.focus();
      } else {
        setStatus(`${msg.name || msg.seat} rang in to solve.`);
      }
      break;
    case "letterResult":
      if (msg.finalPick) {
        if (msg.seat === mySeat) setStatus(`You picked ${msg.letter}.`);
        break;
      }
      if (msg.seat === mySeat) {
        if (msg.hit) sfx("reveal", { volume: 0.5 });
        else sfx("miss", { volume: 0.45 });
        setStatus(msg.hit ? `${msg.count} ${msg.letter}'s!` : `No ${msg.letter}'s.`);
        if (vowelMode && isVowel(msg.letter)) setVowelMode(false);
      }
      break;
    case "spinResult":
      if (msg.seat === mySeat) {
        const wedge = msg.wedge;
        if (wedge?.type === "bankrupt" || wedge?.type === "loseTurn") {
          sfx("bankrupt", { volume: 0.5 });
        } else {
          sfx("land", { volume: 0.45 });
        }
      }
      break;
    case "solveResult":
      awaitingSolveResult = false;
      if (msg.seat === mySeat) sfx("solve", { volume: 0.55 });
      break;
    case "finalTimerStart":
    case "finalTimerTick":
      if (gameState) {
        gameState.finalTimerRemainingMs = msg.remainingMs;
        applyFinalLayout();
      }
      break;
    case "finalTimerExpired":
      if (msg.seat === mySeat) {
        setStatus(msg.message || "Time's up!");
        setTurnActive(false);
      }
      break;
    case "finalEnvelopeSealed":
      if (msg.seat === mySeat) setStatus("Envelope sealed — watch the board for the category.");
      break;
    case "finalRstlneStart":
      setStatus("R, S, T, L, N, and E coming up on the board…");
      break;
    case "finalPickStart":
      if (isMyTurn) setStatus("Pick 3 consonants and 1 vowel.");
      break;
    case "error":
      setStatus(msg.message || msg.error || "Error.");
      break;
    default:
      break;
  }
}

async function connect() {
  const wsUrl = getWsUrl();
  if (!roomCode || !mySeat) {
    setStatus("Missing room or seat. Join from join.html first.");
    return;
  }
  if (!wsUrl) {
    setStatus("Missing WebSocket URL.");
    return;
  }

  els.playerTitle.textContent = myName;
  els.controllerMeta.textContent = `Room ${roomCode} · ${mySeat.toUpperCase()}`;

  client = new WofClient({ onMessage, onClose: () => setStatus("Disconnected.") });
  try {
    await client.connect(wsUrl);
    client.rejoinRoom(roomCode, mySeat, myName);
    setStatus("Connected.");
  } catch {
    setStatus("Could not connect.");
  }
}

document.body.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });

els.btnSpinHold.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  unlockAudio();
  startSpinGauge();
});

els.btnSpinHold.addEventListener("pointerup", stopSpinGauge);
els.btnSpinHold.addEventListener("pointerleave", stopSpinGauge);
els.btnSpinHold.addEventListener("pointercancel", stopSpinGauge);

els.btnVowel.addEventListener("click", () => {
  if (!isMyTurn) return;
  if (vowelMode) {
    setVowelMode(false);
    setStatus("Consonant mode.");
    return;
  }
  if (!gameState?.canBuyVowel) {
    const bank = gameState?.roundBank ?? 0;
    setStatus(`Need $250 in your round bank (you have $${bank}).`);
    return;
  }
  setVowelMode(true);
  setStatus("Pick a vowel ($250).");
});

els.btnSolve.addEventListener("click", openSolveModal);
els.btnFinalSolve?.addEventListener("click", openSolveModal);
els.btnSolveCancel.addEventListener("click", closeSolveModal);
els.btnSolveSubmit.addEventListener("click", submitSolve);
els.btnBuzzLarge?.addEventListener("click", ringIn);
els.btnTossupSolveSubmit?.addEventListener("click", submitTossUpSolve);

els.tossupSolveInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitTossUpSolve();
});

els.solveInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSolve();
  if (e.key === "Escape") closeSolveModal();
});

buildLetterGrid();
updateControls();
stampVersion();
connect().catch(() => {});
