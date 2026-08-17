import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WHEEL_COLORS = [
  "#ee1c24", "#3cb878", "#e70697", "#00aef0", "#f26522", "#fff200",
  "#f6989d", "#a186be", "#ee1c24", "#3cb878", "#f26522", "#00aef0",
];

const ENVELOPE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");

/** @type {object[]} */
let prizeEntries = [];

function loadFile(name) {
  const candidates = [
    join(__dirname, "data", name),
    join(__dirname, "..", "data", name),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadPrizes() {
  const data = loadFile("final-envelopes.json");
  prizeEntries =
    data?.prizes ||
    data?.amounts?.map((amount) => ({ type: "cash", amount })) ||
    [{ type: "cash", amount: 25000 }, { type: "cash", amount: 30000 }, { type: "cash", amount: 35000 }];
}

loadPrizes();

/** @returns {object[]} */
export function getEnvelopeWedges() {
  return prizeEntries.map((entry, index) => {
    const base = {
      label: ENVELOPE_LABELS[index % ENVELOPE_LABELS.length],
      backgroundColor: WHEEL_COLORS[index % WHEEL_COLORS.length],
      index,
      type: "bonusEnvelope",
    };

    if (entry.type === "car") {
      return {
        ...base,
        prizeType: "car",
        value: 0,
        prize: { kind: "car", id: "car-bonus", name: "Bonus Car", label: "New Bonus Car" },
      };
    }
    if (entry.type === "trip") {
      const value = entry.valueUsd ?? entry.amount ?? 7000;
      return {
        ...base,
        prizeType: "trip",
        value,
        prize: { kind: "trip", id: "trip-bonus", label: entry.label || "Bonus Trip", valueUsd: value },
      };
    }

    const amount = entry.amount ?? 25000;
    return {
      ...base,
      prizeType: "cash",
      value: amount,
      prize: null,
    };
  });
}

/** @param {object[]} wedges */
export function randomEnvelopeIndex(wedges) {
  return randomBytes(2).readUInt16BE(0) % wedges.length;
}
