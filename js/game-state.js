import {
  buildLetterMap,
  guessesMatch,
  isVowel,
  layoutPuzzle,
  revealWithMap,
  revealAllRows,
  isSolved,
} from "./puzzle-layout.js?v=3";

export const VOWEL_COST = 250;
export const MIN_ROUND_WIN = 1000;
export const TOSS_UP_WIN = 1000;
export const FINAL_FREE_LETTERS = "RSTLNE";

/** @typedef {"round1"|"round2"|"final"|"tossup"} RoundType */
/** @typedef {"idle"|"spinning"|"guess"|"tossUpAnnounce"|"tossUpReveal"|"finalEnvelope"|"finalRevealFree"|"finalPick"|"finalSolve"|"ended"} Phase */

export function createGameState() {
  return {
    phase: /** @type {Phase} */ ("idle"),
    puzzle: null,
    rows: [],
    letterMap: [],
    called: new Set(),
    /** Banked winnings from previous solved puzzles. Safe from Bankrupt. */
    score: 0,
    /** Cash earned this round (vowel purchases come from here; Bankrupt wipes this). */
    roundBank: 0,
    /** Per-letter value from the current spin's money wedge (0 = must spin). */
    roundMoney: 0,
    /** After a wrong vowel when only vowels remain, solve is blocked until a vowel hits. */
    solveBlocked: false,
    lastWedge: null,
    message: "Spin the wheel to begin.",
    /** @type {RoundType} */
    roundType: "round1",
    /** Prize wedge picked up in Round 2 (won on solve). */
    roundPrize: null,
    /** @type {"car"|null} Waiting for a consonant hit before prize is revealed. */
    pendingPrizeKind: null,
    /** @type {{ id: string, name: string, make: string, model: string }|null} */
    carPrize: null,
    finalConsonantsLeft: 0,
    finalVowelsLeft: 0,
    /** Letters chosen in Final Round before the batch reveal. */
    finalPendingPicks: [],
    /** Sealed bonus amount (hidden until envelope opens). */
    finalEnvelopeAmount: null,
    /** @type {{ kind: "car"|"trip", id: string, name: string, label: string, valueUsd?: number }|null} */
    finalEnvelopePrize: null,
    finalEnvelopeIndex: null,
    finalEnvelopeRevealed: false,
    /** @type {boolean|null} */
    finalWon: null,
    /** Wrong Toss-Up ring-in locks this player out for the rest of the puzzle. */
    tossUpLockedOut: false,
  };
}

export function loadPuzzle(state, entry, { roundType = state.roundType } = {}) {
  const layout = layoutPuzzle(entry.category, entry.answer);
  state.puzzle = entry;
  state.rows = layout.rows;
  state.letterMap = buildLetterMap(layout.rows, layout.answer);
  state.called = new Set();
  state.roundBank = 0;
  state.roundMoney = 0;
  state.solveBlocked = false;
  state.lastWedge = null;
  state.roundType = roundType;
  state.roundPrize = null;
  state.pendingPrizeKind = null;
  state.carPrize = null;
  state.finalConsonantsLeft = 0;
  state.finalVowelsLeft = 0;
  state.finalPendingPicks = [];
  state.finalEnvelopeAmount = null;
  state.finalEnvelopePrize = null;
  state.finalEnvelopeIndex = null;
  state.finalEnvelopeRevealed = false;
  state.finalWon = null;
  state.tossUpLockedOut = false;

  if (roundType === "final") {
    return setupFinalRound(state, layout);
  }

  if (roundType === "tossup") {
    return setupTossUp(state, layout);
  }

  state.phase = "idle";
  state.message = roundType === "round2" ? "Round 2 — spin for cash or a prize wedge!" : "Spin the wheel!";
  return layout;
}

function setupTossUp(state, layout) {
  state.phase = "tossUpAnnounce";
  state.tossUpLockedOut = false;
  state.message = "Toss-Up — stand by for the category…";
  return layout;
}

