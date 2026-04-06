function loggingEnabled() {
  const v = String(process.env.LOGGING ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function playerDebugEnabled() {
  const v = String(process.env.CAMOOT_PLAYER_DEBUG ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

const on = loggingEnabled();
/** Mobile / `player_answer` deep traces: `LOGGING=true` or `CAMOOT_PLAYER_DEBUG=1` alone. */
const playerOn = on || playerDebugEnabled();

/** Call once at process start — always prints whether verbose logging is on. */
export function logLoggingStatus() {
  console.log(
    `[camoot:server] general LOGGING=${on ? "on" : "off"} | player / mobile trace=${playerOn ? "on" : "off"} (on if LOGGING or CAMOOT_PLAYER_DEBUG=1)`,
  );
}

/** Structured server logs when `LOGGING=true` in `.env`. Prefix: `[camoot:server]` */
export function log(scope, ...args) {
  if (!on) return;
  console.log(`[camoot:server:${scope}]`, new Date().toISOString(), ...args);
}

export function logWarn(scope, ...args) {
  if (!on) return;
  console.warn(`[camoot:server:${scope}]`, new Date().toISOString(), ...args);
}

/** Join + player_answer + timer detail; on when LOGGING or CAMOOT_PLAYER_DEBUG. Tag: `[camoot:server:player]` */
export function logPlayer(...args) {
  if (!playerOn) return;
  console.log(`[camoot:server:player]`, new Date().toISOString(), ...args);
}

export function logPlayerWarn(...args) {
  if (!playerOn) return;
  console.warn(`[camoot:server:player]`, new Date().toISOString(), ...args);
}
