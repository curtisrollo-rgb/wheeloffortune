/** Excited CAR wedge win + congratulations voiceovers. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/car-prizes/manifest.json?v=1";

let byCarId = new Map();
let congratsUrl = null;
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopCarPrizeVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopCarPrizeVo);

export async function loadCarPrizeVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  byCarId = new Map();
  for (const clip of manifest.cars || []) {
    byCarId.set(clip.id, `${clip.file}?v=1`);
  }
  congratsUrl = manifest.congrats?.file ? `${manifest.congrats.file}?v=1` : null;
  ready = true;
}

function playUrl(url, { volume = 0.92 } = {}) {
  if (!url) return Promise.resolve();

  const gen = playGeneration;

  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentVo = audio;
    audio.volume = volume;

    const finish = () => {
      if (gen !== playGeneration) return resolve();
      if (currentVo === audio) currentVo = null;
      resolve();
    };

    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play().catch(finish);
  });
}

/** @returns {Promise<void>} */
export async function playCarPrizeVo(carId, { volume = 0.92 } = {}) {
  if (!ready) return;

  stopAllVo();
  playGeneration += 1;
  const gen = playGeneration;

  const winUrl = byCarId.get(carId);
  if (winUrl) {
    await playUrl(winUrl, { volume });
  }

  if (gen !== playGeneration) return;

  if (congratsUrl) {
    await playUrl(congratsUrl, { volume });
  }
}
