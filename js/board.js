import { playSound } from "./audio.js?v=9";
import { ROW_WIDTHS } from "./puzzle-layout.js?v=3";

const ROWS = 4;
const REVEAL_PAUSE = 0.42;
const REVEAL_FLIP = 0.58;
const SOLVE_PAUSE = 0.14;
const SOLVE_FLIP = 0.48;

function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function createFlipTile() {
  const flip = document.createElement("div");
  flip.className = "tile-flip";

  const back = document.createElement("div");
  back.className = "tile-face tile-back";

  const front = document.createElement("div");
  front.className = "tile-face tile-front";

  flip.appendChild(back);
  flip.appendChild(front);
  return flip;
}

function finalizeTile(el, letter) {
  el.classList.remove("letter-slot", "revealing");
  el.classList.add("revealed");
  el.textContent = letter;
  gsap.set(el, { clearProps: "transform" });
}

export class PuzzleBoard {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.tiles = [];
    this.rows = [];
  }

  /** @param {string[]} rows */
  render(rows) {
    this.rows = rows;
    this.container.innerHTML = "";
    this.tiles = [];

    for (let ri = 0; ri < ROWS; ri++) {
      const rowStr = rows[ri] ?? "#".repeat(ROW_WIDTHS[ri]);
      const cols = ROW_WIDTHS[ri];

      const rowEl = document.createElement("div");
      rowEl.className = "board-row";
      rowEl.dataset.row = String(ri);
      rowEl.dataset.cols = String(cols);
      const rowTiles = [];

      for (let ci = 0; ci < cols; ci++) {
        const ch = rowStr[ci] ?? "#";
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.row = String(ri);
        tile.dataset.col = String(ci);

        if (ch === "#" || ch === " ") {
          tile.classList.add("inactive");
        } else if (ch === "_") {
          tile.classList.add("letter-slot");
          tile.appendChild(createFlipTile());
        } else {
          tile.classList.add("revealed");
          tile.textContent = ch;
        }

        rowEl.appendChild(tile);
        rowTiles.push(tile);
      }

      this.container.appendChild(rowEl);
      this.tiles[ri] = rowTiles;
    }
  }

  /** @param {{ row: number, col: number }[]} indices @param {string[]} [rows] */
  revealTiles(indices, rows, { playAudio = true, fast = false } = {}) {
    if (!indices.length) return Promise.resolve();
    const sourceRows = rows ?? this.rows;

    const elements = indices
      .map(({ row, col }) => this.tiles[row]?.[col])
      .filter((el) => el && el.classList.contains("letter-slot"));

    if (!elements.length) return Promise.resolve();

    const pause = fast ? SOLVE_PAUSE : REVEAL_PAUSE;
    const flipDuration = fast ? SOLVE_FLIP : REVEAL_FLIP;
    const ordered = shuffle(elements);
    const revealTimeoutMs = fast ? 8000 : 12000;

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.rows = sourceRows;
        resolve();
      };
      const timeoutId = setTimeout(finish, revealTimeoutMs);

      const tl = gsap.timeline({ onComplete: finish });

      ordered.forEach((el, i) => {
        const ri = Number(el.dataset.row);
        const ci = Number(el.dataset.col);
        const letter = sourceRows[ri]?.[ci];
        if (!letter || letter === "_") return;

        const flip = el.querySelector(".tile-flip");
        const front = el.querySelector(".tile-front");
        if (!flip || !front) return;

        const start = i * pause;

        tl.call(
          () => {
            front.textContent = letter;
            el.classList.add("revealing");
            gsap.set(flip, { rotationY: 0 });
            if (playAudio && (!fast || i === 0)) playSound("reveal", { volume: fast ? 0.22 : 0.32 });
          },
          null,
          start,
        );

        tl.to(
          flip,
          {
            rotationY: 180,
            duration: flipDuration,
            ease: "power2.inOut",
            transformOrigin: "50% 50%",
          },
          start,
        );

        tl.call(() => finalizeTile(el, letter), null, start + flipDuration);
      });
    });
  }

  /** Reveal all remaining hidden tiles (solve). */
  revealAll(rows, { playAudio = true } = {}) {
    const indices = [];
    for (let ri = 0; ri < ROWS; ri++) {
      for (let ci = 0; ci < ROW_WIDTHS[ri]; ci++) {
        const ch = rows[ri]?.[ci];
        if (ch && ch !== "#" && ch !== " " && ch !== "_") {
          const el = this.tiles[ri]?.[ci];
          if (el?.classList.contains("letter-slot")) {
            indices.push({ row: ri, col: ci });
          }
        }
      }
    }
    this.rows = rows;
    return this.revealTiles(indices, rows, { playAudio, fast: true });
  }
}
