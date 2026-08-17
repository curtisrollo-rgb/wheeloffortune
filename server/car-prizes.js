import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {object[]} */
let cars = [];

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

function loadCars() {
  const data = loadFile("car-prizes.json");
  cars = data?.cars || [];
}

loadCars();

/** @returns {{ id: string, name: string }|null} */
export function pickRandomCar() {
  if (!cars.length) return null;
  const car = cars[randomBytes(2).readUInt16BE(0) % cars.length];
  return { id: car.id, name: car.name };
}
