/** Stops every registered announcer VO clip (category, miss, penalty, etc.). */

const stoppers = [];

export function registerVoStop(fn) {
  stoppers.push(fn);
}

export function stopAllVo() {
  for (const stop of stoppers) {
    stop();
  }
}
