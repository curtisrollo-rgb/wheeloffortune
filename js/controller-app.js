import { WofClient } from "./net/client.js?v=1";
import { getWsUrl, getRoomFromUrl, getSeatFromUrl, getNameFromUrl } from "./net/config.js?v=1";

const $ = (id) => document.getElementById(id);

const els = {
  playerTitle: $("player-title"),
  controllerMeta: $("controller-meta"),
  turnBanner: $("turn-banner"),
  spinGaugeFill: $("spin-gauge-fill"),
  btnSpinHold: $("btn-spin-hold"),
  spinHint: $("spin-hint"),
  letterGrid: $("letter-grid"),
  btnVowel: $("btn-vowel"),
  btnSolve: $("btn-solve"),
  btnBuzz: $("btn-buzz"),
  controllerStatus: $("controller-status"),
  solveModal: $("solve-modal"),
  solveInput: $("solve-input"),
  btnSolveSubmit: $("btn-solve-submit"),
  btnSolveCancel: $("btn-solve-cancel"),
};

let client = null;
let mySeat = getSeatFromUrl();
let myName = getNameFromUrl() || "Player";
let roomCode = getRoomFromUrl();
let isMyTurn = false;
let vowelMode = false;
let spinPower = 0;
let spinDirection = 1;
let spinAnim = null;

function setStatus(text) {
  els.controllerStatus.textContent = text;
}

function setTurnActive(active) {
  isMyTurn = active;
  els.turnBanner.textContent = active ? "Your turn!" : "Waiting for other players…";
  els.turnBanner.classList.toggle("is-your-turn", active);
  updateControls();
  if (active && navigator.vibrate) navigator.vibrate([80, 40, 80]);
}

function updateControls() {
  const enabled = isMyTurn && client?.connected;
  els.btnSpinHold.disabled = !enabled || vowelMode;
  els.btnVowel.disabled = !enabled;
  els.btnSolve.disabled = !enabled;
  for (const btn of els.letterGrid.querySelectorAll(".letter-btn")) {
    btn.disabled = !enabled || btn.dataset.used === "1";
  }
}

function buildLetterGrid() {
  els.letterGrid.innerHTML = "";
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn letter-btn";
    btn.dataset.letter = letter;
    btn.textContent = letter;
    btn.disabled = true;
    btn.addEventListener("click", () => handleLetter(letter));
    els.letterGrid.appendChild(btn);
  }
}

function markLetterUsed(letter) {
  const btn = els.letterGrid.querySelector(`[data-letter="${letter}"]`);
  if (btn) {
    btn.dataset.used = "1";
    btn.disabled = true;
  }
}

function handleLetter(letter) {
  if (!isMyTurn || !client?.connected) return;
  if (vowelMode) {
    client.buyVowel(letter);
    vowelMode = false;
    els.btnVowel.textContent = "Buy Vowel ($250)";
  } else {
    client.guessLetter(letter);
  }
  markLetterUsed(letter);
  setStatus(`Called ${letter}.`);
}

function startSpinGauge() {
  if (!isMyTurn || spinAnim) return;
  spinPower = 0;
  spinDirection = 1;
  els.btnSpinHold.classList.add("is-holding");
  spinAnim = window.setInterval(() => {
    spinPower += spinDirection * 0.035;
    if (spinPower >= 1) {
      spinPower = 1;
      spinDirection = -1;
    } else if (spinPower <= 0) {
      spinPower = 0;
      spinDirection = 1;
    }
    els.spinGaugeFill.style.width = `${Math.round(spinPower * 100)}%`;
  }, 40);
}

function stopSpinGauge() {
  if (!spinAnim) return;
  window.clearInterval(spinAnim);
  spinAnim = null;
  els.btnSpinHold.classList.remove("is-holding");
  if (!isMyTurn || !client?.connected) return;
  client.spin(Number(spinPower.toFixed(3)));
  setStatus(`Spin sent (${Math.round(spinPower * 100)}% power).`);
  els.spinGaugeFill.style.width = "0%";
  spinPower = 0;
}

