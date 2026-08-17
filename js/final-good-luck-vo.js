/** Random good-luck voiceovers before Final Round free-letter reveals. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/final-good-luck/manifest.json?v=1";

let clipUrls = [];
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopFinalGoodLuckVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopFinalGoodLuckVo);

export async function loadFinalGoodLuckVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  clipUrls = (manifest.clips || []).map((clip) => `${clip.file}?v=1`);
  ready = true;
}

/** @returns {Promise<void>} */
export function playRandomFinalGoodLuckVo({ volume = 0.88 } = {}) {
  if (!ready || !clipUrls.length) return Promise.resolve();

  stopAllVo();
  const url = clipUrls[Math.floor(Math.random() * clipUrls.length)];
  const gen = ++playGeneration;

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
