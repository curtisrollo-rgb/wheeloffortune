import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {object[]} */
let spas = [];

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

/** @param {object} spa */
export function spaDisplayLabel(spa) {
  return spa.display || spa.wording || "Spa Getaway";
}

function loadSpas() {
  const data = loadFile("spa-prizes.json");
  spas = data?.spas || [];
}

loadSpas();

/** @returns {{ id: string, label: string, name: string, display: string, valueUsd: number }|null} */
export function pickRandomSpa() {
  if (!spas.length) return null;
  const spa = spas[randomBytes(2).readUInt16BE(0) % spas.length];
  const label = spaDisplayLabel(spa);
  return {
    id: spa.id,
    label,
    name: label,
    display: spa.display || label,
    valueUsd: spa.value_usd || 0,
  };
}
