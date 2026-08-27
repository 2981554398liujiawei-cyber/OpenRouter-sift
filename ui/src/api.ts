import type { Endpoint, ModelSummary, ProviderPolicy, RequestListItem, RequestRecord, Settings } from "./types";

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
  saveSettings: (settings: Pick<Settings, "mergeMode" | "globalPolicy" | "metadataTtlMs" | "requestLogLimit">) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  requests: (filters: { limit?: number; model?: string; provider?: string; status?: string; protocol?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
    return request<{ items: RequestListItem[]; total: number }>(`/requests${params.toString() ? `?${params}` : ""}`);
  },
  request: (id: string) => request<RequestRecord>(`/requests/${encodeURIComponent(id)}`),
  clearRequests: () => request<unknown>("/requests", { method: "DELETE" }),
};
