/** SPA wedge prize pool — archive spa getaways with display labels. */

const DATA_URL = "data/spa-prizes.json?v=1";

let spas = [];
let ready = false;

export function spaDisplayLabel(spa) {
  return spa.display || spa.wording || "Spa Getaway";
}

export async function loadSpaPrizes() {
  if (ready) return;
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    ready = true;
    return;
  }
  const data = await res.json();
  spas = data.spas || [];
  ready = true;
}

export function pickRandomSpa() {
  if (!spas.length) return null;
  const spa = spas[Math.floor(Math.random() * spas.length)];
  const label = spaDisplayLabel(spa);
  return {
    id: spa.id,
    name: label,
    label,
    display: spa.display || label,
    valueUsd: spa.value_usd || 0,
    voText: spa.voText || "",
  };
}

export function getSpaById(id) {
  const spa = spas.find((entry) => entry.id === id);
  if (!spa) return null;
  const label = spaDisplayLabel(spa);
  return {
    id: spa.id,
    name: label,
    label,
    display: spa.display || label,
    valueUsd: spa.value_usd || 0,
    voText: spa.voText || "",
  };
}
