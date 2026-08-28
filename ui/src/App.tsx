import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { DesiredModelDetail } from "./DesiredModelDetail";
import { AccessKeyRouting } from "./AccessKeyRouting";
import { AllModelsPage } from "./AllModelsPage";
import type { AccessKey, AccessKeySecret, CatalogCache, DesiredModel, Endpoint, ModelSummary, PolicyMode, ProviderPolicy, RequestListItem, RequestRecord, Settings } from "./types";

type Page = "models" | "desired" | "keys" | "policies" | "settings" | "requests";

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
  const [desiredModels, setDesiredModels] = useState<DesiredModel[]>([]);
  const [catalogCache, setCatalogCache] = useState<CatalogCache | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDesired, setSelectedDesired] = useState(false);
  const [status, setStatus] = useState<{ proxy: { running: boolean }; openrouter: { configured: boolean } } | null>(null);
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
      <button className="brand" onClick={() => { setSelectedId(null); setSelectedDesired(false); setPage("models"); }}>OpenRouter <strong>Control</strong></button>
      <nav aria-label="Primary navigation">
        {(["models", "desired", "keys", "policies", "requests", "settings"] as Page[]).map((item) => <button key={item} className={page === item && !selectedId ? "nav-active" : ""} onClick={() => { setSelectedId(null); setSelectedDesired(false); setPage(item); }}>{item === "keys" ? "API Keys" : item === "desired" ? "Desired Models" : item}</button>)}
      </nav>
      <div className="status-group" aria-label="Service status">
        <span className={status?.proxy.running ? "status good" : "status"}>Proxy {status?.proxy.running ? "Running" : "Unknown"}</span>
        <span className={status?.openrouter.configured ? "status good" : "status warn"}>OpenRouter {status?.openrouter.configured ? "Configured" : "Key needed"}</span>
      </div>
    </header>
    {(notice || error) && <div className={error ? "message error" : "message"}>{error ?? notice}<button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>×</button></div>}
    {selectedId ? selectedDesired ? <DesiredModelDetail modelId={selectedId} models={models} onBack={() => { setSelectedId(null); setSelectedDesired(false); }} setNotice={setNotice} setError={setError} /> : <ModelDetail modelId={selectedId} onBack={() => setSelectedId(null)} onSaved={() => void loadModels()} setNotice={setNotice} setError={setError} /> : page === "models" ? <AllModelsPage models={models} desired={desiredModels} cache={catalogCache} refreshModels={refreshModels} onOpen={openModel} onDesiredChange={() => void loadModels()} setError={setError} /> : page === "desired" ? <DesiredModelsPage models={models} desired={desiredModels} onChanged={() => void loadModels()} onOpen={(id) => { setSelectedId(id); setSelectedDesired(true); }} setNotice={setNotice} setError={setError} /> : page === "keys" ? <AccessKeysPage desired={desiredModels} setNotice={setNotice} setError={setError} /> : page === "policies" ? <PoliciesPage onOpen={openModel} setNotice={setNotice} setError={setError} /> : page === "settings" ? <SettingsPage setNotice={setNotice} setError={setError} /> : <RequestsPage setNotice={setNotice} setError={setError} />}
  </main>;
}

