import { useEffect, useState } from "react";
import { api } from "./api";
import { DesiredModelDetail } from "./DesiredModelDetail";
import { AllModelsPage } from "./pages/AllModelsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { DesiredModelsPage } from "./pages/DesiredModelsPage";
import { ModelDetailPage } from "./pages/ModelDetailPage";
import { RequestsPage } from "./pages/RequestsPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { CatalogCache, DesiredModel, ModelSummary } from "./types";

type Page = "models" | "desired" | "keys" | "requests" | "settings";

const navItems: Array<{ id: Page; label: string }> = [
  { id: "models", label: "All Models" },
  { id: "desired", label: "Desired Models" },
  { id: "keys", label: "API Keys" },
  { id: "requests", label: "Requests" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const [page, setPage] = useState<Page>("models");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [desiredModels, setDesiredModels] = useState<DesiredModel[]>([]);
  const [catalogCache, setCatalogCache] = useState<CatalogCache | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDesired, setSelectedDesired] = useState(false);
  const [status, setStatus] = useState<{ proxy: { running: boolean; host?: string; port?: number }; openrouter: { configured: boolean; lastSuccessfulMetadataRequestAt?: string | null; lastError?: string | null }; catalog?: { modelCount: number; fetchedAt: string | null; stale: boolean }; version?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadModels = async () => {
    try {
      setError(null);
      const [nextModels, nextStatus] = await Promise.all([api.models(), api.status()]);
      const nextDesired = typeof api.desiredModels === "function" ? await api.desiredModels().catch(() => ({ items: [] })) : { items: [] };
      setModels(nextModels.items);
      setCatalogCache(nextModels.cache ?? null);
      setStatus(nextStatus);
      setDesiredModels(Array.isArray(nextDesired) ? nextDesired : Array.isArray(nextDesired?.items) ? nextDesired.items : []);
    } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => { void loadModels(); }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshModels = async () => {
    try {
      setNotice("Refreshing model catalog…");
      await api.refreshModels();
      await loadModels();
      setNotice("Model catalog refreshed.");
    } catch (err) { setError((err as Error).message); }
  };

  const go = (next: Page) => { setSelectedId(null); setSelectedDesired(false); setPage(next); };

  // "configured" only means an upstream key exists — it never implies a verified
  // live connection, so the label must reflect actual metadata sync state.
  let openrouterStatus: { label: string; className: string; detail?: string; title?: string };
  if (!status?.openrouter.configured) openrouterStatus = { label: "API key needed", className: "status warn", title: "Set OPENROUTER_API_KEY to reach OpenRouter." };
  else if (status.openrouter.lastError) openrouterStatus = { label: "Metadata issue", className: "status warn", detail: "last sync failed", title: status.openrouter.lastError };
  else if (status.openrouter.lastSuccessfulMetadataRequestAt) {
    const ageMinutes = Math.floor((Date.now() - Date.parse(status.openrouter.lastSuccessfulMetadataRequestAt)) / 60000);
    openrouterStatus = { label: "Metadata OK", className: "status good", detail: Number.isFinite(ageMinutes) && ageMinutes >= 0 ? `last sync ${ageMinutes === 0 ? "<1m" : `${ageMinutes}m`} ago` : undefined };
  } else openrouterStatus = { label: "Key configured", className: "status good", title: "Upstream key configured; no metadata sync yet." };
  const openModel = (id: string) => { setSelectedId(id); setSelectedDesired(false); setPage("models"); setError(null); };
  const openDesiredModel = (id: string) => { setSelectedId(id); setSelectedDesired(true); setPage("desired"); setError(null); };

  return <div className="shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => go("models")}>OpenRouter <strong>Sift</strong></button>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navItems.map((item) => <button key={item.id} className={page === item.id && !selectedId ? "nav-active" : ""} aria-current={page === item.id && !selectedId ? "page" : undefined} onClick={() => go(item.id)}>{item.label}</button>)}
      </nav>
      <div className="sidebar-status" aria-label="Service status">
        <span className={openrouterStatus.className} title={openrouterStatus.title}>OpenRouter {openrouterStatus.label}{openrouterStatus.detail ? <small> · {openrouterStatus.detail}</small> : null}</span>
        <span className={status?.proxy.running ? "status good" : "status"}>Proxy {status?.proxy.running ? "Running" : "Unknown"}</span>
      </div>
    </aside>
    <main className="content">
      {(notice || error) && <div className={error ? "message error" : "message"} role="status">{error ?? notice}<button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}
      {selectedId ? (
        selectedDesired
          ? <DesiredModelDetail modelId={selectedId} models={models} onBack={() => { setSelectedId(null); setSelectedDesired(false); }} setNotice={setNotice} setError={setError} />
          : <ModelDetailPage modelId={selectedId} desired={desiredModels} onBack={() => setSelectedId(null)} onManageDesired={() => setSelectedDesired(true)} onSaved={() => void loadModels()} setNotice={setNotice} setError={setError} />
      ) : page === "models" ? (
        <AllModelsPage models={models} desired={desiredModels} cache={catalogCache} refreshModels={refreshModels} onOpen={openModel} onDesiredChange={() => void loadModels()} setError={setError} />
      ) : page === "desired" ? (
        <DesiredModelsPage models={models} desired={desiredModels} onChanged={() => void loadModels()} onOpen={openDesiredModel} onBrowse={() => go("models")} setNotice={setNotice} setError={setError} />
      ) : page === "keys" ? (
        <ApiKeysPage desired={desiredModels} setNotice={setNotice} setError={setError} />
      ) : page === "requests" ? (
        <RequestsPage setNotice={setNotice} setError={setError} />
      ) : (
        <SettingsPage onOpenModel={openModel} onKeySaved={() => void loadModels()} setNotice={setNotice} setError={setError} />
      )}
    </main>
  </div>;
}
