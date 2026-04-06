import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Same-origin `/api` during dev & preview: always forward to the Node server (PORT default 3001). */
const apiProxy = {
  "/api": "http://127.0.0.1:3001",
  "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
  "/uploads": "http://127.0.0.1:3001",
};

/**
 * Cloudflare Rocket Loader rewrites/defers `<script type="module" src="...">` and often prevents React from mounting.
 * Bootstrap with a classic script (`data-cfasync="false"`) that dynamically `import()`s the real entry — CF leaves that alone.
 */
function cloudflareFriendlyEntryBootstrap() {
  return {
    name: "cloudflare-friendly-entry",
    enforce: "post" as const,
    transformIndexHtml(html: string) {
      return html.replace(/<script\b[^>]*\btype="module"[^>]*><\/script>/gi, (tag) => {
        const m = tag.match(/\bsrc="([^"]+)"/);
        if (!m) return tag;
        const url = JSON.stringify(m[1]);
        return (
          `<script data-cfasync="false">` +
          `(function(){var u=${url};import(u).catch(function(e){` +
          `console.error(e);var r=document.getElementById("root");if(!r)return;` +
          `var p=document.createElement("p");` +
          `p.style.cssText="margin:0;padding:2rem 1.25rem;font:600 0.9rem system-ui,sans-serif;color:#ffc9c9;text-align:center;max-width:28rem;margin-inline:auto";` +
          `p.textContent="Could not load Camoot. Check your connection; if you use Cloudflare, turn off Rocket Loader (Speed \\u2192 Optimization).";` +
          `r.replaceChildren(p);});})();` +
          `<\/script>`
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflareFriendlyEntryBootstrap()],
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
