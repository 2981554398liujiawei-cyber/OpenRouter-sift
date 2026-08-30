import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Badge, Breadcrumbs, EmptyState, PageHeader, Tabs } from "../components";
import { display, percent, perMillion, policyLabel } from "../format";
import { useI18n } from "../i18n";
import type { DesiredModel, Endpoint, ModelSummary, PolicyMode, ProviderPolicy } from "../types";

const emptyPolicy: ProviderPolicy = { mode: "inherit", providers: [], providerOrder: [], allowFallbacks: true };

function candidateFrom(policy: ProviderPolicy): ProviderPolicy {
  return { mode: policy.mode ?? "inherit", providers: policy.providers ?? [], providerOrder: policy.providerOrder ?? [], allowFallbacks: policy.allowFallbacks ?? true, policy: policy.policy, enabled: policy.enabled };
}

const detailTabs = ["Overview", "Capabilities", "Providers"] as const;

export function ModelDetailPage({ modelId, desired, onBack, onManageDesired, onSaved, setNotice, setError }: { modelId: string; desired: DesiredModel[]; onBack: () => void; onManageDesired: () => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t, formatDate } = useI18n();
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
  const loadProviders = async (refresh = false) => { try { setProvidersLoading(true); setProvidersError(null); const result = refresh ? (await api.refreshEndpoints(modelId), await api.endpoints(modelId)) : await api.endpoints(modelId); setEndpoints(result.items); setProvidersLoaded(true); if (refresh) setNotice(t("model.providerRefreshed")); } catch (err) { setProvidersError((err as Error).message || t("model.providerLoadFailed")); } finally { setProvidersLoading(false); } };
  const openTab = (next: string) => { setTab(next); if (next === "Providers" && !providersLoaded && !providersLoading) void loadProviders(); };
  const providerOptions = useMemo(() => endpoints.flatMap((endpoint) => endpoint.providerRoutingId ? [{ id: endpoint.providerRoutingId, name: endpoint.providerName ?? endpoint.providerRoutingId }] : []), [endpoints]);
  const isDesired = desired.some((item) => item.modelId === modelId);
  const addDesired = async () => { try { await api.addDesiredModel(modelId); onSaved(); setNotice(t("model.addedDesired")); } catch (err) { setError((err as Error).message); } };
  if (loading) return <section className="page"><Breadcrumbs trail={[{ label: t("catalog.title"), onClick: onBack }, { label: t("common.loading") }]} /><p className="muted">{t("model.loadingDetails")}</p></section>;
  if (!model) return <section className="page"><Breadcrumbs trail={[{ label: t("catalog.title"), onClick: onBack }]} /><EmptyState title={t("model.unavailable")} description={t("model.unavailableDescription")} action={<button className="button secondary" onClick={onBack}>{t("model.backToAll")}</button>} /></section>;
  return <section className="page"><Breadcrumbs trail={[{ label: t("catalog.title"), onClick: onBack }, { label: model.name || model.id }]} /><PageHeader eyebrow={t("model.eyebrow")} title={model.name || model.id} description={`${model.creator ?? t("model.unknownCreator")} · ${model.id}`} actions={<>{isDesired ? <button className="button secondary" onClick={onManageDesired}>{t("model.manageDesired")}</button> : <button className="button" onClick={() => void addDesired()}>{t("model.addDesired")}</button>}{tab === "Providers" && providersLoaded && <button className="button secondary" onClick={() => void loadProviders(true)}>{t("model.refreshProviders")}</button>}</>} />
    <div className="stats"><div className="stat"><small>{t("model.context")}</small><strong>{model.contextLength ? model.contextLength.toLocaleString() : "—"}</strong></div><div className="stat"><small>{t("model.input")}</small><strong>{perMillion(model.pricing, "prompt")}</strong></div><div className="stat"><small>{t("model.output")}</small><strong>{perMillion(model.pricing, "completion")}</strong></div></div>
    <Tabs tabs={detailTabs} active={tab} onChange={openTab} />
    {tab === "Overview" && <section className="panel"><h2>{t("model.overview")}</h2><p>{model.description || t("model.modelDescription")}</p><dl className="detail-grid"><dt>{t("model.creator")}</dt><dd>{model.creator ?? "—"}</dd><dt>{t("model.modelId")}</dt><dd><code className="mono">{model.id}</code></dd><dt>{t("model.created")}</dt><dd>{model.created ? formatDate(model.created * 1000) : "—"}</dd><dt>{t("model.maxCompletion")}</dt><dd>{model.maxCompletionTokens?.toLocaleString() ?? "—"}</dd></dl></section>}
    {tab === "Capabilities" && <section className="panel"><div className="panel-title"><div><h2>{t("model.capabilities")}</h2><p>{t("model.capabilitiesDescription")}</p></div></div><div className="catalog-badges">{(model.inputModalities ?? []).map((item) => <i key={item}>{t("model.inputLabel", { value: item })}</i>)}{(model.outputModalities ?? []).map((item) => <i key={item}>{t("model.outputLabel", { value: item })}</i>)}{(model.supportedParameters ?? []).map((item) => <i key={item}>{item}</i>)}</div>{!(model.inputModalities?.length || model.outputModalities?.length || model.supportedParameters?.length) && <p className="muted">{t("model.capabilityUnavailable")}</p>}</section>}
    {tab === "Providers" && <><section className="panel"><div className="panel-title"><div><h2>{t("model.providerEndpoints")}</h2><p>{t("model.providerDescription")}</p></div></div>{providersLoading ? <p className="muted">{t("model.loadingProviders")}</p> : providersError ? <div className="error-copy"><p>{t("model.providerLoadFailed")}</p><button className="button secondary" onClick={() => void loadProviders()}>{t("common.retry")}</button></div> : providersLoaded ? <EndpointTable endpoints={endpoints} /> : null}</section>{providersLoaded && <PolicyEditor modelId={modelId} options={providerOptions} policy={policy} setPolicy={setPolicy} onSaved={() => { onSaved(); setNotice(t("model.policySaved")); }} setNotice={setNotice} setError={setError} />}</>}
  </section>;
}