function setupFinalRound(state, layout) {
  state.phase = "finalEnvelope";
  state.message = "Spin the wheel to seal your bonus envelope!";
  return layout;
}

/** @param {number} index @param {object} wedge */
export function sealFinalEnvelope(state, index, wedge) {
  state.finalEnvelopeIndex = index;
  state.finalEnvelopePrize = wedge.prize || null;

  if (wedge.prizeType === "car" && wedge.prize) {
    state.finalEnvelopeAmount = 0;
    state.lastWedge = { label: "✉ CAR", type: "bonusEnvelope", value: 0, prizeType: "car" };
  } else if (wedge.prizeType === "trip" && wedge.prize) {
    state.finalEnvelopeAmount = wedge.prize.valueUsd || wedge.value || 0;
    state.lastWedge = { label: "✉ TRIP", type: "bonusEnvelope", value: state.finalEnvelopeAmount, prizeType: "trip" };
  } else {
    state.finalEnvelopeAmount = wedge.value ?? 0;
    state.lastWedge = { label: "✉ SEALED", type: "bonusEnvelope", value: state.finalEnvelopeAmount, prizeType: "cash" };
  }

  state.phase = "finalRevealFree";
  state.message = "Bonus sealed! Revealing R, S, T, L, N, E…";
  return { ok: true };
}

/** Hidden letter slots still on the board (for Toss-Up tile-by-tile reveal). */
export function getHiddenTossUpSlots(state) {
  const slots = [];
  for (const slot of state.letterMap) {
    if (state.rows[slot.row][slot.col] === "_") {
      slots.push(slot);
    }
  }
  return slots;
}

/** Reveal one random Toss-Up tile (not all instances of a letter). */
export function revealTossUpTile(state, slot) {
  if (state.phase !== "tossUpReveal") {
    return { ok: false, reason: "badPhase" };
  }
  if (state.rows[slot.row][slot.col] !== "_") {
    return { ok: false, reason: "alreadyRevealed" };
  }

  const next = state.rows.map((r) => r.split(""));
  next[slot.row][slot.col] = slot.letter;
  state.rows = next.map((r) => r.join(""));
  return {
    ok: true,
    letter: slot.letter,
    indices: [{ row: slot.row, col: slot.col }],
    count: 1,
  };
}

/** Reveal one free Final Round letter (RSTLNE). */
export function revealFinalFreeLetter(state, letter) {
  const upper = letter.toUpperCase();
  if (state.phase !== "finalRevealFree") {
    return { ok: false, reason: "badPhase" };
  }
  if (state.called.has(upper)) {
    return { ok: false, reason: "alreadyCalled" };
  }
  if (!FINAL_FREE_LETTERS.includes(upper)) {
    return { ok: false, reason: "notFreeLetter" };
  }

  state.called.add(upper);
  const { rows, indices, count } = revealWithMap(state.rows, state.letterMap, upper);
  state.rows = rows;
  return { ok: true, letter: upper, indices, count };
}

export function beginFinalPickPhase(state) {
  state.finalConsonantsLeft = 3;
  state.finalVowelsLeft = 1;
  state.finalPendingPicks = [];

  if (isSolved(state.rows)) {
    bankRoundAndEnd(state);
    return { autoSolved: true };
  }

  state.phase = "finalPick";
  state.message = `${FINAL_FREE_LETTERS.split("").join(", ")} given. Pick 3 consonants.`;
  return { autoSolved: false };
}

export function canSpinFinalEnvelope(state) {
  return state.roundType === "final" && state.phase === "finalEnvelope";
}

export function isFinalRevealInProgress(state) {
  return state.roundType === "final" && state.phase === "finalRevealFree";
}

export function needsFinalEnvelopeReveal(state) {
  return (
    state.roundType === "final" &&
    state.phase === "ended" &&
    state.finalEnvelopeIndex != null &&
    !state.finalEnvelopeRevealed
  );
}

export function markFinalEnvelopeRevealed(state) {
  state.finalEnvelopeRevealed = true;
}

