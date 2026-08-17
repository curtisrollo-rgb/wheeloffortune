/** Bankrupt / Lose a Turn announcer voiceovers — [sad voice] line. */

import { playSound } from "./audio.js?v=9";
import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/penalty/manifest.json?v=1";

let bankruptUrls = [];
let loseTurnUrls = [];
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopPenaltyVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopPenaltyVo);

export async function loadPenaltyVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  bankruptUrls = (manifest.bankrupt || []).map((clip) => `${clip.file}?v=1`);
  loseTurnUrls = (manifest.loseTurn || []).map((clip) => `${clip.file}?v=1`);
  ready = true;
}

function pickUrl(type) {
  const pool = type === "bankrupt" ? bankruptUrls : loseTurnUrls;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function playVoUrl(url, { volume = 0.9 } = {}) {
  const gen = ++playGeneration;
  haltCurrentAudio();

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

/** @param {"bankrupt"|"loseTurn"} type */
export async function playPenaltyVo(type, { volume = 0.9 } = {}) {
  stopAllVo();

  const url = pickUrl(type);
  if (!url) {
    playSound(type === "bankrupt" ? "bankrupt" : "miss", { volume: 0.5 });
    return;
  }

  await playVoUrl(url, { volume });
}
