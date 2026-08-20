/** Turn + final solve timers (30s default, half-speed while solving). */

export const TURN_TIMER_MS = 30000;
export const FINAL_SOLVE_MS = 30000;
export const TOSSUP_SOLVE_MS = 30000;
const TIMER_TICK_MS = 500;

/** @type {Map<string, NodeJS.Timeout>} */
const roomTimers = new Map();

/** @param {string} code */
export function stopGameTimer(code) {
  const timer = roomTimers.get(code);
  if (timer) clearInterval(timer);
  roomTimers.delete(code);
}

/** @param {import('./rooms.js').Room} room */
function timerPayload(room) {
  const g = room.game;
  return {
    remainingMs: g.timerRemainingMs ?? 0,
    slow: !!g.timerSlow,
    kind: g.timerKind ?? null,
  };
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit @param {string} op */
function broadcastTimer(room, emit, op) {
  emit(room, { op, ...timerPayload(room) });
}

/**
 * @param {import('./rooms.js').Room} room
 * @param {(room: import('./rooms.js').Room, payload: object) => void} emit
 * @param {{ remainingMs?: number, kind: 'turn'|'final', slow?: boolean, onExpire: () => void }} opts
 */
export function startGameTimer(room, emit, { remainingMs, kind, slow = false, onExpire }) {
  if (!room.game) return;
  stopGameTimer(room.code);
  room.game.timerRemainingMs =
    remainingMs ??
    (kind === "final" ? FINAL_SOLVE_MS : kind === "tossupSolve" ? TOSSUP_SOLVE_MS : TURN_TIMER_MS);
  room.game.timerKind = kind;
  room.game.timerSlow = slow;
  room.game.finalTimerRemainingMs = kind === "final" ? room.game.timerRemainingMs : 0;
  room.game.finalTimerPaused = false;

  const startOp = kind === "final" ? "finalTimerStart" : "turnTimerStart";
  broadcastTimer(room, emit, startOp);

  const timer = setInterval(() => {
    const g = room.game;
    if (!g || g.timerKind !== kind) {
      stopGameTimer(room.code);
      return;
    }
    const step = g.timerSlow ? TIMER_TICK_MS / 2 : TIMER_TICK_MS;
    g.timerRemainingMs = Math.max(0, g.timerRemainingMs - step);
    if (kind === "final") g.finalTimerRemainingMs = g.timerRemainingMs;

    const tickOp = kind === "final" ? "finalTimerTick" : "turnTimerTick";
    broadcastTimer(room, emit, tickOp);

    if (g.timerRemainingMs <= 0) {
      stopGameTimer(room.code);
      onExpire();
    }
  }, TIMER_TICK_MS);

  roomTimers.set(room.code, timer);
}

/** @param {import('./rooms.js').Room} room @param {boolean} slow */
export function setTimerSlowMode(room, slow) {
  if (!room.game?.timerKind) return;
  room.game.timerSlow = slow;
  room.game.finalTimerPaused = false;
}

/** @param {import('./rooms.js').Room} room */
export function clearGameTimer(room) {
  stopGameTimer(room.code);
  if (!room.game) return;
  room.game.timerRemainingMs = 0;
  room.game.timerKind = null;
  room.game.timerSlow = false;
  room.game.finalTimerRemainingMs = 0;
  room.game.finalTimerPaused = false;
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit @param {() => void} onExpire @param {number} [remainingMs] */
export function startTurnTimer(room, emit, onExpire, remainingMs = TURN_TIMER_MS) {
  if (!room.game || room.game.roundType === "tossup" || room.game.roundType === "final") return;
  if (!room.game.activeSeat) return;
  if (room.game.phase !== "guess") return;
  startGameTimer(room, emit, {
    remainingMs,
    kind: "turn",
    slow: false,
    onExpire,
  });
}

/** Fresh 30s timer after a spin or when entering letter-pick phase. */
export function resetTurnTimer(room, emit, onExpire, remainingMs = TURN_TIMER_MS) {
  clearGameTimer(room);
  startTurnTimer(room, emit, onExpire, remainingMs);
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit @param {() => void} onExpire @param {number} [remainingMs] */
export function startTossUpSolveTimer(room, emit, onExpire, remainingMs = TOSSUP_SOLVE_MS) {
  startGameTimer(room, emit, {
    remainingMs,
    kind: "tossupSolve",
    slow: false,
    onExpire,
  });
}

/** @param {import('./rooms.js').Room} room @param {(room: import('./rooms.js').Room, payload: object) => void} emit @param {() => void} onExpire @param {number} [remainingMs] */
export function startFinalSolveTimer(room, emit, onExpire, remainingMs = FINAL_SOLVE_MS) {
  startGameTimer(room, emit, {
    remainingMs,
    kind: "final",
    slow: false,
    onExpire,
  });
}
