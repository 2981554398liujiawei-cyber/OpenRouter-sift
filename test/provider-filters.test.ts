import { describe, expect, it } from "vitest";
import { evaluateProviderEndpoints } from "../src/providerFilters/evaluator.js";
import { getFilterFieldRegistry } from "../src/providerFilters/registry.js";
import type { EndpointDto } from "../src/openrouter/endpoints.js";

const endpoint = (patch: Partial<EndpointDto> = {}): EndpointDto => ({
  providerName: "Demo", providerSlug: "demo", providerRoutingId: "demo", tag: "demo", name: "Demo",
  modelId: "demo/model", pricing: { prompt: "0.0000002", completion: 0.0000008, input_cache_read: "0.00000004", discount: 0.1 },
  contextLength: 128000, maxCompletionTokens: 8192, maxPromptTokens: 120000, quantization: "fp16",
  supportedParameters: ["tools", "response_format"], performance: {
    latencyLast30m: { p50: 1, p75: 1.2, p90: 1.5, p99: 2 }, throughputLast30m: { p50: 50, p75: 55, p90: 60, p99: 65 }, uptimeLast5m: 99.5, uptimeLast30m: 99.6, uptimeLast1d: 99.7,
  }, status: 0, ...patch,
});
const context = { modelId: "demo/model", evaluatedAt: "2026-08-27T00:00:00.000Z", metadataFetchedAt: "2026-08-27T00:00:00.000Z", metadataState: "fresh" as const };

describe("provider filter engine", () => {
  it("has no-filter all-eligible semantics and never mutates endpoints", () => {
    const input = [endpoint(), endpoint({ providerRoutingId: "other" })];
    const result = evaluateProviderEndpoints(input, null, context);
    expect(result.eligibleRoutingIds).toEqual(["demo", "other"]);
    expect(result.excludedEndpoints).toHaveLength(0);
    expect(input[0].pricing).toEqual({ prompt: "0.0000002", completion: 0.0000008, input_cache_read: "0.00000004", discount: 0.1 });
  });

  it("ANDs hard conditions, converts token pricing to $/1M, and returns all reasons", () => {
    const result = evaluateProviderEndpoints([endpoint({ performance: { ...endpoint().performance, throughputLast30m: { p50: 30, p75: 30, p90: 30, p99: 30 } } })], {
      enabled: true, mode: "all", maxTelemetryAgeMs: 60000, updatedAt: context.evaluatedAt, conditions: [
        { id: "price", field: "pricing.prompt", operator: "lte", value: 0.2, enabled: true },
        { id: "speed", field: "performance.throughput.p50", operator: "gte", value: 40, enabled: true },
        { id: "cache", field: "pricing.input_cache_read", operator: "lte", value: 0.05, enabled: true },
      ],
    }, context);
    expect(result.usable).toBe(false);
    expect(result.excludedEndpoints[0].reasons.map((r) => r.conditionId)).toEqual(["speed"]);
  });

  it("supports dynamic prices, capabilities, identity allow/block, and missing data fail-closed", () => {
    const config = (field: string, operator: "in" | "notIn" | "contains" | "eq", value: unknown) => ({ enabled: true, mode: "all" as const, maxTelemetryAgeMs: 0, updatedAt: "now", conditions: [{ id: field, field, operator, value, enabled: true }] });
    expect(evaluateProviderEndpoints([endpoint()], config("provider.routingId", "in", ["demo"]), context).usable).toBe(true);
    expect(evaluateProviderEndpoints([endpoint()], config("provider.routingId", "notIn", ["demo"]), context).usable).toBe(false);
    expect(evaluateProviderEndpoints([endpoint()], config("supportedParameters", "contains", "tools"), context).usable).toBe(true);
    expect(evaluateProviderEndpoints([endpoint({ pricing: { future_dimension: "0.000001" } })], config("pricing.future_dimension", "lte", 1), context).usable).toBe(true);
    const missing = evaluateProviderEndpoints([endpoint({ pricing: { prompt: "0.0000002" }, performance: { ...endpoint().performance, throughputLast30m: null } })], config("performance.throughput.p50", "gte", 1), context);
    expect(missing.excludedEndpoints[0].reasons[0].code).toBe("THROUGHPUT_DATA_MISSING");
  });

  it("reports stale and unavailable metadata distinctly", () => {
    const config = { enabled: true, mode: "all" as const, maxTelemetryAgeMs: 0, updatedAt: "now", conditions: [{ id: "x", field: "pricing.prompt", operator: "lte" as const, value: 0, enabled: true }] };
    expect(evaluateProviderEndpoints([endpoint()], config, { ...context, metadataState: "stale" }).failureReason).toBe("FILTER_DATA_STALE");
    expect(evaluateProviderEndpoints([endpoint()], config, { ...context, metadataState: "unavailable" }).failureReason).toBe("FILTER_DATA_UNAVAILABLE");
  });

  it("registers observed dynamic pricing dimensions", () => {
    const fields = getFilterFieldRegistry([endpoint()]);
    expect(fields.find((field) => field.id === "pricing.input_cache_read")?.unit).toBe("$/1M");
    expect(fields.find((field) => field.id === "pricing.discount")).toBeDefined();
  });
});