/** Hidden consonant slots still on the board. */
export function hasHiddenConsonants(state) {
  for (const slot of state.letterMap) {
    if (!isVowel(slot.letter) && state.rows[slot.row][slot.col] === "_") {
      return true;
    }
  }
  return false;
}

/** Only vowel letters remain unrevealed (official: no more spins allowed). */
export function onlyVowelsRemain(state) {
  if (isSolved(state.rows)) return false;
  let hiddenVowel = false;
  for (const slot of state.letterMap) {
    if (state.rows[slot.row][slot.col] !== "_") continue;
    if (isVowel(slot.letter)) hiddenVowel = true;
    else return false;
  }
  return hiddenVowel;
}

/** Vowels that appear in the puzzle answer. */
export function getVowelsInAnswer(state) {
  const inAnswer = new Set();
  for (const slot of state.letterMap) {
    if (isVowel(slot.letter)) inAnswer.add(slot.letter);
  }
  return inAnswer;
}

export function hasUncalledVowelsInAnswer(state) {
  return [...getVowelsInAnswer(state)].some((letter) => !state.called.has(letter));
}

export function hasUncalledVowels(state) {
  return "AEIOU".split("").some((letter) => !state.called.has(letter));
}

function loseTurn(state, message) {
  state.phase = "idle";
  state.roundMoney = 0;
  if (state.pendingPrizeKind === "car") {
    state.pendingPrizeKind = null;
  }
  state.message = message;
}

function bankRoundAndEnd(state) {
  if (state.roundType === "final") {
    const prize = state.finalEnvelopePrize;
    const amount = state.finalEnvelopeAmount ?? 0;
    state.finalWon = true;

    if (prize?.kind === "car") {
      state.carPrize = { id: prize.id, name: prize.name, make: "", model: "" };
      state.roundPrize = prize.name;
      state.message = `Correct! Opening your envelope… you've won a ${prize.name}!`;
    } else if (prize?.kind === "trip") {
      state.roundPrize = prize.label;
      state.score += amount;
      state.message = `Correct! Opening your envelope… you've won ${prize.label}!`;
    } else {
      state.score += amount;
      state.message = "Correct! Opening your envelope…";
    }

    state.roundBank = 0;
    state.roundMoney = 0;
    state.phase = "ended";
    return amount;
  }

  const rawBank = state.roundBank;
  const roundWin = Math.max(rawBank, MIN_ROUND_WIN);
  state.score += roundWin;
  state.roundBank = 0;
  state.roundMoney = 0;
  state.phase = "ended";
  let message =
    roundWin > rawBank
      ? `Correct! Puzzle solved! You win $${roundWin.toLocaleString()} ($${MIN_ROUND_WIN.toLocaleString()} minimum)!`
      : `Correct! Puzzle solved! You win $${roundWin.toLocaleString()}!`;
  if (state.roundPrize) {
    message += ` Plus: ${state.roundPrize}!`;
  } else if (state.carPrize) {
    message += ` Plus: ${state.carPrize.name}!`;
  }
  state.message = message;
  return roundWin;
}

export function beginTossUpReveal(state) {
  if (state.roundType !== "tossup" || state.phase !== "tossUpAnnounce") {
    return false;
  }
  state.phase = "tossUpReveal";
  state.message = "Toss-Up! Letters revealing — ring in when you know it!";
  return true;
}

export function isTossUpActive(state) {
  return state.roundType === "tossup" && state.phase === "tossUpReveal";
}

export function isTossUpAnnounce(state) {
  return state.roundType === "tossup" && state.phase === "tossUpAnnounce";
}

export function canRingIn(state) {
  return isTossUpActive(state) && !state.tossUpLockedOut;
}

