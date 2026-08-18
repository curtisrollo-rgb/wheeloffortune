/** TV host announcer — welcome, turn cues, player actions (with variations). */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/host/manifest.json?v=2";

/** @type {string[]} */
let welcomeClips = [];
/** @type {string[]} */
let turnSpinClips = [];
/** @type {string[]} */
let solveAttemptClips = [];
/** @type {string[]} */
let buyVowelClips = [];
/** @type {Map<string, string[]>} */
let pickClips = new Map();
/** @type {Map<string, string[]>} */
let vowelClips = new Map();
let ready = false;
let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopHostVo() {
  playGeneration += 1;
  haltCurrentAudio();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

registerVoStop(stopHostVo);

function pickRandom(urls) {
  if (!urls?.length) return null;
  return urls[Math.floor(Math.random() * urls.length)];
}

function clipsToUrls(clips) {
  if (!clips) return [];
  const list = Array.isArray(clips) ? clips : [clips];
  return list.filter((c) => c?.file).map((c) => `${c.file}?v=2`);
}

function playUrl(url, { volume = 0.88 } = {}) {
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

export async function loadHostVo() {
  if (ready) return;

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    ready = true;
    return;
  }

  const manifest = await res.json();
  welcomeClips = clipsToUrls(manifest.welcome);
  turnSpinClips = clipsToUrls(manifest.turnSpin);
  solveAttemptClips = clipsToUrls(manifest.solveAttempt);
  buyVowelClips = clipsToUrls(manifest.buyVowel);

  pickClips = new Map();
  for (const [letter, clips] of Object.entries(manifest.pickByLetter || {})) {
    const urls = clipsToUrls(clips);
    if (urls.length) pickClips.set(letter.toUpperCase(), urls);
  }

  vowelClips = new Map();
  for (const [letter, clips] of Object.entries(manifest.vowelByLetter || {})) {
    const urls = clipsToUrls(clips);
    if (urls.length) vowelClips.set(letter.toUpperCase(), urls);
  }

  ready = true;
}

export function playWelcomeVo() {
  return playUrl(pickRandom(welcomeClips));
}

export function playTurnCueVo(_playerName) {
  return playUrl(pickRandom(turnSpinClips));
}

function speakLetter(letter) {
  if (!window.speechSynthesis) return Promise.resolve();
  const upper = String(letter || "").toUpperCase();
  if (!upper) return Promise.resolve();
  stopAllVo();
  const gen = ++playGeneration;
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(`The letter ${upper}.`);
    utter.rate = 0.95;
    utter.pitch = 1.05;
    utter.volume = 0.88;
    const finish = () => {
      if (gen !== playGeneration) return resolve();
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

export function playPickLetterVo(_playerName, letter) {
  const upper = String(letter || "").toUpperCase();
  const urls = pickClips.get(upper) || [];
  const url = pickRandom(urls);
  if (url) return playUrl(url);
  return speakLetter(upper);
}

export function playBuyVowelVo(_playerName, letter) {
  const upper = String(letter || "").toUpperCase();
  const urls = vowelClips.get(upper) || [];
  if (urls.length) return playUrl(pickRandom(urls));
  return playUrl(pickRandom(buyVowelClips));
}

export function playSolveAttemptVo(_playerName) {
  return playUrl(pickRandom(solveAttemptClips));
}

/** @param {{ action: string, name?: string, letter?: string, seat?: string }} msg */
export function playPlayerActionVo(msg) {
  switch (msg.action) {
    case "pick":
      return playPickLetterVo(msg.name, msg.letter);
    case "buyVowel":
      return playBuyVowelVo(msg.name, msg.letter);
    case "solve":
      return playSolveAttemptVo(msg.name);
    case "spin":
      // Turn cue ("spin the wheel") is handled by turnChanged only.
      return Promise.resolve();
    default:
      return Promise.resolve();
  }
}
