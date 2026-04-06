/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional public app URL (mirror server JOIN_BASE_URL when it differs from the page origin). */
  readonly VITE_JOIN_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
