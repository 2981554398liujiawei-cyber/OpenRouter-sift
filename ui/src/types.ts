export type PolicyMode = "inherit" | "allowlist" | "blocklist" | "custom";

export interface ProviderPolicy {
  mode: PolicyMode;
  providers?: string[];
  providerOrder?: string[];
  allowFallbacks?: boolean;
  policy?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ModelSummary {
  id: string;
  name: string | null;
  creator?: string | null;
  contextLength: number | null;
  pricing: unknown | null;
  policySummary: PolicyMode;
  canonicalSlug?: string | null;
  architecture?: unknown | null;
  supportedParameters?: string[] | null;
  created?: number | null;
  description?: string | null;
  inputModalities?: string[] | null;
  outputModalities?: string[] | null;
  maxCompletionTokens?: number | null;
}

export interface CatalogCache { fetchedAt: string | null; stale: boolean; available: boolean; }

export interface Percentiles { p50: number | null; p75: number | null; p90: number | null; p99: number | null; }

export interface Endpoint {
  providerName: string | null;
  providerSlug: string | null;
  providerRoutingId: string | null;
  tag: string | null;
  name: string | null;
  pricing: unknown | null;
  contextLength: number | null;
  quantization: string | null;
  status: string | number | null;
  performance: {
    latencyLast30m: Percentiles | null;
    throughputLast30m: Percentiles | null;
    uptimeLast5m: number | null;
    uptimeLast30m: number | null;
    uptimeLast1d: number | null;
  };
}

export type UpstreamKeySource = "ui-session" | "secure-store" | "environment" | "none";

export interface UpstreamKeyStatus {
  configured: boolean;
  masked: string | null;
  source: UpstreamKeySource;
  secureStoreAvailable: boolean;
  secureStoreLabel: string;
}

export interface Settings {
  openRouterApiKey: UpstreamKeyStatus;
  mergeMode: "merge" | "override" | "strict";
  globalPolicy: Record<string, unknown>;
  metadataTtlMs: number;
  requestLogLimit: number;
  desiredEndpointRefreshIntervalMs: number;
}

export interface DesiredModel {
  modelId: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  assignedApiCount?: number;
  assignedApis?: number | string[];
  providerFilter?: ProviderFilterConfig | null;
}

export type FilterOperator = "lte" | "gte" | "eq" | "in" | "notIn" | "contains" | "exists";
export interface ProviderFilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: unknown;
  enabled: boolean;
}
export interface ProviderFilterConfig {
  enabled: boolean;
  mode: "all";
  conditions: ProviderFilterCondition[];
  maxTelemetryAgeMs: number;
  updatedAt?: string;
}
export interface FilterPreviewReason { conditionId?: string; code?: string; message: string }
export interface FilterPreviewEndpoint {
  providerName: string | null;
  providerRoutingId: string | null;
  [key: string]: unknown;
}
/** Endpoint evaluation entry: the endpoint DTO plus its eligibility verdict and reasons. */
export interface FilterPreviewEntry {
  endpoint: FilterPreviewEndpoint;
  eligible: boolean;
  reasons: FilterPreviewReason[];
}
/** Matches the server's ProviderFilterResult contract for /filter and /filter/preview. */
export interface FilterPreview {
  modelId?: string;
  totalEndpoints: number;
  eligibleEndpoints: FilterPreviewEntry[];
  excludedEndpoints: FilterPreviewEntry[];
  eligibleRoutingIds: string[];
  evaluatedAt?: string;
  metadataFetchedAt: string | null;
  metadataState?: "fresh" | "stale" | "unavailable";
  usable?: boolean;
  failureReason?: string | null;
}

export interface AccessKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  enabled: boolean;
  allowedModels: string[];
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt: string | null;
  secretStorage: "secure-store" | "unavailable" | "legacy";
}

export interface AccessKeySecret extends AccessKey { secret: string }

export type RequestProtocol = "anthropic_messages" | "chat_completions" | "responses" | string;
export type EnrichmentStatus = "pending" | "success" | "failed" | "unavailable" | string;

export interface RequestListItem {
  id: string;
  startedAt: string;
  protocol: RequestProtocol;
  accessKeyId: string | null;
  accessKeyName: string | null;
  model: string | null;
  provider: string | null;
  status: number | string | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedPromptTokens: number | null;
  cacheWriteTokens: number | null;
  cacheDiscountUsd: number | null;
  cacheStatus: string | null;
  sessionAffinity: "explicit" | "implicit" | "unknown";
  costUsd: number | null;
  enrichmentStatus: EnrichmentStatus | null;
}

export interface RequestRecord extends RequestListItem {
  completedAt: string | null;
  requestedModel: string | null;
  forwardedModel: string | null;
  streamed: boolean | null;
  clientCancelled: boolean | null;
  proxyDurationMs: number | null;
  generationId: string | null;
  cachedPromptTokens: number | null;
  cacheWriteTokens: number | null;
  cacheDiscountUsd: number | null;
  cacheStatus: string | null;
  cacheAge: string | null;
  sessionAffinity: "explicit" | "implicit" | "unknown";
  sessionIdPresent: boolean;
  effectiveProviderPolicy: Record<string, unknown> | null;
  actualProviderName: string | null;
  totalTokens: number | null;
  openRouterLatencyMs: number | null;
  generationTimeMs: number | null;
  finishReason: string | null;
  isByok: boolean | null;
  router: string | null;
  serviceTier: string | null;
  error: { code: string | null; message: string | null } | null;
  actualProviderRoutingId: string | null;
  providerFilterSnapshot?: ProviderFilterConfig | null;
  eligibleProviderRoutingIds?: string[] | null;
  providerFilterMetadataFetchedAt?: string | null;
  providerFilterMetadataAgeMs?: number | null;
  providerFilterStatus?: "fresh" | "stale" | "unavailable" | null;
  accessKeyModelOverrideSnapshot?: { providerMode: "inherit" | "allowlist" | "blocklist"; providers?: string[]; providerOrder?: string[]; allowFallbacks?: boolean; sort?: "price" | "latency" | "throughput" | null } | null;
  managedRoutingTrace?: { hardFilter: string[] | null; accessKeyOverride: string[] | null; modelPolicy: string[] | null; incoming: string[] | null; final: string[]; rejectedAt?: string | null } | null;
}