export function canSpin(state) {
  if (isTossUpActive(state)) return false;
  if (isFinalRevealInProgress(state)) return false;
  if (canSpinFinalEnvelope(state)) return true;
  if (state.roundType === "final" || state.roundType === "tossup") return false;
  if (isSolved(state.rows) || state.phase === "spinning" || state.phase === "ended") {
    return false;
  }
  if (onlyVowelsRemain(state)) return false;
  return state.phase === "idle" || state.phase === "guess";
}

export function canGuessLetter(state) {
  if (state.roundType === "tossup") return false;
  return (
    state.phase === "guess" &&
    (state.roundMoney > 0 || state.roundPrize || state.pendingPrizeKind === "car") &&
    hasHiddenConsonants(state) &&
    !isSolved(state.rows)
  );
}

export function isCarPrizePending(state) {
  return state.pendingPrizeKind === "car" && !state.carPrize;
}

/** @param {{ id: string, name: string, make: string, model: string }} car */
export function claimCarPrize(state, car) {
  state.carPrize = car;
  state.roundPrize = car.name;
  state.pendingPrizeKind = null;
  state.message = `You picked up a ${car.name}! Solve the puzzle to win it.`;
}

export function resolveSolvedRound(state) {
  if (!isSolved(state.rows) || state.phase === "ended") return null;
  return bankRoundAndEnd(state);
}

export function canBuyVowel(state) {
  if (state.roundType === "final" || state.roundType === "tossup") return false;
  const onTurn = state.phase === "guess" || (state.phase === "idle" && onlyVowelsRemain(state));
  return (
    onTurn &&
    state.roundBank >= VOWEL_COST &&
    !isSolved(state.rows) &&
    hasUncalledVowels(state)
  );
}

export function canSolve(state) {
  if (canRingIn(state)) return true;
  if (state.phase === "spinning" || state.phase === "ended" || isSolved(state.rows)) {
    return false;
  }
  if (state.roundType === "tossup") return false;
  if (state.roundType === "final") {
    return state.phase === "finalSolve";
  }
  if (state.solveBlocked) return false;
  return state.phase === "idle" || state.phase === "guess";
}

export function canPickFinalLetter(state, letter) {
  if (state.roundType !== "final" || state.phase !== "finalPick") return false;
  const upper = letter.toUpperCase();
  if (state.called.has(upper) || state.finalPendingPicks.includes(upper)) return false;
  if (isVowel(upper)) {
    return state.finalConsonantsLeft === 0 && state.finalVowelsLeft > 0;
  }
  return state.finalConsonantsLeft > 0;
}

export function revealFinalPendingLetters(state) {
  const picks = [...state.finalPendingPicks];
  state.finalPendingPicks = [];

  const allIndices = [];
  for (const letter of picks) {
    state.called.add(letter);
    const { rows, indices } = revealWithMap(state.rows, state.letterMap, letter);
    state.rows = rows;
    allIndices.push(...indices);
  }

  state.phase = "finalSolve";
  state.message = allIndices.length
    ? "Letters revealed. Solve the puzzle!"
    : "None of your letters were in the puzzle. Solve anyway!";

  if (isSolved(state.rows)) {
    const roundWin = bankRoundAndEnd(state);
    return { ok: true, indices: allIndices, picks, solved: true, roundWin };
  }

  return { ok: true, indices: allIndices, picks, solved: false };
}

function finishFinalPicks(state) {
  if (state.finalConsonantsLeft === 0 && state.finalVowelsLeft === 0) {
    return { readyToReveal: true };
  }
  if (state.finalConsonantsLeft === 0) {
    state.message = "Pick 1 vowel.";
  } else {
    state.message = `Pick ${state.finalConsonantsLeft} consonant(s).`;
  }
  return { readyToReveal: false };
}

export function pickFinalLetter(state, letter) {
  const upper = letter.toUpperCase();
  if (!canPickFinalLetter(state, upper)) {
    return { ok: false, reason: "badPhase" };
  }

  state.finalPendingPicks.push(upper);

  if (isVowel(upper)) {
    state.finalVowelsLeft -= 1;
  } else {
    state.finalConsonantsLeft -= 1;
  }

  const outcome = finishFinalPicks(state);
  return { ok: true, letter: upper, picked: true, ...outcome };
}

