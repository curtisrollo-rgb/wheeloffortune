/** SPA wedge win voiceovers — MP3 manifest when present, voText + TTS otherwise. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/spa-prizes/manifest.json?v=1";
const DATA_URL = "data/spa-prizes.json?v=1";

/** @type {Map<string, string>} */
let bySpaId = new Map();
/** @type {Map<string, string>} */
let voTextById = new Map();
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

export function stopSpaPrizeVo() {
  playGeneration += 1;
  haltCurrentAudio();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

registerVoStop(stopSpaPrizeVo);

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

function speakText(text, { volume = 0.88 } = {}) {
  if (!text || !window.speechSynthesis) return Promise.resolve();
  stopAllVo();
  const gen = ++playGeneration;
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.94;
    utter.pitch = 1.02;
    utter.volume = volume;
    const finish = () => {
      if (gen !== playGeneration) return resolve();
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

export async function loadSpaPrizeVo() {
  if (ready) return;

  try {
    const dataRes = await fetch(DATA_URL);
    if (dataRes.ok) {
      const data = await dataRes.json();
      for (const spa of data.spas || []) {
        if (spa.id && spa.voText) voTextById.set(spa.id, spa.voText);
      }
    }
  } catch {
    /* optional */
  }

  try {
    const res = await fetch(MANIFEST_URL);
    if (res.ok) {
      const manifest = await res.json();
      bySpaId = new Map();
      for (const clip of manifest.spas || []) {
        bySpaId.set(clip.id, `${clip.file}?v=1`);
      }
      congratsUrl = manifest.congrats?.file ? `${manifest.congrats.file}?v=1` : null;
    }
  } catch {
    /* manifest optional until MP3s generated */
  }

  ready = true;
}

/** @returns {Promise<void>} */
export async function playSpaPrizeVo(spaId, { volume = 0.92 } = {}) {
  if (!ready) await loadSpaPrizeVo();

  stopAllVo();
  playGeneration += 1;
  const gen = playGeneration;

  const winUrl = bySpaId.get(spaId);
  if (winUrl) {
    await playUrl(winUrl, { volume });
  } else {
    const text = voTextById.get(spaId);
    if (text) await speakText(text, { volume });
  }

  if (gen !== playGeneration) return;

  if (congratsUrl) {
    await playUrl(congratsUrl, { volume });
  }
}