function EndpointTable({ endpoints }: { endpoints: Endpoint[] }) {
  const { t } = useI18n();
  return <div className="table-wrap"><table><thead><tr><th>{t("model.provider")}</th><th className="num">{t("model.priceIn")}</th><th className="num">{t("model.priceOut")}</th><th className="num">{t("model.latency")}</th><th className="num">{t("model.throughput")}</th><th className="num">{t("model.uptime")}</th><th>{t("model.quantization")}</th></tr></thead><tbody>{endpoints.length === 0 ? <tr><td colSpan={7}>{t("model.noEndpointData")}</td></tr> : endpoints.map((endpoint, index) => <tr key={`${endpoint.providerRoutingId ?? "unknown"}-${index}`}><td><strong>{display(endpoint.providerName)}</strong><small className="mono">{endpoint.providerRoutingId ?? t("model.noRoutingId")}</small></td><td className="num">{perMillion(endpoint.pricing, "prompt")}</td><td className="num">{perMillion(endpoint.pricing, "completion")}</td><td className="num" title={metricTitle(endpoint.performance.latencyLast30m, t)}>{display(endpoint.performance.latencyLast30m?.p50)} ms</td><td className="num" title={metricTitle(endpoint.performance.throughputLast30m, t)}>{display(endpoint.performance.throughputLast30m?.p50)}</td><td className="num" title={`30m: ${percent(endpoint.performance.uptimeLast30m)} · 1d: ${percent(endpoint.performance.uptimeLast1d)}`}>{percent(endpoint.performance.uptimeLast5m)}</td><td>{display(endpoint.quantization)}</td></tr>)}</tbody></table></div>;
}
function metricTitle(metric: Endpoint["performance"]["latencyLast30m"], t: ReturnType<typeof useI18n>["t"]) { return metric ? `${t("model.p50")} ${display(metric.p50)} · ${t("model.p75")} ${display(metric.p75)} · ${t("model.p90")} ${display(metric.p90)} · ${t("model.p99")} ${display(metric.p99)}` : t("model.unavailableMetric"); }

export function PolicyEditor({ modelId, options, policy, setPolicy, onSaved, setNotice, setError }: { modelId: string; options: Array<{ id: string; name: string }>; policy: ProviderPolicy; setPolicy: (value: ProviderPolicy) => void; onSaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const selected = policy.providers ?? [];
  useEffect(() => {
    if (policy.mode === "allowlist" && selected.length === 0) { setPreview(null); setPreviewError(t("model.allowlistRequired")); return; }
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
  const save = async () => { if (policy.mode === "allowlist" && selected.length === 0) { setError(t("model.allowlistRequired")); return; } try { await api.savePolicy(modelId, policy); onSaved(); } catch (err) { setError((err as Error).message); } };
  const reset = async () => { try { await api.deletePolicy(modelId); setPolicy(emptyPolicy); setNotice(t("model.policyReset")); } catch (err) { setError((err as Error).message); } };
  return <section className="panel policy-editor"><div className="panel-title"><div><h2>{t("model.routingPolicy")}</h2><p>{t("model.routingPolicyDescription")}</p></div><button className="text-button" onClick={() => void reset()}>{t("model.resetInherit")}</button></div>
    <fieldset className="mode-select"><legend>{t("model.policyMode")}</legend>{(["inherit", "allowlist", "blocklist"] as PolicyMode[]).map((mode) => <label key={mode}><input type="radio" checked={policy.mode === mode} onChange={() => changeMode(mode)} />{mode === "inherit" ? t("model.inheritGlobal") : policyLabel(mode)}</label>)}</fieldset>
    {policy.mode !== "inherit" && <div className="provider-picker"><h3>{policy.mode === "allowlist" ? t("model.allowedProviders") : t("model.blockedProviders")}</h3>{options.length === 0 ? <p className="muted">{t("model.refreshEndpointsHint")}</p> : options.map((option) => <label className="provider-choice" key={option.id}><input aria-label={option.name} type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /><span>{option.name}<small className="mono">{option.id}</small></span></label>)}</div>}
    {policy.mode === "allowlist" && selected.length > 0 && <><div className="order"><h3>{t("model.routingPriority")}</h3>{(policy.providerOrder ?? selected).map((id, index, list) => <div key={id}><span>{index + 1}. {options.find((option) => option.id === id)?.name ?? id}</span><span><button aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(id, -1)}>↑</button><button aria-label={`Move ${id} down`} disabled={index === list.length - 1} onClick={() => move(id, 1)}>↓</button></span></div>)}</div><p className="routing-hint">{t("model.providerOrderStickyWarning")}</p><label className="switch"><input type="checkbox" checked={policy.allowFallbacks ?? true} onChange={(event) => setPolicy({ ...policy, allowFallbacks: event.target.checked })} />{t("model.allowFallback")}</label></>}
    <div className="preview"><div><h3>{t("model.policyPreview")}</h3><small>{previewError ?? t("model.openRouterPayload")}</small></div><pre>{preview ? JSON.stringify({ provider: preview }, null, 2) : t("model.waitingPolicy")}</pre></div><div className="actions"><button className="button" onClick={() => void save()}>{t("model.savePolicy")}</button></div>
  </section>;
}
