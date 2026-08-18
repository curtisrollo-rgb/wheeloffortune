import { Wheel } from "https://cdn.jsdelivr.net/npm/spin-wheel@5.0.2/dist/spin-wheel-esm.js";
import { playSound } from "./audio.js?v=9";

/** Touch / iOS devices struggle with full-retina canvas redraws every frame. */
const MOBILE_WHEEL =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ""));

/** spin-wheel: 0 = auto devicePixelRatio; 1 = 1x (much faster on retina phones/tablets). */
function wheelPixelRatio() {
  if (!MOBILE_WHEEL) return 0;
  return 1;
}

function setSpinningClass(container, on) {
  container?.classList.toggle("is-spinning", on);
  container?.closest(".wheel-inner")?.classList.toggle("is-wheel-spinning", on);
}

/** Easing pool — fast launch, long friction tail. */
const easeSinOut = (t) => Math.sin((t * Math.PI) / 2);
const easeOutQuad = (t) => 1 - (1 - t) ** 2;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuart = (t) => 1 - (1 - t) ** 4;
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeOutCoast = (t) => 1 - (1 - t) ** 6;

function easeCruiseThenGrip(t) {
  if (t < 0.58) {
    const u = t / 0.58;
    return u * 0.74;
  }
  const u = (t - 0.58) / 0.42;
  return 0.74 + 0.26 * (1 - (1 - u) ** 5);
}

function makeFrictionEase(power) {
  return (t) => 1 - (1 - t) ** power;
}

/** Server-authoritative spins — smooth deceleration, lands on exact wedge index. */
function pickServerSpinProfile() {
  return {
    duration: MOBILE_WHEEL ? 4000 : 5800,
    revolutions: MOBILE_WHEEL ? 3.5 : 5,
    easing: easeOutQuart,
  };
}

/** Random duration, revolutions, and deceleration curve per spin (solo mode). */
function pickSpinProfile() {
  if (MOBILE_WHEEL) {
    const frictionPower = 2.8 + Math.random() * 3;
    return {
      duration: 3600 + Math.random() * 2200,
      revolutions: 2.5 + Math.random() * 2.5,
      easing: makeFrictionEase(frictionPower),
    };
  }

  const frictionPower = 2.5 + Math.random() * 4.5;
  const easings = [
    easeOutCubic,
    easeOutQuart,
    easeOutQuint,
    easeOutExpo,
    easeOutCoast,
    easeCruiseThenGrip,
    easeSinOut,
    easeOutQuad,
    makeFrictionEase(frictionPower),
  ];

  return {
    duration: 5500 + Math.random() * 3500,
    revolutions: 4 + Math.random() * 5,
    easing: easings[Math.floor(Math.random() * easings.length)],
  };
}

/** Fixed canvas height so every label starts at the same radial inset. */
const WEDGE_LABEL_CANVAS_HEIGHT = 96;
const WEDGE_LABEL_TOP_PAD = 12;

function computeLineHeight(text) {
  const chars = [...text];
  let lineHeight = Math.min(20, Math.max(13, Math.floor(140 / Math.max(chars.length, 1))));

  if (/\$\d{4}/.test(text) && text !== "$1000") {
    lineHeight = Math.min(lineHeight, 13.5);
  } else if (text === "BANKRUPT" || text === "LOSE TURN") {
    lineHeight = Math.min(lineHeight, 14.5);
  }

  return lineHeight;
}

function computeImageScale(text) {
  if (/\$\d{4}/.test(text) && text !== "$1000") return 0.74;
  if (/\$\d{2,3}K/i.test(text)) return 0.78;
  if (text === "BANKRUPT" || text === "LOSE TURN") return 0.82;
  if (text.length <= 4 && !text.startsWith("$")) return 0.88;
  return 0.84;
}

/**
 * Marquee stack: one character per row, first character at a fixed top inset
 * (outer rim when placed on the wheel, reading inward toward the hub).
 */
