/** Round-end summary narration on the TV host display. */

import { registerVoStop, stopAllVo } from "./vo-bus.js?v=1";

let currentVo = null;
let playGeneration = 0;

function haltCurrentAudio() {
  if (!currentVo) return;
  currentVo.pause();
  currentVo.currentTime = 0;
  currentVo = null;
}

export function stopRoundSummaryVo() {
  playGeneration += 1;
  haltCurrentAudio();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

registerVoStop(stopRoundSummaryVo);

function speak(text, { volume = 1, rate = 0.92 } = {}) {
  if (!text || !window.speechSynthesis) return Promise.resolve();

  stopAllVo();
  const gen = ++playGeneration;

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.volume = volume;
    utter.rate = rate;
    const finish = () => {
      if (gen !== playGeneration) return resolve();
      resolve();
    };
    utter.addEventListener("end", finish, { once: true });
    utter.addEventListener("error", finish, { once: true });
    window.speechSynthesis.speak(utter);
  });
}

/**
 * @param {{
 *   roundLabel?: string,
 *   title?: string,
 *   winnerName?: string,
 *   amount?: number,
 *   detail?: string,
 *   scoresLine?: string,
 * }} summary
 */
export function playRoundSummaryVo(summary = {}) {
  const parts = [];

  if (summary.roundLabel && summary.title) {
    parts.push(`${summary.roundLabel}. ${summary.title}`);
  } else if (summary.title) {
    parts.push(summary.title);
  }

  if (summary.winnerName && summary.winnerName !== "No winner") {
    if (summary.amount > 0) {
      parts.push(
        `${summary.winnerName} takes $${summary.amount.toLocaleString()} for the round.`,
      );
    } else {
      parts.push(`${summary.winnerName}.`);
    }
  } else if (summary.winnerName === "No winner") {
    parts.push("Nobody solved the puzzle.");
  }

  if (summary.detail) parts.push(summary.detail);

  if (summary.scoresLine) {
    parts.push(`Scores going into the next round: ${summary.scoresLine}.`);
  }

  return speak(parts.join(" "));
}
