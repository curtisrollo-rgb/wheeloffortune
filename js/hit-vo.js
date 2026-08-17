/** Letter-hit voiceovers — short congratulatory clips for 1–3 matches. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/hit/manifest.json?v=1";

/** @type {Map<string, string>} key: `${letter}_${count}` */
let byLetterCount = new Map();
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopHitVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopHitVo);

export async function loadHitVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  byLetterCount = new Map();

  for (const [letter, counts] of Object.entries(manifest.byLetter || {})) {
    for (const [count, clip] of Object.entries(counts)) {
      byLetterCount.set(`${letter.toUpperCase()}_${count}`, `${clip.file}?v=1`);
    }
  }

  ready = true;
}

/** @returns {Promise<void>} */
export function playHitVo(letter, count, { volume = 0.88 } = {}) {
  if (!ready) return Promise.resolve();

  const upper = String(letter || "").toUpperCase();
  const capped = Math.min(Math.max(Number(count) || 0, 1), 3);
  const url = byLetterCount.get(`${upper}_${capped}`);
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