function createMarqueeCanvas(text, color) {
  const chars = [...text];
  const lineHeight = computeLineHeight(text);
  const fontSize = Math.round(lineHeight * 0.84) + 2;
  const width = Math.max(24, fontSize + 10);
  const height = WEDGE_LABEL_CANVAS_HEIGHT;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.font = `900 ${fontSize}px Impact, "Arial Black", "Franklin Gothic Heavy", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  let row = 0;
  for (const ch of chars) {
    if (ch !== " ") {
      ctx.fillText(ch, width / 2, WEDGE_LABEL_TOP_PAD + row * lineHeight);
    }
    row += ch === " " ? 0.55 : 1;
  }

  return canvas;
}

function canvasToImage(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL("image/png");
  });
}

/** spin-wheel library: pointerAngle 0 = top (north), matching .wheel-pointer CSS. */
const DEFAULT_POINTER_ANGLE = 0;

/** @param {HTMLElement} container @param {object[]} wedges @param {{ pointerAngle?: number }} [opts] */
export async function createWheel(container, wedges, opts = {}) {
  const pointerAngle = opts.pointerAngle ?? DEFAULT_POINTER_ANGLE;
  const images = await Promise.all(
    wedges.map((w) => {
      const color = w.type === "bankrupt" ? "#fff" : "#000";
      return canvasToImage(createMarqueeCanvas(w.label, color));
    }),
  );

  const items = wedges.map((w, i) => ({
    label: "",
    backgroundColor: w.backgroundColor,
    image: images[i],
    // Outer rim: image center sits slightly inward so the stack reads rim → hub.
    imageRadius: 0.86,
    imageScale: computeImageScale(w.label),
    // 0 = local +Y points toward hub; first char at top of image faces the rim.
    imageRotation: 0,
    imageOpacity: 1,
    weight: 1,
    value: w,
  }));

  let restResolve = null;
  let lastTickAt = 0;
  let spinPhase = "idle";
  const tickMinInterval = MOBILE_WHEEL ? 420 : 280;

  const wheel = new Wheel(container, {
    items,
    radius: 0.98,
    lineWidth: MOBILE_WHEEL ? 0 : 1,
    lineColor: "rgba(255, 255, 255, 0.55)",
    pixelRatio: wheelPixelRatio(),
    isInteractive: false,
    pointerAngle,
    rotationResistance: 0,
    onCurrentIndexChange: () => {
      if (spinPhase !== "spinning") return;
      if (MOBILE_WHEEL) return;
      const now = Date.now();
      if (now - lastTickAt < tickMinInterval) return;
      lastTickAt = now;
      playSound("tick", { volume: 0.22 });
    },
    onRest: () => {
      if (spinPhase !== "spinning" && spinPhase !== "nudging") return;

      const index = wheel.getCurrentIndex();
      const wedge = wedges[index];

      if (spinPhase === "nudging") {
        playSound("tick", { volume: 0.2 });
      }

      if (restResolve) {
        restResolve({ index, wedge });
        restResolve = null;
      }
    },
  });

  /** @returns {Promise<{ index: number, wedge: object }>} */
  function runSpinTo(index, profile, { playStartSound = false, phase = "spinning" } = {}) {
    const timeoutMs = Math.max(3500, Math.ceil((profile?.duration || 0) * (profile?.revolutions || 1)) + 2500);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (restResolve) restResolve = null;
        resolve(result);
      };

      restResolve = (result) => finish(result);
      spinPhase = phase;
      setSpinningClass(container, true);
      if (playStartSound) playSound("spin", { volume: MOBILE_WHEEL ? 0.35 : 0.45 });
      wheel.spinToItem(index, profile.duration, true, profile.revolutions, 1, profile.easing);

      const timeoutId = setTimeout(() => {
        spinPhase = "idle";
        setSpinningClass(container, false);
        const safeIndex = wheel.getCurrentIndex();
        finish({ index: safeIndex, wedge: wedges[safeIndex] });
      }, timeoutMs);
    });
  }

  function playLandSound(wedge) {
    if (!wedge) return;
    if (wedge.type === "bankrupt" || wedge.type === "loseTurn") return;
    if (wedge.type === "prize" || wedge.type === "bonusEnvelope") {
      playSound("land", { volume: 0.55 });
    } else {
      playSound("land", { volume: 0.65 });
    }
  }

  /** Spin to a server-chosen wedge index — one smooth ease-out, no post-spin snap. */
  async function spinToIndex(index) {
    const target = Number(index);
    if (!Number.isFinite(target) || target < 0 || target >= wedges.length) {
      return { index: 0, wedge: wedges[0] };
    }

    const result = await runSpinTo(target, pickServerSpinProfile(), {
      playStartSound: true,
      phase: "spinning",
    });

    spinPhase = "idle";
    setSpinningClass(container, false);
    playLandSound(result.wedge);
    return result;
  }

  async function spinRandom() {
    const index = Math.floor(Math.random() * wedges.length);
    const result = await runSpinTo(index, pickSpinProfile(), { playStartSound: true, phase: "spinning" });
    spinPhase = "idle";
    setSpinningClass(container, false);
    playLandSound(result.wedge);
    return result;
  }

  /** Alias for spinToIndex — kept for older callers. */
  function snapToIndex(index) {
    return spinToIndex(index);
  }

  function getCurrentIndex() {
    return wheel.getCurrentIndex();
  }

  /** One-wedge test cheat — short step left (-1) or right (+1). */
  function nudgeWedge(delta) {
    const len = wedges.length;
    const current = wheel.getCurrentIndex();
    const next = (current + delta + len) % len;
    if (next === current) {
      return Promise.resolve({ index: next, wedge: wedges[next] });
    }

    return new Promise((resolve) => {
      restResolve = resolve;
      spinPhase = "nudging";
      setSpinningClass(container, true);
      wheel.spinToItem(next, 220, true, 0, delta > 0 ? 1 : -1, easeOutQuad);
    });
  }

  return { wheel, spinToIndex, spinRandom, nudgeWedge, snapToIndex, getCurrentIndex, wedges };
}