function openSolveModal() {
  els.solveModal.classList.remove("is-hidden");
  els.solveInput.value = "";
  els.solveInput.focus();
}

function closeSolveModal() {
  els.solveModal.classList.add("is-hidden");
}

function submitSolve() {
  const text = els.solveInput.value.trim();
  if (!text || !client?.connected) return;
  client.solve(text);
  closeSolveModal();
  setStatus("Solve submitted.");
}

function onMessage(msg) {
  switch (msg.op) {
    case "joined":
    case "rejoined":
      mySeat = msg.seat;
      roomCode = msg.code;
      myName = msg.name || myName;
      els.playerTitle.textContent = myName;
      els.controllerMeta.textContent = `Room ${roomCode} · ${mySeat.toUpperCase()}`;
      setStatus("Connected. Waiting for host…");
      break;
    case "turnChanged":
      setTurnActive(msg.seat === mySeat);
      if (msg.seat === mySeat) setStatus(msg.message || "Your turn!");
      break;
    case "gameUpdate":
      if (msg.state?.phase === "tossUpReveal") {
        els.btnBuzz.classList.remove("is-hidden");
        els.btnBuzz.disabled = false;
      } else {
        els.btnBuzz.classList.add("is-hidden");
      }
      if (typeof msg.state?.roundMoney === "number") {
        setStatus(`Round value: $${msg.state.roundMoney.toLocaleString()}`);
      }
      break;
    case "buzzWinner":
      if (msg.seat === mySeat) {
        setStatus("You buzzed in first! Solve the puzzle.");
        openSolveModal();
      } else {
        setStatus(`${msg.name || msg.seat} buzzed in.`);
      }
      break;
    case "letterResult":
      if (msg.seat === mySeat) {
        setStatus(msg.hit ? `${msg.count} ${msg.letter}'s!` : `No ${msg.letter}'s.`);
      }
      break;
    case "error":
      setStatus(msg.message || msg.error || "Error.");
      break;
    default:
      break;
  }
}

async function connect() {
  const wsUrl = getWsUrl();
  if (!roomCode || !mySeat) {
    setStatus("Missing room or seat. Join from join.html first.");
    return;
  }
  if (!wsUrl) {
    setStatus("Missing WebSocket URL.");
    return;
  }

  els.playerTitle.textContent = myName;
  els.controllerMeta.textContent = `Room ${roomCode} · ${mySeat.toUpperCase()}`;

  client = new WofClient({ onMessage, onClose: () => setStatus("Disconnected.") });
  try {
    await client.connect(wsUrl);
    client.rejoinRoom(roomCode, mySeat, myName);
    setStatus("Connected.");
  } catch {
    setStatus("Could not connect.");
  }
}

els.btnSpinHold.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startSpinGauge();
});

els.btnSpinHold.addEventListener("pointerup", stopSpinGauge);
els.btnSpinHold.addEventListener("pointerleave", stopSpinGauge);
els.btnSpinHold.addEventListener("pointercancel", stopSpinGauge);

els.btnVowel.addEventListener("click", () => {
  if (!isMyTurn) return;
  vowelMode = !vowelMode;
  els.btnVowel.textContent = vowelMode ? "Cancel Vowel" : "Buy Vowel ($250)";
  setStatus(vowelMode ? "Pick a vowel ($250)." : "Consonant mode.");
});

els.btnSolve.addEventListener("click", openSolveModal);
els.btnSolveCancel.addEventListener("click", closeSolveModal);
els.btnSolveSubmit.addEventListener("click", submitSolve);
els.btnBuzz.addEventListener("click", () => client?.buzz());

els.solveInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSolve();
  if (e.key === "Escape") closeSolveModal();
});

buildLetterGrid();
updateControls();
connect().catch(() => {});
