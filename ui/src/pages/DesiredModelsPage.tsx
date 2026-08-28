import { api } from "../api";
import { Badge, EmptyState, PageHeader } from "../components";
import type { DesiredModel, ModelSummary } from "../types";

export function DesiredModelsPage({ models, desired, onChanged, onOpen, onBrowse, setNotice, setError }: { models: ModelSummary[]; desired: DesiredModel[]; onChanged: () => void; onOpen: (id: string) => void; onBrowse: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const names = new Map(models.map((model) => [model.id, model.name || model.id]));
  const remove = async (id: string) => {
    if (!window.confirm(`Remove "${names.get(id) ?? id}" from Desired Models? This immediately revokes it from API Keys and removes its per-key provider overrides.`)) return;
    try { await api.removeDesiredModel(id); onChanged(); setNotice("Model removed from Desired Models."); } catch (err) { setError((err as Error).message); }
  };
  return <section className="page"><PageHeader eyebrow="Access boundary" title="Desired Models" description="Models exposed through your managed API keys. Provider filters and per-key access are configured from here." />
    {desired.length === 0 ? <EmptyState title="No Desired Models" description="Add models from the OpenRouter catalog before creating managed API access." action={<button className="button" onClick={onBrowse}>Browse All Models</button>} /> : <div className="panel table-wrap"><table><thead><tr><th>Model</th><th>Provider Filters</th><th className="num">API Keys</th><th>Status</th><th /></tr></thead><tbody>{desired.map((item) => {
      const rules = item.providerFilter?.conditions?.length ?? 0;
      const apiCount = typeof item.assignedApiCount === "number" ? item.assignedApiCount : Array.isArray(item.assignedApis) ? item.assignedApis.length : typeof item.assignedApis === "number" ? item.assignedApis : 0;
      return <tr key={item.modelId}>
        <td><button className="model-link" onClick={() => onOpen(item.modelId)}><strong>{names.get(item.modelId) ?? item.modelId}</strong><small className="mono">{item.modelId}</small></button></td>
        <td>{rules ? <Badge variant="accent">{rules} {rules === 1 ? "rule" : "rules"}</Badge> : <span className="muted">No filter</span>}</td>
        <td className="num">{apiCount}</td>
        <td><Badge variant={item.enabled === false ? "neutral" : "success"}>{item.enabled === false ? "Disabled" : "Available"}</Badge></td>
        <td className="table-actions"><button onClick={() => onOpen(item.modelId)}>Manage</button><button onClick={() => void remove(item.modelId)}>Remove</button></td>
      </tr>;
    })}</tbody></table></div>}
  </section>;
}
