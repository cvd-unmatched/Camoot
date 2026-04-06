import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** Same-origin `/api` during dev & preview: always forward to the Node server (PORT default 3001). */
const apiProxy = {
  "/api": "http://127.0.0.1:3001",
  "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
  "/uploads": "http://127.0.0.1:3001",
};

/**
 * Cloudflare Rocket Loader breaks many SPA setups. We:
 * 1) Remove the default `<script type="module" src="...">` from the document.
 * 2) Append a classic `data-cfasync="false"` bootstrap at the **end of body** so `#root` exists and CSS from `<head>` can load first.
 */
function cloudflareFriendlyEntryBootstrap() {
  return {
    name: "cloudflare-friendly-entry",
    enforce: "post" as const,
    transformIndexHtml(html: string) {
      const moduleRe = /<script\b[^>]*\btype="module"[^>]*><\/script>/gi;
      let entry = "";
      let out = html.replace(moduleRe, (tag) => {
        const m = tag.match(/\bsrc="([^"]+)"/);
        if (m) entry = m[1];
        return "";
      });
      if (!entry) return html;

      const u = JSON.stringify(entry);
      const boot =
        `<script data-cfasync="false">` +
        `(function(){var u=${u};import(u).catch(function(e){` +
        `console.error(e);var r=document.getElementById("root");if(!r)return;` +
        `var p=document.createElement("p");` +
        `p.style.cssText="margin:0;padding:2rem 1rem;font:600 1rem system-ui,sans-serif;color:#fff;text-align:center;max-width:28rem;margin-inline:auto;text-shadow:0 1px 4px rgba(0,0,0,.75)";` +
        `p.textContent="Could not load Camoot (offline or blocked script). With Cloudflare: Speed \\u2192 Optimization \\u2192 Rocket Loader off.";` +
        `r.replaceChildren(p);});})();` +
        `<\/script>`;

      out = out.replace(/<\/body>/i, (m) => boot + "\n" + m);

      return out;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const v = String(env.LOGGING ?? env.VITE_LOGGING ?? "").trim().toLowerCase();
  const camootLog = v === "true" || v === "1" || v === "yes";

  return {
  define: {
    __CAMOOT_LOG__: JSON.stringify(camootLog),
  },
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
};
});
