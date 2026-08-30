import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components";
import { useI18n } from "../i18n";
import { canonicalNumber, numericDraftIsPlausible } from "../numericDraft";
import type { ProviderPolicy, Settings } from "../types";

export function SettingsPage({ onOpenModel, onKeySaved, setNotice, setError }: { onOpenModel: (id: string) => void; onKeySaved?: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [globalPolicyText, setGlobalPolicyText] = useState("{}");
  const [catalogTtlSeconds, setCatalogTtlSeconds] = useState("300");
  const [refreshSeconds, setRefreshSeconds] = useState("300");
  const [requestLimitDraft, setRequestLimitDraft] = useState("1000");
  const [policies, setPolicies] = useState<Array<ProviderPolicy & { modelId: string }>>([]);
  useEffect(() => {
    void api.settings().then((value) => {
      setSettings(value);
      setCatalogTtlSeconds(String(Math.max(1, Math.round((value.metadataTtlMs ?? 300000) / 1000))));
      setRefreshSeconds(String(Math.max(1, Math.round((value.desiredEndpointRefreshIntervalMs ?? 300000) / 1000))));
      setRequestLimitDraft(String(value.requestLogLimit ?? 1000));
      setGlobalPolicyText(JSON.stringify(value.globalPolicy, null, 2));
    }).catch((err: Error) => setError(err.message));
    void api.policies().then((result) => setPolicies(result.items)).catch(() => setPolicies([]));
  }, []);
  const save = async () => {
    if (!settings) return;
    try {
      const ttl = canonicalNumber(catalogTtlSeconds);
      const refresh = canonicalNumber(refreshSeconds);
      const requestLimit = canonicalNumber(requestLimitDraft);
      if (ttl === null || ttl < 1 || refresh === null || refresh < 1 || requestLimit === null || requestLimit < 100 || requestLimit > 10000 || !numericDraftIsPlausible(catalogTtlSeconds) || !numericDraftIsPlausible(refreshSeconds) || !numericDraftIsPlausible(requestLimitDraft)) throw new Error(t("settings.invalidNumber"));
      const globalPolicy = JSON.parse(globalPolicyText) as Record<string, unknown>;
      const saved = await api.saveSettings({ mergeMode: settings.mergeMode, metadataTtlMs: ttl * 1000, desiredEndpointRefreshIntervalMs: refresh * 1000, requestLogLimit: requestLimit, globalPolicy });
      setSettings(saved);
      setCatalogTtlSeconds(String(Math.round(saved.metadataTtlMs / 1000)));
      setRefreshSeconds(String(Math.round(saved.desiredEndpointRefreshIntervalMs / 1000)));
      setRequestLimitDraft(String(saved.requestLogLimit));
      setGlobalPolicyText(JSON.stringify(saved.globalPolicy, null, 2));
      setNotice(t("settings.saved"));
    } catch (err) { setError((err as Error).message || t("settings.invalidJson")); }
  };
  const resetPolicy = async (id: string) => { try { await api.deletePolicy(id); setPolicies((await api.policies()).items); setNotice(t("settings.policyReset")); } catch (err) { setError((err as Error).message); } };
  if (!settings) return <section className="page"><p className="muted">{t("common.loadingSettings")}</p></section>;
  return <section className="page"><PageHeader eyebrow={t("settings.eyebrow")} title={t("settings.title")} description={t("settings.description")} actions={<button className="button" onClick={() => void save()}>{t("settings.saveChanges")}</button>} />
    <OpenRouterKeyPanel status={settings.openRouterApiKey} onKeySaved={() => { void api.settings().then((value) => setSettings(value)).catch(() => undefined); onKeySaved?.(); }} setNotice={setNotice} setError={setError} />
    <section className="panel"><h2>{t("settings.metadata")}</h2><p>{t("settings.metadataDescription")}</p><div className="form-grid">
      <label>{t("settings.catalogTtl")}<input aria-label={t("settings.catalogTtl")} type="text" inputMode="decimal" value={catalogTtlSeconds} onChange={(event) => setCatalogTtlSeconds(event.target.value)} /><small>{humanDuration(canonicalNumber(catalogTtlSeconds) ?? 0, t)}</small></label>
      <label>{t("settings.providerRefresh")}<input aria-label={t("settings.providerRefresh")} type="text" inputMode="decimal" value={refreshSeconds} onChange={(event) => setRefreshSeconds(event.target.value)} /><small>{humanDuration(canonicalNumber(refreshSeconds) ?? 0, t)}</small></label>
    </div></section>
    <section className="panel"><h2>{t("settings.routing")}</h2><p>{t("settings.routingDescription")}</p>
      <fieldset className="mode-select mode-cards"><legend>{t("settings.mergeMode")}</legend>{(["merge", "override", "strict"] as Settings["mergeMode"][]).map((mode) => <label key={mode} className="mode-card"><input type="radio" name="merge-mode" checked={settings.mergeMode === mode} onChange={() => setSettings({ ...settings, mergeMode: mode })} /><span><strong>{t(`settings.${mode}` as "settings.merge" | "settings.override" | "settings.strict")}</strong><small>{t(`settings.${mode}Hint` as "settings.mergeHint" | "settings.overrideHint" | "settings.strictHint")}</small></span></label>)}</fieldset>
      <div className="advanced-block"><h3>{t("settings.advanced")}</h3><label className="full">{t("settings.globalPolicy")} <textarea value={globalPolicyText} onChange={(event) => setGlobalPolicyText(event.target.value)} spellCheck="false" /></label></div>
      <h3>{t("settings.modelPolicies")}</h3>{policies.length === 0 ? <p className="muted">{t("settings.noModelPolicies")}</p> : <div className="table-wrap"><table><thead><tr><th>{t("desired.model")}</th><th>{t("settings.policy")}</th><th>{t("desired.providers")}</th><th /></tr></thead><tbody>{policies.map((item) => <tr key={item.modelId}><td><strong>{item.modelId}</strong></td><td>{item.mode}</td><td>{item.providers?.join(", ") || "—"}</td><td className="table-actions"><button onClick={() => onOpenModel(item.modelId)}>{t("settings.edit")}</button><button onClick={() => void resetPolicy(item.modelId)}>{t("common.reset")}</button></td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel"><h2>{t("settings.observability")}</h2><div className="form-grid"><label>{t("settings.requestLimit")}<input aria-label={t("settings.requestLimit")} type="text" inputMode="decimal" value={requestLimitDraft} onChange={(event) => setRequestLimitDraft(event.target.value)} /><small>{t("settings.requestRetention")}</small></label></div><p className="privacy-inline">{t("settings.privacy")}</p></section>
  </section>;
}

function humanDuration(seconds: number, t: ReturnType<typeof useI18n>["t"]): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds} ${t("common.seconds")}`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} ${t("common.minutes")}`;
  return `${Math.round(seconds / 3600)} ${t("common.hours")}`;
}

interface KeyFormState { value: string; remember: boolean; busy: boolean; pendingUnverified: boolean; pendingSessionOnly: boolean; message: string | null; }

function OpenRouterKeyPanel({ status, onKeySaved, setNotice, setError }: { status: Settings["openRouterApiKey"]; onKeySaved: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t } = useI18n();
  const sourceLabel = (source: string) => ({ "ui-session": t("settings.sessionOnly"), "secure-store": t("settings.secureStore"), environment: t("settings.environment"), none: t("settings.notConfigured") }[source] ?? source);
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
    if (!key) { setForm((current) => ({ ...current, message: t("settings.pasteKey") })); return; }
    setForm((current) => ({ ...current, busy: true, message: null }));
    try {
      await api.setOpenRouterKey(key, rememberOverride ?? form.remember, verify);
      resetForm();
      setReplacing(false);
      setNotice(t("settings.keySaved"));
      onKeySaved();
    } catch (err) {
      const raw = (err as Error).message || "";
      if (raw.includes("rejected this API key")) setError(t("settings.keyRejected"));
      else if (raw.includes("unreachable")) setForm((current) => ({ ...current, busy: false, pendingUnverified: true, message: t("settings.keyUnreachable") }));
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
      setNotice(t("settings.keyRemoved"));
      onKeySaved();
    } catch (err) { setError((err as Error).message); }
  };
  const showForm = !status.configured || replacing;
  return <section className="panel"><h2>{t("settings.openRouter")}</h2>
    {!status.configured ? <p>{t("settings.openRouterDescription")}</p> : <div className="form-grid">
      <label>{t("access.apiKey")}<input aria-label={t("settings.configuredKey")} value={status.masked ?? "••••"} readOnly /></label>
      <label>{t("settings.stored")}<input aria-label={t("settings.keyStorage")} value={sourceLabel(status.source)} readOnly /></label>
      <label>{t("settings.lastMetadata")}<input aria-label={t("settings.lastMetadata")} value={metaSuccess ?? t("common.never")} readOnly /></label>
    </div>}
    {showForm && <div className="form-grid">
      <label>{t("access.apiKey")}<input aria-label={t("settings.apiKey")} type="password" autoComplete="off" placeholder="sk-or-…" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} /></label>
      <label className="catalog-checkbox"><input type="checkbox" checked={form.remember} disabled={!status.secureStoreAvailable} onChange={(event) => setForm((current) => ({ ...current, remember: event.target.checked }))} />{t("settings.remember")}{!status.secureStoreAvailable ? <small> {t("settings.secureUnavailable")}</small> : null}</label>
      {form.message && <p className="muted" role="status">{form.message}</p>}
      <div className="actions">
        <button className="button" disabled={form.busy} onClick={() => void save(true)}>{form.busy ? t("common.saving") : t("settings.saveKey")}</button>
        {replacing && <button className="button secondary" onClick={() => { resetForm(); setReplacing(false); }}>{t("common.cancel")}</button>}
        {form.pendingUnverified && <button className="button secondary" disabled={form.busy} onClick={() => void save(false)}>{t("settings.saveUnverified")}</button>}
        {form.pendingSessionOnly && <button className="button secondary" disabled={form.busy} onClick={() => void save(true, false)}>{t("settings.useSession")}</button>}
      </div>
    </div>}
    {status.configured && !replacing && <div className="actions">
      <button className="button secondary" onClick={() => { setReplacing(true); setConfirmForget(false); }}>{t("settings.replaceKey")}</button>
      <button className="text-button danger-text" onClick={() => setConfirmForget((current) => !current)}>{confirmForget ? t("settings.confirmForget") : t("settings.forgetKey")}</button>
    </div>}
    {confirmForget && <p className="muted" role="status">{t("settings.removeQuestion")}{status.source === "secure-store" ? t("settings.fallbackEnv") : ""} <button className="button secondary" onClick={() => void forget()}>{t("settings.removeKey")}</button></p>}
    <small>{t("settings.keyPrivacy", { store: status.secureStoreLabel })}</small>
  </section>;
}
