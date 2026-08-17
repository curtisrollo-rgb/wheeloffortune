/** Quick [matter of factly] callout when landing on a cash wedge. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/wedge-amounts/manifest.json?v=1";

let byValue = new Map();
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopWedgeAmountVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopWedgeAmountVo);

export async function loadWedgeAmountVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  byValue = new Map();
  for (const clip of manifest.clips || []) {
    byValue.set(clip.value, `${clip.file}?v=1`);
  }
  ready = true;
}

/** Fire-and-forget amount callout (non-blocking). */
export function playWedgeAmountVo(value, { volume = 0.78 } = {}) {
  if (!ready) return;

  const url = byValue.get(value);
  if (!url) return;

  stopAllVo();
  const gen = ++playGeneration;

  const audio = new Audio(url);
  currentVo = audio;
  audio.volume = volume;

  const finish = () => {
    if (gen !== playGeneration) return;
    if (currentVo === audio) currentVo = null;
  };

  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", finish, { once: true });
  audio.play().catch(finish);
}
