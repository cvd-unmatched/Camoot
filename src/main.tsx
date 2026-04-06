import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";
import { camootLog } from "./log";

camootLog("boot", "main.tsx", { href: typeof window !== "undefined" ? window.location.href : "" });

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
} catch (err) {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  const p = document.createElement("p");
  p.style.cssText =
    "margin:0;padding:2rem 1.25rem;font:600 0.95rem system-ui,sans-serif;color:#ffc9c9;text-align:center;max-width:28rem;margin-inline:auto";
  p.textContent = `Camoot failed to start: ${msg}`;
  rootEl.replaceChildren(p);
}
