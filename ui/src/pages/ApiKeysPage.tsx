import { useEffect, useState } from "react";
import { AccessKeyRouting } from "../AccessKeyRouting";
import { api } from "../api";
import { Badge, EmptyState, PageHeader } from "../components";
import { copyText } from "../clipboard";
import { useI18n } from "../i18n";
import type { AccessKey, AccessKeySecret, DesiredModel } from "../types";

export function ApiKeysPage({ desired, setNotice, setError }: { desired: DesiredModel[]; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t, formatDate } = useI18n();
  const [keys, setKeys] = useState<AccessKey[]>([]); const [editing, setEditing] = useState<AccessKey | null>(null); const [routingKey, setRoutingKey] = useState<AccessKey | null>(null); const [showForm, setShowForm] = useState(false); const [secret, setSecret] = useState<AccessKeySecret | null>(null);
  const load = async (showError = true) => { try { const result = await api.accessKeys(); setKeys(Array.isArray(result) ? result : result.items); } catch (err) { if (showError) setError((err as Error).message); throw err; } };
  useEffect(() => { void load().catch(() => undefined); }, []);
  const save = async (name: string, allowedModels: string[], enabled: boolean): Promise<void> => {
    if (editing) {
      await api.updateAccessKey(editing.id, { name, allowedModels, enabled });
      setShowForm(false); setEditing(null); setNotice(t("access.keyUpdated"));
      try { await load(false); } catch { setError(t("access.listRefreshFailed")); }
      return;
    }
    const created = await api.createAccessKey({ name, allowedModels });
    setSecret(created); setShowForm(false); setEditing(null); setNotice(created.secretStorage === "secure-store" ? t("access.keyCreated") : t("access.secureStorageUnavailable"));
    try { await load(false); } catch { setError(t("access.listRefreshFailed")); }
  };
  const copyKey = async (item: AccessKey) => {
    if (item.secretStorage !== "secure-store") { setError(t("access.copyUnavailable")); return; }
    try {
      const { secret: value } = await api.copyAccessKeySecret(item.id);
      if (await copyText(value)) setNotice(t("access.keyCopied")); else setError(t("access.copyFailed"));
    } catch (err) { setError((err as Error).message || t("access.copyUnavailable")); }
  };
  const toggle = async (item: AccessKey) => { try { await api.updateAccessKey(item.id, { enabled: !item.enabled }); await load(); } catch (err) { setError((err as Error).message); } };
  const remove = async (item: AccessKey) => { if (!window.confirm(t("access.confirmDelete", { name: item.name }))) return; try { await api.deleteAccessKey(item.id); await load(); setNotice(t("access.keyDeleted")); } catch (err) { setError((err as Error).message); } };
  return <section className="page"><PageHeader eyebrow={t("access.managedGateway")} title={t("keys.title")} description={t("access.keysDescription")} actions={<button className="button" onClick={() => { setEditing(null); setShowForm(true); }}>{t("access.createKey")}</button>} />
    {keys.length === 0 ? <EmptyState title={t("access.noKeys")} description={t("access.createKeyDescription")} action={<button className="button" onClick={() => { setEditing(null); setShowForm(true); }}>{t("access.createKey")}</button>} /> : <div className="panel table-wrap"><table><thead><tr><th>{t("access.name")}</th><th>{t("access.key")}</th><th className="num">{t("access.models")}</th><th>{t("access.lastUsed")}</th><th>{t("access.status")}</th><th /></tr></thead><tbody>{keys.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td><div className="key-cell"><code className="mono">{item.keyPrefix}••••{item.keyLast4}</code><span className="key-storage-hint">{item.secretStorage === "secure-store" ? t("access.securelyStored") : t("access.secretUnavailable")}</span><button className="text-button" type="button" disabled={item.secretStorage !== "secure-store"} onClick={() => void copyKey(item)}>{item.secretStorage === "secure-store" ? t("access.copyKey") : t("access.copyUnavailableShort")}</button></div></td><td className="num">{item.allowedModels.length} {item.allowedModels.length === 1 ? t("common.model") : t("common.models")}</td><td>{item.lastUsedAt ? formatDate(item.lastUsedAt) : t("common.never")}</td><td><Badge variant={item.enabled ? "success" : "neutral"}>{item.enabled ? t("common.enabled") : t("common.disabled")}</Badge></td><td className="table-actions"><button onClick={() => setRoutingKey(item)}>{t("access.providerAccess")}</button><button onClick={() => { setEditing(item); setShowForm(true); }}>{t("common.edit")}</button><button onClick={() => void toggle(item)}>{item.enabled ? t("access.disable") : t("access.enable")}</button><button onClick={() => void remove(item)}>{t("common.delete")}</button></td></tr>)}</tbody></table></div>}
    {showForm && <AccessKeyForm initial={editing} desired={desired} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}{secret && <SecretModal value={secret} onClose={() => setSecret(null)} />}{routingKey && <AccessKeyRouting keyId={routingKey.id} allowedModels={routingKey.allowedModels} onClose={() => setRoutingKey(null)} onSaved={() => void load()} setNotice={setNotice} setError={setError} />}
  </section>;
}

