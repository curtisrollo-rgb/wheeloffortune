/** WebSocket client for WoF online play. */

export class WofClient {
  /** @param {{ onMessage?: (msg: object) => void, onOpen?: () => void, onClose?: () => void, onError?: (err: unknown) => void }} hooks */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.ws = null;
    this.seat = null;
    this.roomCode = null;
    this.role = null;
    this.connected = false;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      if (this.ws) this.ws.close();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        this.hooks.onOpen?.();
        resolve();
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.hooks.onClose?.();
      };

      this.ws.onerror = (err) => {
        this.hooks.onError?.(err);
        reject(err);
      };

      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.op === "roomCreated") {
          this.roomCode = msg.code;
        }
        if (msg.op === "joined" || msg.op === "rejoined") {
          this.roomCode = msg.code;
          this.seat = msg.seat;
          this.role = msg.role ?? "player";
        }
        if (msg.op === "hostAttached") {
          this.roomCode = msg.code;
          this.role = "host";
        }
        this.hooks.onMessage?.(msg);
      };
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  ping() {
    this.send({ op: "ping", t: Date.now() });
  }

  createRoom() {
    this.send({ op: "createRoom" });
  }

  joinRoom(code, name) {
    this.send({ op: "joinRoom", code: String(code).toUpperCase(), name: String(name || "").trim() });
  }

  attachHost(code) {
    this.send({ op: "attachHost", code: String(code).toUpperCase() });
  }

  rejoinRoom(code, seat, name) {
    this.send({ op: "rejoinRoom", code: String(code).toUpperCase(), seat, name });
  }

  startGame() {
    this.send({ op: "startGame" });
  }

  newPuzzle() {
    this.send({ op: "newPuzzle" });
  }

  setRound(roundType) {
    this.send({ op: "setRound", roundType });
  }

  beginTossUp() {
    this.send({ op: "beginTossUp" });
  }

  spin(power) {
    this.send({ op: "spin", power });
  }

  guessLetter(letter) {
    this.send({ op: "guessLetter", letter: String(letter).toUpperCase() });
  }

  buyVowel(letter) {
    this.send({ op: "buyVowel", letter: String(letter).toUpperCase() });
  }

  solveIntent() {
    this.send({ op: "solveIntent" });
  }

  solve(text) {
    this.send({ op: "solve", text: String(text).trim() });
  }

  buzz() {
    this.send({ op: "buzz" });
  }

  beginFinalRstlne() {
    this.send({ op: "beginFinalRstlne" });
  }

  advanceFinalRstlne() {
    this.send({ op: "advanceFinalRstlne" });
  }

  chat(text) {
    this.send({ op: "chat", text });
  }

  leaveRoom() {
    this.send({ op: "leaveRoom" });
  }
}
