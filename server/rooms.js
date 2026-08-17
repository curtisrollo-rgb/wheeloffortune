import { randomBytes } from "crypto";
import { ROOM_CODES } from "./room-words.js";

/** @typedef {'p1'|'p2'|'p3'} PlayerSeat */

/** @typedef {object} PlayerConn
 * @property {string} id
 * @property {import('ws').WebSocket} ws
 * @property {PlayerSeat} seat
 * @property {string} name
 * @property {number} score
 */

/** @typedef {object} HostConn
 * @property {import('ws').WebSocket} ws
 */

/** @typedef {object} LobbyConn
 * @property {import('ws').WebSocket} ws
 */

/** @typedef {object} Room
 * @property {string} code
 * @property {number} createdAt
 * @property {LobbyConn|null} lobby
 * @property {HostConn|null} host
 * @property {PlayerConn[]} players
 * @property {string[]} log
 * @property {object|null} game
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

export const PLAYER_SEATS = /** @type {const} */ (["p1", "p2", "p3"]);

export function generateRoomCode() {
  const open = ROOM_CODES.filter((word) => !rooms.has(word));
  const pool = open.length ? open : ROOM_CODES;
  const idx = randomBytes(1)[0] % pool.length;
  const code = pool[idx];
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

export function createRoom() {
  const code = generateRoomCode();
  rooms.set(code, {
    code,
    createdAt: Date.now(),
    lobby: null,
    host: null,
    players: [],
    log: [],
    game: null,
  });
  return code;
}

export function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase()) || null;
}

/** @returns {PlayerSeat|null} */
export function nextOpenSeat(room) {
  for (const seat of PLAYER_SEATS) {
    if (!room.players.some((p) => p.seat === seat)) return seat;
  }
  return null;
}

/** @param {Room} room @param {import('ws').WebSocket} ws @param {PlayerSeat} seat @param {string} name */
export function addPlayer(room, ws, seat, name) {
  room.players.push({
    id: `${seat}-${Date.now()}`,
    ws,
    seat,
    name: String(name || seat).slice(0, 24),
    score: 0,
  });
}

/** @param {import('ws').WebSocket} ws @param {Room} room */
export function setLobby(room, ws) {
  room.lobby = { ws };
}

/** @param {import('ws').WebSocket} ws @param {Room} room */
export function setHost(room, ws) {
  room.host = { ws };
}

/** @param {import('ws').WebSocket} ws */
export function removeConnection(ws) {
  for (const room of rooms.values()) {
    const idx = room.players.findIndex((p) => p.ws === ws);
    if (idx >= 0) {
      const [removed] = room.players.splice(idx, 1);
      if (room.players.length === 0 && !room.host && !room.lobby) {
        rooms.delete(room.code);
      }
      return { room, seat: removed.seat, role: "player", name: removed.name };
    }

    if (room.host?.ws === ws) {
      room.host = null;
      if (room.players.length === 0 && !room.lobby) {
        rooms.delete(room.code);
      }
      return { room, seat: null, role: "host", name: null };
    }

    if (room.lobby?.ws === ws) {
      room.lobby = null;
      if (room.players.length === 0 && !room.host) {
        rooms.delete(room.code);
      }
      return { room, seat: null, role: "lobby", name: null };
    }
  }
  return null;
}

/** @param {Room} room */
export function playerSummaries(room) {
  return room.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    score: p.score,
  }));
}

/** @param {Room} room */
export function roomStatus(room) {
  return {
    code: room.code,
    playerCount: room.players.length,
    hostConnected: !!room.host,
    gameStarted: !!room.game?.started,
    players: playerSummaries(room),
    log: room.log.slice(-20),
  };
}

/** @param {Room} room @param {string} message */
export function appendLog(room, message) {
  room.log.push(`${new Date().toISOString()} ${message}`);
  if (room.log.length > 100) room.log.shift();
}

export function listRooms() {
  return [...rooms.values()].map((r) => roomStatus(r));
}

/** @param {Room} room @param {import('ws').WebSocket} ws */
export function getConnectionRole(room, ws) {
  if (room.lobby?.ws === ws) return { role: "lobby", seat: null };
  if (room.host?.ws === ws) return { role: "host", seat: null };
  const player = room.players.find((p) => p.ws === ws);
  if (player) return { role: "player", seat: player.seat, name: player.name };
  return null;
}

/** @param {Room} room @param {PlayerSeat} seat */
export function getPlayerBySeat(room, seat) {
  return room.players.find((p) => p.seat === seat) || null;
}
