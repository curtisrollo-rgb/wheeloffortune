/** Miss voiceovers — generic sympathetic lines + per-letter clips. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/miss/manifest.json?v=2";

let genericUrls = [];
let byLetter = new Map();
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopMissVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopMissVo);

export async function loadMissVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  genericUrls = (manifest.generic || manifest.clips || []).map(
    (clip) => `${clip.file}?v=2`,
  );

  byLetter = new Map();
  const letterMap = manifest.byLetter || {};
  for (const [letter, clips] of Object.entries(letterMap)) {
    byLetter.set(
      letter.toUpperCase(),
      clips.map((clip) => `${clip.file}?v=2`),
    );
  }

  ready = true;
}

const LETTER_SPECIFIC_CHANCE = 0.2;

function pickUrl(letter) {
  const upper = String(letter || "").toUpperCase();
  const letterUrls = byLetter.get(upper) || [];
  if (!letterUrls.length && !genericUrls.length) return null;
  if (!letterUrls.length) {
    return genericUrls[Math.floor(Math.random() * genericUrls.length)];
  }
  if (!genericUrls.length) {
    return letterUrls[Math.floor(Math.random() * letterUrls.length)];
  }
  if (Math.random() < LETTER_SPECIFIC_CHANCE) {
    return letterUrls[Math.floor(Math.random() * letterUrls.length)];
  }
  return genericUrls[Math.floor(Math.random() * genericUrls.length)];
}

/** @returns {Promise<void>} */
export function playMissVo(letter, { volume = 0.85 } = {}) {
  if (!ready) return Promise.resolve();

  const url = pickUrl(letter);
  if (!url) return Promise.resolve();

  stopAllVo();
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

/** @deprecated use playMissVo */
export function playRandomMissVo(opts) {
  return playMissVo("", opts);
}
