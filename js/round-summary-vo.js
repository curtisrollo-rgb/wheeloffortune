/** Round-end summary narration on the TV host display. */

import { playRandomSolveCongrats } from "./solve-congrats-vo.js?v=2";

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
  const hasWinner = summary.winnerName && summary.winnerName !== "No winner";
  if (!hasWinner) return Promise.resolve();
  return playRandomSolveCongrats({ volume: 0.88 });
}
