import http from "http";
import { WebSocketServer } from "ws";
import {
  addPlayer,
  appendLog,
  createRoom,
  getConnectionRole,
  getPlayerBySeat,
  getRoom,
  nextOpenSeat,
  playerSummaries,
  removeConnection,
  roomStatus,
  listRooms,
  setHost,
  setLobby,
} from "./rooms.js";
import {
  handleBuzz,
  handleBuyVowel,
  handleGuessLetter,
  handleSolve,
  handleSolveIntent,
  handleSpin,
  ensurePreviewBoard,
  letterResultPayload,
  playerActionPayload,
  newPuzzle,
  publicGameState,
  startGame,
  turnChangedPayload,
  setRound,
  beginTossUp,
  revealFinalFreeLetters,
  startTossUpRevealLoop,
  resumeTossUpReveal,
  startTossUpCountdown,
} from "./wof-game.js";
import { getWedgeManifestForRound } from "./wedges.js";
import { puzzleCount, getPuzzleSource } from "./puzzles.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const VERSION = "0.2.20";

/** @type {Map<import('ws').WebSocket, { code: string, role: 'host'|'player'|'lobby', seat?: import('./rooms.js').PlayerSeat|null, name?: string }>} */
const connections = new Map();

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function error(ws, message) {
  send(ws, { op: "error", message, error: message });
}

/** @param {import('./rooms.js').Room} room */
function broadcast(room, payload, exceptWs = null) {
  if (room.lobby?.ws && room.lobby.ws !== exceptWs) {
    send(room.lobby.ws, payload);
  }
  if (room.host?.ws && room.host.ws !== exceptWs) {
    send(room.host.ws, payload);
  }
  for (const player of room.players) {
    if (player.ws !== exceptWs) send(player.ws, payload);
  }
}

/** @param {import('./rooms.js').Room} room @param {string} [message] */
function broadcastLobby(room, message = "Waiting for players…") {
  const payload = {
    op: "lobbyUpdate",
    players: playerSummaries(room),
    message,
    gameStarted: !!room.game?.started,
  };
  broadcast(room, payload);
}

