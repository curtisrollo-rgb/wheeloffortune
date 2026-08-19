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

const ESCALATION_WEDGES = {
  round2: [
    { label: "$1500", backgroundColor: "#e70697", value: 1500 },
    { label: "$2500", backgroundColor: "#fff200", value: 2500 },
  ],
};

/** @param {object[]} wedges @param {object[]} extras */
function insertBeforeLoseTurn(wedges, extras) {
  if (!extras.length) return wedges;
  const list = [...wedges];
  const loseIdx = list.findIndex((w) => w.type === "loseTurn");
  const at = loseIdx >= 0 ? loseIdx : list.length;
  list.splice(at, 0, ...extras);
  return list;
}

/** @param {"round1"|"round2"|"final"|"tossup"|string} roundType */
export function getWedgesForRound(roundType) {
  if (roundType === "round2") {
    return insertBeforeLoseTurn(round2, ESCALATION_WEDGES.round2);
  }
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
