/** Looping background music with fade in/out (Toss-Up + Final Round). */

import { registerVoStop } from "./vo-bus.js?v=1";

const BGM_URL = "assets/audio/bgm-game-show.wav?v=1";
const FADE_MS = 1400;

let audio = null;
let fadeTimer = null;
let targetVolume = 0.22;
let playing = false;

function resolveUrl(relative) {
  if (typeof location !== "undefined" && location.pathname.includes("/multiplayer/")) {
    return new URL(relative.replace(/^\//, ""), new URL("../", location.href)).href;
  }
  return relative;
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio(resolveUrl(BGM_URL));
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  return audio;
}

function clearFade() {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function fadeTo(volume, durationMs, { onDone } = {}) {
  clearFade();
  const el = ensureAudio();
  const start = el.volume;
  const delta = volume - start;
  if (Math.abs(delta) < 0.01) {
    el.volume = volume;
    onDone?.();
    return;
  }
  const started = performance.now();
  fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / durationMs);
    el.volume = start + delta * t;
    if (t >= 1) {
      clearFade();
      el.volume = volume;
      onDone?.();
    }
  }, 40);
}

export function preloadBgm() {
  const el = ensureAudio();
  return new Promise((resolve) => {
    if (el.readyState >= 3) return resolve();
    const done = () => resolve();
    el.addEventListener("canplaythrough", done, { once: true });
    el.addEventListener("error", done, { once: true });
    el.load();
    setTimeout(done, 4000);
  });
}

/** Fade in looping BGM (Toss-Up reveal or Final Round pick/solve). */
export function fadeInBgm({ volume = 0.22 } = {}) {
  targetVolume = volume;
  const el = ensureAudio();
  if (!playing) {
    playing = true;
    el.play().catch(() => {});
  }
  fadeTo(targetVolume, FADE_MS);
}

/** Fade out and stop BGM. */
export function fadeOutBgm({ durationMs = FADE_MS } = {}) {
  if (!audio || !playing) return Promise.resolve();
  return new Promise((resolve) => {
    fadeTo(0, durationMs, {
      onDone: () => {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        playing = false;
        resolve();
      },
    });
  });
}

/** Cut BGM immediately (e.g. Toss-Up buzz-in). */
export function stopBgm() {
  clearFade();
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.volume = 0;
  playing = false;
}

registerVoStop(stopBgm);
