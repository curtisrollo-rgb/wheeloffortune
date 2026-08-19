/** Round-end summary narration on the TV host display. */

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
export function playRoundSummaryVo(_summary = {}) {
  // Solve congrats already plays on the board reveal — skip duplicate narration here.
  return Promise.resolve();
}
