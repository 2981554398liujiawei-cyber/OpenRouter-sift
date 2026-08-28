import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components";
import type { ProviderPolicy, Settings } from "../types";

const mergeModeCopy: Record<Settings["mergeMode"], { label: string; hint: string }> = {
  merge: { label: "Merge", hint: "Keep client routing options unless local policy defines them." },
  override: { label: "Override", hint: "Local routing policy takes precedence over client options." },
  strict: { label: "Strict", hint: "Reject conflicting client routing options." },
};

export function SettingsPage({ onOpenModel, setNotice, setError }: { onOpenModel: (id: string) => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [globalPolicyText, setGlobalPolicyText] = useState("{}");
  const [catalogTtlSeconds, setCatalogTtlSeconds] = useState(300);
  const [refreshSeconds, setRefreshSeconds] = useState(300);
  const [policies, setPolicies] = useState<Array<ProviderPolicy & { modelId: string }>>([]);
  useEffect(() => {
    void api.settings().then((value) => {
      setSettings(value);
      setCatalogTtlSeconds(Math.max(1, Math.round((value.metadataTtlMs ?? 300000) / 1000)));
      setRefreshSeconds(Math.max(1, Math.round((value.desiredEndpointRefreshIntervalMs ?? 300000) / 1000)));
      setGlobalPolicyText(JSON.stringify(value.globalPolicy, null, 2));
    }).catch((err: Error) => setError(err.message));
    void api.policies().then((result) => setPolicies(result.items)).catch(() => setPolicies([]));
  }, []);
  const save = async () => {
    if (!settings) return;
    try {
      const globalPolicy = JSON.parse(globalPolicyText) as Record<string, unknown>;
      const saved = await api.saveSettings({ mergeMode: settings.mergeMode, metadataTtlMs: catalogTtlSeconds * 1000, desiredEndpointRefreshIntervalMs: refreshSeconds * 1000, requestLogLimit: settings.requestLogLimit ?? 1000, globalPolicy });
      setSettings(saved);
      setGlobalPolicyText(JSON.stringify(saved.globalPolicy, null, 2));
      setNotice("Settings saved.");
    } catch (err) { setError((err as Error).message || "Global policy must be valid JSON."); }
  };
  const resetPolicy = async (id: string) => { try { await api.deletePolicy(id); setPolicies((await api.policies()).items); setNotice("Model policy reset to inherit."); } catch (err) { setError((err as Error).message); } };
  if (!settings) return <section className="page"><p className="muted">Loading settings…</p></section>;
  return <section className="page"><PageHeader eyebrow="System" title="Settings" description="System-level configuration for the local control plane." actions={<button className="button" onClick={() => void save()}>Save Changes</button>} />
    <section className="panel"><h2>OpenRouter</h2><p>{settings.openRouterApiKeyConfigured ? `Configured (${settings.openRouterApiKeyMasked ?? "key set"}).` : "Not configured. Set OPENROUTER_API_KEY or use the startup option."}</p><small>For safety, the upstream API key is configured outside this UI and never stored here.</small></section>
    <section className="panel"><h2>Metadata</h2><p>How long cached OpenRouter metadata stays fresh.</p><div className="form-grid">
      <label>Models catalog TTL (seconds)<input aria-label="Models catalog TTL" type="number" min="1" value={catalogTtlSeconds} onChange={(event) => setCatalogTtlSeconds(Number(event.target.value))} /><small>{humanDuration(catalogTtlSeconds)}</small></label>
      <label>Desired provider refresh interval (seconds)<input aria-label="Desired provider refresh interval" type="number" min="1" value={refreshSeconds} onChange={(event) => setRefreshSeconds(Number(event.target.value))} /><small>{humanDuration(refreshSeconds)}</small></label>
    </div></section>
    <section className="panel"><h2>Routing</h2><p>How client routing options are combined with your local policy.</p>
      <fieldset className="mode-select mode-cards"><legend>Merge mode</legend>{(["merge", "override", "strict"] as Settings["mergeMode"][]).map((mode) => <label key={mode} className="mode-card"><input type="radio" name="merge-mode" checked={settings.mergeMode === mode} onChange={() => setSettings({ ...settings, mergeMode: mode })} /><span><strong>{mergeModeCopy[mode].label}</strong><small>{mergeModeCopy[mode].hint}</small></span></label>)}</fieldset>
      <div className="advanced-block"><h3>Advanced</h3><label className="full">Global provider policy <textarea value={globalPolicyText} onChange={(event) => setGlobalPolicyText(event.target.value)} spellCheck="false" /></label></div>
      <h3>Model policies</h3>{policies.length === 0 ? <p className="muted">No model-specific policies. Set one from a model's Providers tab.</p> : <div className="table-wrap"><table><thead><tr><th>Model</th><th>Policy</th><th>Providers</th><th /></tr></thead><tbody>{policies.map((item) => <tr key={item.modelId}><td><strong>{item.modelId}</strong></td><td>{item.mode}</td><td>{item.providers?.join(", ") || "—"}</td><td className="table-actions"><button onClick={() => onOpenModel(item.modelId)}>Edit</button><button onClick={() => void resetPolicy(item.modelId)}>Reset</button></td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel"><h2>Observability</h2><div className="form-grid"><label>Request history limit<input aria-label="Request history limit" type="number" min="100" max="10000" value={settings.requestLogLimit ?? 1000} onChange={(event) => setSettings({ ...settings, requestLogLimit: Number(event.target.value) })} /><small>Request metadata retained locally (100–10,000 requests).</small></label></div><p className="privacy-inline">Request logs contain metadata only. Prompts and responses are not stored.</p></section>
  </section>;
}

function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}
