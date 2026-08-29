import { api } from "../api";
import { Badge, EmptyState, PageHeader } from "../components";
import { useI18n } from "../i18n";
import type { DesiredModel, ModelSummary } from "../types";

export function DesiredModelsPage({ models, desired, onChanged, onOpen, onBrowse, setNotice, setError }: { models: ModelSummary[]; desired: DesiredModel[]; onChanged: () => void; onOpen: (id: string) => void; onBrowse: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const { t } = useI18n();
  const names = new Map(models.map((model) => [model.id, model.name || model.id]));
  const remove = async (id: string) => {
    if (!window.confirm(t("desired.confirmRemove", { model: names.get(id) ?? id }))) return;
    try { await api.removeDesiredModel(id); onChanged(); setNotice(t("desired.removed")); } catch (err) { setError((err as Error).message); }
  };
  return <section className="page"><PageHeader eyebrow={t("desired.eyebrow")} title={t("desired.title")} description={t("desired.description")} />
    {desired.length === 0 ? <EmptyState title={t("desired.noModels")} description={t("desired.emptyDescription")} action={<button className="button" onClick={onBrowse}>{t("desired.browse")}</button>} /> : <div className="panel table-wrap"><table><thead><tr><th>{t("desired.model")}</th><th>{t("desired.providerFilters")}</th><th className="num">{t("desired.apiKeys")}</th><th>{t("desired.status")}</th><th /></tr></thead><tbody>{desired.map((item) => {
      const rules = item.providerFilter?.conditions?.length ?? 0;
      const apiCount = typeof item.assignedApiCount === "number" ? item.assignedApiCount : Array.isArray(item.assignedApis) ? item.assignedApis.length : typeof item.assignedApis === "number" ? item.assignedApis : 0;
      return <tr key={item.modelId}>
        <td><button className="model-link" onClick={() => onOpen(item.modelId)}><strong>{names.get(item.modelId) ?? item.modelId}</strong><small className="mono">{item.modelId}</small></button></td>
        <td>{rules ? <Badge variant="accent">{rules} {rules === 1 ? t("common.rule") : t("common.rules")}</Badge> : <span className="muted">{t("desired.noFilter")}</span>}</td>
        <td className="num">{apiCount}</td>
        <td><Badge variant={item.enabled === false ? "neutral" : "success"}>{item.enabled === false ? t("desired.disabled") : t("desired.available")}</Badge></td>
        <td className="table-actions"><button onClick={() => onOpen(item.modelId)}>{t("desired.manage")}</button><button onClick={() => void remove(item.modelId)}>{t("desired.remove")}</button></td>
      </tr>;
    })}</tbody></table></div>}
  </section>;
}
