/**
 * Client debug when `LOGGING=true` in `.env` at **build time** (Vite injects `__CAMOOT_LOG__`),
 * or enable at runtime without rebuild: add `?camoot_log=1` to the URL, or
 * `sessionStorage.setItem('camoot_log', '1')` then refresh.
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
