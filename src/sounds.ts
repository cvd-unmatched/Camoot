let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function beep(freq: number, duration: number, type: OscillatorType = "sine", vol = 0.08) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

/** Call on first user gesture if you need audio before any play* (optional). */
export function resumeSounds() {
  const c = getCtx();
  if (c?.state === "suspended") void c.resume();
}

/* --- In-game (player) --- */

export function playClick() {
  beep(880, 0.05, "square", 0.04);
}

export function playSubmit() {
  beep(523, 0.06);
  setTimeout(() => beep(784, 0.08), 60);
}

export function playCorrect() {
  beep(523, 0.1);
  setTimeout(() => beep(659, 0.1), 90);
  setTimeout(() => beep(784, 0.15), 180);
}

export function playWrong() {
  beep(200, 0.15, "sawtooth", 0.05);
}

export function playTick() {
  beep(1200, 0.03, "sine", 0.025);
}

/** Joined the game lobby (socket `joined`). */
export function playYouJoined() {
  beep(440, 0.07, "triangle", 0.055);
  setTimeout(() => beep(554, 0.08, "triangle", 0.055), 75);
  setTimeout(() => beep(880, 0.12, "triangle", 0.06), 155);
}

/** Home: Join / Host / Create tiles. */
export function playMenuTap() {
  beep(523, 0.05, "sine", 0.055);
  setTimeout(() => beep(659, 0.06, "sine", 0.06), 55);
}

/** Manager unlock & Host login success. */
export function playUnlockOk() {
  beep(392, 0.08);
  setTimeout(() => beep(523, 0.1), 85);
  setTimeout(() => beep(659, 0.12), 175);
}

/** Host: lobby → first question (Start). */
export function playGameStart() {
  beep(349, 0.1, "square", 0.04);
  setTimeout(() => beep(440, 0.1, "square", 0.045), 100);
  setTimeout(() => beep(523, 0.15, "square", 0.05), 200);
  setTimeout(() => beep(698, 0.18, "square", 0.055), 310);
}

/** Host: advance flow (Show answers, Leaderboard, Next, Finish). */
export function playHostStep() {
  beep(587, 0.09, "sine", 0.06);
  setTimeout(() => beep(784, 0.11, "sine", 0.065), 95);
}

/** Host: chose a quiz to go live. */
export function playPickQuiz() {
  beep(523, 0.07);
  setTimeout(() => beep(698, 0.1), 80);
}

/** Manager: quiz saved. */
export function playSaved() {
  beep(659, 0.09);
  setTimeout(() => beep(880, 0.14), 90);
}

/** Manager: new quiz or light toolbar action. */
export function playTap() {
  beep(698, 0.05, "sine", 0.05);
}
