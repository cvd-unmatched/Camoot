function loggingEnabled() {
  const v = String(process.env.LOGGING ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

const on = loggingEnabled();

/** Call once at process start — always prints whether verbose logging is on. */
export function logLoggingStatus() {
  console.log(
    `[camoot:server] verbose logs: ${on ? "ON (LOGGING=true)" : "OFF — set LOGGING=true in .env for join/answer/socket traces"}`,
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
