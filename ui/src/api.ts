import type { AccessKey, AccessKeySecret, DesiredModel, Endpoint, FilterPreview, ModelSummary, ProviderFilterConfig, ProviderFilterCondition, ProviderPolicy, RequestListItem, RequestRecord, Settings } from "./types";

type ApiError = { error?: { message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiError;
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<{ proxy: { running: boolean }; openrouter: { configured: boolean }; catalog: { modelCount: number; stale: boolean } }>("/status"),
  models: (query = "") => request<{ items: ModelSummary[]; total: number }>(`/models${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  refreshModels: () => request<unknown>("/models/refresh", { method: "POST" }),
  model: (id: string) => request<{ model: ModelSummary; policy: ProviderPolicy }>(`/models/${encodeURIComponent(id)}`),
  endpoints: (id: string) => request<{ items: Endpoint[] }>(`/models/${encodeURIComponent(id)}/endpoints`),
  refreshEndpoints: (id: string) => request<unknown>(`/models/${encodeURIComponent(id)}/endpoints/refresh`, { method: "POST" }),
  policies: () => request<{ items: Array<ProviderPolicy & { modelId: string }> }>("/policies"),
  savePolicy: (id: string, policy: ProviderPolicy) => request<ProviderPolicy>(`/policies/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(policy) }),
  deletePolicy: (id: string) => request<unknown>(`/policies/${encodeURIComponent(id)}`, { method: "DELETE" }),
  preview: (modelId: string, candidatePolicy: ProviderPolicy) => request<{ effectivePolicy: Record<string, unknown>; openRouterProviderPayload: Record<string, unknown> }>("/policies/preview", { method: "POST", body: JSON.stringify({ modelId, candidatePolicy }) }),
  settings: () => request<Settings>("/settings"),
  saveSettings: (settings: Pick<Settings, "mergeMode" | "globalPolicy" | "metadataTtlMs" | "requestLogLimit" | "desiredEndpointRefreshIntervalMs">) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  requests: (filters: { limit?: number; model?: string; provider?: string; status?: string; protocol?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
    return request<{ items: RequestListItem[]; total: number }>(`/requests${params.toString() ? `?${params}` : ""}`);
  },
  request: (id: string) => request<RequestRecord>(`/requests/${encodeURIComponent(id)}`),
  clearRequests: () => request<unknown>("/requests", { method: "DELETE" }),
  desiredModels: () => request<{ items: DesiredModel[] } | DesiredModel[]>("/desired-models"),
  addDesiredModel: (id: string) => request<DesiredModel>(`/desired-models/${encodeURIComponent(id)}`, { method: "POST" }),
  removeDesiredModel: (id: string) => request<unknown>(`/desired-models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  desiredFilter: (id: string) => request<ProviderFilterConfig | { providerFilter: ProviderFilterConfig | null } | null>(`/desired-models/${encodeURIComponent(id)}/filter`),
  saveDesiredFilter: (id: string, filter: ProviderFilterConfig) => request<ProviderFilterConfig>(`/desired-models/${encodeURIComponent(id)}/filter`, { method: "PUT", body: JSON.stringify(filter) }),
  deleteDesiredFilter: (id: string) => request<unknown>(`/desired-models/${encodeURIComponent(id)}/filter`, { method: "DELETE" }),
  previewDesiredFilter: (id: string, candidateFilter: ProviderFilterConfig) => request<FilterPreview>(`/desired-models/${encodeURIComponent(id)}/filter/preview`, { method: "POST", body: JSON.stringify({ candidateFilter }) }),
  accessKeys: () => request<{ items: AccessKey[] } | AccessKey[]>("/access-keys"),
  accessKey: (id: string) => request<AccessKey>(`/access-keys/${encodeURIComponent(id)}`),
  createAccessKey: (body: { name: string; allowedModels: string[] }) => request<AccessKeySecret>("/access-keys", { method: "POST", body: JSON.stringify(body) }),
  updateAccessKey: (id: string, body: { name?: string; allowedModels?: string[]; enabled?: boolean }) => request<AccessKey>(`/access-keys/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAccessKey: (id: string) => request<unknown>(`/access-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