function ModelsPage({ models, desired, query, setQuery, loadModels, refreshModels, onOpen, onDesiredChange, setError }: { models: ModelSummary[]; desired: DesiredModel[]; query: string; setQuery: (value: string) => void; loadModels: (query?: string) => Promise<void>; refreshModels: () => Promise<void>; onOpen: (id: string) => void; onDesiredChange: () => void; setError: (value: string) => void }) {
  const desiredIds = new Set(desired.map((item) => item.modelId));
  const toggleDesired = async (id: string) => { try { if (desiredIds.has(id)) await api.removeDesiredModel(id); else await api.addDesiredModel(id); onDesiredChange(); } catch (err) { setError((err as Error).message); } };
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">Catalog</p><h1>All Models</h1><p>Choose a model for your local Desired Models pool, then inspect its endpoints and policy.</p></div><button className="button secondary" onClick={() => void refreshModels()}>Refresh models</button></div>
    <form className="search" onSubmit={(event) => { event.preventDefault(); void loadModels(query); }}><input aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model ID, name, or vendor" /><button className="button" type="submit">Search</button></form>
    <div className="model-list">{models.length === 0 ? <EmptyCatalog /> : models.map((model) => <div className="model-row" key={model.id}><button className="model-link" onClick={() => onOpen(model.id)}><strong>{model.name || model.id}</strong><small>{model.id}</small></button><span className="model-meta"><span>{model.contextLength ? `${model.contextLength.toLocaleString()} context` : "Context unavailable"}</span><span className={`policy-tag ${model.policySummary}`}>{policyLabel(model.policySummary)}</span><button className={desiredIds.has(model.id) ? "desired-button selected" : "desired-button"} onClick={() => void toggleDesired(model.id)}>{desiredIds.has(model.id) ? "✓ Desired" : "Add to Desired"}</button></span></div>)}</div>
  </section>;
}

function EmptyCatalog() { return <div className="empty"><h2>No cached models yet</h2><p>Configure an OpenRouter key outside the UI, then refresh the catalog.</p></div>; }