function AccessKeyForm({ initial, desired, onCancel, onSave }: { initial: AccessKey | null; desired: DesiredModel[]; onCancel: () => void; onSave: (name: string, models: string[], enabled: boolean) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ""); const [selected, setSelected] = useState(initial?.allowedModels ?? []); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const { t } = useI18n();
  const nameMissing = !name.trim();
  const modelsMissing = selected.length === 0;
  const submit = async () => {
    if (nameMissing || modelsMissing || submitting) return;
    setSubmitting(true); setError(null);
    try { await onSave(name.trim(), selected, initial?.enabled ?? true); }
    catch (err) { setError((err as Error).message || t("access.createFailed")); setSubmitting(false); }
  };
  return <div className="sift-modal-backdrop"><section className="modal panel" role="dialog" aria-label={initial ? t("access.editKey") : t("access.createKey")}><form onSubmit={(event) => { event.preventDefault(); void submit(); }}><div className="panel-title"><div><h2>{initial ? t("access.editKey") : t("access.createKey")}</h2><p>{t("access.allowedModelsHint")}</p></div><button className="text-button" type="button" disabled={submitting} onClick={onCancel}>{t("common.close")}</button></div><label className="modal-field">{t("access.name")}<input autoFocus disabled={submitting} value={name} onChange={(event) => setName(event.target.value)} placeholder="Codex" /></label>{nameMissing && <p className="validation-message">{t("access.nameRequired")}</p>}<fieldset className="model-checks"><legend>{t("access.allowedModels")}</legend>{desired.length === 0 ? <p className="muted">{t("access.noDesiredModels")}</p> : desired.map((item) => <label key={item.modelId}><input type="checkbox" disabled={submitting} checked={selected.includes(item.modelId)} onChange={() => toggle(item.modelId)} />{item.modelId}</label>)}</fieldset>{modelsMissing && <p className="validation-message">{t("access.modelRequired")}</p>}{error && <p className="error-copy" role="alert">{t("access.createFailed")}: {error}</p>}<div className="actions"><button className="button secondary" type="button" disabled={submitting} onClick={onCancel}>{t("common.cancel")}</button><button className="button" type="submit" disabled={nameMissing || modelsMissing || submitting}>{submitting ? t("access.creating") : initial ? t("common.save") : t("access.createKeyAction")}</button></div></form></section></div>;
}

function SecretModal({ value, onClose }: { value: AccessKeySecret; onClose: () => void }) {
  const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState(false);
  const { t } = useI18n();
  const copy = async () => { setCopyError(false); if (await copyText(value.secret)) setCopied(true); else setCopyError(true); };
  return <div className="sift-modal-backdrop"><section className="modal panel secret-modal" role="dialog" aria-label={t("access.yourKey")}><h2>{t("access.yourKey")}</h2><p className="secret-warning">{t("access.copyWarning")}</p><code className="secret-value">{value.secret}</code>{copyError && <p className="validation-message" role="alert">{t("access.copyFailed")}</p>}<div className="actions"><button className="button" onClick={() => void copy()}>{copied ? t("common.copied") : t("common.copy")}</button><button className="button secondary" onClick={onClose}>{t("common.done")}</button></div></section></div>;
}
