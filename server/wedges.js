import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getEnvelopeWedges } from "./final-envelopes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {object[]} */
let round1 = [];

/** @type {object[]} */
let round2 = [];

function loadWedgeFile(name) {
  const candidates = [
    join(__dirname, "data", name),
    join(__dirname, "..", "data", name),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) return list;
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadWedges() {
  round1 = loadWedgeFile("wedges.json") || [
    { label: "$500", value: 500 },
    { label: "BANKRUPT", value: 0, type: "bankrupt" },
    { label: "LOSE TURN", value: 0, type: "loseTurn" },
  ];
  round2 = loadWedgeFile("wedges-round2.json") || round1;
}

loadWedges();

/** @param {"round1"|"round2"|"final"|"tossup"|string} roundType */
export function getWedgesForRound(roundType) {
  if (roundType === "round2") return round2;
  if (roundType === "final") return getEnvelopeWedges();
  return round1;
}

/** @param {"round1"|"round2"|"final"|string} roundType */
export function getWedgeManifestForRound(roundType) {
  return getWedgesForRound(roundType).map((w, index) => ({
    index,
    label: w.label,
    backgroundColor: w.backgroundColor,
    type: w.type || "cash",
    value: w.value ?? 0,
    prizeKind: w.prizeKind ?? null,
    prizeType: w.prizeType ?? null,
  }));
}
