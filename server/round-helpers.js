/** Shared round logic (ported from js/game-state.js for multiplayer server). */

import { isVowel, revealWithMap, isSolved, revealAllRows } from "./puzzle-layout.js";
import { getPlayerBySeat } from "./rooms.js";
import { tossUpWinAmount } from "./round-sequence.js";

/** Base toss-up value (1st toss-up); later toss-ups scale by ordinal. */
export const TOSS_UP_WIN = 1000;

/** @param {object} game */
export function getTossUpWin(game) {
  return game.tossUpWinAmount ?? tossUpWinAmount(game.roundSequenceIndex ?? 0);
}
export const FINAL_FREE_LETTERS = "RSTLNE";

/** @param {object} game */
export function onlyVowelsRemain(game) {
  if (isSolved(game.rows)) return false;
  let hiddenVowel = false;
  for (const slot of game.letterMap) {
    if (game.rows[slot.row][slot.col] !== "_") continue;
    if (isVowel(slot.letter)) hiddenVowel = true;
    else return false;
  }
  return hiddenVowel;
}

/** @param {object} game */
export function hasHiddenVowels(game) {
  for (const letter of "AEIOU") {
    if (game.called.has(letter)) continue;
    for (const slot of game.letterMap) {
      if (slot.letter === letter && game.rows[slot.row][slot.col] === "_") {
        return true;
      }
    }
  }
  return false;
}

/** @param {object} game */
export function hasHiddenConsonants(game) {
  for (const slot of game.letterMap) {
    if (!isVowel(slot.letter) && game.rows[slot.row][slot.col] === "_") {
      return true;
    }
  }
  return false;
}

/** @param {object} game */
export function getHiddenTossUpSlots(game) {
  const slots = [];
  for (const slot of game.letterMap) {
    if (game.rows[slot.row][slot.col] === "_") {
      slots.push(slot);
    }
  }
  return slots;
}

/** @param {object} game @param {{ row: number, col: number, letter: string }} slot */
export function revealTossUpTile(game, slot) {
  if (game.phase !== "tossUpReveal") {
    return { ok: false, reason: "badPhase" };
  }
  if (game.rows[slot.row][slot.col] !== "_") {
    return { ok: false, reason: "alreadyRevealed" };
  }

  const next = game.rows.map((r) => r.split(""));
  next[slot.row][slot.col] = slot.letter;
  game.rows = next.map((r) => r.join(""));
  return {
    ok: true,
    letter: slot.letter,
    indices: [{ row: slot.row, col: slot.col }],
    count: 1,
    rows: game.rows,
  };
}

/** @param {object} game */
export function beginTossUpReveal(game) {
  if (game.roundType !== "tossup") return false;
  if (game.phase !== "tossUpAnnounce" && game.phase !== "tossUpCountdown") {
    return false;
  }
  game.phase = "tossUpReveal";
  game.message = "Toss-Up! Letters revealing — ring in when you know it!";
  return true;
}

/** @param {object} game @param {number} index @param {object} wedge */
export function sealFinalEnvelope(game, index, wedge) {
  game.finalEnvelopeIndex = index;
  game.finalEnvelopePrize = wedge.prize || null;

  if (wedge.prizeType === "car" && wedge.prize) {
    game.finalEnvelopeAmount = 0;
    game.wedgeLabel = "✉ CAR";
  } else if (wedge.prizeType === "trip" && wedge.prize) {
    game.finalEnvelopeAmount = wedge.prize.valueUsd || wedge.value || 0;
    game.wedgeLabel = "✉ TRIP";
  } else {
    game.finalEnvelopeAmount = wedge.value ?? 0;
    game.wedgeLabel = "✉ SEALED";
  }

  game.phase = "finalPuzzleReveal";
  game.puzzleHidden = false;
  game.message = "Bonus sealed! Here's your puzzle!";
  return { ok: true };
}

/** @param {object} game @param {string} letter */
export function revealFinalFreeLetter(game, letter) {
  const upper = letter.toUpperCase();
  if (game.phase !== "finalRevealFree") {
    return { ok: false, reason: "badPhase" };
  }
  if (game.called.has(upper) || !FINAL_FREE_LETTERS.includes(upper)) {
    return { ok: false, reason: "skip" };
  }

  game.called.add(upper);
  const { rows, indices, count } = revealWithMap(game.rows, game.letterMap, upper);
  game.rows = rows;
  return { ok: true, letter: upper, indices, count, rows: game.rows };
}

/** @param {object} game */
export function beginFinalPickPhase(game) {
  game.finalConsonantsLeft = 3;
  game.finalVowelsLeft = 1;
  game.finalPendingPicks = [];

  if (isSolved(game.rows)) {
    return { autoSolved: true };
  }

  game.phase = "finalPick";
  game.message = `${FINAL_FREE_LETTERS.split("").join(", ")} given. Pick 3 consonants.`;
  return { autoSolved: false };
}

/** @param {object} game @param {string} letter */
export function canPickFinalLetter(game, letter) {
  if (game.roundType !== "final" || game.phase !== "finalPick") return false;
  const upper = letter.toUpperCase();
  if (game.called.has(upper) || game.finalPendingPicks.includes(upper)) return false;
  if (isVowel(upper)) {
    return game.finalConsonantsLeft === 0 && game.finalVowelsLeft > 0;
  }
  return game.finalConsonantsLeft > 0;
}

