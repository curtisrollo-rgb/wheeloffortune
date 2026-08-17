/** CAR wedge prize pool — sorted make/model from archive. */

const DATA_URL = "data/car-prizes.json?v=1";

let cars = [];
let ready = false;

export async function loadCarPrizes() {
  if (ready) return;
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    ready = true;
    return;
  }
  const data = await res.json();
  cars = data.cars || [];
  ready = true;
}

export function pickRandomCar() {
  if (!cars.length) return null;
  return cars[Math.floor(Math.random() * cars.length)];
}

export function getAllCars() {
  return cars;
}

export function getCarById(id) {
  return cars.find((car) => car.id === id) || null;
}
