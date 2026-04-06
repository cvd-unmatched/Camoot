/**
 * Client debug when `LOGGING=true` in `.env` at **build time** (Vite injects `__CAMOOT_LOG__`),
 * or enable at runtime without rebuild: add `?camoot_log=1` to the URL, or
 * `sessionStorage.setItem('camoot_log', '1')` then refresh.
 *
 * **Android (e.g. Chrome on Samsung):** open this app with `?camoot_log=1`, plug in USB,
 * on desktop Chrome open `chrome://inspect` → Inspect the phone tab → Console shows
 * `[camoot:qp]`, `[camoot:play]`, `[camoot:qp-touch]` lines in order as you tap.
 *
 * **Server:** set `CAMOOT_PLAYER_DEBUG=1` or `LOGGING=true` in `.env` → terminal shows
 * `[camoot:server:player]` for every `player_answer` (incl. User-Agent), rejects, and timer→reveal.
 */

function clientFlagEnabled(): boolean {
  if (typeof __CAMOOT_LOG__ !== "undefined" && __CAMOOT_LOG__) return true;
  try {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    if (q.get("camoot_log") === "1" || q.has("camoot_log")) return true;
    if (window.sessionStorage?.getItem("camoot_log") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function camootLog(scope: string, ...args: unknown[]) {
  if (!clientFlagEnabled()) return;
  console.log(`[camoot:${scope}]`, new Date().toISOString(), ...args);
}

export function camootWarn(scope: string, ...args: unknown[]) {
  if (!clientFlagEnabled()) return;
  console.warn(`[camoot:${scope}]`, new Date().toISOString(), ...args);
}
