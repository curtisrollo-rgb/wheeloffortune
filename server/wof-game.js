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
import { pickRandomPuzzle } from "./puzzles.js";
import { getWedgesForRound } from "./wedges.js";
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

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit */
export function startTossUpRevealLoop(room, emit) {
  stopTossUpTimer(room.code);
  const timer = setInterval(() => {
    if (!room.game || room.game.phase !== "tossUpReveal") {
      stopTossUpTimer(room.code);
      return;
    }
    if (room.game.tossUpRevealPaused) return;

    const hidden = getHiddenTossUpSlots(room.game);
    if (!hidden.length) {
      stopTossUpTimer(room.code);
      room.game.message = "Toss-Up complete — no one solved it.";
      room.game.phase = "ended";
      emit(room, { op: "tossUpComplete", allRevealed: true });
      emit(room, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
      return;
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
  }, 900);
  tossUpTimers.set(room.code, timer);
}

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
    roundPrize: null,
    pendingPrizeKind: null,
    carPrize: null,
    solveBlocked: false,
    finalConsonantsLeft: 0,
    finalVowelsLeft: 0,
    finalPendingPicks: [],
    finalEnvelopeAmount: null,
    finalEnvelopePrize: null,
    finalEnvelopeIndex: null,
    finalEnvelopeRevealed: false,
    finalWon: null,
    tossUpLockedOut: false,
    tossUpLockedSeats: new Set(),
    tossUpRevealPaused: false,
  };
}

/** @param {import('./rooms.js').Room} room @param {string} roundType @param {{ preview?: boolean }} [opts] */
function loadPuzzleForRound(room, roundType, { preview = false } = {}) {
  const entry = pickRandomPuzzle(room.game.usedPuzzleIds);
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
  if (room.game.pendingPrizeKind === "car") {
    room.game.pendingPrizeKind = null;
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
    return {
      canSpin,
      canGuess: false,
      canBuyVowel: false,
      canSolve: g.phase === "finalSolve",
      canRingIn: false,
      canPickFinal,
      finalConsonantsLeft: g.finalConsonantsLeft,
      finalVowelsLeft: g.finalVowelsLeft,
    };
  }

  const canSpin =
    (g.phase === "idle" || g.phase === "guess") &&
    !onlyVowelsRemain(g) &&
    g.phase !== "ended";
  const canGuess =
    g.phase === "guess" &&
    (g.roundMoney > 0 || g.roundPrize || g.pendingPrizeKind === "car") &&
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
    category: room.game.category,
    wedgeLabel: room.game.wedgeLabel,
    rows: room.game.rows,
    roundMoney: room.game.roundMoney,
    roundBank: room.game.roundBank,
    roundPrize: room.game.roundPrize,
    pendingPrizeKind: room.game.pendingPrizeKind,
    carPrize: room.game.carPrize,
    puzzleId: room.game.puzzle?.id ?? null,
    called: [...room.game.called],
    finalConsonantsLeft: room.game.finalConsonantsLeft,
    finalVowelsLeft: room.game.finalVowelsLeft,
    finalEnvelopeAmount: room.game.finalEnvelopeRevealed ? room.game.finalEnvelopeAmount : null,
    finalWon: room.game.finalWon,
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
      revealFinalFree: true,
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
      room.game.message = `${name} landed on CAR! Call a consonant to claim it.`;
    } else {
      room.game.pendingPrizeKind = null;
      room.game.roundPrize = wedge.prize || wedge.label;
      room.game.message = `${name} landed on ${room.game.roundPrize}! Guess a consonant.`;
    }
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

/** @param {import('./rooms.js').Room} room */
export function revealFinalFreeLetters(room) {
  const allIndices = [];
  for (const letter of FINAL_FREE_LETTERS) {
    const result = revealFinalFreeLetter(room.game, letter);
    if (result.ok && result.indices?.length) {
      allIndices.push(...result.indices);
    }
  }
  const pickPhase = beginFinalPickPhase(room.game);
  if (pickPhase.autoSolved) {
    const seat = room.game.activeSeat;
    const player = getPlayerBySeat(room, seat);
    const amount = room.game.finalEnvelopeAmount ?? 0;
    bankFinalWin(room.game, seat, player, amount);
    revealAllForAnswer(room.game);
    return { ok: true, indices: allIndices, autoSolved: true, rows: room.game.rows };
  }
  return { ok: true, indices: allIndices, autoSolved: false, rows: room.game.rows };
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
  if (room.game.roundPrize) {
    message += ` Plus: ${room.game.roundPrize}!`;
  } else if (room.game.carPrize) {
    message += ` Plus: ${room.game.carPrize.name}!`;
  }
  room.game.message = message;
  room.game.phase = "ended";
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
      return {
        ok: true,
        hit: reveal.indices.length > 0,
        count: reveal.indices.length,
        letter,
        indices: reveal.indices,
        solved: reveal.solved,
        rows: room.game.rows,
        finalReveal: true,
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

    if (room.game.pendingPrizeKind === "car") {
      room.game.pendingPrizeKind = null;
      room.game.carPrize = { id: "car-round2", name: "Bonus Car" };
      room.game.roundPrize = room.game.carPrize.name;
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

    if (onlyVowelsRemain(room.game)) {
      room.game.message = `${count} ${upper}'s. Only vowels left — buy a vowel or solve.`;
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
      room.game.tossUpLockedSeats.add(seat);
      room.game.activeSeat = null;
      room.game.tossUpRevealPaused = false;
      room.game.message = `${name} locked out — letters keep revealing.`;
      return { ok: true, correct: false, lockedOut: true, resumeTossUp: true };
    }

    if (guessesMatch(trimmed, room.game.puzzle.answer)) {
      stopTossUpTimer(room.code);
      room.game.rows = revealAllRows(room.game.rows, room.game.puzzle.answer);
      if (player) player.score = (player.score || 0) + TOSS_UP_WIN;
      room.game.phase = "ended";
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

    room.game.tossUpLockedSeats.add(seat);
    room.game.activeSeat = null;
    room.game.tossUpRevealPaused = false;
    room.game.message = `${name}'s solve was wrong — locked out.`;
    return { ok: true, correct: false, lockedOut: true, resumeTossUp: true };
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
    room.game.finalWon = false;
    room.game.rows = revealAllRows(room.game.rows, answer);
    room.game.phase = "ended";
    room.game.message = `Sorry ${name} — the answer was: ${answer}`;
    return {
      ok: true,
      correct: false,
      revealAnswer: true,
      rows: room.game.rows,
      answer,
      message: room.game.message,
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
