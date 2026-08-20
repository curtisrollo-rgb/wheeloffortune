#!/usr/bin/env node
/**
 * Self-test: Big Board static assets + full game section flow (server-side + WebSocket smoke).
 * Run: node server/self-test.mjs
 */

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import { createRoom, getRoom, addPlayer, setHost } from "./rooms.js";
import {
  startGame,
  setRound,
  handleBuzz,
  handleSolve,
  handleSpin,
  handleGuessLetter,
  publicGameState,
  ensurePreviewBoard,
} from "./wof-game.js";
import { beginTossUpReveal } from "./round-helpers.js";
import { nextRoundEntry, tossUpWinAmount, ROUND_SEQUENCE } from "./round-sequence.js";
import { getWedgeManifestForRound } from "./wedges.js";
import { puzzleCount } from "./puzzles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const passed = [];
const failed = [];

function ok(name) {
  passed.push(name);
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed.push({ name, err: String(err?.message || err) });
  console.error(`  ✗ ${name}: ${err?.message || err}`);
}

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** @param {string} htmlPath */
function extractAssetRefs(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const refs = [];
  for (const m of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) refs.push(m[1]);
  for (const m of html.matchAll(/import\(["']([^"']+)["']\)/g)) refs.push(m[1]);
  return { html, refs };
}

function resolveAsset(fromFile, ref) {
  if (ref.startsWith("http")) return null;
  const clean = ref.split("?")[0];
  return resolve(dirname(fromFile), clean);
}

/** @returns {Promise<{ proc: import('child_process').ChildProcess, port: number }>} */
function startServer(port) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, ["index.js"], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let booted = false;
    const timer = setTimeout(() => {
      if (!booted) {
        proc.kill();
        reject(new Error(`Server did not start on port ${port}`));
      }
    }, 15000);

    proc.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Health:")) {
        booted = true;
        clearTimeout(timer);
        resolvePromise({ proc, port });
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk);
      if (text.includes("EADDRINUSE")) {
        clearTimeout(timer);
        reject(new Error(`Port ${port} in use`));
      }
    });
    proc.on("exit", (code) => {
      if (!booted) {
        clearTimeout(timer);
        reject(new Error(`Server exited early (${code})`));
      }
    });
  });
}