function DesiredModelsPage({ models, desired, onChanged, onOpen, setNotice, setError }: { models: ModelSummary[]; desired: DesiredModel[]; onChanged: () => void; onOpen: (id: string) => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const names = new Map(models.map((model) => [model.id, model.name || model.id]));
  const remove = async (id: string) => { try { await api.removeDesiredModel(id); onChanged(); setNotice("Model removed from Desired Models."); } catch (err) { setError((err as Error).message); } };
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">Access boundary</p><h1>Desired Models</h1><p>Only models in this pool can be assigned to managed Local Access Keys.</p></div></div><div className="panel table-wrap"><table><thead><tr><th>Model</th><th>Enabled</th><th>Assigned APIs</th><th /></tr></thead><tbody>{desired.length === 0 ? <tr><td colSpan={4}>No Desired Models yet. Add one from All Models.</td></tr> : desired.map((item) => <tr key={item.modelId}><td><button className="model-link" onClick={() => onOpen(item.modelId)}><strong>{names.get(item.modelId) ?? item.modelId}</strong><small>{item.modelId}</small></button></td><td>{item.enabled === false ? "Disabled" : "Enabled"}</td><td>{typeof item.assignedApiCount === "number" ? item.assignedApiCount : Array.isArray(item.assignedApis) ? item.assignedApis.length : typeof item.assignedApis === "number" ? item.assignedApis : 0}</td><td className="table-actions"><button onClick={() => void remove(item.modelId)}>Remove</button></td></tr>)}</tbody></table></div></section>;
}

function AccessKeysPage({ desired, setNotice, setError }: { desired: DesiredModel[]; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [keys, setKeys] = useState<AccessKey[]>([]); const [editing, setEditing] = useState<AccessKey | null>(null); const [routingKey, setRoutingKey] = useState<AccessKey | null>(null); const [showForm, setShowForm] = useState(false); const [secret, setSecret] = useState<AccessKeySecret | null>(null);
  const load = async () => { try { const result = await api.accessKeys(); setKeys(Array.isArray(result) ? result : result.items); } catch (err) { setError((err as Error).message); } };
  useEffect(() => { void load(); }, []);
  const save = async (name: string, allowedModels: string[], enabled: boolean) => { try { if (editing) await api.updateAccessKey(editing.id, { name, allowedModels, enabled }); else setSecret(await api.createAccessKey({ name, allowedModels })); setShowForm(false); setEditing(null); await load(); setNotice(editing ? "Local Access Key updated." : "Local Access Key created."); } catch (err) { setError((err as Error).message); } };
  const toggle = async (item: AccessKey) => { try { await api.updateAccessKey(item.id, { enabled: !item.enabled }); await load(); } catch (err) { setError((err as Error).message); } };
  const remove = async (item: AccessKey) => { if (!window.confirm(`Delete Local Access Key “${item.name}”?`)) return; try { await api.deleteAccessKey(item.id); await load(); setNotice("Local Access Key deleted."); } catch (err) { setError((err as Error).message); } };
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">Managed gateway</p><h1>API Keys</h1><p>These are Local Access Keys for <code>/v1/*</code>. They are separate from the Upstream OpenRouter API Key.</p></div><button className="button" onClick={() => { setEditing(null); setShowForm(true); }}>Create</button></div><div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Key</th><th>Status</th><th>Models</th><th>Last used</th><th /></tr></thead><tbody>{keys.length === 0 ? <tr><td colSpan={6}>No Local Access Keys yet.</td></tr> : keys.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td><code>{item.keyPrefix}••••{item.keyLast4}</code></td><td>{item.enabled ? "Enabled" : "Disabled"}</td><td>{item.allowedModels.length} {item.allowedModels.length === 1 ? "model" : "models"}</td><td>{item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : "Never"}</td><td className="table-actions"><button onClick={() => setRoutingKey(item)}>Routing</button><button onClick={() => { setEditing(item); setShowForm(true); }}>Edit</button><button onClick={() => void toggle(item)}>{item.enabled ? "Disable" : "Enable"}</button><button onClick={() => void remove(item)}>Delete</button></td></tr>)}</tbody></table></div>{showForm && <AccessKeyForm initial={editing} desired={desired} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}{secret && <SecretModal value={secret} onClose={() => setSecret(null)} />}{routingKey && <AccessKeyRouting keyId={routingKey.id} allowedModels={routingKey.allowedModels} onClose={() => setRoutingKey(null)} onSaved={() => void load()} setNotice={setNotice} setError={setError} />}</section>;
}

function AccessKeyForm({ initial, desired, onCancel, onSave }: { initial: AccessKey | null; desired: DesiredModel[]; onCancel: () => void; onSave: (name: string, models: string[], enabled: boolean) => void }) {
  const [name, setName] = useState(initial?.name ?? ""); const [selected, setSelected] = useState(initial?.allowedModels ?? []);
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  return <div className="modal-backdrop"><section className="modal panel" role="dialog" aria-label={initial ? "Edit Local Access Key" : "Create Local Access Key"}><div className="panel-title"><div><h2>{initial ? "Edit Local Access Key" : "Create Local Access Key"}</h2><p>Allowed Models must be selected from Desired Models.</p></div><button className="text-button" onClick={onCancel}>Close</button></div><label className="modal-field">Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Codex" /></label><fieldset className="model-checks"><legend>Allowed Models</legend>{desired.length === 0 ? <p className="muted">Add Desired Models before assigning this key.</p> : desired.map((item) => <label key={item.modelId}><input type="checkbox" checked={selected.includes(item.modelId)} onChange={() => toggle(item.modelId)} />{item.modelId}</label>)}</fieldset><div className="actions"><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button" disabled={!name.trim() || selected.length === 0} onClick={() => onSave(name.trim(), selected, initial?.enabled ?? true)}>{initial ? "Save" : "Create key"}</button></div></section></div>;
}

function SecretModal({ value, onClose }: { value: AccessKeySecret; onClose: () => void }) {
  const [copied, setCopied] = useState(false); const copy = async () => { await navigator.clipboard?.writeText(value.secret); setCopied(true); };
  return <div className="modal-backdrop"><section className="modal panel secret-modal" role="dialog" aria-label="Your Access Key"><h2>Your Access Key</h2><p>Copy this now. It will not be shown again.</p><code className="secret-value">{value.secret}</code><div className="actions"><button className="button secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button><button className="button" onClick={onClose}>Done</button></div></section></div>;
}

function ModelDetail({ modelId, onBack, onSaved, setNotice, setError }: { modelId: string; onBack: () => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [model, setModel] = useState<ModelSummary | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [policy, setPolicy] = useState<ProviderPolicy>(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try { setLoading(true); const [detail, endpointResult] = await Promise.all([api.model(modelId), api.endpoints(modelId)]); setModel(detail.model); setPolicy(candidateFrom(detail.policy)); setEndpoints(endpointResult.items); setProvidersLoaded(true); } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [modelId]);
  const loadProviders = async (refresh = false) => { try { const result = refresh ? (await api.refreshEndpoints(modelId), await api.endpoints(modelId)) : await api.endpoints(modelId); setEndpoints(result.items); setProvidersLoaded(true); if (refresh) setNotice("Provider endpoints refreshed."); } catch (err) { setError((err as Error).message); } };
  const providerOptions = useMemo(() => endpoints.flatMap((endpoint) => endpoint.providerRoutingId ? [{ id: endpoint.providerRoutingId, name: endpoint.providerName ?? endpoint.providerRoutingId }] : []), [endpoints]);
  if (loading) return <section className="page">Loading model details…</section>;
  if (!model) return <section className="page"><button className="back" onClick={onBack}>← Models</button><EmptyCatalog /></section>;
  return <section className="page"><button className="back" onClick={onBack}>← Models</button><div className="page-heading detail-heading"><div><p className="eyebrow">Model control</p><h1>{model.name || model.id}</h1><code>{model.creator ?? "Unknown creator"} · {model.id}</code></div>{providersLoaded && <button className="button secondary" onClick={() => void loadProviders(true)}>Refresh providers</button>}</div>
    <div className="stats"><Stat label="Context" value={model.contextLength ? model.contextLength.toLocaleString() : "—"} /><Stat label="Input" value={perMillion(model.pricing, "prompt")} /><Stat label="Output" value={perMillion(model.pricing, "completion")} /></div>
    <section className="panel"><div className="panel-title"><div><h2>Capabilities</h2><p>{model.description || "Model metadata from the local OpenRouter catalog."}</p></div></div><div className="catalog-badges">{(model.inputModalities ?? []).map((item) => <i key={item}>Input: {item}</i>)}{(model.outputModalities ?? []).map((item) => <i key={item}>Output: {item}</i>)}{(model.supportedParameters ?? []).map((item) => <i key={item}>{item}</i>)}</div></section>
    <section className="panel"><div className="panel-title"><div><h2>Provider endpoints</h2><p>Provider pricing and live telemetry load only when requested.</p></div>{!providersLoaded && <button className="button secondary" onClick={() => void loadProviders()}>Load provider details</button>}</div>{providersLoaded ? <EndpointTable endpoints={endpoints} /> : <p className="muted">No provider endpoint data has been loaded for this view.</p>}</section>
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
  const save = async () => { if (!settings) return; try { const globalPolicy = JSON.parse(globalPolicyText) as Record<string, unknown>; const saved = await api.saveSettings({ mergeMode: settings.mergeMode, metadataTtlMs: settings.metadataTtlMs, requestLogLimit: settings.requestLogLimit, globalPolicy }); setSettings(saved); setGlobalPolicyText(JSON.stringify(saved.globalPolicy, null, 2)); setNotice("Settings saved."); } catch (err) { setError((err as Error).message || "Global policy must be valid JSON."); } };
  if (!settings) return <section className="page">Loading settings…</section>;
  return <section className="page settings"><div className="page-heading"><div><p className="eyebrow">Local control plane</p><h1>Settings</h1><p>Values here persist locally and apply to the same policy resolver as proxy traffic.</p></div></div><section className="panel"><h2>OpenRouter API key</h2><p>{settings.openRouterApiKeyConfigured ? `Configured externally (${settings.openRouterApiKeyMasked}).` : "Not configured. Set OPENROUTER_API_KEY or use the startup option."}</p><small>For safety, this UI does not accept or store API keys.</small></section><section className="panel form-grid"><label>Merge mode<select value={settings.mergeMode} onChange={(event) => setSettings({ ...settings, mergeMode: event.target.value as Settings["mergeMode"] })}><option value="merge">Merge</option><option value="override">Override</option><option value="strict">Strict</option></select></label><label>Metadata cache TTL (ms)<input type="number" min="1000" value={settings.metadataTtlMs} onChange={(event) => setSettings({ ...settings, metadataTtlMs: Number(event.target.value) })} /></label><label>Request history limit <input type="number" min="100" max="10000" value={settings.requestLogLimit ?? 1000} onChange={(event) => setSettings({ ...settings, requestLogLimit: Number(event.target.value) })} /><small>Request metadata retained locally (100–10,000 requests).</small></label><label className="full">Global provider policy <textarea value={globalPolicyText} onChange={(event) => setGlobalPolicyText(event.target.value)} spellCheck="false" /></label><div className="full actions"><button className="button" onClick={() => void save()}>Save settings</button></div></section><section className="panel privacy-note"><h2>Privacy</h2><p>Request logging stores metadata only. Prompt and response content are never persisted.</p></section></section>;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTokens(input: number | null | undefined, output: number | null | undefined): string {
  if (input === null || input === undefined || output === null || output === undefined) return "—";
  const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(value);
  return `${compact(input)} → ${compact(output)}`;
}

function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.000001) return "<$0.000001";
  return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function requestStatus(value: RequestListItem["status"], cancelled?: boolean | null): { label: string; className: string } {
  if (cancelled) return { label: "Cancelled", className: "cancelled" };
  const code = Number(value);
  if (Number.isFinite(code) && code >= 200 && code < 400) return { label: `✓ ${code}`, className: "success" };
  if (Number.isFinite(code)) return { label: `× ${code}`, className: "failure" };
  return { label: display(value), className: "unknown" };
}

function protocolLabel(protocol: string): string { return ({ anthropic_messages: "Anthropic Messages", chat_completions: "Chat Completions", responses: "Responses" } as Record<string, string>)[protocol] ?? protocol; }

function RequestsPage({ setNotice, setError }: { setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [items, setItems] = useState<RequestListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ model: "", provider: "", status: "", protocol: "" });
  const [selected, setSelected] = useState<RequestRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => { try { setLoading(true); const result = await api.requests({ ...filters, limit: 100 }); setItems(result.items); setTotal(result.total); } catch (err) { setError((err as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [filters.model, filters.provider, filters.status, filters.protocol]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [filters.model, filters.provider, filters.status, filters.protocol]);
  const clear = async () => { if (!window.confirm("Clear all local request metadata? Prompts and responses are never stored.")) return; try { await api.clearRequests(); setItems([]); setTotal(0); setSelected(null); setNotice("Request history cleared."); } catch (err) { setError((err as Error).message); } };
  return <section className="page requests"><div className="page-heading"><div><p className="eyebrow">G5 · Observability</p><h1>Requests</h1><p>Metadata-only history. Prompts and responses are never persisted.</p></div><div className="request-actions"><button className="button secondary" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button><button className="button danger" onClick={() => void clear()}>Clear history</button></div></div><div className="request-filters"><input aria-label="Search model" placeholder="Search model" value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })} /><input aria-label="Filter provider" placeholder="Provider" value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value })} /><select aria-label="Filter status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option><option value="200">200 Success</option><option value="400">400 Error</option><option value="429">429 Error</option><option value="500">500 Error</option></select><select aria-label="Filter protocol" value={filters.protocol} onChange={(event) => setFilters({ ...filters, protocol: event.target.value })}><option value="">All protocols</option><option value="anthropic_messages">Anthropic Messages</option><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option></select></div>{items.length === 0 ? <div className="empty"><h2>No requests yet</h2><p>Completed proxy calls will appear here. Refreshing every 3 seconds while visible.</p></div> : <div className="panel table-wrap"><table className="request-table"><thead><tr><th>Time</th><th>Model</th><th>Provider</th><th>Protocol</th><th>Status</th><th>Duration</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="clickable-row" tabIndex={0} onClick={() => void api.request(item.id).then(setSelected).catch((err: Error) => setError(err.message))} onKeyDown={(event) => { if (event.key === "Enter") void api.request(item.id).then(setSelected).catch((err: Error) => setError(err.message)); }}><td>{new Date(item.startedAt).toLocaleTimeString()}</td><td><strong>{item.model ?? "Unknown"}</strong></td><td>{item.enrichmentStatus === "pending" ? <span className="resolving">Resolving…</span> : item.provider ?? "Unknown"}</td><td>{protocolLabel(item.protocol)}</td><td><span className={`request-status ${requestStatus(item.status).className}`}>{requestStatus(item.status).label}</span></td><td>{formatDuration(item.durationMs)}</td><td>{formatTokens(item.promptTokens, item.completionTokens)}</td><td>{formatCost(item.costUsd)}</td></tr>)}</tbody></table><small className="request-count">Showing {items.length} of {total}</small></div>}{selected && <RequestDetail record={selected} onClose={() => setSelected(null)} />}</section>;
}

