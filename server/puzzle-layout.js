/** Lay out a phrase onto the classic 4-row WoF board (12 / 14 / 14 / 12). */

export const ROW_WIDTHS = [12, 14, 14, 12];
const VOWELS = new Set(["A", "E", "I", "O", "U"]);
const GUESSABLE = /^[A-Z]$/;

export function isGuessableLetter(letter) {
  return GUESSABLE.test(String(letter || "").toUpperCase());
}

export function isVowel(letter) {
  return VOWELS.has(String(letter || "").toUpperCase());
}

function splitWords(answer) {
  return answer.toUpperCase().trim().split(/\s+/).filter(Boolean);
}

function hyphenSegments(word) {
  if (!word.includes("-")) return [word];
  const parts = word.split("-");
  return parts.map((part, i) => (i < parts.length - 1 ? `${part}-` : part));
}

function tokenizeWords(words) {
  const tokens = [];
  for (const word of words) {
    const segments = hyphenSegments(word);
    for (let i = 0; i < segments.length; i++) {
      tokens.push({ text: segments[i], spaceBefore: i === 0 });
    }
  }
  return tokens;
}

function appendToken(line, token) {
  if (!line) return token.text;
  return `${line}${token.spaceBefore ? " " : ""}${token.text}`;
}

function splitIntoLines(words) {
  const tokens = tokenizeWords(words);
  const lines = [];
  let current = "";
  let row = 0;

  for (const token of tokens) {
    let placed = false;

    while (!placed) {
      if (row >= 4) break;

      const limit = ROW_WIDTHS[Math.min(row, 3)];
      const candidate = appendToken(current, token);

      if (candidate.length <= limit) {
        current = candidate;
        placed = true;
        break;
      }

      if (current) {
        lines.push(current);
        row += 1;
        current = "";
        continue;
      }

      if (token.text.length <= limit) {
        current = token.text;
        placed = true;
        break;
      }

      lines.push(token.text.slice(0, limit));
      row += 1;
      const remainder = token.text.slice(limit);
      if (remainder) current = remainder;
      placed = true;
    }
  }

  if (current && lines.length < 4) lines.push(current);
  return lines;
}

function lineToRow(line, rowIndex) {
  const width = ROW_WIDTHS[rowIndex];
  const text = line.trim().toUpperCase();
  if (!text) return "#".repeat(width);

  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  const padded = "#".repeat(left) + text + "#".repeat(pad - left);

  return padded
    .slice(0, width)
    .split("")
    .map((ch) => {
      if (ch === "#") return "#";
      if (/\s/.test(ch)) return " ";
      if (isGuessableLetter(ch)) return "_";
      return ch;
    })
    .join("");
}

function assignRows(lines) {
  const nonEmpty = lines.filter((l) => l.trim());
  const count = nonEmpty.length;
  const startRow = count === 1 ? 1 : count === 2 ? 1 : count === 3 ? 0 : 0;
  const rows = Array.from({ length: 4 }, (_, i) => "#".repeat(ROW_WIDTHS[i]));

  for (let i = 0; i < count; i++) {
    rows[startRow + i] = lineToRow(nonEmpty[i], startRow + i);
  }
  return rows;
}

export function layoutPuzzle(category, answer) {
  const lines = splitIntoLines(splitWords(answer));
  const rows = assignRows(lines);
  return { category, answer: answer.toUpperCase(), rows };
}

export function buildLetterMap(rows, answer) {
  const map = [];
  const chars = answer.toUpperCase().split("");
  let ai = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < rows[ri].length; ci++) {
      const cell = rows[ri][ci];
      if (cell === "#" || cell === " ") continue;
      while (ai < chars.length && chars[ai] === " ") ai++;
      if (ai >= chars.length) break;
      const answerChar = chars[ai];
      ai++;
      if (isGuessableLetter(answerChar)) {
        map.push({ row: ri, col: ci, letter: answerChar });
      }
    }
  }
  return map;
}
