import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Endpoint, ModelSummary, PolicyMode, ProviderPolicy, Settings } from "./types";

type Page = "models" | "policies" | "settings" | "requests";

const emptyPolicy: ProviderPolicy = { mode: "inherit", providers: [], providerOrder: [], allowFallbacks: true };

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function perMillion(pricing: unknown, key: "prompt" | "completion"): string {
  if (!pricing || typeof pricing !== "object") return "—";
  const raw = (pricing as Record<string, unknown>)[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${(value * 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} / M`;
}

function policyLabel(mode: PolicyMode): string {
  return { inherit: "Inherit", allowlist: "Allowlist", blocklist: "Blocklist", custom: "Custom" }[mode];
}

function candidateFrom(policy: ProviderPolicy): ProviderPolicy {
  return {
    mode: policy.mode ?? "inherit",
    providers: policy.providers ?? [],
    providerOrder: policy.providerOrder ?? [],
    allowFallbacks: policy.allowFallbacks ?? true,
    policy: policy.policy,
    enabled: policy.enabled,
  };
}

export function App() {
  const [page, setPage] = useState<Page>("models");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ proxy: { running: boolean }; openrouter: { configured: boolean } } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadModels = async (nextQuery = query) => {
    try {
      setError(null);
      const [nextModels, nextStatus] = await Promise.all([api.models(nextQuery), api.status()]);
      setModels(nextModels.items);
      setStatus(nextStatus);
    } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => { void loadModels(""); }, []);

  const refreshModels = async () => {
    try {
      setNotice("Refreshing model catalog…");
      await api.refreshModels();
      await loadModels();
      setNotice("Model catalog refreshed.");
    } catch (err) { setError((err as Error).message); }
  };

  const openModel = (id: string) => { setSelectedId(id); setPage("models"); setError(null); };

  return <main className="shell">
    <header className="topbar">
      <button className="brand" onClick={() => { setSelectedId(null); setPage("models"); }}>OpenRouter <strong>Control</strong></button>
      <nav aria-label="Primary navigation">
        {(["models", "policies", "requests", "settings"] as Page[]).map((item) => <button key={item} className={page === item && !selectedId ? "nav-active" : ""} onClick={() => { setSelectedId(null); setPage(item); }}>{item}</button>)}
      </nav>
      <div className="status-group" aria-label="Service status">
        <span className={status?.proxy.running ? "status good" : "status"}>Proxy {status?.proxy.running ? "Running" : "Unknown"}</span>
        <span className={status?.openrouter.configured ? "status good" : "status warn"}>OpenRouter {status?.openrouter.configured ? "Configured" : "Key needed"}</span>
      </div>
    </header>
    {(notice || error) && <div className={error ? "message error" : "message"}>{error ?? notice}<button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}
    {selectedId ? <ModelDetail modelId={selectedId} onBack={() => setSelectedId(null)} onSaved={() => void loadModels()} setNotice={setNotice} setError={setError} /> : page === "models" ? <ModelsPage models={models} query={query} setQuery={setQuery} loadModels={loadModels} refreshModels={refreshModels} onOpen={openModel} /> : page === "policies" ? <PoliciesPage onOpen={openModel} setNotice={setNotice} setError={setError} /> : page === "settings" ? <SettingsPage setNotice={setNotice} setError={setError} /> : <section className="empty-page"><p className="eyebrow">G5</p><h1>Request history arrives next.</h1><p>Provider control is ready; request metadata stays out of this phase.</p></section>}
  </main>;
}

function ModelsPage({ models, query, setQuery, loadModels, refreshModels, onOpen }: { models: ModelSummary[]; query: string; setQuery: (value: string) => void; loadModels: (query?: string) => Promise<void>; refreshModels: () => Promise<void>; onOpen: (id: string) => void }) {
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">Catalog</p><h1>Models</h1><p>Choose a model, inspect its current endpoints, and control its provider policy.</p></div><button className="button secondary" onClick={() => void refreshModels()}>Refresh models</button></div>
    <form className="search" onSubmit={(event) => { event.preventDefault(); void loadModels(query); }}><input aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model ID, name, or vendor" /><button className="button" type="submit">Search</button></form>
    <div className="model-list">{models.length === 0 ? <EmptyCatalog /> : models.map((model) => <button className="model-row" key={model.id} onClick={() => onOpen(model.id)}><span><strong>{model.name || model.id}</strong><small>{model.id}</small></span><span className="model-meta"><span>{model.contextLength ? `${model.contextLength.toLocaleString()} context` : "Context unavailable"}</span><span className={`policy-tag ${model.policySummary}`}>{policyLabel(model.policySummary)}</span></span></button>)}</div>
  </section>;
}

function EmptyCatalog() { return <div className="empty"><h2>No cached models yet</h2><p>Configure an OpenRouter key outside the UI, then refresh the catalog.</p></div>; }

function ModelDetail({ modelId, onBack, onSaved, setNotice, setError }: { modelId: string; onBack: () => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [model, setModel] = useState<ModelSummary | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [policy, setPolicy] = useState<ProviderPolicy>(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try { setLoading(true); const [detail, endpointResult] = await Promise.all([api.model(modelId), api.endpoints(modelId)]); setModel(detail.model); setPolicy(candidateFrom(detail.policy)); setEndpoints(endpointResult.items); } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [modelId]);
  const refresh = async () => { try { await api.refreshEndpoints(modelId); await load(); setNotice("Provider endpoints refreshed."); } catch (err) { setError((err as Error).message); } };
  const providerOptions = useMemo(() => endpoints.flatMap((endpoint) => endpoint.providerRoutingId ? [{ id: endpoint.providerRoutingId, name: endpoint.providerName ?? endpoint.providerRoutingId }] : []), [endpoints]);
  if (loading) return <section className="page">Loading model details…</section>;
  if (!model) return <section className="page"><button className="back" onClick={onBack}>← Models</button><EmptyCatalog /></section>;
  return <section className="page"><button className="back" onClick={onBack}>← Models</button><div className="page-heading detail-heading"><div><p className="eyebrow">Model control</p><h1>{model.name || model.id}</h1><code>{model.id}</code></div><button className="button secondary" onClick={() => void refresh()}>Refresh endpoints</button></div>
    <div className="stats"><Stat label="Context" value={model.contextLength ? model.contextLength.toLocaleString() : "—"} /><Stat label="Input" value={perMillion(model.pricing, "prompt")} /><Stat label="Output" value={perMillion(model.pricing, "completion")} /></div>
    <section className="panel"><div className="panel-title"><div><h2>Provider endpoints</h2><p>Metrics are OpenRouter data. Missing values stay unavailable.</p></div></div><EndpointTable endpoints={endpoints} /></section>
    <PolicyEditor modelId={modelId} options={providerOptions} policy={policy} setPolicy={setPolicy} onSaved={() => { onSaved(); setNotice("Policy saved. The proxy will use it for the next request."); }} setNotice={setNotice} setError={setError} />
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><small>{label}</small><strong>{value}</strong></div>; }

function EndpointTable({ endpoints }: { endpoints: Endpoint[] }) { return <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Price in</th><th>Price out</th><th>Latency</th><th>Throughput</th><th>Uptime</th><th>Quantization</th></tr></thead><tbody>{endpoints.length === 0 ? <tr><td colSpan={7}>No endpoint data is cached for this model.</td></tr> : endpoints.map((endpoint, index) => <tr key={`${endpoint.providerRoutingId ?? "unknown"}-${index}`}><td><strong>{display(endpoint.providerName)}</strong><small>{endpoint.providerRoutingId ?? "No routing ID"}</small></td><td>{perMillion(endpoint.pricing, "prompt")}</td><td>{perMillion(endpoint.pricing, "completion")}</td><td title={metricTitle(endpoint.performance.latencyLast30m)}>{display(endpoint.performance.latencyLast30m?.p50)} ms</td><td title={metricTitle(endpoint.performance.throughputLast30m)}>{display(endpoint.performance.throughputLast30m?.p50)}</td><td title={`30m: ${display(endpoint.performance.uptimeLast30m)} · 1d: ${display(endpoint.performance.uptimeLast1d)}`}>{display(endpoint.performance.uptimeLast5m)}</td><td>{display(endpoint.quantization)}</td></tr>)}</tbody></table></div>; }
function metricTitle(metric: Endpoint["performance"]["latencyLast30m"]) { return metric ? `P50 ${display(metric.p50)} · P75 ${display(metric.p75)} · P90 ${display(metric.p90)} · P99 ${display(metric.p99)}` : "Unavailable"; }

function PolicyEditor({ modelId, options, policy, setPolicy, onSaved, setNotice, setError }: { modelId: string; options: Array<{ id: string; name: string }>; policy: ProviderPolicy; setPolicy: (value: ProviderPolicy) => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const selected = policy.providers ?? [];
  useEffect(() => {
    if (policy.mode === "allowlist" && selected.length === 0) { setPreview(null); setPreviewError("Allowlist requires at least one provider."); return; }
    let active = true;
    void api.preview(modelId, policy).then((result) => { if (active) { setPreview(result.openRouterProviderPayload); setPreviewError(null); } }).catch((err: Error) => { if (active) { setPreview(null); setPreviewError(err.message); } });
    return () => { active = false; };
  }, [modelId, policy.mode, JSON.stringify(policy)]);
  const changeMode = (mode: PolicyMode) => setPolicy({ ...policy, mode, providers: mode === "inherit" ? [] : selected, providerOrder: mode === "inherit" ? [] : policy.providerOrder });
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((provider) => provider !== id) : [...selected, id];
    setPolicy({ ...policy, providers: next, providerOrder: (policy.providerOrder ?? []).filter((provider) => next.includes(provider)).concat(next.filter((provider) => !(policy.providerOrder ?? []).includes(provider))) });
  };
  const move = (id: string, direction: -1 | 1) => {
    const order = [...(policy.providerOrder ?? selected)]; const index = order.indexOf(id); const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setPolicy({ ...policy, providerOrder: order });
  };
  const save = async () => { if (policy.mode === "allowlist" && selected.length === 0) { setError("Allowlist requires at least one provider."); return; } try { await api.savePolicy(modelId, policy); onSaved(); } catch (err) { setError((err as Error).message); } };
  const reset = async () => { try { await api.deletePolicy(modelId); setPolicy(emptyPolicy); setNotice("Model policy reset to inherit."); } catch (err) { setError((err as Error).message); } };
  return <section className="panel policy-editor"><div className="panel-title"><div><h2>Provider policy</h2><p>Policy preview is compiled by the server, using the same resolver as proxy requests.</p></div><button className="text-button" onClick={() => void reset()}>Reset to inherit</button></div>
    <fieldset className="mode-select"><legend>Policy mode</legend>{(["inherit", "allowlist", "blocklist"] as PolicyMode[]).map((mode) => <label key={mode}><input type="radio" checked={policy.mode === mode} onChange={() => changeMode(mode)} />{mode === "inherit" ? "Inherit global policy" : policyLabel(mode)}</label>)}</fieldset>
    {policy.mode !== "inherit" && <div className="provider-picker"><h3>{policy.mode === "allowlist" ? "Allowed providers" : "Blocked providers"}</h3>{options.length === 0 ? <p className="muted">Refresh endpoints to select verified provider routing IDs.</p> : options.map((option) => <label className="provider-choice" key={option.id}><input aria-label={option.name} type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /><span>{option.name}<small>{option.id}</small></span></label>)}</div>}
    {policy.mode === "allowlist" && selected.length > 0 && <><div className="order"><h3>Provider order</h3>{(policy.providerOrder ?? selected).map((id, index, list) => <div key={id}><span>{index + 1}. {options.find((option) => option.id === id)?.name ?? id}</span><span><button aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(id, -1)}>↑</button><button aria-label={`Move ${id} down`} disabled={index === list.length - 1} onClick={() => move(id, 1)}>↓</button></span></div>)}</div><label className="switch"><input type="checkbox" checked={policy.allowFallbacks ?? true} onChange={(event) => setPolicy({ ...policy, allowFallbacks: event.target.checked })} />Allow fallback outside allowlist</label></>}
    <div className="preview"><div><h3>Policy preview</h3><small>{previewError ?? "OpenRouter provider payload"}</small></div><pre>{preview ? JSON.stringify({ provider: preview }, null, 2) : "Waiting for a valid policy…"}</pre></div><div className="actions"><button className="button" onClick={() => void save()}>Save policy</button></div>
  </section>;
}

function PoliciesPage({ onOpen, setNotice, setError }: { onOpen: (id: string) => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [items, setItems] = useState<Array<ProviderPolicy & { modelId: string }>>([]);
  const load = async () => { try { setItems((await api.policies()).items); } catch (err) { setError((err as Error).message); } };
  useEffect(() => { void load(); }, []);
  const reset = async (id: string) => { try { await api.deletePolicy(id); await load(); setNotice("Model policy reset to inherit."); } catch (err) { setError((err as Error).message); } };
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">Rules</p><h1>Policies</h1><p>Only persisted, model-specific policies appear here.</p></div></div><div className="panel table-wrap"><table><thead><tr><th>Model</th><th>Policy</th><th>Providers</th><th /></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={4}>No model-specific policies yet.</td></tr> : items.map((item) => <tr key={item.modelId}><td><strong>{item.modelId}</strong></td><td><span className={`policy-tag ${item.mode}`}>{policyLabel(item.mode)}</span></td><td>{item.providers?.join(", ") || "—"}</td><td className="table-actions"><button onClick={() => onOpen(item.modelId)}>Edit</button><button onClick={() => void reset(item.modelId)}>Reset</button></td></tr>)}</tbody></table></div></section>;
}

function SettingsPage({ setNotice, setError }: { setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [globalPolicyText, setGlobalPolicyText] = useState("{}");
  useEffect(() => { void api.settings().then((value) => { setSettings(value); setGlobalPolicyText(JSON.stringify(value.globalPolicy, null, 2)); }).catch((err: Error) => setError(err.message)); }, []);
  const save = async () => { if (!settings) return; try { const globalPolicy = JSON.parse(globalPolicyText) as Record<string, unknown>; const saved = await api.saveSettings({ mergeMode: settings.mergeMode, metadataTtlMs: settings.metadataTtlMs, globalPolicy }); setSettings(saved); setGlobalPolicyText(JSON.stringify(saved.globalPolicy, null, 2)); setNotice("Settings saved."); } catch (err) { setError((err as Error).message || "Global policy must be valid JSON."); } };
  if (!settings) return <section className="page">Loading settings…</section>;
  return <section className="page settings"><div className="page-heading"><div><p className="eyebrow">Local control plane</p><h1>Settings</h1><p>Values here persist locally and apply to the same policy resolver as proxy traffic.</p></div></div><section className="panel"><h2>OpenRouter API key</h2><p>{settings.openRouterApiKeyConfigured ? `Configured externally (${settings.openRouterApiKeyMasked}).` : "Not configured. Set OPENROUTER_API_KEY or use the startup option."}</p><small>For safety, this UI does not accept or store API keys.</small></section><section className="panel form-grid"><label>Merge mode<select value={settings.mergeMode} onChange={(event) => setSettings({ ...settings, mergeMode: event.target.value as Settings["mergeMode"] })}><option value="merge">Merge</option><option value="override">Override</option><option value="strict">Strict</option></select></label><label>Metadata cache TTL (ms)<input type="number" min="1000" value={settings.metadataTtlMs} onChange={(event) => setSettings({ ...settings, metadataTtlMs: Number(event.target.value) })} /></label><label className="full">Global provider policy <textarea value={globalPolicyText} onChange={(event) => setGlobalPolicyText(event.target.value)} spellCheck="false" /></label><div className="full actions"><button className="button" onClick={() => void save()}>Save settings</button></div></section></section>;
}