export function applySpinResult(state, wedge) {
  state.lastWedge = wedge;
  state.roundMoney = 0;

  if (wedge.type === "bankrupt") {
    state.roundBank = 0;
    state.roundPrize = null;
    state.pendingPrizeKind = null;
    state.carPrize = null;
    loseTurn(state, "Bankrupt! Round earnings wiped. Spin again.");
    return { type: "bankrupt" };
  }

  if (wedge.type === "loseTurn") {
    loseTurn(state, "Lose a turn! Spin again.");
    return { type: "loseTurn" };
  }

  if (wedge.type === "prize") {
    state.phase = "guess";
    state.roundMoney = 0;
    if (wedge.prizeKind === "car") {
      state.pendingPrizeKind = "car";
      state.roundPrize = null;
      state.carPrize = null;
      state.message = "Landed on CAR! Call a consonant in the puzzle to claim your car.";
      return { type: "prize", prizeKind: "car" };
    }
    state.pendingPrizeKind = null;
    state.carPrize = null;
    state.roundPrize = wedge.prize || wedge.label;
    state.message = `You picked up ${state.roundPrize}! Solve the puzzle to win it. Guess a consonant.`;
    return { type: "prize", prize: state.roundPrize };
  }

  state.phase = "guess";
  state.roundMoney = wedge.value;
  state.message = `Landed on ${wedge.label}. Guess a consonant.`;
  return { type: "money", value: wedge.value };
}

export function guessConsonant(state, letter) {
  const upper = letter.toUpperCase();
  if (isVowel(upper)) {
    return { ok: false, reason: "vowel" };
  }
  if (!canGuessLetter(state)) {
    return { ok: false, reason: "badPhase" };
  }
  if (state.called.has(upper)) {
    loseTurn(state, `${upper} was already called. Spin again.`);
    return { ok: true, hit: false, indices: [], turnLost: true };
  }

  state.called.add(upper);
  const { rows, indices, count } = revealWithMap(state.rows, state.letterMap, upper);
  state.rows = rows;

  if (count > 0) {
    const earned = state.roundMoney > 0 ? count * state.roundMoney : 0;
    if (earned > 0) state.roundBank += earned;

    if (isCarPrizePending(state)) {
      if (isSolved(state.rows)) {
        return { ok: true, hit: true, indices, count, earned, needsCarReveal: true, solvedAfterCar: true };
      }
      if (onlyVowelsRemain(state)) {
        return {
          ok: true,
          hit: true,
          indices,
          count,
          earned,
          needsCarReveal: true,
          onlyVowelsReached: true,
        };
      }
      return { ok: true, hit: true, indices, count, earned, needsCarReveal: true };
    }

    if (isSolved(state.rows)) {
      const roundWin = bankRoundAndEnd(state);
      return { ok: true, hit: true, indices, count, earned, solved: true, roundWin };
    }
    if (onlyVowelsRemain(state)) {
      const payLine =
        earned > 0 ? `${upper}: ${count} × $${state.roundMoney} = $${earned}.` : `${upper}: ${count} revealed.`;
      state.message = `${payLine} Only vowels left — buy a vowel or solve.`;
      state.phase = "guess";
      return { ok: true, hit: true, indices, count, earned, onlyVowelsReached: true };
    }
    const payLine =
      earned > 0
        ? `${upper}: ${count} × $${state.roundMoney} = $${earned}. Spin, buy a vowel, or solve.`
        : `${upper}: ${count} revealed. Spin, buy a vowel, or solve.`;
    state.message = payLine;
    state.phase = "guess";
    return { ok: true, hit: true, indices, count, earned };
  }

  loseTurn(state, `Sorry, no ${upper}. Spin again.`);
  return { ok: true, hit: false, indices: [] };
}

