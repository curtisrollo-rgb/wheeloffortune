/** Milestone voiceovers — all consonants done / no more vowels in puzzle. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/milestones/manifest.json?v=1";

const pools = {
  onlyVowelsRemain: [],
  noMoreVowels: [],
};

let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopMilestoneVo() {
  playGeneration += 1;
  haltCurrentAudio();
}

registerVoStop(stopMilestoneVo);

export async function loadMilestoneVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  pools.onlyVowelsRemain = (manifest.onlyVowelsRemain || []).map(
    (clip) => `${clip.file}?v=1`,
  );
  pools.noMoreVowels = (manifest.noMoreVowels || []).map((clip) => `${clip.file}?v=1`);
  ready = true;
}

function pickClip(key) {
  const urls = pools[key] || [];
  if (!urls.length) return null;
  return urls[Math.floor(Math.random() * urls.length)];
}

/** @param {string} key @param {{ volume?: number }} [opts] */
function speakFallback(key, opts = {}) {
  const lines = {
    onlyVowelsRemain: "Only vowels remain in the puzzle.",
    noMoreVowels: "There are no more vowels in the puzzle.",
  };
  const text = lines[key];
  if (!text || !window.speechSynthesis) return Promise.resolve();

  stopAllVo();
  const gen = ++playGeneration;

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.volume = opts.volume ?? 0.88;
    utter.rate = 0.92;
    const finish = () => {
      if (gen !== playGeneration) return resolve();
      resolve();
    };
    utter.addEventListener("end", finish, { once: true });
    utter.addEventListener("error", finish, { once: true });
    window.speechSynthesis.speak(utter);
  });
}

function playPool(key, { volume = 0.88 } = {}) {
  if (!ready) return Promise.resolve();

  const url = pickClip(key);
  if (!url) return speakFallback(key, { volume });

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

/** All consonants on the board revealed — only vowels remain hidden. */
export function playOnlyVowelsRemainVo(opts) {
  return playPool("onlyVowelsRemain", opts);
}

/** Every vowel appearing in the puzzle answer has been bought/called. */
export function playNoMoreVowelsVo(opts) {
  return playPool("noMoreVowels", opts);
}
