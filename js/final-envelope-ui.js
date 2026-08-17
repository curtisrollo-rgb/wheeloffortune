/** Envelope reveal modal after Final Round ends. */

import { playSound } from "./audio.js?v=8";
import { playFinalWinVo } from "./final-win-vo.js?v=1";
import { playFinalLossVo } from "./final-loss-vo.js?v=1";
import { playCarPrizeVo } from "./car-prize-vo.js?v=1";

function formatRevealHeadline({ amount, prize }) {
  if (prize?.kind === "car") {
    return prize.name;
  }
  if (prize?.kind === "trip") {
    return prize.label;
  }
  return `$${amount.toLocaleString()}`;
}

function formatRevealDetail({ amount, won, prize }) {
  if (prize?.kind === "car") {
    return won
      ? "Your envelope opens — you've won a brand new car!"
      : `Your envelope contained a ${prize.name}. You don't take it home.`;
  }
  if (prize?.kind === "trip") {
    const valueText = amount > 0 ? ` (valued at $${amount.toLocaleString()})` : "";
    return won
      ? `Your envelope opens — you've won a vacation${valueText}!`
      : `Your envelope contained ${prize.label}${valueText}. You don't take it home.`;
  }
  return won
    ? "Your envelope opens — that's your bonus!"
    : `Your envelope contained $${amount.toLocaleString()}. You don't take it home.`;
}

/** @param {HTMLElement} modal */
export async function showEnvelopeReveal(modal, { amount, won, prize = null }) {
  const amountEl = modal.querySelector("#envelope-reveal-amount");
  const titleEl = modal.querySelector("#envelope-reveal-title");
  const detailEl = modal.querySelector("#envelope-reveal-detail");
  const flap = modal.querySelector(".envelope-flap");

  titleEl.textContent = won ? "You solved it!" : "Time's up…";
  amountEl.textContent = formatRevealHeadline({ amount, prize });
  amountEl.classList.toggle("is-prize-name", prize?.kind === "car" || prize?.kind === "trip");
  detailEl.textContent = formatRevealDetail({ amount, won, prize });

  flap?.classList.remove("is-open");
  modal.classList.remove("is-hidden");

  const openPromise = new Promise((resolve) => {
    requestAnimationFrame(() => {
      flap?.classList.add("is-open");
      resolve();
    });
  });

  await openPromise;

  if (won) {
    playSound("solve", { volume: 0.5 });
    if (prize?.kind === "car") {
      await playCarPrizeVo(prize.id);
    } else if (prize?.kind === "trip") {
      // Trip VO clips not generated yet — cash win VO only when a dollar value exists.
      if (amount > 0) {
        await playFinalWinVo(amount);
      }
    } else {
      await playFinalWinVo(amount);
    }
  } else {
    playSound("sad", { volume: 0.65 });
    await playFinalLossVo(amount > 0 ? amount : 25000);
  }

  return new Promise((resolve) => {
    const btn = modal.querySelector("#btn-envelope-dismiss");
    const finish = () => {
      modal.classList.add("is-hidden");
      flap?.classList.remove("is-open");
      amountEl.classList.remove("is-prize-name");
      btn?.removeEventListener("click", finish);
      resolve();
    };
    btn?.addEventListener("click", finish, { once: true });
  });
}
