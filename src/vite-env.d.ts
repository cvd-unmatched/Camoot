/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional public app URL (mirror server JOIN_BASE_URL when it differs from the page origin). */
  readonly VITE_JOIN_BASE_URL?: string;
  /** Mirror of LOGGING for tooling; prefer LOGGING in .env (read by Vite `define`). */
  readonly VITE_LOGGING?: string;
}

/** Injected by Vite from LOGGING / VITE_LOGGING in `.env` at build time. */
declare const __CAMOOT_LOG__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
