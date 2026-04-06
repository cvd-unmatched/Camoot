import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Same-origin `/api` during dev & preview: always forward to the Node server (PORT default 3001). */
const apiProxy = {
  "/api": "http://127.0.0.1:3001",
  "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
  "/uploads": "http://127.0.0.1:3001",
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /** Listen on 0.0.0.0 so phones / other devices on the LAN can open http://<your-ip>:5173 */
    host: true,
    // Run `npm run dev` (client + server) or start `dev:server` separately.
    proxy: apiProxy,
  },
  /** Without this, `vite preview` serves `/api/*` as missing static files → 404 on login, uploads, etc. */
  preview: {
    host: true,
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    outDir: "dist",
  },
});
