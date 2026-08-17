/** Category announcement voiceovers (ElevenLabs). */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

const MANIFEST_URL = "assets/audio/vo/categories/manifest.json?v=4";
const ALIAS_URL = "data/category_map.json?v=3";

const clipsByCategory = new Map();
/** @type {Map<string, string>} */
const spokenByCategory = new Map();
let aliases = {};
let ready = false;
let currentVo = null;
let playGeneration = 0;

function pythonTitle(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Canonical WoF category label — used for both on-screen pill and VO lookup. */
export function canonicalCategory(name) {
  const titled = pythonTitle(name);
  return aliases[titled] || titled;
}

function resolveClip(category) {
  const canonical = canonicalCategory(category);
  const urls = clipsByCategory.get(canonical.toLowerCase()) || [];
  if (!urls.length) return { canonical, url: null };
  const url = urls[Math.floor(Math.random() * urls.length)];
  return { canonical, url };
}

function preloadUrl(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      finish();
    };
    if (audio.readyState >= 3) return done();
    audio.addEventListener("canplaythrough", done, { once: true });
    audio.addEventListener("error", done, { once: true });
    audio.load();
  });
}

export async function loadCategoryVo() {
  if (ready) return;

  const [manifestRes, aliasRes] = await Promise.all([
    fetch(MANIFEST_URL),
    fetch(ALIAS_URL),
  ]);

  if (aliasRes.ok) {
    const aliasData = await aliasRes.json();
    aliases = aliasData.aliases || {};
  }

  if (!manifestRes.ok) {
    ready = true;
    return;
  }

  const manifest = await manifestRes.json();
  const urls = [];
  for (const clip of manifest.clips || []) {
    const key = clip.category.toLowerCase();
    const url = `${clip.file}?v=4`;
    if (!clipsByCategory.has(key)) clipsByCategory.set(key, []);
    clipsByCategory.get(key).push(url);
    if (!spokenByCategory.has(key)) {
      spokenByCategory.set(key, clip.spoken || clip.category);
    }
    urls.push(url);
  }

  await Promise.all(urls.map(preloadUrl));
  ready = true;
}

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopCategoryVo() {
  playGeneration += 1;
  haltCurrentAudio();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

registerVoStop(stopCategoryVo);

function categorySpokenLabel(category) {
  const canonical = canonicalCategory(category);
  return spokenByCategory.get(canonical.toLowerCase()) || canonical;
}

function categoryFallbackText(category, intro) {
  const spoken = categorySpokenLabel(category);
  if (intro === "first") return `The category is ${spoken}.`;
  return `And the next category is ${spoken}.`;
}

function speakFallback(text, { volume = 0.88 } = {}) {
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

/** @returns {Promise<void>} */
export function playCategoryVo(category, { volume = 0.88, intro = "next" } = {}) {
  if (!category) return Promise.resolve();

  const { url } = resolveClip(category);
  const useClip = intro !== "first" && url && ready;

  if (!useClip) {
    return speakFallback(categoryFallbackText(category, intro), { volume });
  }

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
    audio.addEventListener(
      "error",
      () => speakFallback(categoryFallbackText(category, intro), { volume }).then(finish),
      { once: true },
    );
    audio.play().catch(() =>
      speakFallback(categoryFallbackText(category, intro), { volume }).then(finish),
    );
  });
}
