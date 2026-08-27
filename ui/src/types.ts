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
  contextLength: number | null;
  pricing: unknown | null;
  policySummary: PolicyMode;
}

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

export interface Settings {
  openRouterApiKeyConfigured: boolean;
  openRouterApiKeyMasked: string | null;
  mergeMode: "merge" | "override" | "strict";
  globalPolicy: Record<string, unknown>;
  metadataTtlMs: number;
  requestLogLimit: number;
}

export interface DesiredModel {
  modelId: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  assignedApiCount?: number;
  assignedApis?: number | string[];
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
}
