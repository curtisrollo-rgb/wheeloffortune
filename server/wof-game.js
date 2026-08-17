/** Authoritative Wheel of Fortune game state (multiplayer — full game rounds). */

import {
  layoutPuzzle,
  buildLetterMap,
  revealWithMap,
  revealAllRows,
  isVowel,
  isSolved,
  guessesMatch,
  emptyBoardRows,
} from "./puzzle-layout.js";
import { getPlayerBySeat, playerSummaries } from "./rooms.js";
import { pickRandomPuzzle, puzzleCount } from "./puzzles.js";
import { getWedgesForRound } from "./wedges.js";
import { pickRandomTrip } from "./trip-prizes.js";
import { pickRandomCar } from "./car-prizes.js";
import { randomBytes } from "crypto";
import {
  TOSS_UP_WIN,
  FINAL_FREE_LETTERS,
  onlyVowelsRemain,
  hasHiddenConsonants,
  getHiddenTossUpSlots,
  revealTossUpTile,
  beginTossUpReveal,
  sealFinalEnvelope,
  revealFinalFreeLetter,
  beginFinalPickPhase,
  pickFinalLetter,
  revealFinalPendingLetters,
  resetRoundFields,
  setupRoundPhase,
  bankFinalWin,
  revealAllForAnswer,
} from "./round-helpers.js";

export const VOWEL_COST = 250;
export const MIN_ROUND_WIN = 1000;
export const FINAL_SOLVE_MS = 30000;

/** @type {Map<string, NodeJS.Timeout>} */
const finalTimers = new Map();

function stopFinalTimer(code) {
  const timer = finalTimers.get(code);
  if (timer) clearInterval(timer);
  finalTimers.delete(code);
}

/** @param {import('./rooms.js').Room} room */
export function pauseFinalTimer(room) {
  if (!room.game || room.game.finalTimerPaused) return;
  room.game.finalTimerPaused = true;
  stopFinalTimer(room.code);
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
export function resumeFinalTimer(room, emit) {
  if (!room.game || !room.game.finalTimerPaused) return;
  room.game.finalTimerPaused = false;
  startFinalSolveTimer(room, emit, room.game.finalTimerRemainingMs);
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit @param {number} [remainingMs] */
export function startFinalSolveTimer(room, emit, remainingMs = FINAL_SOLVE_MS) {
  stopFinalTimer(room.code);
  room.game.finalTimerRemainingMs = remainingMs;
  room.game.finalTimerPaused = false;
  emit(room, { op: "finalTimerStart", remainingMs: room.game.finalTimerRemainingMs });

  const timer = setInterval(() => {
    if (!room.game || room.game.phase !== "finalSolve" || room.game.finalTimerPaused) return;
    room.game.finalTimerRemainingMs = Math.max(0, room.game.finalTimerRemainingMs - 1000);
    emit(room, {
      op: "finalTimerTick",
      remainingMs: room.game.finalTimerRemainingMs,
    });
    if (room.game.finalTimerRemainingMs <= 0) {
      stopFinalTimer(room.code);
      handleFinalTimerExpired(room, emit);
    }
  }, 1000);
  finalTimers.set(room.code, timer);
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
function handleFinalTimerExpired(room, emit) {
  const answer = room.game.puzzle?.answer;
  const seat = room.game.activeSeat;
  const player = seat ? getPlayerBySeat(room, seat) : null;
  const name = player?.name ?? seat ?? "Finalist";
  room.game.finalWon = false;
  room.game.rows = revealAllForAnswer(room.game);
  room.game.phase = "ended";
  room.game.roundWinnerSeat = seat;
  room.game.roundWinAmount = 0;
  room.game.message = `Time's up! Sorry ${name} — the answer was: ${answer}`;
  emit(room, {
    op: "finalTimerExpired",
    seat,
    name,
    answer,
    rows: room.game.rows,
    message: room.game.message,
  });
  emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
}

/** @param {import('./rooms.js').Room} room */
export function beginFinalRstlne(room) {
  if (!room.game?.started || room.game.roundType !== "final") {
    return { error: "Not Final Round." };
  }
  if (room.game.phase !== "finalPuzzleReveal" && room.game.phase !== "finalRevealFree") {
    return { error: "Envelope not sealed yet." };
  }
  room.game.phase = "finalRevealFree";
  room.game.finalRstlneIndex = 0;
  room.game.message = "Let's get you R, S, T, L, N, and E!";
  return { ok: true };
}

/** @param {import('./rooms.js').Room} room */
export function advanceFinalRstlne(room) {
  if (!room.game?.started || room.game.roundType !== "final") {
    return { error: "Not Final Round." };
  }
  if (room.game.phase !== "finalRevealFree" && room.game.phase !== "finalPuzzleReveal") {
    return { error: "RSTLNE not ready." };
  }
  if (room.game.phase === "finalPuzzleReveal") {
    room.game.phase = "finalRevealFree";
    room.game.finalRstlneIndex = 0;
  }

  const letters = FINAL_FREE_LETTERS.split("");
  const idx = room.game.finalRstlneIndex ?? 0;
  if (idx >= letters.length) return { error: "RSTLNE already complete." };

  const letter = letters[idx];
  const result = revealFinalFreeLetter(room.game, letter);
  room.game.finalRstlneIndex = idx + 1;
  const done = room.game.finalRstlneIndex >= letters.length;
  let autoSolved = false;

  if (done) {
    const pick = beginFinalPickPhase(room.game);
    autoSolved = !!pick.autoSolved;
    if (autoSolved) {
      const seat = room.game.activeSeat;
      const player = getPlayerBySeat(room, seat);
      const amount = room.game.finalEnvelopeAmount ?? 0;
      bankFinalWin(room.game, seat, player, amount);
      revealAllForAnswer(room.game);
    }
  }

  return {
    ok: true,
    letter,
    indices: result.ok && result.indices?.length ? result.indices : [],
    count: result.count ?? 0,
    rows: room.game.rows.map((row) => row),
    step: room.game.finalRstlneIndex,
    done,
    autoSolved,
  };
}

const FINAL_RSTLNE_STEP_MS = 900;
const FINAL_RSTLNE_LEAD_MS = 900;
/** Time after envelope seal for spin animation + category VO before RSTLNE. */
const FINAL_INTRO_DELAY_MS = 10000;

/** @type {Map<string, NodeJS.Timeout>} */
const finalRstlneTimers = new Map();

function stopFinalRstlneSequence(code) {
  for (const key of [code, `${code}:start`]) {
    const timer = finalRstlneTimers.get(key);
    if (timer) clearTimeout(timer);
    finalRstlneTimers.delete(key);
  }
}

function emitFinalFreeLetter(room, emit, result) {
  emit(room, {
    op: "finalFreeLetter",
    letter: result.letter,
    indices: result.indices,
    count: result.count,
    rows: result.rows,
    step: result.step,
    done: result.done,
    autoSolved: !!result.autoSolved,
  });

  if (result.autoSolved) {
    stopFinalRstlneSequence(room.code);
    const seat = room.game.activeSeat;
    const player = getPlayerBySeat(room, seat);
    emit(room, {
      op: "solveResult",
      seat,
      name: player?.name ?? seat,
      rows: result.rows,
      answer: room.game.puzzle?.answer,
      roundWin: room.game.roundWinAmount,
      message: room.game.message,
    });
    emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
    return;
  }

  if (result.done) {
    stopFinalRstlneSequence(room.code);
    emit(room, { op: "finalPickStart" });
    emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
    return;
  }

  finalRstlneTimers.set(
    room.code,
    setTimeout(() => revealNextFinalLetter(room, emit), FINAL_RSTLNE_STEP_MS),
  );
}

function revealNextFinalLetter(room, emit) {
  if (!room.game || room.game.phase !== "finalRevealFree") {
    stopFinalRstlneSequence(room.code);
    return;
  }

  const result = advanceFinalRstlne(room);
  if (result.error) {
    stopFinalRstlneSequence(room.code);
    return;
  }

  emitFinalFreeLetter(room, emit, result);
}

function startFinalRstlneLetters(room, emit) {
  stopFinalRstlneSequence(room.code);
  const begin = beginFinalRstlne(room);
  if (begin.error) return begin;

  emit(room, {
    op: "finalRstlneStart",
    message: room.game.message,
  });
  emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });

  finalRstlneTimers.set(
    room.code,
    setTimeout(() => revealNextFinalLetter(room, emit), FINAL_RSTLNE_LEAD_MS),
  );
  return { ok: true };
}

/** After envelope spin: pause for category intro, then auto-reveal RSTLNE. */
export function scheduleFinalRoundIntro(room, emit) {
  stopFinalRstlneSequence(room.code);
  room.game.message = "Bonus sealed! Here's your puzzle!";

  emit(room, { op: "finalEnvelopeSealed" });
  emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });

  finalRstlneTimers.set(
    `${room.code}:start`,
    setTimeout(() => startFinalRstlneLetters(room, emit), FINAL_INTRO_DELAY_MS),
  );
  return { ok: true };
}

