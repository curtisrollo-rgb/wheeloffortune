import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {{ id?: string, category: string, answer: string }[]} */
let puzzles = [];

function loadPuzzleBank() {
  const candidates = [
    join(__dirname, "data/puzzles.json"),
    join(__dirname, "data/puzzles.sample.json"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const data = JSON.parse(raw);
      const list = data.puzzles || data;
      if (Array.isArray(list) && list.length) {
        puzzles = list.filter((p) => p?.answer && p?.category);
        return;
      }
    } catch {
      /* try next */
    }
  }
  puzzles = [
    { category: "PHRASE", answer: "WHEEL OF FORTUNE" },
    { category: "PHRASE", answer: "SPIN THE WHEEL" },
  ];
}

loadPuzzleBank();

/** @param {Set<string>} [excludeIds] */
export function pickRandomPuzzle(excludeIds = new Set()) {
  const pool = puzzles.filter((p) => !excludeIds.has(p.id || p.answer));
  const list = pool.length ? pool : puzzles;
  const i = randomBytes(2)[0] % list.length;
  return list[i];
}

export function puzzleCount() {
  return puzzles.length;
}
