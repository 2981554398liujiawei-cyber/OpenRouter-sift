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
}
