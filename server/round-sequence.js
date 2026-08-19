/** Canonical round order for a full online game. */

export const ROUND_SEQUENCE = [
  { type: "tossup", label: "Toss-Up" },
  { type: "round1", label: "Round 1" },
  { type: "tossup", label: "Toss-Up" },
  { type: "round2", label: "Round 2" },
  { type: "final", label: "Final Round" },
];

/** @param {number} index */
export function roundAt(index) {
  return ROUND_SEQUENCE[index] ?? null;
}

/** @param {number} index */
export function nextRoundEntry(index) {
  if (index == null || index < 0) return null;
  const next = index + 1;
  if (next >= ROUND_SEQUENCE.length) return null;
  return { index: next, ...ROUND_SEQUENCE[next] };
}

/** @param {string} roundType @param {number} [afterIndex] */
export function sequenceIndexForType(roundType, afterIndex = -1) {
  for (let i = afterIndex + 1; i < ROUND_SEQUENCE.length; i++) {
    if (ROUND_SEQUENCE[i].type === roundType) return i;
  }
  for (let i = 0; i <= afterIndex && i < ROUND_SEQUENCE.length; i++) {
    if (ROUND_SEQUENCE[i].type === roundType) return i;
  }
  return -1;
}

/** Toss-up ordinal (1st, 2nd, …) at this point in the round sequence. @param {number} sequenceIndex */
export function tossUpOrdinalAt(sequenceIndex) {
  let ordinal = 0;
  const end = Math.min(sequenceIndex, ROUND_SEQUENCE.length - 1);
  for (let i = 0; i <= end; i++) {
    if (ROUND_SEQUENCE[i].type === "tossup") ordinal++;
  }
  return Math.max(1, ordinal);
}

/** Cash for the toss-up at this sequence index ($1K × ordinal). @param {number} sequenceIndex */
export function tossUpWinAmount(sequenceIndex) {
  return tossUpOrdinalAt(sequenceIndex) * 1000;
}
