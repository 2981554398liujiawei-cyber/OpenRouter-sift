import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function startLauncherLease(): void {
  let token: string | null = null;
  try {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const launchToken = fragment.get("launch");
    if (launchToken) {
      sessionStorage.setItem("openrouter-sift.launch-token", launchToken);
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    token = sessionStorage.getItem("openrouter-sift.launch-token");
  } catch { return; }
  if (!token) return;
  let clientId: string;
  try {
    clientId = sessionStorage.getItem("openrouter-sift.launch-client") ?? crypto.randomUUID();
    sessionStorage.setItem("openrouter-sift.launch-client", clientId);
  } catch { return; }
  const lease = (action: "acquire" | "heartbeat" | "release") => {
    const body = JSON.stringify({ token, clientId, action });
    if (action === "release" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/launcher/lease", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/launcher/lease", { method: "POST", headers: { "content-type": "application/json" }, body }).then((response) => {
      if (!response.ok && action !== "release") sessionStorage.removeItem("openrouter-sift.launch-token");
    }).catch(() => undefined);
  };
  lease("acquire");
  const timer = window.setInterval(() => lease("heartbeat"), 5_000);
  window.addEventListener("pagehide", () => { window.clearInterval(timer); lease("release"); }, { once: true });
}

startLauncherLease();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
