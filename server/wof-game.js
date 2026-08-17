/** Authoritative Wheel of Fortune game state (v0.2 — puzzles + letter guesses). */

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
import { pickRandomPuzzle } from "./puzzles.js";
import { getWedgesForRound } from "./wedges.js";
import { randomBytes } from "crypto";

export const VOWEL_COST = 250;
export const MIN_ROUND_WIN = 1000;

/** @param {import('./rooms.js').Room} room */
export function createInitialGame() {
  return {
    started: false,
    phase: "lobby",
    roundType: "round1",
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
  };
}

/** @param {import('./rooms.js').Room} room @param {{ preview?: boolean }} [opts] */
function loadRandomPuzzle(room, { preview = false } = {}) {
  const entry = pickRandomPuzzle(room.game.usedPuzzleIds);
  const layout = layoutPuzzle(entry.category, entry.answer);
  const id = entry.id || entry.answer;
  room.game.usedPuzzleIds.add(id);
  room.game.puzzle = { id, category: entry.category, answer: layout.answer };
  room.game.category = entry.category;
  room.game.rows = layout.rows;
  room.game.letterMap = buildLetterMap(layout.rows, layout.answer);
  room.game.called = new Set();
  room.game.roundMoney = 0;
  room.game.roundBank = 0;
  room.game.wedgeLabel = "—";
  room.game.phase = preview ? "lobby" : "idle";
  room.game.message = preview
    ? "Preview puzzle — waiting to start…"
    : "Spin the wheel!";
  return entry;
}

/** Load a preview puzzle when the TV connects (before Start Game). */
export function ensurePreviewBoard(room) {
  if (!room.game) {
    room.game = createInitialGame();
  }
  const hasPuzzleTiles = room.game.rows?.some((row) => row.includes("_"));
  if (!room.game.started && !hasPuzzleTiles) {
    loadRandomPuzzle(room, { preview: true });
  }
  return publicGameState(room);
}

/** @param {import('./rooms.js').Room} room */
function advanceTurn(room) {
  if (room.players.length <= 1) {
    room.game.phase = "idle";
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
    loadRandomPuzzle(room);
  } else {
    room.game.started = true;
    room.game.phase = "idle";
    room.game.called = new Set();
    room.game.roundMoney = 0;
    room.game.roundBank = 0;
    room.game.wedgeLabel = "—";
  }

  room.game.started = true;
  room.game.phase = "idle";
  room.game.activeSeat = room.players[0].seat;
  const first = room.players[0];
  room.game.message = `${first.name}'s turn — spin the wheel!`;

  for (const player of room.players) {
    player.score = player.score || 0;
  }

  return { ok: true };
}

/** @param {import('./rooms.js').Room} room */
export function newPuzzle(room) {
  if (!room.game?.started) {
    return { error: "Start the game first." };
  }
  loadRandomPuzzle(room);
  const player = getPlayerBySeat(room, room.game.activeSeat);
  room.game.message = player
    ? `${player.name}'s turn — spin the wheel!`
    : "New puzzle loaded — spin the wheel!";
  return { ok: true };
}

