/** Build bonus-envelope wedges for the Final Round wheel spin. */

const WHEEL_COLORS = [
  "#ee1c24",
  "#3cb878",
  "#e70697",
  "#00aef0",
  "#f26522",
  "#fff200",
  "#f6989d",
  "#a186be",
  "#ee1c24",
  "#3cb878",
  "#f26522",
  "#00aef0",
];

/** Letters on bonus wheel wedges — amounts stay hidden until envelope opens. */
const ENVELOPE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");

/** @type {Array<{ type: string, amount?: number }>} */
let prizeEntries = [];

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function loadFinalEnvelopeAmounts() {
  const res = await fetch("data/final-envelopes.json?v=3");
  const data = await res.json();
  prizeEntries = data.prizes || data.amounts?.map((amount) => ({ type: "cash", amount })) || [];
  return prizeEntries;
}

export function getFinalEnvelopePrizes() {
  return prizeEntries;
}

/** @deprecated Use getFinalEnvelopePrizes(). */
export function getFinalEnvelopeAmounts() {
  return prizeEntries
    .filter((entry) => entry.type === "cash")
    .map((entry) => entry.amount ?? 0);
}

/**
 * @param {Array<{ type: string, amount?: number }>} [source]
 * @param {{ cars?: Array<{ id: string, name: string }>, trips?: Array<{ id: string, label: string, valueUsd?: number }> }} [options]
 */
export function buildEnvelopeWedges(source = prizeEntries, { cars = [], trips = [] } = {}) {
  const carPool = shuffle(cars);
  const tripPool = shuffle(trips);

  return source.map((entry, index) => {
    const base = {
      label: ENVELOPE_LABELS[index % ENVELOPE_LABELS.length],
      backgroundColor: WHEEL_COLORS[index % WHEEL_COLORS.length],
      index,
      type: "bonusEnvelope",
    };

    if (entry.type === "car") {
      const car = carPool.pop() || cars[0] || null;
      return {
        ...base,
        prizeType: "car",
        value: 0,
        prize: car
          ? { kind: "car", id: car.id, name: car.name, label: `New ${car.name}` }
          : null,
      };
    }

    if (entry.type === "trip") {
      const trip = tripPool.pop() || trips[0] || null;
      return {
        ...base,
        prizeType: "trip",
        value: trip?.valueUsd || 0,
        prize: trip
          ? {
              kind: "trip",
              id: trip.id,
              name: trip.label,
              label: trip.label,
              valueUsd: trip.valueUsd || 0,
            }
          : null,
      };
    }

    const amount = entry.amount ?? 0;
    return {
      ...base,
      prizeType: "cash",
      value: amount,
      prize: null,
    };
  });
}
