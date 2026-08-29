import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Badge, Breadcrumbs, EmptyState, PageHeader, Tabs } from "../components";
import { display, percent, perMillion, policyLabel } from "../format";
import type { DesiredModel, Endpoint, ModelSummary, PolicyMode, ProviderPolicy } from "../types";

const emptyPolicy: ProviderPolicy = { mode: "inherit", providers: [], providerOrder: [], allowFallbacks: true };

function candidateFrom(policy: ProviderPolicy): ProviderPolicy {
  return { mode: policy.mode ?? "inherit", providers: policy.providers ?? [], providerOrder: policy.providerOrder ?? [], allowFallbacks: policy.allowFallbacks ?? true, policy: policy.policy, enabled: policy.enabled };
}

const detailTabs = ["Overview", "Capabilities", "Providers"] as const;

export function ModelDetailPage({ modelId, desired, onBack, onManageDesired, onSaved, setNotice, setError }: { modelId: string; desired: DesiredModel[]; onBack: () => void; onManageDesired: () => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [model, setModel] = useState<ModelSummary | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("Overview");
  const [policy, setPolicy] = useState<ProviderPolicy>(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try { setLoading(true); const detail = await api.model(modelId); setModel(detail.model); setPolicy(candidateFrom(detail.policy)); } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [modelId]);
  const loadProviders = async (refresh = false) => { try { setProvidersLoading(true); setProvidersError(null); const result = refresh ? (await api.refreshEndpoints(modelId), await api.endpoints(modelId)) : await api.endpoints(modelId); setEndpoints(result.items); setProvidersLoaded(true); if (refresh) setNotice("Provider endpoints refreshed."); } catch (err) { setProvidersError((err as Error).message || "Failed to load provider endpoints."); } finally { setProvidersLoading(false); } };
  const openTab = (next: string) => { setTab(next); if (next === "Providers" && !providersLoaded && !providersLoading) void loadProviders(); };
  const providerOptions = useMemo(() => endpoints.flatMap((endpoint) => endpoint.providerRoutingId ? [{ id: endpoint.providerRoutingId, name: endpoint.providerName ?? endpoint.providerRoutingId }] : []), [endpoints]);
  const isDesired = desired.some((item) => item.modelId === modelId);
  const addDesired = async () => { try { await api.addDesiredModel(modelId); onSaved(); setNotice("Added to Desired Models."); } catch (err) { setError((err as Error).message); } };
  if (loading) return <section className="page"><Breadcrumbs trail={[{ label: "All Models", onClick: onBack }, { label: "Loading…" }]} /><p className="muted">Loading model details…</p></section>;
  if (!model) return <section className="page"><Breadcrumbs trail={[{ label: "All Models", onClick: onBack }]} /><EmptyState title="Model unavailable" description="Model metadata could not be loaded from the local catalog." action={<button className="button secondary" onClick={onBack}>Back to All Models</button>} /></section>;
  return <section className="page"><Breadcrumbs trail={[{ label: "All Models", onClick: onBack }, { label: model.name || model.id }]} /><PageHeader eyebrow="Model" title={model.name || model.id} description={`${model.creator ?? "Unknown creator"} · ${model.id}`} actions={<>{isDesired ? <button className="button secondary" onClick={onManageDesired}>Manage Desired Model</button> : <button className="button" onClick={() => void addDesired()}>Add to Desired</button>}{tab === "Providers" && providersLoaded && <button className="button secondary" onClick={() => void loadProviders(true)}>Refresh Providers</button>}</>} />
    <div className="stats"><div className="stat"><small>Context</small><strong>{model.contextLength ? model.contextLength.toLocaleString() : "—"}</strong></div><div className="stat"><small>Input</small><strong>{perMillion(model.pricing, "prompt")}</strong></div><div className="stat"><small>Output</small><strong>{perMillion(model.pricing, "completion")}</strong></div></div>
    <Tabs tabs={detailTabs} active={tab} onChange={openTab} />
    {tab === "Overview" && <section className="panel"><h2>Overview</h2><p>{model.description || "Model metadata from the local OpenRouter catalog."}</p><dl className="detail-grid"><dt>Creator</dt><dd>{model.creator ?? "—"}</dd><dt>Model ID</dt><dd><code className="mono">{model.id}</code></dd><dt>Created</dt><dd>{model.created ? new Date(model.created * 1000).toLocaleDateString() : "—"}</dd><dt>Max completion</dt><dd>{model.maxCompletionTokens?.toLocaleString() ?? "—"}</dd></dl></section>}
    {tab === "Capabilities" && <section className="panel"><div className="panel-title"><div><h2>Capabilities</h2><p>Only fields declared by the current model catalog are shown.</p></div></div><div className="catalog-badges">{(model.inputModalities ?? []).map((item) => <i key={item}>Input: {item}</i>)}{(model.outputModalities ?? []).map((item) => <i key={item}>Output: {item}</i>)}{(model.supportedParameters ?? []).map((item) => <i key={item}>{item}</i>)}</div>{!(model.inputModalities?.length || model.outputModalities?.length || model.supportedParameters?.length) && <p className="muted">Capability metadata is unavailable for this model.</p>}</section>}
    {tab === "Providers" && <><section className="panel"><div className="panel-title"><div><h2>Provider endpoints</h2><p>Provider pricing and live telemetry are loaded only for this model.</p></div></div>{providersLoading ? <p className="muted">Loading provider endpoints…</p> : providersError ? <div className="error-copy"><p>Failed to load provider endpoints.</p><button className="button secondary" onClick={() => void loadProviders()}>Retry</button></div> : providersLoaded ? <EndpointTable endpoints={endpoints} /> : null}</section>{providersLoaded && <PolicyEditor modelId={modelId} options={providerOptions} policy={policy} setPolicy={setPolicy} onSaved={() => { onSaved(); setNotice("Policy saved. The proxy will use it for the next request."); }} setNotice={setNotice} setError={setError} />}</>}
  </section>;
}

function EndpointTable({ endpoints }: { endpoints: Endpoint[] }) { return <div className="table-wrap"><table><thead><tr><th>Provider</th><th className="num">Price in</th><th className="num">Price out</th><th className="num">Latency</th><th className="num">Throughput</th><th className="num">Uptime</th><th>Quantization</th></tr></thead><tbody>{endpoints.length === 0 ? <tr><td colSpan={7}>No endpoint data is cached for this model.</td></tr> : endpoints.map((endpoint, index) => <tr key={`${endpoint.providerRoutingId ?? "unknown"}-${index}`}><td><strong>{display(endpoint.providerName)}</strong><small className="mono">{endpoint.providerRoutingId ?? "No routing ID"}</small></td><td className="num">{perMillion(endpoint.pricing, "prompt")}</td><td className="num">{perMillion(endpoint.pricing, "completion")}</td><td className="num" title={metricTitle(endpoint.performance.latencyLast30m)}>{display(endpoint.performance.latencyLast30m?.p50)} ms</td><td className="num" title={metricTitle(endpoint.performance.throughputLast30m)}>{display(endpoint.performance.throughputLast30m?.p50)}</td><td className="num" title={`30m: ${percent(endpoint.performance.uptimeLast30m)} · 1d: ${percent(endpoint.performance.uptimeLast1d)}`}>{percent(endpoint.performance.uptimeLast5m)}</td><td>{display(endpoint.quantization)}</td></tr>)}</tbody></table></div>; }
function metricTitle(metric: Endpoint["performance"]["latencyLast30m"]) { return metric ? `P50 ${display(metric.p50)} · P75 ${display(metric.p75)} · P90 ${display(metric.p90)} · P99 ${display(metric.p99)}` : "Unavailable"; }

export function PolicyEditor({ modelId, options, policy, setPolicy, onSaved, setNotice, setError }: { modelId: string; options: Array<{ id: string; name: string }>; policy: ProviderPolicy; setPolicy: (value: ProviderPolicy) => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
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
  return <section className="panel policy-editor"><div className="panel-title"><div><h2>Routing policy</h2><p>Restrict which providers may serve this model. The preview is compiled by the server with the same resolver as proxy requests.</p></div><button className="text-button" onClick={() => void reset()}>Reset to inherit</button></div>
    <fieldset className="mode-select"><legend>Policy mode</legend>{(["inherit", "allowlist", "blocklist"] as PolicyMode[]).map((mode) => <label key={mode}><input type="radio" checked={policy.mode === mode} onChange={() => changeMode(mode)} />{mode === "inherit" ? "Inherit global policy" : policyLabel(mode)}</label>)}</fieldset>
    {policy.mode !== "inherit" && <div className="provider-picker"><h3>{policy.mode === "allowlist" ? "Allowed providers" : "Blocked providers"}</h3>{options.length === 0 ? <p className="muted">Refresh endpoints to select verified provider routing IDs.</p> : options.map((option) => <label className="provider-choice" key={option.id}><input aria-label={option.name} type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /><span>{option.name}<small className="mono">{option.id}</small></span></label>)}</div>}
    {policy.mode === "allowlist" && selected.length > 0 && <><div className="order"><h3>Routing priority</h3>{(policy.providerOrder ?? selected).map((id, index, list) => <div key={id}><span>{index + 1}. {options.find((option) => option.id === id)?.name ?? id}</span><span><button aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(id, -1)}>↑</button><button aria-label={`Move ${id} down`} disabled={index === list.length - 1} onClick={() => move(id, 1)}>↓</button></span></div>)}</div><label className="switch"><input type="checkbox" checked={policy.allowFallbacks ?? true} onChange={(event) => setPolicy({ ...policy, allowFallbacks: event.target.checked })} />Allow fallback outside the providers above</label></>}
    <div className="preview"><div><h3>Policy preview</h3><small>{previewError ?? "OpenRouter provider payload"}</small></div><pre>{preview ? JSON.stringify({ provider: preview }, null, 2) : "Waiting for a valid policy…"}</pre></div><div className="actions"><button className="button" onClick={() => void save()}>Save policy</button></div>
  </section>;
}
