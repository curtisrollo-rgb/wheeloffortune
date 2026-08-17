/** Final Round loss — random host consolation + amount not won. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/final-loss/manifest.json?v=1";

let consolationUrls = [];
let amountByValue = new Map();
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopFinalLossVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopFinalLossVo);

export async function loadFinalLossVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  consolationUrls = (manifest.consolation || []).map((clip) => `${clip.file}?v=1`);
  amountByValue = new Map();
  for (const clip of manifest.amounts || []) {
    amountByValue.set(clip.value, `${clip.file}?v=1`);
  }
  ready = true;
}

function playUrl(url, { volume = 0.9 } = {}) {
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
export async function playFinalLossVo(amount, { volume = 0.9 } = {}) {
  if (!ready) return;

  stopAllVo();
  playGeneration += 1;
  const gen = playGeneration;

  if (consolationUrls.length) {
    const conUrl = consolationUrls[Math.floor(Math.random() * consolationUrls.length)];
    await playUrl(conUrl, { volume });
  }

  if (gen !== playGeneration) return;

  const amtUrl = amountByValue.get(amount);
  if (amtUrl) {
    await playUrl(amtUrl, { volume });
  }
}
