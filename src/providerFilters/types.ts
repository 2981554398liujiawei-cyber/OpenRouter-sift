import type { EndpointDto } from "../openrouter/endpoints.js";

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
  updatedAt: string;
}

export type MetadataState = "fresh" | "stale" | "unavailable";
export type FilterFailureReason = null | "NO_ELIGIBLE_PROVIDER" | "FILTER_DATA_STALE" | "FILTER_DATA_UNAVAILABLE";

export interface FilterEvaluationContext {
  modelId: string;
  evaluatedAt?: string;
  metadataFetchedAt?: string | null;
  metadataState?: MetadataState;
}

export type FilterReasonCode =
  | "PRICING_FIELD_MISSING" | "PERFORMANCE_DATA_MISSING" | "THROUGHPUT_DATA_MISSING"
  | "LATENCY_DATA_MISSING" | "UPTIME_DATA_MISSING" | "QUANTIZATION_MISSING"
  | "CONTEXT_DATA_MISSING" | "SUPPORTED_PARAMETERS_MISSING" | "CACHING_DATA_MISSING"
  | "PROVIDER_ROUTING_ID_MISSING" | "FIELD_MISSING" | "THRESHOLD_NOT_MET"
  | "VALUE_NOT_ALLOWED" | "VALUE_MISMATCH" | "INVALID_CONDITION";

export interface FilterReason { conditionId: string; code: FilterReasonCode; message: string; }
export interface EndpointFilterEvaluation { endpoint: EndpointDto; eligible: boolean; reasons: FilterReason[]; }
export interface ProviderFilterResult {
  modelId: string;
  totalEndpoints: number;
  eligibleEndpoints: EndpointFilterEvaluation[];
  excludedEndpoints: EndpointFilterEvaluation[];
  eligibleRoutingIds: string[];
  evaluatedAt: string;
  metadataFetchedAt: string | null;
  metadataState: MetadataState;
  usable: boolean;
  failureReason: FilterFailureReason;
}

export interface FilterFieldDefinition {
  id: string;
  label: string;
  type: "number" | "string" | "boolean" | "string[]";
  operators: readonly FilterOperator[];
  unit?: string;
  dynamic?: boolean;
}