function wsOnce(url, handler, { timeoutMs = 8000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket timeout"));
    }, timeoutMs);

    ws.on("open", () => handler(ws));
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const done = (result) => {
        clearTimeout(timer);
        ws.close();
        resolvePromise(result);
      };
      if (msg.op === "error") {
        done({ error: msg.message || msg.error });
      }
      handler.onMessage?.(msg, done, ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitForHealth(port) {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  return res.json();
}

function mockWs() {
  return { readyState: 1, send() {}, close() {} };
}

function setupRoom() {
  const code = createRoom();
  const room = getRoom(code);
  if (!room) throw new Error("Room not created");
  setHost(room, mockWs());
  addPlayer(room, mockWs(), "p1", "Alex");
  addPlayer(room, mockWs(), "p2", "Blake");
  return room;
}

console.log("\n=== WoF Self-Test ===\n");

console.log("Big Board static assets");
await test("host.html exists with #puzzle-tiles (not board target bug)", () => {
  const hostPath = join(ROOT, "multiplayer/host.html");
  assert(existsSync(hostPath), "multiplayer/host.html missing");
  const { html } = extractAssetRefs(hostPath);
  assert(html.includes('id="puzzle-tiles"'), "Missing #puzzle-tiles");
  assert(html.includes('id="puzzle-board"'), "Missing #puzzle-board wrapper");
  assert(!html.includes('new PuzzleBoard(document.getElementById("puzzle-board")'), "Board must not target #puzzle-board");
});

await test("Big Board CSS/JS references resolve on disk", () => {
  const hostPath = join(ROOT, "multiplayer/host.html");
  const { refs } = extractAssetRefs(hostPath);
  const missing = [];
  for (const ref of refs) {
    const path = resolveAsset(hostPath, ref);
    if (!path) continue;
    if (!existsSync(path)) missing.push(ref);
  }
  assert(missing.length === 0, `Missing assets: ${missing.join(", ")}`);
});

await test("host-app.js imports resolve (module graph)", () => {
  const hostApp = join(ROOT, "js/host-app.js");
  assert(existsSync(hostApp), "js/host-app.js missing");
  const text = readFileSync(hostApp, "utf8");
  assert(text.includes("puzzle-tiles"), "host-app should reference puzzle-tiles container");
  assert(text.includes('GAME_ORDER = ["tossup", "round1", "tossup", "round2", "final"]'), "Dual toss-up order missing");
});

console.log("\nRound sequence & wedges");
await test("ROUND_SEQUENCE has dual toss-ups", () => {
  assert(ROUND_SEQUENCE.length === 5, "Expected 5 sections");
  assert(ROUND_SEQUENCE[0].type === "tossup", "First section tossup");
  assert(ROUND_SEQUENCE[2].type === "tossup", "Second tossup before R2");
});

await test("Toss-up values scale $1K / $2K", () => {
  assert(tossUpWinAmount(0) === 1000, "1st toss-up");
  assert(tossUpWinAmount(2) === 2000, "2nd toss-up");
});

await test("Round 2 wedge manifest includes $1500 and $2500", () => {
  const labels = getWedgeManifestForRound("round2").map((w) => w.label);
  assert(labels.includes("$1500"), "Missing $1500 wedge");
  assert(labels.includes("$2500"), "Missing $2500 wedge");
});

await test("Puzzle bank loaded", () => {
  assert(puzzleCount() >= 100, `Puzzle count too low: ${puzzleCount()}`);
});

console.log("\nIn-process game flow (section → section)");
await test("Preview board loads tiles before start", () => {
  const room = setupRoom();
  const preview = ensurePreviewBoard(room);
  assert(preview?.rows?.length === 4, "Preview should have 4 rows");
  assert(preview.rows.some((r) => r.includes("_")), "Preview should have hidden letters");
  assert(preview.category, "Preview should have category");
});

await test("Start game → Toss-Up #1 ($1,000)", () => {
  const room = setupRoom();
  const result = startGame(room);
  assert(result.ok, result.error);
  const state = publicGameState(room);
  assert(state.roundType === "tossup", "Should start on toss-up");
  assert(state.roundSequenceIndex === 0, "Sequence index 0");
  assert(state.tossUpWinAmount === 1000, "1st toss-up value");
  assert(state.phase === "tossUpAnnounce", "Toss-up announce phase");
});

await test("Toss-Up solve → Round 1 (winner starts)", () => {
  const room = setupRoom();
  startGame(room);
  const answer = room.game.puzzle.answer;
  beginTossUpReveal(room.game);
  const buzz = handleBuzz(room, "p1");
  assert(buzz.ok, buzz.error);
  const solve = handleSolve(room, "p1", answer);
  assert(solve.correct, "Toss-up solve should succeed");
  assert(room.game.roundWinnerSeat === "p1", "Winner seat p1");

  const next = nextRoundEntry(room.game.roundSequenceIndex);
  assert(next.type === "round1", "Next is Round 1");
  setRound(room, next.type, { sequenceIndex: next.index });
  assert(room.game.roundType === "round1", "Now Round 1");
  assert(room.game.activeSeat === "p1", "Toss-up winner starts Round 1");
});

await test("Round 1 solve → Toss-Up #2 ($2,000)", () => {
  const room = setupRoom();
  startGame(room);
  beginTossUpReveal(room.game);
  handleBuzz(room, "p1");
  handleSolve(room, "p1", room.game.puzzle.answer);
  setRound(room, "round1", { sequenceIndex: 1 });
  const solve = handleSolve(room, "p1", room.game.puzzle.answer);
  assert(solve.solved, "Round 1 solved");
  assert(room.game.phase === "ended", "Round ended");

  const next = nextRoundEntry(room.game.roundSequenceIndex);
  assert(next.type === "tossup", "Next is 2nd toss-up");
  setRound(room, next.type, { sequenceIndex: next.index });
  assert(publicGameState(room).tossUpWinAmount === 2000, "2nd toss-up $2K");
});

await test("Round 2 spin + letter hit works", () => {
  const room = setupRoom();
  startGame(room);
  setRound(room, "round2", { sequenceIndex: 3 });
  const spin = handleSpin(room, room.game.activeSeat, 0.5);
  assert(spin.ok, spin.error);
  assert(spin.wedge, "Wedge returned");
  if (spin.wedge.type === "cash" && spin.wedge.value > 0) {
    const letter = room.game.puzzle.answer.replace(/[^A-Z]/gi, "").charAt(0).toUpperCase();
    const guess = handleGuessLetter(room, room.game.activeSeat, letter);
    assert(guess.ok, guess.error);
  }
});

await test("Full sequence indices advance correctly", () => {
  const room = setupRoom();
  startGame(room);
  let idx = 0;
  for (let step = 1; step < ROUND_SEQUENCE.length; step++) {
    const next = nextRoundEntry(idx);
    assert(next, `Missing next after index ${idx}`);
    setRound(room, next.type, { sequenceIndex: next.index });
    assert(room.game.roundSequenceIndex === next.index, `Expected index ${next.index}`);
    idx = next.index;
  }
  assert(room.game.roundType === "final", "Ends on Final Round");
});

console.log("\nLive WebSocket smoke test");
let serverProc = null;
const TEST_PORT = 18080;

try {
  await test("Server boots and /health responds", async () => {
    const { proc, port } = await startServer(TEST_PORT);
    serverProc = proc;
    const health = await waitForHealth(port);
    assert(health.ok, "Health not ok");
    assert(health.puzzleCount > 0, "No puzzles in health");
  });

  await test("Host attach receives preview board state", async () => {
    const result = await new Promise((resolvePromise, reject) => {
      const lobby = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      let code = null;
      const timer = setTimeout(() => {
        lobby.close();
        reject(new Error("Host attach smoke timeout"));
      }, 10000);

      lobby.on("open", () => lobby.send(JSON.stringify({ op: "createRoom" })));
      lobby.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.op === "roomCreated") {
          code = msg.code;
          const host = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
          host.on("open", () => host.send(JSON.stringify({ op: "attachHost", code })));
          host.on("message", (hraw) => {
            const hmsg = JSON.parse(String(hraw));
            if (hmsg.op === "hostAttached") {
              clearTimeout(timer);
              lobby.close();
              host.close();
              resolvePromise(hmsg);
            }
          });
        }
      });
    });
    assert(result.preview?.rows?.length === 4, "Host preview missing rows");
    assert(result.preview.rows.some((r) => r.includes("_") || r.includes("#")), "Host preview tiles");
  });

  await test("WebSocket startGame → beginTossUpReady", async () => {
    await new Promise((resolvePromise, reject) => {
      const lobby = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      let code = null;
      let sawReady = false;
      let gameStartedState = null;
      const timer = setTimeout(() => {
        lobby.close();
        reject(new Error("startGame smoke timeout"));
      }, 12000);

      const finish = (err) => {
        clearTimeout(timer);
        lobby.close();
        if (err) reject(err);
        else resolvePromise();
      };

      lobby.on("open", () => lobby.send(JSON.stringify({ op: "createRoom" })));
      lobby.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.op === "roomCreated") {
          code = msg.code;
          const player = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
          player.on("open", () => {
            player.send(JSON.stringify({ op: "joinRoom", code, name: "Test Player" }));
          });
          player.on("message", (praw) => {
            const pmsg = JSON.parse(String(praw));
            if (pmsg.op !== "joined") return;
            const host = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
            host.on("open", () => {
              host.send(JSON.stringify({ op: "attachHost", code }));
            });
            host.on("message", (hraw) => {
              const hmsg = JSON.parse(String(hraw));
              if (hmsg.op === "error") {
                host.close();
                player.close();
                finish(new Error(hmsg.message || hmsg.error));
                return;
              }
              if (hmsg.op === "hostAttached") {
                host.send(JSON.stringify({ op: "startGame" }));
                return;
              }
              if (hmsg.op === "beginTossUpReady") sawReady = true;
              if (hmsg.op === "gameStarted") gameStartedState = hmsg.state;
              if (sawReady && gameStartedState) {
                try {
                  assert(gameStartedState.roundType === "tossup", "Not toss-up start");
                  assert(gameStartedState.tossUpWinAmount === 1000, "Wrong toss-up amount");
                  host.close();
                  player.close();
                  finish();
                } catch (err) {
                  host.close();
                  player.close();
                  finish(err);
                }
              }
            });
          });
        }
      });
    });
  });
} catch (err) {
  fail("Live server tests", err);
} finally {
  if (serverProc) serverProc.kill();
}

console.log("\n=== Summary ===");
console.log(`Passed: ${passed.length}`);
console.log(`Failed: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.err}`);
  process.exit(1);
}
console.log("\nAll self-tests passed.\n");