export function buyVowel(state, letter) {
  const upper = letter.toUpperCase();
  if (!isVowel(upper)) {
    return { ok: false, reason: "notVowel" };
  }
  if (state.called.has(upper)) {
    loseTurn(state, `${upper} was already called. Spin again.`);
    return { ok: true, hit: false, indices: [], turnLost: true };
  }
  if (!canBuyVowel(state)) {
    return { ok: false, reason: "badPhase" };
  }

  if (state.phase === "idle" && onlyVowelsRemain(state)) {
    state.phase = "guess";
  }

  state.roundBank -= VOWEL_COST;
  state.called.add(upper);
  const { rows, indices, count } = revealWithMap(state.rows, state.letterMap, upper);
  state.rows = rows;

  if (count > 0) {
    state.solveBlocked = false;
    if (isSolved(state.rows)) {
      const roundWin = bankRoundAndEnd(state);
      return { ok: true, hit: true, indices, count, solved: true, roundWin };
    }
    if (onlyVowelsRemain(state)) {
      state.message = "Only vowels left — buy a vowel or solve the puzzle.";
    } else if (!hasUncalledVowelsInAnswer(state)) {
      state.message = "No More Vowels";
    } else {
      state.message = `Vowel ${upper} revealed (${count}). Spin, buy a vowel, or solve.`;
    }
    state.phase = "guess";
    return {
      ok: true,
      hit: true,
      indices,
      count,
      noMoreVowels: !hasUncalledVowelsInAnswer(state) && !onlyVowelsRemain(state),
    };
  }

  if (onlyVowelsRemain(state)) {
    state.solveBlocked = true;
    loseTurn(state, `No ${upper} in the puzzle. You can't solve — buy another vowel.`);
    return { ok: true, hit: false, indices: [], turnLost: true, solveBlocked: true };
  }

  loseTurn(state, `No ${upper} in the puzzle. Spin again.`);
  return { ok: true, hit: false, indices: [] };
}

export function attemptTossUpSolve(state, guessText) {
  if (!canRingIn(state)) {
    return { ok: false, reason: "badPhase" };
  }
  const trimmed = String(guessText || "").trim();
  if (!trimmed) {
    state.tossUpLockedOut = true;
    state.message = "No answer — you're locked out! Letters will keep revealing.";
    return { ok: true, correct: false, lockedOut: true };
  }
  if (guessesMatch(trimmed, state.puzzle.answer)) {
    state.rows = revealAllRows(state.rows, state.puzzle.answer);
    state.score += TOSS_UP_WIN;
    state.phase = "ended";
    state.message = `Correct! Toss-Up win: $${TOSS_UP_WIN.toLocaleString()}!`;
    return { ok: true, correct: true, amount: TOSS_UP_WIN };
  }
  state.tossUpLockedOut = true;
  state.message = "Wrong answer — you're locked out! Letters will keep revealing.";
  return { ok: true, correct: false, lockedOut: true };
}

export function attemptSolve(state, guessText) {
  if (state.roundType === "tossup") {
    return attemptTossUpSolve(state, guessText);
  }
  if (!canSolve(state)) {
    return { ok: false, reason: "badPhase" };
  }
  if (guessesMatch(guessText, state.puzzle.answer)) {
    state.rows = revealAllRows(state.rows, state.puzzle.answer);
    const roundWin = bankRoundAndEnd(state);
    return { ok: true, correct: true, roundWin };
  }
  if (state.roundType === "final") {
    state.finalWon = false;
    state.rows = revealAllRows(state.rows, state.puzzle.answer);
    state.phase = "ended";
    state.message = `I'm sorry, the correct answer was: ${state.puzzle.answer}`;
    return { ok: true, correct: false, revealAnswer: true };
  }
  loseTurn(state, "Wrong solve. Spin again.");
  return { ok: true, correct: false };
}

export function finishSpinning(state) {
  if (state.phase === "spinning") state.phase = "guess";
}

export function startSpin(state) {
  state.phase = "spinning";
  state.roundMoney = 0;
  state.lastWedge = null;
  state.message = "Spinning…";
}
