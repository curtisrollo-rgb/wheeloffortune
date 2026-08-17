/** Sound effects — curated from gaming pack, card pack, and sparkling effect */

const SOUND_VERSION = "8";

const SOUNDS = {
  /** Wheel peg tick — PlayingCards_DealFlip_03 */
  tick: `assets/audio/tick.mp3?v=${SOUND_VERSION}`,
  /** Wedge landed / toss-up ring-in — Jumps Up 01 */
  land: `assets/audio/land.mp3?v=${SOUND_VERSION}`,
  /** Toss-up buzz-in (same clip as land) */
  buzz: `assets/audio/land.mp3?v=${SOUND_VERSION}`,
  /** Letter revealed — Arcade Pickup Item (light cha-ching) */
  reveal: `assets/audio/reveal.mp3?v=${SOUND_VERSION}`,
  /** Wrong guess sting — Arcade Ominous Hit */
  miss: `assets/audio/miss.mp3?v=${SOUND_VERSION}`,
  /** Puzzle solved fanfare — Shine 01 */
  solve: `assets/audio/solve.mp3?v=${SOUND_VERSION}`,
  /** Bankrupt wedge fallback — Arcade Drop Item */
  bankrupt: `assets/audio/bankrupt.mp3?v=${SOUND_VERSION}`,
  /** Penalty wedge sting — sad trombone-style hit */
  sad: `assets/audio/sad.mp3?v=${SOUND_VERSION}`,
  /** Wheel spin — PlayingCards_Shuffle_01 */
  spin: `assets/audio/spin.mp3?v=${SOUND_VERSION}`,
  /** Vowel purchase — Arcade Classic Pickup */
  vowel: `assets/audio/vowel.mp3?v=${SOUND_VERSION}`,
};

const cache = new Map();
let muted = false;

/** Resolve asset paths from /multiplayer/ pages (controller, host). */
function resolveSoundUrl(relative) {
  if (typeof location !== "undefined" && location.pathname.includes("/multiplayer/")) {
    return new URL(relative.replace(/^\//, ""), new URL("../", location.href)).href;
  }
  return relative;
}

function load(name) {
  if (!cache.has(name)) {
    const url = resolveSoundUrl(SOUNDS[name]);
    if (!url) return null;
    const audio = new Audio(url);
    audio.preload = "auto";
    cache.set(name, audio);
  }
  return cache.get(name);
}

export function setMuted(value) {
  muted = !!value;
}

export function playSound(name, { volume = 0.6 } = {}) {
  if (muted) return;
  const base = load(name);
  if (!base) return;
  const audio = base.cloneNode();
  audio.volume = volume;
  audio.play().catch(() => {});
}

/** Play a one-shot SFX and resolve when it finishes (or on error). */
export function playSoundAndWait(name, { volume = 0.6 } = {}) {
  if (muted) return Promise.resolve();
  const base = load(name);
  if (!base) return Promise.resolve();

  return new Promise((resolve) => {
    const audio = base.cloneNode();
    audio.volume = volume;
    const finish = () => resolve();
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play().catch(finish);
  });
}

export function preloadAll() {
  return Promise.all([preloadEssential(), preloadRemaining()]);
}

/** Toss-Up + first spins — keep the boot path small. */
export function preloadEssential() {
  return preloadSounds(["tick", "land", "buzz", "solve", "miss", "spin"]);
}

/** Everything else — safe to load after the lobby is visible. */
export function preloadRemaining() {
  const rest = Object.keys(SOUNDS).filter(
    (name) => !["tick", "land", "buzz", "solve", "miss", "spin"].includes(name),
  );
  return preloadSounds(rest);
}

function preloadSounds(names) {
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          const audio = load(name);
          if (!audio) return resolve();
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const timer = setTimeout(finish, 2500);
          const done = () => {
            clearTimeout(timer);
            finish();
          };
          if (audio.readyState >= 3) return done();
          audio.addEventListener("canplaythrough", done, { once: true });
          audio.addEventListener("error", done, { once: true });
          audio.load();
        }),
    ),
  );
}

/** @deprecated Use preloadEssential / preloadRemaining. */
export function preloadAllLegacy() {
  return preloadAll();
}