/** @param {import('./rooms.js').Room} room */
export function playerActionFlags(room) {
  if (!room.game?.started) {
    return { canSpin: false, canGuess: false, canBuyVowel: false, canSolve: false };
  }
  const g = room.game;
  const canSpin = g.phase === "idle" || g.phase === "guess";
  const canGuess = g.phase === "guess" && g.roundMoney > 0;
  const canBuyVowel =
    g.phase === "guess" &&
    g.roundBank >= VOWEL_COST &&
    "AEIOU".split("").some((letter) => !g.called.has(letter));
  const canSolve = g.phase === "guess" || g.phase === "idle";
  return { canSpin, canGuess, canBuyVowel, canSolve };
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
    category: room.game.category,
    wedgeLabel: room.game.wedgeLabel,
    rows: room.game.rows,
    roundMoney: room.game.roundMoney,
    roundBank: room.game.roundBank,
    puzzleId: room.game.puzzle?.id ?? null,
    called: [...room.game.called],
    ...playerActionFlags(room),
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat|null} seat */
export function turnChangedPayload(room, seat) {
  const player = seat ? getPlayerBySeat(room, seat) : null;
  return {
    op: "turnChanged",
    seat,
    name: player?.name ?? seat,
    players: playerSummaries(room),
    message: player ? `${player.name}'s turn — spin the wheel!` : "Waiting…",
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

function letterResultPayload(room, seat, result) {
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
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {number} power */
export function handleSpin(room, seat, _power) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  if (room.game.phase !== "idle" && room.game.phase !== "guess") {
    return { error: "You cannot spin right now." };
  }

  const wedges = getWedgesForRound(room.game.roundType);
  const index = randomBytes(2).readUInt16BE(0) % wedges.length;
  const wedge = wedges[index];
  const player = getPlayerBySeat(room, seat);
  const name = player?.name ?? seat;

  if (wedge.type === "bankrupt") {
    room.game.roundBank = 0;
    room.game.roundMoney = 0;
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
    room.game.message = `${name} landed on ${wedge.label}! Guess a consonant.`;
    return {
      ok: true,
      index,
      wedge: {
        label: wedge.label,
        value: 0,
        type: "prize",
        prize: wedge.prize,
        prizeKind: wedge.prizeKind,
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
  const roundWin = bankRoundOnSolve(room, seat);
  const name = getPlayerBySeat(room, seat)?.name ?? seat;
  room.game.message =
    roundWin > 0
      ? `Correct! ${name} solved the puzzle for $${roundWin.toLocaleString()}!`
      : `Correct! ${name} solved the puzzle!`;
  room.game.phase = "ended";
  return roundWin;
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} letter */
export function handleGuessLetter(room, seat, letter) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
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
    room.game.message =
      earned > 0
        ? `${count} ${upper}'s — $${earned.toLocaleString()}! Spin, buy a vowel, or solve.`
        : `${count} ${upper}'s revealed. Spin, buy a vowel, or solve.`;
    room.game.phase = "guess";

    if (isSolved(room.game.rows)) {
      finishSolveByLetters(room, seat);
      return { ok: true, hit: true, count, letter: upper, indices, solved: true, rows: room.game.rows };
    }

    return { ok: true, hit: true, count, letter: upper, indices, rows: room.game.rows };
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
  if (room.game.phase !== "guess" && room.game.phase !== "idle") {
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
    room.game.message = `${count} ${upper}'s. Spin, buy another vowel, or solve.`;
    if (isSolved(room.game.rows)) {
      finishSolveByLetters(room, seat);
      return { ok: true, hit: true, count, letter: upper, indices, solved: true, rows: room.game.rows };
    }
    return { ok: true, hit: true, count, letter: upper, indices, rows: room.game.rows };
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

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} text */
export function handleSolve(room, seat, text) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  if (room.game.phase !== "guess" && room.game.phase !== "idle") {
    return { error: "You cannot solve right now." };
  }

  const answer = room.game.puzzle?.answer;
  if (!answer) return { error: "No puzzle loaded." };

  const player = getPlayerBySeat(room, seat);
  const name = player?.name ?? seat;

  if (guessesMatch(text, answer)) {
    room.game.rows = revealAllRows(room.game.rows, answer);
    const roundWin = bankRoundOnSolve(room, seat);
    room.game.message =
      roundWin > 0
        ? `Correct! ${name} solved the puzzle for $${roundWin.toLocaleString()}!`
        : `Correct! ${name} solved the puzzle!`;
    room.game.phase = "ended";
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

  room.game.message = `${getPlayerBySeat(room, seat)?.name}'s solve was wrong.`;
  advanceTurn(room);
  return { ok: true, correct: false, turnLost: true, broadcastTurn: true };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat */
export function handleBuzz(room, seat) {
  if (!room.game?.started) return { error: "Game not started." };
  const player = getPlayerBySeat(room, seat);
  if (!player) return { error: "Player not found." };
  return { ok: true, seat, name: player.name };
}

export { letterResultPayload, playerActionPayload };