/** @param {object} game @param {string} letter */
export function pickFinalLetter(game, letter) {
  const upper = letter.toUpperCase();
  if (!canPickFinalLetter(game, upper)) {
    return { ok: false, reason: "badPhase" };
  }

  game.finalPendingPicks.push(upper);
  if (isVowel(upper)) {
    game.finalVowelsLeft -= 1;
  } else {
    game.finalConsonantsLeft -= 1;
  }

  if (game.finalConsonantsLeft === 0 && game.finalVowelsLeft === 0) {
    return { ok: true, letter: upper, readyToReveal: true };
  }
  if (game.finalConsonantsLeft === 0) {
    game.message = "Pick 1 vowel.";
  } else {
    game.message = `Pick ${game.finalConsonantsLeft} consonant(s).`;
  }
  return { ok: true, letter: upper, readyToReveal: false };
}

/** @param {object} game */
export function revealFinalPendingLetters(game) {
  const picks = [...game.finalPendingPicks];
  game.finalPendingPicks = [];
  const allIndices = [];
  const steps = [];

  for (const letter of picks) {
    game.called.add(letter);
    const { rows, indices } = revealWithMap(game.rows, game.letterMap, letter);
    game.rows = rows;
    allIndices.push(...indices);
    steps.push({
      letter,
      indices: [...indices],
      rows: game.rows.map((row) => row),
    });
  }

  game.phase = "finalSolve";
  game.message = allIndices.length
    ? "Letters revealed. You have 30 seconds to solve!"
    : "None of your letters were in the puzzle. You have 30 seconds to solve!";

  return {
    ok: true,
    indices: allIndices,
    picks,
    steps,
    rows: game.rows,
    solved: isSolved(game.rows),
  };
}

/** @param {object} game */
export function resetRoundFields(game) {
  game.roundMoney = 0;
  game.roundBank = 0;
  game.wedgeLabel = "—";
  game.roundPrize = null;
  game.pendingPrizeKind = null;
  game.pendingPrizeLabel = null;
  game.carPrize = null;
  game.tripPrize = null;
  game.tripPrizeClaimed = false;
  game.spaPrize = null;
  game.spaPrizeClaimed = false;
  game.solveBlocked = false;
  game.finalConsonantsLeft = 0;
  game.finalVowelsLeft = 0;
  game.finalPendingPicks = [];
  game.finalEnvelopeAmount = null;
  game.finalEnvelopePrize = null;
  game.finalEnvelopeIndex = null;
  game.finalEnvelopeRevealed = false;
  game.finalWon = null;
  game.puzzleHidden = false;
  game.finalRstlneIndex = 0;
  game.finalTimerRemainingMs = 0;
  game.finalTimerPaused = false;
  game.timerRemainingMs = 0;
  game.timerKind = null;
  game.timerSlow = false;
  game.tossUpLockedOut = false;
  game.tossUpLockedSeats = new Set();
  game.tossUpRevealPaused = false;
  game.roundWinnerSeat = null;
  game.roundWinAmount = 0;
  game.spinInFlight = false;
  game.spunThisTurn = false;
}

/** @param {object} game @param {import('./rooms.js').Room} room @param {{ starterSeat?: import('./rooms.js').PlayerSeat|null }} [opts] */
export function setupRoundPhase(game, roundType, room, { starterSeat = null } = {}) {
  if (roundType === "tossup") {
    game.phase = "tossUpAnnounce";
    game.activeSeat = null;
    const win = tossUpWinAmount(game.roundSequenceIndex ?? 0);
    game.tossUpWinAmount = win;
    game.message = `Toss-Up worth $${win.toLocaleString()} — stand by for the category…`;
    return;
  }
  if (roundType === "final") {
    game.phase = "finalEnvelope";
    game.puzzleHidden = true;
    game.activeSeat = pickFinalist(room);
    game.message = "Spin the wheel to seal your bonus envelope!";
    return;
  }
  game.phase = "idle";
  const fallbackSeat = room.players[0]?.seat ?? null;
  game.activeSeat = starterSeat ?? fallbackSeat;
  const starter = game.activeSeat ? getPlayerBySeat(room, game.activeSeat) : null;
  if (roundType === "round2") {
    game.message = starter
      ? `${starter.name}'s turn — Round 2! Spin for cash or a prize wedge!`
      : "Round 2 — spin for cash or a prize wedge!";
    return;
  }
  game.message = starter ? `${starter.name}'s turn — spin the wheel!` : "Spin the wheel!";
}

/** @param {import('./rooms.js').Room} room */
export function pickFinalist(room) {
  let best = room.players[0];
  for (const player of room.players) {
    if ((player.score || 0) > (best?.score || 0)) best = player;
  }
  return best?.seat ?? room.players[0]?.seat ?? null;
}

/** @param {object} game @param {import('./rooms.js').PlayerSeat} seat @param {number} amount */
export function bankFinalWin(game, seat, player, amount) {
  const prize = game.finalEnvelopePrize;
  if (prize?.kind === "car") {
    const label = prize.make && prize.model ? `${prize.make} ${prize.model}` : prize.name;
    game.carPrize = { id: prize.id, name: label, make: prize.make, model: prize.model };
    game.roundPrize = label;
    game.message = `Correct! ${player?.name ?? seat} wins a ${label}!`;
  } else if (prize?.kind === "trip") {
    game.roundPrize = prize.label;
    if (player) player.score = (player.score || 0) + amount;
    game.message = `Correct! ${player?.name ?? seat} wins ${prize.label}!`;
  } else {
    if (player) player.score = (player.score || 0) + amount;
    game.message = `Correct! ${player?.name ?? seat} wins $${amount.toLocaleString()}!`;
  }
  game.phase = "ended";
  game.finalWon = true;
  game.roundWinnerSeat = seat;
  game.roundWinAmount = amount ?? 0;
}

/** @param {object} game */
export function revealAllForAnswer(game) {
  if (!game.puzzle?.answer) return game.rows;
  game.rows = revealAllRows(game.rows, game.puzzle.answer);
  return game.rows;
}
