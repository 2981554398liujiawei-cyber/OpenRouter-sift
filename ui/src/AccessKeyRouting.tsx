import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";

type OverrideMode = "inherit" | "allowlist" | "blocklist";
export interface KeyProvider { id?: string; providerRoutingId?: string | null; name?: string | null; providerName?: string | null; available?: boolean; status?: string | null }
export interface KeyModelRouting { modelId: string; mode: OverrideMode; providers: string[]; providerOrder: string[]; allowFallbacks: boolean }
export interface AccessKeyRoutingData { models?: string[]; providers?: KeyProvider[]; availableProviders?: KeyProvider[]; providerCatalog?: KeyProvider[]; mode?: OverrideMode; providersSelected?: string[]; selectedProviders?: string[]; providerOrder?: string[]; allowFallbacks?: boolean; preview?: Record<string, unknown> | null }

const empty = (modelId: string): KeyModelRouting => ({ modelId, mode: "inherit", providers: [], providerOrder: [], allowFallbacks: true });

/** Per-key routing is deliberately kept separate from the global model policy editor. */
export function AccessKeyRouting({ keyId, allowedModels, onClose, onSaved, setError, setNotice }: { keyId: string; allowedModels: string[]; onClose: () => void; onSaved?: () => void; setError: (value: string) => void; setNotice: (value: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<AccessKeyRoutingData | null>(null);
  const [modelId, setModelId] = useState(allowedModels[0] ?? "");
  const [draft, setDraft] = useState<KeyModelRouting>(empty(allowedModels[0] ?? ""));
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const first = modelId || allowedModels[0] || "";
      const next = await api.accessKeyRouting(keyId, first);
      setData({ ...next, models: next.models?.length ? next.models : allowedModels });
      setModelId(first);
      setDraft({ modelId: first, mode: next.mode ?? "inherit", providers: next.providersSelected ?? next.selectedProviders ?? [], providerOrder: next.providerOrder ?? [], allowFallbacks: next.allowFallbacks ?? true });
      setPreview(next.preview ?? null);
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [keyId]);

  const providers = useMemo(() => (data?.providers ?? data?.availableProviders ?? data?.providerCatalog ?? []).map((item) => ({ ...item, id: item.id ?? item.providerRoutingId ?? "", name: item.name ?? item.providerName ?? item.providerRoutingId ?? t("common.unknownProvider") })), [data, t]);
  const modelAllows = providers.filter((provider) => provider.available !== false).length;
  const keyAllows = draft.mode === "inherit" ? modelAllows : draft.mode === "allowlist" ? draft.providers.length : Math.max(0, modelAllows - draft.providers.length);
  const selectModel = async (next: string) => { setModelId(next); setPreview(null); try { const detail = await api.accessKeyRouting(keyId, next); setDraft({ modelId: next, mode: detail.mode ?? "inherit", providers: detail.providersSelected ?? detail.selectedProviders ?? [], providerOrder: detail.providerOrder ?? [], allowFallbacks: detail.allowFallbacks ?? true }); } catch (err) { setError((err as Error).message); } };
  const toggleProvider = (id: string) => setDraft((current) => ({ ...current, providers: current.providers.includes(id) ? current.providers.filter((item) => item !== id) : [...current.providers, id], providerOrder: current.providerOrder.includes(id) ? current.providerOrder : [...current.providerOrder, id] }));
  const move = (id: string, direction: -1 | 1) => setDraft((current) => { const order = [...(current.providerOrder.length ? current.providerOrder : current.providers)]; const index = order.indexOf(id); const next = index + direction; if (index < 0 || next < 0 || next >= order.length) return current; [order[index], order[next]] = [order[next], order[index]]; return { ...current, providerOrder: order }; });
  const save = async () => { try { await api.saveAccessKeyRouting(keyId, draft); setNotice(t("access.saved")); onSaved?.(); await load(); } catch (err) { setError((err as Error).message); } };
  const reset = async () => { try { await api.resetAccessKeyRouting(keyId, modelId); setDraft(empty(modelId)); setPreview(null); setNotice(t("access.reset")); await load(); } catch (err) { setError((err as Error).message); } };
  const showPreview = async () => { try { setPreview(await api.previewAccessKeyRouting(keyId, draft)); } catch (err) { setError((err as Error).message); } };

  return <div className="modal-backdrop"><section className="modal panel key-routing" role="dialog" aria-label={t("access.providerAccess")}>
    <div className="panel-title"><div><p className="eyebrow">{t("access.apiKey")}</p><h2>{t("access.providerAccess")}</h2><p>{t("access.description")}</p></div><button className="text-button" onClick={onClose}>{t("common.close")}</button></div>
    {loading ? <p className="muted">{t("access.loading")}</p> : allowedModels.length === 0 ? <p className="muted">{t("access.noModels")}</p> : <>
      <label className="modal-field">{t("access.model")}<select aria-label={t("access.routingModel")} value={modelId} onChange={(event) => void selectModel(event.target.value)}>{(data?.models?.length ? data.models : allowedModels).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <div className="access-summary">
        <span>{t("access.desiredAllows")} <strong>{modelAllows} {modelAllows === 1 ? t("common.provider") : t("common.providers")}</strong></span>
        <span>{t("access.keyAllows")} <strong>{keyAllows} {keyAllows === 1 ? t("common.provider") : t("common.providers")}</strong></span>
      </div>
      <fieldset className="mode-select mode-cards"><legend>{t("access.mode")}</legend>{(["inherit", "allowlist", "blocklist"] as OverrideMode[]).map((mode) => <label key={mode} className="mode-card"><input type="radio" name="key-routing-mode" aria-label={mode === "inherit" ? t("access.inherit") : mode === "allowlist" ? t("access.allowSelected") : t("access.blockSelected")} checked={draft.mode === mode} onChange={() => setDraft({ ...draft, mode })} /><span><strong>{mode === "inherit" ? t("access.inherit") : mode === "allowlist" ? t("access.allowSelected") : t("access.blockSelected")}</strong><small>{mode === "inherit" ? t("access.inheritHint") : mode === "allowlist" ? t("access.allowHint") : t("access.blockHint")}</small></span></label>)}</fieldset>
      {draft.mode !== "inherit" && <><div className="provider-picker"><h3>{t("access.providers")}</h3>{providers.length === 0 ? <p className="muted">{t("access.catalogUnavailable")}</p> : providers.map((provider) => <label className={`provider-choice ${provider.available === false ? "provider-unavailable" : ""}`} key={provider.id}><input type="checkbox" disabled={provider.available === false} checked={draft.providers.includes(provider.id)} onChange={() => toggleProvider(provider.id)} /><span><strong>{provider.name}</strong><small className="mono">{provider.id} · {provider.available === false ? (provider.status ?? t("access.excludedByFilters")) : t("common.available")}</small></span></label>)}</div>{draft.mode === "allowlist" && <div className="order"><h3>{t("access.priority")}</h3>{(draft.providerOrder.length ? draft.providerOrder : draft.providers).map((id, index, order) => <div key={id}><span>{index + 1}. {providers.find((provider) => provider.id === id)?.name ?? id}</span><span><button aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(id, -1)}>↑</button><button aria-label={`Move ${id} down`} disabled={index === order.length - 1} onClick={() => move(id, 1)}>↓</button></span></div>)}</div>}<details className="advanced-block"><summary>{t("access.advanced")}</summary><label className="switch"><input type="checkbox" checked={draft.allowFallbacks} onChange={(event) => setDraft({ ...draft, allowFallbacks: event.target.checked })} />{t("access.allowFallbackProviders")}</label><small>{t("access.fallbackHint")}</small></details></>}
      <div className="preview"><div className="panel-title"><div><h3>{t("access.routingPreview")}</h3><p>{t("access.previewDescription")}</p></div><button className="button secondary" onClick={() => void showPreview()}>{t("access.preview")}</button></div>{preview ? <pre>{JSON.stringify(preview, null, 2)}</pre> : <p className="muted">{t("access.previewNotLoaded")}</p>}</div>
      <div className="actions"><button className="button secondary" onClick={() => void reset()}>{t("common.reset")}</button><button className="button" onClick={() => void save()}>{t("common.save")}</button></div>
    </>}
  </section></div>;
}