function RequestDetail({ record, onClose }: { record: RequestRecord; onClose: () => void }) {
  const policy = record.effectiveProviderPolicy;
  const filterSnapshot = record.providerFilterSnapshot;
  const routingDecision = record.managedRoutingTrace;
  const errorText = record.error ? [record.error.code, record.error.message].filter(Boolean).join(": ") : "";
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer" role="dialog" aria-label="Request details" onClick={(event) => event.stopPropagation()}><div className="panel-title"><div><p className="eyebrow">Request</p><h2>{record.id}</h2></div><button className="text-button" onClick={onClose}>Close</button></div><dl className="detail-grid"><Detail label="Timestamp" value={new Date(record.startedAt).toLocaleString()} /><Detail label="Protocol" value={protocolLabel(record.protocol)} /><Detail label="Requested model" value={record.requestedModel ?? record.model} /><Detail label="Forwarded model" value={record.forwardedModel ?? "—"} /><Detail label="Actual provider" value={record.enrichmentStatus === "pending" ? "Resolving…" : record.actualProviderName ?? "Unknown"} /><Detail label="Status" value={requestStatus(record.status, record.clientCancelled).label} /><Detail label="Streaming" value={record.streamed === null ? "—" : record.streamed ? "Yes" : "No"} /><Detail label="Client cancelled" value={record.clientCancelled === null ? "—" : record.clientCancelled ? "Yes" : "No"} /><Detail label="Proxy duration" value={formatDuration(record.proxyDurationMs)} /><Detail label="OpenRouter latency" value={formatDuration(record.openRouterLatencyMs)} /><Detail label="Generation time" value={formatDuration(record.generationTimeMs)} /><Detail label="Prompt tokens" value={display(record.promptTokens)} /><Detail label="Completion tokens" value={display(record.completionTokens)} /><Detail label="Total tokens" value={display(record.totalTokens)} /><Detail label="Cost" value={formatCost(record.costUsd)} /><Detail label="Finish reason" value={display(record.finishReason)} /><Detail label="Generation ID" value={display(record.generationId)} /><Detail label="Enrichment" value={record.enrichmentStatus ?? "Unknown"} /></dl>{routingDecision !== undefined && <section className="detail-section routing-decision"><h3>Routing Decision</h3><pre>{JSON.stringify(routingDecision, null, 2)}</pre></section>}<section className="detail-section"><h3>Provider Policy Used</h3>{policy ? <pre>{JSON.stringify(policy, null, 2)}</pre> : <p>—</p>}</section>{filterSnapshot && <section className="detail-section"><h3>Provider Filter Used</h3><dl className="detail-grid"><Detail label="Filter status" value={record.providerFilterStatus ?? "Unknown"} /><Detail label="Telemetry age" value={record.providerFilterMetadataAgeMs == null ? "—" : formatDuration(record.providerFilterMetadataAgeMs)} /><Detail label="Metadata fetched" value={record.providerFilterMetadataFetchedAt ? new Date(record.providerFilterMetadataFetchedAt).toLocaleString() : "—"} /><Detail label="Eligible endpoints" value={record.eligibleProviderRoutingIds?.join(", ") || "—"} /></dl><pre>{JSON.stringify(filterSnapshot, null, 2)}</pre></section>}{errorText && <section className="detail-section error-copy"><h3>Error</h3><p>{errorText}</p></section>}<p className="privacy-inline">Request metadata only. Prompt and response content are never shown or stored.</p></aside></div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
