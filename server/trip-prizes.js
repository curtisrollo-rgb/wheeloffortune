import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {object[]} */
let trips = [];

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

function tripDisplayLabel(trip) {
  const wording = trip.wording || "";
  if (wording.startsWith("Trip to ")) return wording;
  const colon = wording.indexOf(":");
  if (colon !== -1) {
    const body = wording.slice(colon + 1).trim();
    if (/^trip to /i.test(body)) return body.replace(/^trip to /i, "Trip to ");
    return `Trip to ${body}`;
  }
  return wording || "Vacation Trip";
}

function loadTrips() {
  const data = loadFile("trip-prizes.json");
  trips = data?.trips || [];
}

loadTrips();

/** @returns {{ id: string, label: string, name: string, display: string, wording: string, valueUsd: number, congratsText: string }|null} */
export function pickRandomTrip() {
  if (!trips.length) return null;
  const trip = trips[randomBytes(2).readUInt16BE(0) % trips.length];
  const label = tripDisplayLabel(trip);
  return {
    id: trip.id,
    label,
    name: label,
    display: trip.wording || label,
    wording: trip.wording || "",
    valueUsd: trip.value_usd || 0,
    congratsText: trip.congratsText || "",
  };
}
