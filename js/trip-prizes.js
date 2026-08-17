/** TRIP / vacation prize pool — archive wordings with display labels. */

const DATA_URL = "data/trip-prizes.json?v=1";

let trips = [];
let ready = false;

export function tripDisplayLabel(trip) {
  if (trip.displayName) return trip.displayName;
  const wording = trip.wording || "";
  if (wording.startsWith("Trip to ")) return wording;
  const colon = wording.indexOf(":");
  if (colon !== -1) {
    const body = wording.slice(colon + 1).trim();
    if (/^trip to /i.test(body)) return body.replace(/^trip to /i, "Trip to ");
    return `Trip to ${body}`;
  }
  return wording;
}

export async function loadTripPrizes() {
  if (ready) return;
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    ready = true;
    return;
  }
  const data = await res.json();
  trips = data.trips || [];
  ready = true;
}

export function pickRandomTrip() {
  if (!trips.length) return null;
  const trip = trips[Math.floor(Math.random() * trips.length)];
  return {
    id: trip.id,
    name: tripDisplayLabel(trip),
    label: tripDisplayLabel(trip),
    valueUsd: trip.value_usd || 0,
    wording: trip.wording,
  };
}

export function getAllTrips() {
  return trips.map((trip) => ({
    id: trip.id,
    name: tripDisplayLabel(trip),
    label: tripDisplayLabel(trip),
    valueUsd: trip.value_usd || 0,
    wording: trip.wording,
  }));
}

export function getTripById(id) {
  const trip = trips.find((entry) => entry.id === id);
  if (!trip) return null;
  return {
    id: trip.id,
    name: tripDisplayLabel(trip),
    label: tripDisplayLabel(trip),
    valueUsd: trip.value_usd || 0,
    wording: trip.wording,
  };
}