/** @param {import('./rooms.js').Room} room */
function broadcastGameState(room) {
  const state = publicGameState(room);
  const payload = {
    op: "gameUpdate",
    state,
    players: playerSummaries(room),
  };
  broadcast(room, payload);
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    return jsonResponse(res, 200, {
      ok: true,
      service: "wof-game-server",
      version: VERSION,
      connections: connections.size,
      rooms: listRooms().length,
      puzzleCount: puzzleCount(),
      puzzleSource: getPuzzleSource(),
    });
  }
  jsonResponse(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  send(ws, {
    op: "hello",
    message: "Wheel of Fortune game server connected",
    version: VERSION,
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return error(ws, "Invalid JSON");
    }

    const op = msg.op;

    if (op === "ping") {
      return send(ws, { op: "pong", t: Date.now(), echo: msg.t ?? null });
    }

    if (op === "createRoom") {
      const code = createRoom();
      const room = getRoom(code);
      setLobby(room, ws);
      connections.set(ws, { code, role: "lobby", seat: null });
      appendLog(room, "Room created");
      send(ws, {
        op: "roomCreated",
        code,
        players: playerSummaries(room),
        status: roomStatus(room),
      });
      return;
    }

    if (op === "attachHost") {
      const code = String(msg.code || "").toUpperCase();
      const room = getRoom(code);
      if (!room) return error(ws, "Room not found");

      setHost(room, ws);
      connections.set(ws, { code, role: "host", seat: null });
      appendLog(room, "TV host attached");

      const preview = ensurePreviewBoard(room);
      send(ws, {
        op: "hostAttached",
        code,
        players: playerSummaries(room),
        gameStarted: !!room.game?.started,
        preview,
        wedgeManifest: getWedgeManifestForRound(room.game?.roundType || "round1"),
      });
      send(ws, {
        op: "gameUpdate",
        state: preview,
        players: playerSummaries(room),
      });
      broadcastLobby(room, "TV display connected.");
      return;
    }

    if (op === "joinRoom") {
      const code = String(msg.code || "").toUpperCase();
      const name = String(msg.name || "").trim();
      const room = getRoom(code);
      if (!room) return error(ws, "Room not found");
      if (!name) return error(ws, "Enter a display name.");

      const existing = getConnectionRole(room, ws);
      if (existing?.role === "player") {
        return error(ws, "Already joined this room.");
      }

      const seat = nextOpenSeat(room);
      if (!seat) return error(ws, "Room is full (3 players max).");

      addPlayer(room, ws, seat, name);
      connections.set(ws, { code, role: "player", seat, name });
      appendLog(room, `${name} joined as ${seat}`);

      send(ws, {
        op: "joined",
        code,
        seat,
        name,
        role: "player",
        players: playerSummaries(room),
        gameStarted: !!room.game?.started,
      });

      broadcast(room, { op: "playerJoined", seat, name, players: playerSummaries(room) }, ws);
      broadcastLobby(room, `${name} joined as ${seat.toUpperCase()}.`);
      return;
    }

    if (op === "rejoinRoom") {
      const code = String(msg.code || "").toUpperCase();
      const seat = msg.seat;
      const name = String(msg.name || "").trim() || seat;
      const room = getRoom(code);
      if (!room) return error(ws, "Room not found");
      if (seat !== "p1" && seat !== "p2" && seat !== "p3") {
        return error(ws, "Invalid seat.");
      }

      const existing = room.players.find((p) => p.seat === seat);
      if (existing && existing.ws !== ws) {
        try {
          existing.ws.close(4000, "Replaced by controller");
        } catch {
          /* ignore */
        }
      }
      room.players = room.players.filter((p) => p.seat !== seat);

      addPlayer(room, ws, seat, name);
      connections.set(ws, { code, role: "player", seat, name });
      appendLog(room, `${name} rejoined as ${seat}`);

      send(ws, {
        op: "rejoined",
        code,
        seat,
        name,
        role: "player",
        players: playerSummaries(room),
        gameStarted: !!room.game?.started,
      });

      if (room.game?.started) {
        send(ws, { op: "gameUpdate", state: publicGameState(room), players: playerSummaries(room) });
        if (room.game.activeSeat) {
          send(ws, turnChangedPayload(room, room.game.activeSeat));
        }
      } else {
        broadcastLobby(room);
      }
      return;
    }

    if (op === "startGame") {
      const info = connections.get(ws);
      if (!info) return error(ws, "Join or attach to a room first.");
      if (info.role !== "host" && info.role !== "lobby") {
        return error(ws, "Only the lobby or TV can start the game.");
      }
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found.");

      const result = startGame(room);
      if (result.error) return error(ws, result.error);

      appendLog(room, "Game started");
      broadcast(room, { op: "gameStarted", code: room.code, state: publicGameState(room), players: playerSummaries(room) });
      broadcastGameState(room);
      broadcast(room, turnChangedPayload(room, room.game.activeSeat));
      return;
    }

    if (op === "spin") {
      const info = connections.get(ws);
      if (!info || info.role !== "player" || !info.seat) return error(ws, "Players only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");

      const result = handleSpin(room, info.seat, msg.power);
      if (result.error) return error(ws, result.error);

      broadcast(room, playerActionPayload(room, info.seat, "spin"));
      broadcast(room, {
        op: "spinResult",
        seat: info.seat,
        index: result.index,
        wedge: result.wedge,
        roundType: room.game.roundType,
      });
      if (result.revealFinalFree) {
        const free = revealFinalFreeLetters(room);
        broadcast(room, {
          op: "finalFreeReveal",
          steps: free.steps,
          indices: free.indices,
          rows: free.rows,
          autoSolved: !!free.autoSolved,
        });
      }
      if (result.broadcastTurn) {
        broadcast(room, turnChangedPayload(room, room.game.activeSeat));
      }
      broadcastGameState(room);
      return;
    }

    if (op === "guessLetter") {
      const info = connections.get(ws);
      if (!info || info.role !== "player" || !info.seat) return error(ws, "Players only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");

      const result = handleGuessLetter(room, info.seat, msg.letter);
      if (result.error) return error(ws, result.error);

      broadcast(room, playerActionPayload(room, info.seat, "pick", { letter: msg.letter }));
      broadcast(room, letterResultPayload(room, info.seat, result));
      if (result.broadcastTurn) {
        broadcast(room, turnChangedPayload(room, room.game.activeSeat));
      }
      broadcastGameState(room);
      return;
    }

    if (op === "buyVowel") {
      const info = connections.get(ws);
      if (!info || info.role !== "player" || !info.seat) return error(ws, "Players only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");

      const result = handleBuyVowel(room, info.seat, msg.letter);
      if (result.error) return error(ws, result.error);

      broadcast(room, playerActionPayload(room, info.seat, "buyVowel", { letter: msg.letter }));
      broadcast(room, letterResultPayload(room, info.seat, result));
      if (result.broadcastTurn) {
        broadcast(room, turnChangedPayload(room, room.game.activeSeat));
      }
      broadcastGameState(room);
      return;
    }

    if (op === "solveIntent") {
      const info = connections.get(ws);
      if (!info || info.role !== "player" || !info.seat) return error(ws, "Players only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");

      const result = handleSolveIntent(room, info.seat);
      if (result.error) return error(ws, result.error);

      broadcast(room, playerActionPayload(room, info.seat, "solve"));
      broadcast(room, {
        op: "turnChanged",
        seat: info.seat,
        name: result.name,
        players: playerSummaries(room),
        message: `${result.name} is attempting to solve!`,
      });
      broadcastGameState(room);
      return;
    }

    if (op === "solve") {
      const info = connections.get(ws);
      if (!info || info.role !== "player" || !info.seat) return error(ws, "Players only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");

      const result = handleSolve(room, info.seat, msg.text);
      if (result.error) return error(ws, result.error);

      if (result.solved) {
        broadcast(room, {
          op: "solveResult",
          seat: info.seat,
          name: result.name,
          rows: result.rows,
          answer: result.answer,
          roundWin: result.roundWin,
          message: result.message,
        });
      } else if (result.resumeTossUp) {
        broadcast(room, {
          op: "solveWrong",
          seat: info.seat,
          name: result.name,
          lockedOut: !!result.lockedOut,
          message: room.game.message,
        });
        resumeTossUpReveal(room, (r, payload) => broadcast(r, payload));
      } else if (result.broadcastTurn) {
        broadcast(room, {
          op: "solveWrong",
          seat: info.seat,
          name: result.name,
          lockedOut: false,
          message: room.game.message,
        });
        broadcast(room, turnChangedPayload(room, room.game.activeSeat));
      }
      broadcastGameState(room);
      return;
    }

    if (op === "buzz") {
      const info = connections.get(ws);
      if (!info || info.role !== "player" || !info.seat) return error(ws, "Players only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");

      const result = handleBuzz(room, info.seat);
      if (result.error) return error(ws, result.error);

      broadcast(room, playerActionPayload(room, info.seat, "solve"));
      broadcast(room, {
        op: "buzzWinner",
        seat: info.seat,
        name: result.name,
      });
      broadcast(room, turnChangedPayload(room, info.seat));
      broadcastGameState(room);
      return;
    }

    if (op === "setRound") {
      const info = connections.get(ws);
      if (!info || info.role !== "host") return error(ws, "Host only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found.");
      const roundType = String(msg.roundType || "");
      const result = setRound(room, roundType);
      if (result.error) return error(ws, result.error);
      appendLog(room, `Host switched to ${roundType}`);
      broadcast(room, {
        op: "roundChanged",
        roundType,
        wedgeManifest: getWedgeManifestForRound(roundType),
        state: publicGameState(room),
      });
      if (roundType === "tossup") {
        broadcast(room, { op: "beginTossUpReady" });
      }
      if (room.game.activeSeat) {
        broadcast(room, turnChangedPayload(room, room.game.activeSeat));
      }
      broadcastGameState(room);
      return;
    }

    if (op === "beginTossUp") {
      const info = connections.get(ws);
      if (!info || info.role !== "host") return error(ws, "Host only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found.");
      const result = beginTossUp(room);
      if (result.error) return error(ws, result.error);
      if (result.startCountdown) {
        startTossUpCountdown(room, (r, payload) => broadcast(r, payload));
      } else {
        broadcastGameState(room);
      }
      return;
    }

    if (op === "newPuzzle") {
      const info = connections.get(ws);
      if (!info || info.role !== "host") return error(ws, "Host only.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found");
      const result = newPuzzle(room);
      if (result.error) return error(ws, result.error);
      appendLog(room, "Host loaded new puzzle");
      broadcastGameState(room);
      return;
    }

    if (op === "chat") {
      const info = connections.get(ws);
      if (!info) return error(ws, "Join a room first.");
      const room = getRoom(info.code);
      if (!room) return error(ws, "Room not found.");
      const text = String(msg.text || "").slice(0, 500);
      const label = info.role === "host" ? "host" : info.seat;
      appendLog(room, `${label}: ${text}`);
      const payload = { op: "chat", seat: info.seat, role: info.role, text, t: Date.now() };
      broadcast(room, payload);
      return;
    }

    if (op === "leaveRoom") {
      const info = connections.get(ws);
      if (!info) return error(ws, "Not in a room.");
      const result = removeConnection(ws);
      connections.delete(ws);
      if (result?.room) {
        appendLog(result.room, `${result.name || result.role} left`);
        broadcastLobby(result.room, "A player disconnected.");
      }
      return send(ws, { op: "left" });
    }

    return error(ws, `Unknown op: ${op}`);
  });

  ws.on("close", () => {
    const result = removeConnection(ws);
    connections.delete(ws);
    if (result?.room) {
      appendLog(result.room, `${result.name || result.role} disconnected`);
      broadcastLobby(result.room, "Someone disconnected.");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`WoF game server v${VERSION} on http://${HOST}:${PORT}`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`WebSocket: ws://${HOST}:${PORT}`);
});