/** @deprecated Use scheduleFinalRoundIntro */
export function startFinalRstlneSequence(room, emit) {
  return scheduleFinalRoundIntro(room, emit);
}

/** @param {string} [wedgeLabel] @param {"car"|"trip"|"prize"} [kind] */
function prizeSubtitleForWedge(wedgeLabel, kind) {
  if (kind === "car") return "New Car";
  if (kind === "trip") return "Vacation Trip";
  const label = String(wedgeLabel || "").toUpperCase();
  if (label === "GIFT") return "Gift Card";
  if (label === "SPA") return "Spa Getaway";
  if (label === "TRIP") return "Vacation Trip";
  if (label === "CAR") return "New Car";
  return wedgeLabel || "Bonus Prize";
}

/** @type {Map<string, NodeJS.Timeout>} */
const tossUpTimers = new Map();

function stopTossUpTimer(code) {
  const timer = tossUpTimers.get(code);
  if (timer) clearInterval(timer);
  tossUpTimers.delete(code);
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
export function pauseTossUpReveal(room, emit) {
  if (!room.game || room.game.roundType !== "tossup") return;
  room.game.tossUpRevealPaused = true;
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
export function resumeTossUpReveal(room, emit) {
  if (!room.game || room.game.roundType !== "tossup") return;
  room.game.tossUpRevealPaused = false;
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit @returns {boolean} */
function emitNextTossUpTile(room, emit) {
  const hidden = getHiddenTossUpSlots(room.game);
  if (!hidden.length) {
    stopTossUpTimer(room.code);
    room.game.message = "Toss-Up complete — no one solved it.";
    room.game.phase = "ended";
    room.game.roundWinnerSeat = null;
    room.game.roundWinAmount = 0;
    emit(room, {
      op: "tossUpComplete",
      allRevealed: true,
      rows: room.game.rows,
      message: room.game.message,
    });
    emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
    return false;
  }

  const slot = hidden[randomBytes(1)[0] % hidden.length];
  const result = revealTossUpTile(room.game, slot);
  if (result.ok) {
    emit(room, {
      op: "tossUpTile",
      letter: result.letter,
      indices: result.indices,
      rows: result.rows,
    });
    emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
  }
  return true;
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
export function startTossUpRevealLoop(room, emit) {
  stopTossUpTimer(room.code);
  if (room.game?.phase === "tossUpReveal") {
    emitNextTossUpTile(room, emit);
  }
  const timer = setInterval(() => {
    if (!room.game || room.game.phase !== "tossUpReveal") {
      stopTossUpTimer(room.code);
      return;
    }
    if (room.game.tossUpRevealPaused) return;
    emitNextTossUpTile(room, emit);
  }, 900);
  tossUpTimers.set(room.code, timer);
}

/** @param {import('./rooms.js').Room} room */
export function createInitialGame() {
  return {
    started: false,
    phase: "lobby",
    roundType: "tossup",
    activeSeat: null,
    message: "Waiting to start…",
    category: "—",
    wedgeLabel: "—",
    rows: emptyBoardRows(),
    roundMoney: 0,
    roundBank: 0,
    puzzle: null,
    letterMap: [],
    called: new Set(),
    usedPuzzleIds: new Set(),
    roundPrize: null,
    pendingPrizeKind: null,
    pendingPrizeLabel: null,
    carPrize: null,
    tripPrize: null,
    tripPrizeClaimed: false,
    solveBlocked: false,
    finalConsonantsLeft: 0,
    finalVowelsLeft: 0,
    finalPendingPicks: [],
    finalEnvelopeAmount: null,
    finalEnvelopePrize: null,
    finalEnvelopeIndex: null,
    finalEnvelopeRevealed: false,
    finalWon: null,
    puzzleHidden: false,
    finalRstlneIndex: 0,
    finalTimerRemainingMs: 0,
    finalTimerPaused: false,
    tossUpLockedOut: false,
    tossUpLockedSeats: new Set(),
    tossUpRevealPaused: false,
    roundWinnerSeat: null,
    roundWinAmount: 0,
  };
}

/** @param {import('./rooms.js').Room} room @param {string} roundType @param {{ preview?: boolean }} [opts] */
function loadPuzzleForRound(room, roundType, { preview = false } = {}) {
  let exclude = room.game.usedPuzzleIds;
  if (exclude.size >= puzzleCount()) {
    exclude = new Set();
    room.game.usedPuzzleIds = exclude;
  }

  const entry = pickRandomPuzzle(exclude);
  const layout = layoutPuzzle(entry.category, entry.answer);
  const id = entry.id || entry.answer;
  room.game.usedPuzzleIds.add(id);
  room.game.puzzle = { id, category: entry.category, answer: layout.answer };
  room.game.category = entry.category;
  room.game.rows = layout.rows;
  room.game.letterMap = buildLetterMap(layout.rows, layout.answer);
  room.game.called = new Set();
  room.game.roundType = roundType;
  resetRoundFields(room.game);

  if (preview) {
    room.game.phase = "lobby";
    room.game.message = "Preview puzzle — waiting to start…";
    return entry;
  }

  setupRoundPhase(room.game, roundType, room);
  return entry;
}

/** Load a preview puzzle when the TV connects (before Start Game). */
export function ensurePreviewBoard(room) {
  if (!room.game) {
    room.game = createInitialGame();
  }
  const hasPuzzleTiles = room.game.rows?.some((row) => row.includes("_"));
  if (!room.game.started && !hasPuzzleTiles) {
    loadPuzzleForRound(room, room.game.roundType || "round1", { preview: true });
  }
  return publicGameState(room);
}

/** @param {import('./rooms.js').Room} room */
function advanceTurn(room) {
  if (room.players.length <= 1) {
    room.game.phase = room.game.roundType === "final" && room.game.phase === "finalEnvelope"
      ? "finalEnvelope"
      : "idle";
    room.game.roundMoney = 0;
    const player = getPlayerBySeat(room, room.game.activeSeat);
    room.game.message = player ? `${player.name} — spin again.` : "Spin the wheel!";
    return;
  }
  const seats = room.players.map((p) => p.seat);
  const idx = seats.indexOf(room.game.activeSeat);
  const nextSeat = seats[(idx + 1) % seats.length];
  room.game.activeSeat = nextSeat;
  room.game.phase = "idle";
  room.game.roundMoney = 0;
  if (room.game.pendingPrizeKind) {
    room.game.pendingPrizeKind = null;
    room.game.pendingPrizeLabel = null;
    if (!room.game.tripPrizeClaimed) {
      room.game.tripPrize = null;
      room.game.roundPrize = null;
    }
  }
  const next = getPlayerBySeat(room, nextSeat);
  room.game.message = `${next?.name}'s turn — spin the wheel!`;
}

/** @param {import('./rooms.js').Room} room */
export function startGame(room) {
  if (room.players.length < 1) {
    return { error: "Need at least 1 player to start." };
  }
  if (room.game?.started) {
    return { error: "Game already started." };
  }

  if (!room.game) {
    room.game = createInitialGame();
  }

  const hasPuzzleTiles = room.game.rows?.some((row) => row.includes("_"));
  if (!hasPuzzleTiles) {
    loadPuzzleForRound(room, room.game.roundType || "round1");
  } else {
    room.game.started = true;
    setupRoundPhase(room.game, room.game.roundType || "round1", room);
    resetRoundFields(room.game);
  }

  room.game.started = true;
  if (room.game.roundType !== "tossup" && room.game.roundType !== "final") {
    room.game.activeSeat = room.players[0].seat;
    const first = room.players[0];
    room.game.message = `${first.name}'s turn — spin the wheel!`;
  }

  for (const player of room.players) {
    player.score = player.score || 0;
  }

  return { ok: true };
}

/** @param {import('./rooms.js').Room} room @param {"round1"|"round2"|"final"|"tossup"} roundType */
export function setRound(room, roundType) {
  if (!room.game?.started) {
    return { error: "Start the game first." };
  }
  if (!["round1", "round2", "final", "tossup"].includes(roundType)) {
    return { error: "Invalid round type." };
  }

  stopTossUpTimer(room.code);
  stopFinalTimer(room.code);
  stopFinalRstlneSequence(room.code);
  loadPuzzleForRound(room, roundType);

  return { ok: true, roundType };
}

/** @param {import('./rooms.js').Room} room */
export function beginTossUp(room) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.roundType !== "tossup") return { error: "Not a Toss-Up round." };
  if (room.game.phase !== "tossUpAnnounce") return { error: "Toss-Up already started." };
  return { ok: true, startCountdown: true };
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
export function startTossUpCountdown(room, emit) {
  stopTossUpTimer(room.code);
  room.game.phase = "tossUpCountdown";
  room.game.message = "Get ready for the Toss-Up!";
  let step = 0;
  const counts = [3, 2, 1];

  const advance = () => {
    if (!room.game || room.game.roundType !== "tossup") {
      stopTossUpTimer(room.code);
      return;
    }
    if (step < counts.length) {
      const count = counts[step];
      room.game.message = step === 0 ? "Get ready…" : String(count);
      emit(room, { op: "tossUpCountdown", count });
      emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
      step += 1;
      return;
    }
    stopTossUpTimer(room.code);
    beginTossUpReveal(room.game);
    room.game.message = "Toss-Up! Ring in when you know it!";
    emit(room, { op: "tossUpCountdown", count: 0 });
    emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
    startTossUpRevealLoop(room, emit);
  };

  advance();
  const timer = setInterval(advance, 1000);
  tossUpTimers.set(room.code, timer);
}

/** @param {import('./rooms.js').Room} room */
export function newPuzzle(room) {
  if (!room.game?.started) {
    return { error: "Start the game first." };
  }
  stopTossUpTimer(room.code);
  loadPuzzleForRound(room, room.game.roundType);
  const player = getPlayerBySeat(room, room.game.activeSeat);
  room.game.message = player
    ? `${player.name}'s turn — spin the wheel!`
    : "New puzzle loaded — spin the wheel!";
  return { ok: true };
}

function isTossUpReveal(room) {
  return room.game?.roundType === "tossup" && room.game.phase === "tossUpReveal";
}

/** @param {import('./rooms.js').Room} room */
export function playerActionFlags(room) {
  if (!room.game?.started) {
    return { canSpin: false, canGuess: false, canBuyVowel: false, canSolve: false, canRingIn: false, canPickFinal: false };
  }
  const g = room.game;

  if (g.roundType === "tossup") {
    const hiddenLeft = getHiddenTossUpSlots(g).length > 0;
    return {
      canSpin: false,
      canGuess: false,
      canBuyVowel: false,
      canSolve: g.phase === "tossUpReveal" && g.activeSeat != null,
      canRingIn: isTossUpReveal(room) && !g.activeSeat && hiddenLeft,
      canPickFinal: false,
      tossUpLockedSeats: [...g.tossUpLockedSeats],
    };
  }

  if (g.roundType === "final") {
    const canSpin = g.phase === "finalEnvelope";
    const canPickFinal = g.phase === "finalPick";
    const timerLeft = g.finalTimerRemainingMs ?? 0;
    return {
      canSpin,
      canGuess: false,
      canBuyVowel: false,
      canSolve: g.phase === "finalSolve" && timerLeft > 0,
      canRingIn: false,
      canPickFinal,
      finalConsonantsLeft: g.finalConsonantsLeft,
      finalVowelsLeft: g.finalVowelsLeft,
      finalTimerRemainingMs: timerLeft,
      finalTimerPaused: !!g.finalTimerPaused,
    };
  }

  const canSpin =
    (g.phase === "idle" || g.phase === "guess") &&
    !onlyVowelsRemain(g) &&
    g.phase !== "ended";
  const canGuess =
    g.phase === "guess" &&
    (g.roundMoney > 0 || g.roundPrize || g.pendingPrizeKind) &&
    hasHiddenConsonants(g);
  const canBuyVowel =
    (g.phase === "guess" || (g.phase === "idle" && onlyVowelsRemain(g))) &&
    g.roundBank >= VOWEL_COST &&
    "AEIOU".split("").some((letter) => !g.called.has(letter));
  const canSolve =
    !g.solveBlocked &&
    (g.phase === "guess" || g.phase === "idle") &&
    g.phase !== "ended";

  return { canSpin, canGuess, canBuyVowel, canSolve, canRingIn: false, canPickFinal: false };
}

/** @param {import('./rooms.js').Room} room */
export function publicGameState(room) {
  if (!room.game) return null;
  return {
    started: room.game.started,
    phase: room.game.phase,
    roundType: room.game.roundType,
    activeSeat: room.game.activeSeat,
    message: room.game.message,
    category: room.game.puzzleHidden ? "Final Round" : room.game.category,
    wedgeLabel: room.game.wedgeLabel,
    rows: room.game.puzzleHidden ? emptyBoardRows() : room.game.rows,
    puzzleHidden: !!room.game.puzzleHidden,
    roundMoney: room.game.roundMoney,
    roundBank: room.game.roundBank,
    roundPrize: room.game.roundPrize,
    pendingPrizeKind: room.game.pendingPrizeKind,
    carPrize: room.game.carPrize,
    tripPrize: room.game.tripPrize,
    tripPrizeClaimed: !!room.game.tripPrizeClaimed,
    puzzleId: room.game.puzzle?.id ?? null,
    called: [...room.game.called],
    finalPendingPicks: [...(room.game.finalPendingPicks || [])],
    finalConsonantsLeft: room.game.finalConsonantsLeft,
    finalVowelsLeft: room.game.finalVowelsLeft,
    finalEnvelopeAmount: room.game.finalEnvelopeAmount,
    finalEnvelopePrize: room.game.finalEnvelopePrize,
    finalEnvelopeIndex: room.game.finalEnvelopeIndex,
    finalEnvelopeRevealed: room.game.finalEnvelopeRevealed,
    finalWon: room.game.finalWon,
    finalTimerRemainingMs: room.game.finalTimerRemainingMs ?? 0,
    finalTimerPaused: !!room.game.finalTimerPaused,
    roundWinnerSeat: room.game.roundWinnerSeat,
    roundWinAmount: room.game.roundWinAmount,
    ...playerActionFlags(room),
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat|null} seat */
export function turnChangedPayload(room, seat, { cue } = {}) {
  const player = seat ? getPlayerBySeat(room, seat) : null;
  const g = room.game;
  let message = "Waiting…";
  let turnCue = cue ?? "spin";

  if (player && g) {
    if (g.roundType === "tossup") {
      turnCue = "none";
      if (g.phase === "tossUpReveal" && g.activeSeat === seat) {
        message = `${player.name} is attempting to solve!`;
      } else {
        message = "Toss-Up in progress…";
      }
    } else if (g.roundType === "final") {
      if (g.phase === "finalEnvelope") {
        message = `${player.name} — spin for your envelope!`;
        turnCue = "spin";
      } else if (g.phase === "finalPick") {
        message = `${player.name} — pick your letters!`;
        turnCue = "none";
      } else if (g.phase === "finalSolve") {
        const sec = Math.ceil((g.finalTimerRemainingMs ?? 0) / 1000);
        message = `${player.name} — ${sec}s to solve!`;
        turnCue = "none";
      } else if (g.phase === "finalPuzzleReveal" || g.phase === "finalRevealFree") {
        message = `${player.name} — Final Round in progress…`;
        turnCue = "none";
      } else {
        message = `${player.name}'s turn — spin the wheel!`;
        turnCue = "spin";
      }
    } else {
      message = `${player.name}'s turn — spin the wheel!`;
      turnCue = "spin";
    }
  }

  return {
    op: "turnChanged",
    seat,
    name: player?.name ?? seat,
    players: playerSummaries(room),
    message,
    cue: turnCue,
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} action */
export function playerActionPayload(room, seat, action, extra = {}) {
  const player = getPlayerBySeat(room, seat);
  return {
    op: "playerAction",
    seat,
    name: player?.name ?? seat,
    action,
    ...extra,
  };
}

export function letterResultPayload(room, seat, result) {
  return {
    op: "letterResult",
    seat,
    letter: result.letter,
    hit: result.hit,
    count: result.count,
    indices: result.indices,
    rows: room.game.rows,
    turnLost: !!result.turnLost,
    solved: !!result.solved,
    roundType: room.game.roundType,
    onlyVowelsRemain: !!result.onlyVowelsRemain,
    noMoreVowels: !!result.noMoreVowels,
    carWon: result.prizeReveal?.kind === "car" || !!result.carWon,
    carPrize: result.prizeReveal?.kind === "car"
      ? { id: result.prizeReveal.id, name: result.prizeReveal.name }
      : result.carPrize ?? null,
    prizeReveal: result.prizeReveal ?? null,
    finalPick: !!result.finalPick,
    finalReveal: !!result.finalReveal,
    steps: result.steps ?? null,
    picks: result.picks ?? null,
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {number} _power */
export function handleSpin(room, seat, _power) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };

  if (room.game.roundType === "final" && room.game.phase === "finalEnvelope") {
    const wedges = getWedgesForRound("final");
    const index = randomBytes(2).readUInt16BE(0) % wedges.length;
    const wedge = wedges[index];
    sealFinalEnvelope(room.game, index, wedge);
    return {
      ok: true,
      index,
      wedge: { label: wedge.label, value: wedge.value ?? 0, type: "bonusEnvelope", prizeType: wedge.prizeType },
      state: publicGameState(room),
    };
  }

  if (room.game.phase !== "idle" && room.game.phase !== "guess") {
    return { error: "You cannot spin right now." };
  }
  if (onlyVowelsRemain(room.game)) {
    return { error: "Only vowels remain — buy a vowel or solve." };
  }

  const wedges = getWedgesForRound(room.game.roundType);
  const index = randomBytes(2).readUInt16BE(0) % wedges.length;
  const wedge = wedges[index];
  const player = getPlayerBySeat(room, seat);
  const name = player?.name ?? seat;

  if (wedge.type === "bankrupt") {
    room.game.roundBank = 0;
    room.game.roundMoney = 0;
    room.game.roundPrize = null;
    room.game.pendingPrizeKind = null;
    room.game.pendingPrizeLabel = null;
    room.game.tripPrize = null;
    room.game.tripPrizeClaimed = false;
    room.game.wedgeLabel = wedge.label;
    room.game.message = `${name} hit BANKRUPT! Round earnings wiped.`;
    advanceTurn(room);
    return {
      ok: true,
      index,
      wedge: { label: wedge.label, value: 0, type: "bankrupt" },
      state: publicGameState(room),
      broadcastTurn: true,
    };
  }

  if (wedge.type === "loseTurn") {
    room.game.roundMoney = 0;
    room.game.wedgeLabel = wedge.label;
    room.game.message = `${name} hit LOSE TURN!`;
    advanceTurn(room);
    return {
      ok: true,
      index,
      wedge: { label: wedge.label, value: 0, type: "loseTurn" },
      state: publicGameState(room),
      broadcastTurn: true,
    };
  }

  if (wedge.type === "prize") {
    room.game.phase = "guess";
    room.game.roundMoney = 0;
    room.game.wedgeLabel = wedge.label;
    if (wedge.prizeKind === "car") {
      room.game.pendingPrizeKind = "car";
      room.game.roundPrize = null;
      room.game.tripPrize = null;
      room.game.message = `${name} landed on CAR! Call a consonant to claim it.`;
    } else if (wedge.label === "TRIP" || wedge.prizeKind === "trip") {
      const trip = pickRandomTrip();
      room.game.pendingPrizeKind = "trip";
      room.game.tripPrize = trip;
      room.game.tripPrizeClaimed = false;
      room.game.roundPrize = trip?.label || wedge.prize || "Trip";
      room.game.message = `${name} landed on TRIP! Call a consonant to claim ${room.game.roundPrize}!`;
    } else {
      room.game.pendingPrizeKind = "prize";
      room.game.pendingPrizeLabel = wedge.label;
      room.game.tripPrize = null;
      room.game.tripPrizeClaimed = false;
      room.game.roundPrize = wedge.prize || wedge.label;
      room.game.message = `${name} landed on ${wedge.label}! Call a consonant to claim ${room.game.roundPrize}!`;
    }
    return {
      ok: true,
      index,
      wedge: {
        label: wedge.label,
        value: 0,
        type: "prize",
        prize: room.game.roundPrize,
        prizeKind: room.game.pendingPrizeKind || wedge.prizeKind || null,
        tripId: room.game.tripPrize?.id ?? null,
      },
      state: publicGameState(room),
    };
  }

  room.game.phase = "guess";
  room.game.roundMoney = wedge.value;
  room.game.wedgeLabel = wedge.label;
  room.game.message = `${name} spun ${wedge.label}. Guess a consonant.`;

  return {
    ok: true,
    index,
    wedge: { label: wedge.label, value: wedge.value },
    state: publicGameState(room),
  };
}

/** @param {import('./rooms.js').Room} room */
export function revealFinalFreeLetters(room) {
  const steps = [];
  const allIndices = [];
  for (const letter of FINAL_FREE_LETTERS) {
    const result = revealFinalFreeLetter(room.game, letter);
    const indices = result.ok && result.indices?.length ? result.indices : [];
    steps.push({
      letter,
      indices,
      rows: room.game.rows.map((row) => row),
    });
    if (indices.length) allIndices.push(...indices);
  }
  const pickPhase = beginFinalPickPhase(room.game);
  if (pickPhase.autoSolved) {
    const seat = room.game.activeSeat;
    const player = getPlayerBySeat(room, seat);
    const amount = room.game.finalEnvelopeAmount ?? 0;
    bankFinalWin(room.game, seat, player, amount);
    revealAllForAnswer(room.game);
    return { ok: true, steps, indices: allIndices, autoSolved: true, rows: room.game.rows };
  }
  return { ok: true, steps, indices: allIndices, autoSolved: false, rows: room.game.rows };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat */
function bankRoundOnSolve(room, seat) {
  const player = getPlayerBySeat(room, seat);
  if (!player) return 0;

  const rawBank = room.game.roundBank;
  const roundWin = Math.max(rawBank, MIN_ROUND_WIN);
  if (roundWin > rawBank) {
    player.score = (player.score || 0) + (roundWin - rawBank);
  }
  room.game.roundBank = 0;
  room.game.roundMoney = 0;
  return roundWin;
}

function finishSolveByLetters(room, seat) {
  if (room.game.roundType === "final") {
    const player = getPlayerBySeat(room, seat);
    const amount = room.game.finalEnvelopeAmount ?? 0;
    bankFinalWin(room.game, seat, player, amount);
    return amount;
  }

  const roundWin = bankRoundOnSolve(room, seat);
  const name = getPlayerBySeat(room, seat)?.name ?? seat;
  let message =
    roundWin > 0
      ? `Correct! ${name} solved the puzzle for $${roundWin.toLocaleString()}!`
      : `Correct! ${name} solved the puzzle!`;
  if (room.game.carPrize) {
    message += ` Plus: ${room.game.carPrize.name}!`;
  } else if (room.game.tripPrize?.label) {
    message += ` Plus: ${room.game.tripPrize.label}!`;
  } else if (room.game.roundPrize) {
    message += ` Plus: ${room.game.roundPrize}!`;
  }
  room.game.message = message;
  room.game.phase = "ended";
  room.game.roundWinnerSeat = seat;
  room.game.roundWinAmount = roundWin;
  return roundWin;
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} letter */
export function handleGuessLetter(room, seat, letter) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };

  if (room.game.roundType === "final" && room.game.phase === "finalPick") {
    const pick = pickFinalLetter(room.game, letter);
    if (!pick.ok) return { error: "Invalid letter pick." };
    if (pick.readyToReveal) {
      const reveal = revealFinalPendingLetters(room.game);
      if (reveal.solved) {
        stopFinalTimer(room.code);
        const amount = finishSolveByLetters(room, seat);
        return {
          ok: true,
          hit: true,
          count: reveal.indices.length,
          letter,
          indices: reveal.indices,
          solved: true,
          rows: room.game.rows,
          finalReveal: true,
          steps: reveal.steps,
          picks: reveal.picks,
        };
      }
      return {
        ok: true,
        hit: reveal.indices.length > 0,
        count: reveal.indices.length,
        letter,
        indices: reveal.indices,
        solved: false,
        rows: room.game.rows,
        finalReveal: true,
        steps: reveal.steps,
        picks: reveal.picks,
      };
    }
    return {
      ok: true,
      hit: false,
      count: 0,
      letter,
      indices: [],
      finalPick: true,
    };
  }

  if (room.game.phase !== "guess") return { error: "Spin the wheel first." };

  const upper = String(letter || "").toUpperCase();
  if (!/^[A-Z]$/.test(upper)) return { error: "Pick a letter A–Z." };
  if (isVowel(upper)) return { error: "Buy a vowel for A, E, I, O, U." };

  if (room.game.called.has(upper)) {
    room.game.message = `${upper} was already called.`;
    advanceTurn(room);
    return {
      ok: true,
      hit: false,
      count: 0,
      letter: upper,
      indices: [],
      turnLost: true,
      broadcastTurn: true,
    };
  }

  room.game.called.add(upper);
  const { rows, indices, count } = revealWithMap(room.game.rows, room.game.letterMap, upper);
  room.game.rows = rows;

  if (count > 0) {
    const earned = room.game.roundMoney > 0 ? count * room.game.roundMoney : 0;
    if (earned > 0) {
      room.game.roundBank += earned;
      const player = getPlayerBySeat(room, seat);
      if (player) player.score += earned;
    }

    let prizeReveal = null;
    if (room.game.pendingPrizeKind === "car") {
      const car = pickRandomCar() || { id: "car-round2", name: "Bonus Car" };
      room.game.pendingPrizeKind = null;
      room.game.pendingPrizeLabel = null;
      room.game.carPrize = car;
      room.game.roundPrize = car.name;
      prizeReveal = { kind: "car", subtitle: "New Car", name: car.name, id: car.id };
    } else if (room.game.pendingPrizeKind === "trip" && room.game.tripPrize) {
      room.game.pendingPrizeKind = null;
      room.game.pendingPrizeLabel = null;
      room.game.tripPrizeClaimed = true;
      room.game.roundPrize = room.game.tripPrize.label;
      prizeReveal = {
        kind: "trip",
        subtitle: "Vacation Trip",
        name: room.game.tripPrize.label,
        id: room.game.tripPrize.id,
      };
    } else if (room.game.pendingPrizeKind === "prize" && room.game.roundPrize) {
      const subtitle = prizeSubtitleForWedge(room.game.pendingPrizeLabel, "prize");
      prizeReveal = {
        kind: "prize",
        subtitle,
        name: room.game.roundPrize,
        wedgeLabel: room.game.pendingPrizeLabel,
      };
      room.game.pendingPrizeKind = null;
      room.game.pendingPrizeLabel = null;
    }

    const onlyVowels = onlyVowelsRemain(room.game);

    room.game.message =
      earned > 0
        ? `${count} ${upper}'s — $${earned.toLocaleString()}! Spin, buy a vowel, or solve.`
        : `${count} ${upper}'s revealed. Spin, buy a vowel, or solve.`;
    room.game.phase = "guess";

    if (isSolved(room.game.rows)) {
      finishSolveByLetters(room, seat);
      return { ok: true, hit: true, count, letter: upper, indices, solved: true, rows: room.game.rows };
    }

    if (onlyVowels) {
      room.game.message = `${count} ${upper}'s. Only vowels left — buy a vowel or solve.`;
    }

    return {
      ok: true,
      hit: true,
      count,
      letter: upper,
      indices,
      rows: room.game.rows,
      onlyVowelsRemain: onlyVowels,
      prizeReveal,
      carWon: prizeReveal?.kind === "car",
      carPrize: prizeReveal?.kind === "car" ? room.game.carPrize : null,
    };
  }

  room.game.message = `Sorry, no ${upper}.`;
  advanceTurn(room);
  return {
    ok: true,
    hit: false,
    count: 0,
    letter: upper,
    indices: [],
    turnLost: true,
    broadcastTurn: true,
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} letter */
export function handleBuyVowel(room, seat, letter) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  if (room.game.roundType === "final" || room.game.roundType === "tossup") {
    return { error: "Cannot buy vowels in this round." };
  }
  if (room.game.phase !== "guess" && !(room.game.phase === "idle" && onlyVowelsRemain(room.game))) {
    return { error: "You cannot buy a vowel right now." };
  }

  const upper = String(letter || "").toUpperCase();
  if (!isVowel(upper)) return { error: "Pick a vowel: A, E, I, O, or U." };
  if (room.game.called.has(upper)) {
    advanceTurn(room);
    return {
      ok: true,
      hit: false,
      count: 0,
      letter: upper,
      indices: [],
      turnLost: true,
      broadcastTurn: true,
    };
  }
  if (room.game.roundBank < VOWEL_COST) {
    return { error: `Need $${VOWEL_COST} in your round bank (you have $${room.game.roundBank}).` };
  }

  room.game.roundBank -= VOWEL_COST;
  room.game.phase = "guess";
  room.game.called.add(upper);
  const { rows, indices, count } = revealWithMap(room.game.rows, room.game.letterMap, upper);
  room.game.rows = rows;

  if (count > 0) {
    room.game.solveBlocked = false;
    room.game.message = `${count} ${upper}'s. Spin, buy another vowel, or solve.`;
    if (isSolved(room.game.rows)) {
      finishSolveByLetters(room, seat);
      return { ok: true, hit: true, count, letter: upper, indices, solved: true, rows: room.game.rows };
    }
    return { ok: true, hit: true, count, letter: upper, indices, rows: room.game.rows };
  }

  if (onlyVowelsRemain(room.game)) {
    room.game.solveBlocked = true;
    room.game.message = `No ${upper} in the puzzle. Buy another vowel.`;
    advanceTurn(room);
    return { ok: true, hit: false, count: 0, letter: upper, indices: [], turnLost: true, broadcastTurn: true };
  }

  room.game.message = `Sorry, no ${upper}.`;
  advanceTurn(room);
  return {
    ok: true,
    hit: false,
    count: 0,
    letter: upper,
    indices: [],
    turnLost: true,
    broadcastTurn: true,
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} name @param {string} lockedMessage */
function failTossUpSolve(room, seat, name, lockedMessage) {
  room.game.activeSeat = null;
  room.game.tossUpRevealPaused = false;

  // Solo play: no lockout pool — the only player can ring in again.
  if (room.players.length <= 1) {
    room.game.message = `${name}'s solve was wrong — ring in again when you're ready!`;
    return { ok: true, correct: false, lockedOut: false, resumeTossUp: true };
  }

  room.game.tossUpLockedSeats.add(seat);
  room.game.message = lockedMessage;
  return { ok: true, correct: false, lockedOut: true, resumeTossUp: true };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} text */
export function handleSolve(room, seat, text) {
  if (!room.game?.started) return { error: "Game not started." };

  if (room.game.roundType === "tossup") {
    if (room.game.phase !== "tossUpReveal" || room.game.activeSeat !== seat) {
      return { error: "Ring in first during the Toss-Up." };
    }
    const trimmed = String(text || "").trim();
    const player = getPlayerBySeat(room, seat);
    const name = player?.name ?? seat;

    if (!trimmed) {
      return failTossUpSolve(room, seat, name, `${name} locked out — letters keep revealing.`);
    }

    if (guessesMatch(trimmed, room.game.puzzle.answer)) {
      stopTossUpTimer(room.code);
      room.game.rows = revealAllRows(room.game.rows, room.game.puzzle.answer);
      if (player) player.score = (player.score || 0) + TOSS_UP_WIN;
      room.game.phase = "ended";
      room.game.roundWinnerSeat = seat;
      room.game.roundWinAmount = TOSS_UP_WIN;
      room.game.message = `Correct! ${name} wins the Toss-Up: $${TOSS_UP_WIN.toLocaleString()}!`;
      return {
        ok: true,
        correct: true,
        solved: true,
        answer: room.game.puzzle.answer,
        rows: room.game.rows,
        roundWin: TOSS_UP_WIN,
        name,
        message: room.game.message,
      };
    }

    return failTossUpSolve(room, seat, name, `${name}'s solve was wrong — locked out.`);
  }

  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  if (room.game.phase !== "guess" && room.game.phase !== "idle" && room.game.phase !== "finalSolve") {
    return { error: "You cannot solve right now." };
  }
  if (room.game.solveBlocked) return { error: "Buy a vowel before solving." };

  const answer = room.game.puzzle?.answer;
  if (!answer) return { error: "No puzzle loaded." };

  const player = getPlayerBySeat(room, seat);
  const name = player?.name ?? seat;

  if (guessesMatch(text, answer)) {
    if (room.game.roundType === "final") stopFinalTimer(room.code);
    room.game.rows = revealAllRows(room.game.rows, answer);
    const roundWin = finishSolveByLetters(room, seat);
    return {
      ok: true,
      correct: true,
      solved: true,
      answer,
      rows: room.game.rows,
      roundWin,
      name,
      message: room.game.message,
    };
  }

  if (room.game.roundType === "final") {
    room.game.message = `${name}'s solve was wrong — keep trying!`;
    return {
      ok: true,
      correct: false,
      resumeFinalTimer: true,
      name,
    };
  }

  room.game.message = `${name}'s solve was wrong.`;
  advanceTurn(room);
  return { ok: true, correct: false, turnLost: true, broadcastTurn: true };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat */
export function handleSolveIntent(room, seat) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.roundType === "tossup") return { error: "Use Buzz In during Toss-Up." };

  const flags = playerActionFlags(room);
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  if (!flags.canSolve) return { error: "You cannot solve right now." };

  const player = getPlayerBySeat(room, seat);
  if (!player) return { error: "Player not found." };

  room.game.message = `${player.name} is attempting to solve!`;
  if (room.game.roundType === "final" && room.game.phase === "finalSolve") {
    pauseFinalTimer(room);
  }
  return { ok: true, seat, name: player.name };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat */
export function handleBuzz(room, seat) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.phase === "tossUpCountdown") return { error: "Wait for the countdown." };
  if (!isTossUpReveal(room)) return { error: "Buzz only during Toss-Up." };
  if (room.game.activeSeat) return { error: "Someone already rang in." };
  if (room.game.tossUpLockedSeats.has(seat)) return { error: "You are locked out." };

  const hidden = getHiddenTossUpSlots(room.game);
  if (!hidden.length) return { error: "Too late — puzzle fully revealed." };

  const player = getPlayerBySeat(room, seat);
  if (!player) return { error: "Player not found." };

  room.game.activeSeat = seat;
  room.game.tossUpRevealPaused = true;
  room.game.message = `${player.name} is attempting to solve!`;
  return { ok: true, seat, name: player.name, pauseTossUp: true };
}

export { stopTossUpTimer };
