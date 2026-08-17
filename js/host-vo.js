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

function speakFallback(text, { volume = 1 } = {}) {
  if (!text || !window.speechSynthesis) return Promise.resolve();
  stopAllVo();
  const gen = ++playGeneration;

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.volume = volume;
    utter.rate = 0.95;
    const finish = () => {
      if (gen !== playGeneration) return resolve();
      resolve();
    };
    utter.addEventListener("end", finish, { once: true });
    utter.addEventListener("error", finish, { once: true });
    window.speechSynthesis.speak(utter);
  });
}

function playUrl(url, fallbackText, { volume = 0.88 } = {}) {
  if (!url) return speakFallback(fallbackText, { volume });

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
    audio.addEventListener("error", () => speakFallback(fallbackText, { volume }).then(finish), {
      once: true,
    });
    audio.play().catch(() => speakFallback(fallbackText, { volume }).then(finish));
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
  return playUrl(pickRandom(welcomeClips), "Welcome to Wheel of Fortune!");
}

export function playTurnCueVo(playerName) {
  const name = playerName || "Player";
  return playUrl(pickRandom(turnSpinClips), `${name}, spin the wheel!`);
}

export function playPickLetterVo(playerName, letter) {
  const upper = String(letter || "").toUpperCase();
  const name = playerName || "Player";
  const urls = pickClips.get(upper) || [];
  return playUrl(pickRandom(urls), `${name} picks ${upper}.`);
}

export function playBuyVowelVo(playerName, letter) {
  const upper = String(letter || "").toUpperCase();
  const name = playerName || "Player";
  const urls = vowelClips.get(upper) || [];
  if (urls.length) {
    return playUrl(pickRandom(urls), `${name} would like to buy an ${upper}.`);
  }
  return playUrl(pickRandom(buyVowelClips), `${name} would like to buy a vowel.`);
}

export function playSolveAttemptVo(playerName) {
  const name = playerName || "Player";
  return playUrl(pickRandom(solveAttemptClips), `${name} is attempting to solve the puzzle.`);
}

/** @param {{ action: string, name?: string, letter?: string, seat?: string }} msg */
export function playPlayerActionVo(msg) {
  const name = msg.name || msg.seat || "Player";
  switch (msg.action) {
    case "pick":
      return playPickLetterVo(name, msg.letter);
    case "buyVowel":
      return playBuyVowelVo(name, msg.letter);
    case "solve":
      return playSolveAttemptVo(name);
    case "spin":
      // Turn cue ("spin the wheel") is handled by turnChanged only.
      return Promise.resolve();
    default:
      return Promise.resolve();
  }
}
