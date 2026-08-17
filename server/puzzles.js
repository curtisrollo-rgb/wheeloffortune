import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {{ id?: string, category: string, answer: string }[]} */
let puzzles = [];
/** @type {string | null} */
let puzzleSource = null;

const FALLBACK_PUZZLES = [
  { id: "fallback1", category: "PHRASE", answer: "WHEEL OF FORTUNE" },
  { id: "fallback2", category: "PHRASE", answer: "SPIN THE WHEEL" },
];

/** Hasbro CD-ROM era bank first; TV-scraped banks are fallback only. */
const PUZZLE_CANDIDATES = [
  join(__dirname, "data/puzzles-cdrom.json"),
  join(__dirname, "../data/puzzles-cdrom.json"),
  join(__dirname, "../data/puzzles.json"),
  join(__dirname, "data/puzzles.sample.json"),
  join(__dirname, "../data/puzzles.sample.json"),
  join(__dirname, "data/puzzles.json"),
];

function tryLoadFile(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    const list = (data.puzzles || data).filter((p) => p?.answer && p?.category);
    if (!list.length) return null;
    return { path, list };
  } catch {
    return null;
  }
}

function loadPuzzleBank() {
  for (const path of PUZZLE_CANDIDATES) {
    const loaded = tryLoadFile(path);
    if (!loaded) continue;
    puzzles = loaded.list;
    puzzleSource = loaded.path;
    console.log(`Puzzle bank: ${puzzles.length} puzzles from ${loaded.path}`);
    return;
  }

  puzzles = FALLBACK_PUZZLES;
  puzzleSource = "fallback";
  console.warn("Puzzle bank: using built-in fallback (2 puzzles)");
}

loadPuzzleBank();

/** Unbiased random index for pool selection. */
function randomIndex(length) {
  if (length <= 1) return 0;
  const max = 0xffffffff - (0xffffffff % length);
  let value;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= max);
  return value % length;
}

/** @param {Set<string>} [excludeIds] */
export function pickRandomPuzzle(excludeIds = new Set()) {
  if (!puzzles.length) return FALLBACK_PUZZLES[0];

  let pool = puzzles.filter((p) => !excludeIds.has(p.id || p.answer));
  if (!pool.length) {
    // Full deck seen — start a new cycle (caller may clear usedPuzzleIds).
    pool = puzzles;
  }

  return pool[randomIndex(pool.length)];
}

export function puzzleCount() {
  return puzzles.length;
}

export function getPuzzleSource() {
  return puzzleSource;
}
