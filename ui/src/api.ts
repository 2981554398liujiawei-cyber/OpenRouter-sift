import type { AccessKey, AccessKeySecret, CatalogCache, DesiredModel, Endpoint, FilterPreview, ModelSummary, ProviderFilterConfig, ProviderFilterCondition, ProviderPolicy, RequestListItem, RequestRecord, Settings, UpstreamKeyStatus } from "./types";
import type { AccessKeyRoutingData, KeyModelRouting } from "./AccessKeyRouting";

type ApiError = { error?: { message?: string; code?: string } };
type ProviderFilterResponse = { filter: ProviderFilterConfig | null; preview: FilterPreview | null };

let controlKey: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

/**
 * Control-key state lives in memory only (G12 §14): never in the URL, never in
 * localStorage, never in a cookie. A page refresh clears it, which is fine —
 * the server remains the only authority.
 */
export function setControlKey(key: string | null): void { controlKey = key; }
export function hasControlKey(): boolean { return controlKey !== null; }
export function onControlUnauthorized(handler: (() => void) | null): void { unauthorizedHandler = handler; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (controlKey) headers.authorization = `Bearer ${controlKey}`;
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiError;
    if (response.status === 401 && body.error?.code === "ERR_UNAUTHORIZED") unauthorizedHandler?.();
    const err = new Error(body.error?.message ?? `Request failed (${response.status})`) as Error & { code?: string };
    err.code = body.error?.code;
    throw err;
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<{ proxy: { running: boolean; host?: string; port?: number }; openrouter: { configured: boolean; lastSuccessfulMetadataRequestAt?: string | null; lastError?: string | null }; catalog?: { modelCount: number; fetchedAt: string | null; stale: boolean }; version?: string }>("/status"),
  models: (query = "") => request<{ items: ModelSummary[]; total: number; cache?: CatalogCache }>(`/models${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  refreshModels: () => request<unknown>("/models/refresh", { method: "POST" }),
  model: (id: string) => request<{ model: ModelSummary; policy: ProviderPolicy }>(`/models/${encodeURIComponent(id)}`),
  endpoints: (id: string) => request<{ items: Endpoint[] }>(`/models/${encodeURIComponent(id)}/endpoints`),
  refreshEndpoints: (id: string) => request<unknown>(`/models/${encodeURIComponent(id)}/endpoints/refresh`, { method: "POST" }),
  policies: () => request<{ items: Array<ProviderPolicy & { modelId: string }> }>("/policies"),
  savePolicy: (id: string, policy: ProviderPolicy) => request<ProviderPolicy>(`/policies/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(policy) }),
  deletePolicy: (id: string) => request<unknown>(`/policies/${encodeURIComponent(id)}`, { method: "DELETE" }),
  preview: (modelId: string, candidatePolicy: ProviderPolicy) => request<{ effectivePolicy: Record<string, unknown>; openRouterProviderPayload: Record<string, unknown> }>("/policies/preview", { method: "POST", body: JSON.stringify({ modelId, candidatePolicy }) }),
  settings: () => request<Settings>("/settings"),
  setOpenRouterKey: (apiKey: string, remember: boolean, verify = true) => request<{ openRouterApiKey: UpstreamKeyStatus } & Partial<Settings>>("/settings/openrouter-key", { method: "PUT", body: JSON.stringify({ apiKey, remember, verify }) }),
  forgetOpenRouterKey: () => request<{ openRouterApiKey: UpstreamKeyStatus }>("/settings/openrouter-key", { method: "DELETE" }),
  launcherShortcut: () => request<{ available: boolean; installed: boolean; path?: string }>("/launcher/shortcut"),
  createLauncherShortcut: () => request<{ available: boolean; installed: boolean; path?: string }>("/launcher/shortcut", { method: "POST" }),
  removeLauncherShortcut: () => request<{ available: boolean; installed: boolean; path?: string }>("/launcher/shortcut", { method: "DELETE" }),
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
  desiredFilter: (id: string) => request<ProviderFilterResponse | ProviderFilterConfig | { providerFilter: ProviderFilterConfig | null } | null>(`/desired-models/${encodeURIComponent(id)}/filter`),
  saveDesiredFilter: (id: string, filter: ProviderFilterConfig) => request<ProviderFilterResponse | ProviderFilterConfig>(`/desired-models/${encodeURIComponent(id)}/filter`, { method: "PUT", body: JSON.stringify(filter) }),
  deleteDesiredFilter: (id: string) => request<unknown>(`/desired-models/${encodeURIComponent(id)}/filter`, { method: "DELETE" }),
  previewDesiredFilter: (id: string, candidateFilter: ProviderFilterConfig) => request<FilterPreview>(`/desired-models/${encodeURIComponent(id)}/filter/preview`, { method: "POST", body: JSON.stringify({ candidateFilter }) }),
  accessKeys: () => request<{ items: AccessKey[] } | AccessKey[]>("/access-keys"),
  accessKey: (id: string) => request<AccessKey>(`/access-keys/${encodeURIComponent(id)}`),
  createAccessKey: (body: { name: string; allowedModels: string[] }) => request<AccessKeySecret>("/access-keys", { method: "POST", body: JSON.stringify(body) }),
  copyAccessKeySecret: (id: string) => request<{ secret: string }>(`/access-keys/${encodeURIComponent(id)}/secret`, { method: "POST" }),
  updateAccessKey: (id: string, body: { name?: string; allowedModels?: string[]; enabled?: boolean }) => request<AccessKey>(`/access-keys/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAccessKey: (id: string) => request<unknown>(`/access-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  accessKeyRouting: (id: string, modelId: string) => request<AccessKeyRoutingData>(`/access-keys/${encodeURIComponent(id)}/models/${encodeURIComponent(modelId)}/override`),
  saveAccessKeyRouting: (id: string, routing: KeyModelRouting) => request<KeyModelRouting>(`/access-keys/${encodeURIComponent(id)}/models/${encodeURIComponent(routing.modelId)}/override`, { method: "PUT", body: JSON.stringify(routing.mode === "inherit" ? { providerMode: "inherit" } : { providerMode: routing.mode, providers: routing.providers, providerOrder: routing.mode === "allowlist" ? routing.providerOrder : [], allowFallbacks: routing.allowFallbacks }) }),
  resetAccessKeyRouting: (id: string, modelId: string) => request<unknown>(`/access-keys/${encodeURIComponent(id)}/models/${encodeURIComponent(modelId)}/override`, { method: "DELETE" }),
  previewAccessKeyRouting: (id: string, routing: KeyModelRouting) => request<Record<string, unknown>>(`/access-keys/${encodeURIComponent(id)}/models/${encodeURIComponent(routing.modelId)}/override/preview`, { method: "POST", body: JSON.stringify(routing.mode === "inherit" ? { providerMode: "inherit" } : { providerMode: routing.mode, providers: routing.providers, providerOrder: routing.mode === "allowlist" ? routing.providerOrder : [], allowFallbacks: routing.allowFallbacks }) }),
};
