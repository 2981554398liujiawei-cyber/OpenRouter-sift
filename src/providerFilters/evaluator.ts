import type { EndpointDto, PercentileMetric } from "../openrouter/endpoints.js";
import type { FilterEvaluationContext, FilterFieldDefinition, FilterReason, ProviderFilterCondition, ProviderFilterConfig, ProviderFilterResult } from "./types.js";

const metric = (endpoint: EndpointDto, kind: "latency" | "throughput", percentile: string): number | null => {
  const value = endpoint.performance[kind === "latency" ? "latencyLast30m" : "throughputLast30m"] as PercentileMetric | null;
  return value?.[percentile as keyof PercentileMetric] ?? null;
};
function numericPricing(endpoint: EndpointDto, key: string): number | null {
  if (!endpoint.pricing || typeof endpoint.pricing !== "object" || Array.isArray(endpoint.pricing)) return null;
  const raw = (endpoint.pricing as Record<string, unknown>)[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return key === "discount" ? n : n * 1_000_000;
}
function valueFor(endpoint: EndpointDto, field: string): unknown {
  const metricMatch = field.match(/^performance\.(latency|throughput)\.(p\d+)$/);
  if (metricMatch) return metric(endpoint, metricMatch[1] as "latency" | "throughput", metricMatch[2]);
  if (field.startsWith("pricing.")) return numericPricing(endpoint, field.slice(8));
  const map: Record<string, unknown> = {
    "uptime.5m": endpoint.performance.uptimeLast5m, "uptime.30m": endpoint.performance.uptimeLast30m, "uptime.1d": endpoint.performance.uptimeLast1d,
    quantization: endpoint.quantization, "context.length": endpoint.contextLength, "context.maxPrompt": endpoint.maxPromptTokens,
    "context.maxCompletion": endpoint.maxCompletionTokens, supportedParameters: endpoint.supportedParameters,
    supportsImplicitCaching: endpoint.supportsImplicitCaching,
    "provider.routingId": endpoint.providerRoutingId,
  };
  return map[field];
}
function label(field: string): string { return field.startsWith("pricing.") ? `${field.slice(8)} price` : field; }
function reason(condition: ProviderFilterCondition, code: FilterReason["code"], message: string): FilterReason { return { conditionId: condition.id, code, message }; }

function evaluateCondition(endpoint: EndpointDto, condition: ProviderFilterCondition): FilterReason | null {
  const actual = valueFor(endpoint, condition.field);
  const missing = actual === null || actual === undefined || (Array.isArray(actual) && actual.length === 0 && condition.operator === "contains");
  if (condition.operator === "exists") return actual == null ? reason(condition, "FIELD_MISSING", `${label(condition.field)} is unavailable`) : null;
  if (missing) {
    const code = condition.field.startsWith("pricing.") ? "PRICING_FIELD_MISSING" : condition.field.includes("throughput") ? "THROUGHPUT_DATA_MISSING" : condition.field.includes("latency") ? "LATENCY_DATA_MISSING" : condition.field.startsWith("uptime.") ? "UPTIME_DATA_MISSING" : condition.field === "quantization" ? "QUANTIZATION_MISSING" : condition.field.startsWith("context.") ? "CONTEXT_DATA_MISSING" : condition.field === "supportedParameters" ? "SUPPORTED_PARAMETERS_MISSING" : condition.field === "supportsImplicitCaching" ? "CACHING_DATA_MISSING" : condition.field === "provider.routingId" ? "PROVIDER_ROUTING_ID_MISSING" : "FIELD_MISSING";
    return reason(condition, code, `${label(condition.field)} is unavailable`);
  }
  const target = condition.value;
  if (condition.operator === "contains") return Array.isArray(actual) && actual.includes(target) ? null : reason(condition, "VALUE_NOT_ALLOWED", `${label(condition.field)} does not include ${String(target)}`);
  if (condition.operator === "in" || condition.operator === "notIn") {
    if (!Array.isArray(target)) return reason(condition, "INVALID_CONDITION", `${condition.field} requires an array value`);
    const included = target.some((v) => v === actual);
    return (condition.operator === "in" ? included : !included) ? null : reason(condition, "VALUE_NOT_ALLOWED", `${String(actual)} is ${condition.operator === "in" ? "not allowed" : "blocked"}`);
  }
  if (condition.operator === "eq") return actual === target ? null : reason(condition, "VALUE_MISMATCH", `${label(condition.field)} ${String(actual)} does not equal ${String(target)}`);
  if (typeof actual !== "number" || typeof target !== "number" || !Number.isFinite(actual) || !Number.isFinite(target)) return reason(condition, "INVALID_CONDITION", `${label(condition.field)} requires numeric values`);
  const ok = condition.operator === "lte" ? actual <= target : actual >= target;
  return ok ? null : reason(condition, "THRESHOLD_NOT_MET", `${label(condition.field)} ${actual} does not meet ${condition.operator} ${target}`);
}

export function evaluateProviderEndpoints(endpoints: EndpointDto[], filterConfig: ProviderFilterConfig | null | undefined, context: FilterEvaluationContext): ProviderFilterResult {
  const metadataState = context.metadataState ?? "fresh";
  const evaluations = endpoints.map((endpoint) => {
    const reasons = filterConfig?.enabled ? filterConfig.conditions.filter((c) => c.enabled).map((c) => evaluateCondition(endpoint, c)).filter((r): r is FilterReason => r !== null) : [];
    return { endpoint, eligible: reasons.length === 0, reasons };
  });
  const eligibleEndpoints = evaluations.filter((e) => e.eligible);
  const failureReason = eligibleEndpoints.length ? null : metadataState === "unavailable" ? "FILTER_DATA_UNAVAILABLE" : metadataState === "stale" ? "FILTER_DATA_STALE" : "NO_ELIGIBLE_PROVIDER";
  return { modelId: context.modelId, totalEndpoints: endpoints.length, eligibleEndpoints, excludedEndpoints: evaluations.filter((e) => !e.eligible), eligibleRoutingIds: eligibleEndpoints.map((e) => e.endpoint.providerRoutingId).filter((id): id is string => Boolean(id)), evaluatedAt: context.evaluatedAt ?? new Date().toISOString(), metadataFetchedAt: context.metadataFetchedAt ?? null, metadataState, usable: eligibleEndpoints.length > 0, failureReason };
}
