import { useEffect, useState } from "react";
import { AccessKeyRouting } from "../AccessKeyRouting";
import { api } from "../api";
import { Badge, EmptyState, PageHeader } from "../components";
import { useI18n } from "../i18n";
import type { AccessKey, AccessKeySecret, DesiredModel } from "../types";

export function ApiKeysPage({ desired, setNotice, setError }: { desired: DesiredModel[]; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t, formatDate } = useI18n();
  const [keys, setKeys] = useState<AccessKey[]>([]); const [editing, setEditing] = useState<AccessKey | null>(null); const [routingKey, setRoutingKey] = useState<AccessKey | null>(null); const [showForm, setShowForm] = useState(false); const [secret, setSecret] = useState<AccessKeySecret | null>(null);
  const load = async () => { try { const result = await api.accessKeys(); setKeys(Array.isArray(result) ? result : result.items); } catch (err) { setError((err as Error).message); } };
  useEffect(() => { void load(); }, []);
  const save = async (name: string, allowedModels: string[], enabled: boolean) => { try { if (editing) await api.updateAccessKey(editing.id, { name, allowedModels, enabled }); else setSecret(await api.createAccessKey({ name, allowedModels })); setShowForm(false); setEditing(null); await load(); setNotice(editing ? t("access.keyUpdated") : t("access.keyCreated")); } catch (err) { setError((err as Error).message); } };
  const toggle = async (item: AccessKey) => { try { await api.updateAccessKey(item.id, { enabled: !item.enabled }); await load(); } catch (err) { setError((err as Error).message); } };
  const remove = async (item: AccessKey) => { if (!window.confirm(t("access.confirmDelete", { name: item.name }))) return; try { await api.deleteAccessKey(item.id); await load(); setNotice(t("access.keyDeleted")); } catch (err) { setError((err as Error).message); } };
  return <section className="page"><PageHeader eyebrow={t("access.managedGateway")} title={t("keys.title")} description={t("access.keysDescription")} actions={<button className="button" onClick={() => { setEditing(null); setShowForm(true); }}>{t("access.createKey")}</button>} />
    {keys.length === 0 ? <EmptyState title={t("access.noKeys")} description={t("access.createKeyDescription")} action={<button className="button" onClick={() => { setEditing(null); setShowForm(true); }}>{t("access.createKey")}</button>} /> : <div className="panel table-wrap"><table><thead><tr><th>{t("access.name")}</th><th>{t("access.key")}</th><th className="num">{t("access.models")}</th><th>{t("access.lastUsed")}</th><th>{t("access.status")}</th><th /></tr></thead><tbody>{keys.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td><code className="mono">{item.keyPrefix}••••{item.keyLast4}</code></td><td className="num">{item.allowedModels.length} {item.allowedModels.length === 1 ? t("common.model") : t("common.models")}</td><td>{item.lastUsedAt ? formatDate(item.lastUsedAt) : t("common.never")}</td><td><Badge variant={item.enabled ? "success" : "neutral"}>{item.enabled ? t("common.enabled") : t("common.disabled")}</Badge></td><td className="table-actions"><button onClick={() => setRoutingKey(item)}>{t("access.providerAccess")}</button><button onClick={() => { setEditing(item); setShowForm(true); }}>{t("common.edit")}</button><button onClick={() => void toggle(item)}>{item.enabled ? t("access.disable") : t("access.enable")}</button><button onClick={() => void remove(item)}>{t("common.delete")}</button></td></tr>)}</tbody></table></div>}
    {showForm && <AccessKeyForm initial={editing} desired={desired} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}{secret && <SecretModal value={secret} onClose={() => setSecret(null)} />}{routingKey && <AccessKeyRouting keyId={routingKey.id} allowedModels={routingKey.allowedModels} onClose={() => setRoutingKey(null)} onSaved={() => void load()} setNotice={setNotice} setError={setError} />}
  </section>;
}

function AccessKeyForm({ initial, desired, onCancel, onSave }: { initial: AccessKey | null; desired: DesiredModel[]; onCancel: () => void; onSave: (name: string, models: string[], enabled: boolean) => void }) {
  const [name, setName] = useState(initial?.name ?? ""); const [selected, setSelected] = useState(initial?.allowedModels ?? []);
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const { t } = useI18n();
  return <div className="modal-backdrop"><section className="modal panel" role="dialog" aria-label={initial ? t("access.editKey") : t("access.createKey")}><div className="panel-title"><div><h2>{initial ? t("access.editKey") : t("access.createKey")}</h2><p>{t("access.allowedModelsHint")}</p></div><button className="text-button" onClick={onCancel}>{t("common.close")}</button></div><label className="modal-field">{t("access.name")}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Codex" /></label><fieldset className="model-checks"><legend>{t("access.allowedModels")}</legend>{desired.length === 0 ? <p className="muted">{t("access.noDesiredModels")}</p> : desired.map((item) => <label key={item.modelId}><input type="checkbox" checked={selected.includes(item.modelId)} onChange={() => toggle(item.modelId)} />{item.modelId}</label>)}</fieldset><div className="actions"><button className="button secondary" onClick={onCancel}>{t("common.cancel")}</button><button className="button" disabled={!name.trim() || selected.length === 0} onClick={() => onSave(name.trim(), selected, initial?.enabled ?? true)}>{initial ? t("common.save") : t("access.createKeyAction")}</button></div></section></div>;
}

function SecretModal({ value, onClose }: { value: AccessKeySecret; onClose: () => void }) {
  const [copied, setCopied] = useState(false); const copy = async () => { await navigator.clipboard?.writeText(value.secret); setCopied(true); };
  const { t } = useI18n();
  return <div className="modal-backdrop"><section className="modal panel secret-modal" role="dialog" aria-label={t("access.yourKey")}><h2>{t("access.yourKey")}</h2><p className="secret-warning">{t("access.copyWarning")}</p><code className="secret-value">{value.secret}</code><div className="actions"><button className="button" onClick={() => void copy()}>{copied ? t("common.copied") : t("common.copy")}</button><button className="button secondary" onClick={onClose}>{t("common.done")}</button></div></section></div>;
}
