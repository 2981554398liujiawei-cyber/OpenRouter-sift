import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components";
import type { ProviderPolicy, Settings } from "../types";

const mergeModeCopy: Record<Settings["mergeMode"], { label: string; hint: string }> = {
  merge: { label: "Merge", hint: "Keep client routing options unless local policy defines them." },
  override: { label: "Override", hint: "Local routing policy takes precedence over client options." },
  strict: { label: "Strict", hint: "Reject conflicting client routing options." },
};

export function SettingsPage({ onOpenModel, onKeySaved, setNotice, setError }: { onOpenModel: (id: string) => void; onKeySaved?: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
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
    <OpenRouterKeyPanel status={settings.openRouterApiKey} onKeySaved={() => { void api.settings().then((value) => setSettings(value)).catch(() => undefined); onKeySaved?.(); }} setNotice={setNotice} setError={setError} />
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

const sourceLabels: Record<string, string> = { "ui-session": "This session only (not persisted)", "secure-store": "Securely stored on this device", environment: "Environment variable", none: "Not configured" };

interface KeyFormState { value: string; remember: boolean; busy: boolean; pendingUnverified: boolean; pendingSessionOnly: boolean; message: string | null; }

function OpenRouterKeyPanel({ status, onKeySaved, setNotice, setError }: { status: Settings["openRouterApiKey"]; onKeySaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [form, setForm] = useState<KeyFormState>({ value: "", remember: status.secureStoreAvailable, busy: false, pendingUnverified: false, pendingSessionOnly: false, message: null });
  const [replacing, setReplacing] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [metaSuccess, setMetaSuccess] = useState<string | null>(null);
  useEffect(() => {
    void api.status().then((value) => {
      const at = value.openrouter.lastSuccessfulMetadataRequestAt;
      if (!at) return setMetaSuccess(null);
      const age = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
      setMetaSuccess(age <= 0 ? "just now" : `${age}m ago`);
    }).catch(() => setMetaSuccess(null));
  }, [status.configured, status.masked]);
  const resetForm = () => setForm({ value: "", remember: status.secureStoreAvailable, busy: false, pendingUnverified: false, pendingSessionOnly: false, message: null });
  const save = async (verify: boolean, rememberOverride?: boolean) => {
    const key = form.value.trim();
    if (!key) { setForm((current) => ({ ...current, message: "Paste your OpenRouter API key first." })); return; }
    setForm((current) => ({ ...current, busy: true, message: null }));
    try {
      await api.setOpenRouterKey(key, rememberOverride ?? form.remember, verify);
      resetForm();
      setReplacing(false);
      setNotice("OpenRouter API key saved.");
      onKeySaved();
    } catch (err) {
      const raw = (err as Error).message || "";
      if (raw.includes("rejected this API key")) setError("OpenRouter rejected this API key.");
      else if (raw.includes("unreachable")) setForm((current) => ({ ...current, busy: false, pendingUnverified: true, message: "Could not verify the key because OpenRouter is unreachable." }));
      else if (raw.includes("remember the key securely")) setForm((current) => ({ ...current, busy: false, pendingSessionOnly: true, message: raw }));
      else setError(raw);
      if (raw.includes("rejected") || raw === "") setForm((current) => ({ ...current, busy: false, value: "" }));
    }
  };
  const forget = async () => {
    try {
      await api.forgetOpenRouterKey();
      setConfirmForget(false);
      resetForm();
      setReplacing(false);
      setNotice("OpenRouter API key removed.");
      onKeySaved();
    } catch (err) { setError((err as Error).message); }
  };
  const showForm = !status.configured || replacing;
  return <section className="panel"><h2>OpenRouter</h2>
    {!status.configured ? <p>Connect OpenRouter to enable inference and provider metadata.</p> : <div className="form-grid">
      <label>API Key<input aria-label="Configured OpenRouter API key" value={status.masked ?? "••••"} readOnly /></label>
      <label>Stored<input aria-label="OpenRouter key storage" value={sourceLabels[status.source] ?? status.source} readOnly /></label>
      <label>Last metadata success<input aria-label="Last metadata success" value={metaSuccess ?? "never"} readOnly /></label>
    </div>}
    {showForm && <div className="form-grid">
      <label>API Key<input aria-label="OpenRouter API key" type="password" autoComplete="off" placeholder="sk-or-…" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} /></label>
      <label className="catalog-checkbox"><input type="checkbox" checked={form.remember} disabled={!status.secureStoreAvailable} onChange={(event) => setForm((current) => ({ ...current, remember: event.target.checked }))} />Remember on this device{!status.secureStoreAvailable ? <small> (secure storage unavailable; session-only)</small> : null}</label>
      {form.message && <p className="muted" role="status">{form.message}</p>}
      <div className="actions">
        <button className="button" disabled={form.busy} onClick={() => void save(true)}>{form.busy ? "Saving…" : "Save Key"}</button>
        {replacing && <button className="button secondary" onClick={() => { resetForm(); setReplacing(false); }}>Cancel</button>}
        {form.pendingUnverified && <button className="button secondary" disabled={form.busy} onClick={() => void save(false)}>Save without verification</button>}
        {form.pendingSessionOnly && <button className="button secondary" disabled={form.busy} onClick={() => void save(true, false)}>Use for this session</button>}
      </div>
    </div>}
    {status.configured && !replacing && <div className="actions">
      <button className="button secondary" onClick={() => { setReplacing(true); setConfirmForget(false); }}>Replace Key</button>
      <button className="text-button danger-text" onClick={() => setConfirmForget((current) => !current)}>{confirmForget ? "Confirm forget" : "Forget Key"}</button>
    </div>}
    {confirmForget && <p className="muted" role="status">Remove the OpenRouter API key saved by Sift?{status.source === "secure-store" ? " Sift will fall back to OPENROUTER_API_KEY from the environment if it is set." : ""} <button className="button secondary" onClick={() => void forget()}>Remove key</button></p>}
    <small>The key is sent to this local server only and is never returned in full. "Remember" uses the {status.secureStoreLabel}.</small>
  </section>;
}
