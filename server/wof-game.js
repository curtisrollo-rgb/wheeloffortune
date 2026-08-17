/** Authoritative Wheel of Fortune game state (v0.1 — lobby + turn shell). */

import { getPlayerBySeat, playerSummaries } from "./rooms.js";

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
    rows: [],
    roundMoney: 0,
  };
}

/** @param {import('./rooms.js').Room} room */
export function startGame(room) {
  if (room.players.length < 2) {
    return { error: "Need at least 2 players to start." };
  }
  if (room.game?.started) {
    return { error: "Game already started." };
  }

  room.game = createInitialGame();
  room.game.started = true;
  room.game.phase = "idle";
  room.game.activeSeat = room.players[0].seat;
  room.game.message = `${room.players[0].name}'s turn — spin the wheel!`;

  for (const player of room.players) {
    player.score = player.score || 0;
  }

  return { ok: true };
}

/** @param {import('./rooms.js').Room} room */
export function publicGameState(room) {
  if (!room.game) return null;
  return {
    phase: room.game.phase,
    roundType: room.game.roundType,
    activeSeat: room.game.activeSeat,
    message: room.game.message,
    category: room.game.category,
    wedgeLabel: room.game.wedgeLabel,
    rows: room.game.rows,
    roundMoney: room.game.roundMoney,
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat|null} seat */
export function turnChangedPayload(room, seat) {
  const player = seat ? getPlayerBySeat(room, seat) : null;
  return {
    op: "turnChanged",
    seat,
    players: playerSummaries(room),
    message: player ? `${player.name}'s turn` : "Waiting…",
  };
}

/** Placeholder handlers — wired in Step 2+ game logic. */

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {number} power */
export function handleSpin(room, seat, power) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  if (room.game.phase !== "idle" && room.game.phase !== "guess") {
    return { error: "You cannot spin right now." };
  }

  const clamped = Math.max(0, Math.min(1, Number(power) || 0));
  room.game.phase = "guess";
  room.game.roundMoney = 500 + Math.round(clamped * 4500);
  room.game.wedgeLabel = `$${room.game.roundMoney.toLocaleString()}`;
  room.game.message = `${getPlayerBySeat(room, seat)?.name} spun ${room.game.wedgeLabel}`;

  return {
    ok: true,
    index: Math.floor(clamped * 23),
    wedge: { label: room.game.wedgeLabel, value: room.game.roundMoney },
    state: publicGameState(room),
  };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} letter */
export function handleGuessLetter(room, seat, letter) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  return { ok: true, hit: false, count: 0, letter: letter.toUpperCase(), indices: [], state: publicGameState(room) };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} letter */
export function handleBuyVowel(room, seat, letter) {
  return handleGuessLetter(room, seat, letter);
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat @param {string} text */
export function handleSolve(room, seat, text) {
  if (!room.game?.started) return { error: "Game not started." };
  if (room.game.activeSeat !== seat) return { error: "Not your turn." };
  room.game.message = `${getPlayerBySeat(room, seat)?.name} attempted a solve.`;
  return { ok: true, correct: false, state: publicGameState(room) };
}

/** @param {import('./rooms.js').Room} room @param {import('./rooms.js').PlayerSeat} seat */
export function handleBuzz(room, seat) {
  if (!room.game?.started) return { error: "Game not started." };
  const player = getPlayerBySeat(room, seat);
  if (!player) return { error: "Player not found." };
  return { ok: true, seat, name: player.name };
}
