import type { EndpointDto } from "../openrouter/endpoints.js";
import type { FilterFieldDefinition } from "./types.js";

const definitions: FilterFieldDefinition[] = [
  ...["p50", "p75", "p90", "p99"].flatMap((p) => [
    { id: `performance.latency.${p}`, label: `Latency ${p.toUpperCase()}`, type: "number" as const, operators: ["lte", "gte"] as const, unit: "seconds" },
    { id: `performance.throughput.${p}`, label: `Throughput ${p.toUpperCase()}`, type: "number" as const, operators: ["lte", "gte"] as const, unit: "t/s" },
  ]),
  { id: "uptime.5m", label: "Uptime 5m", type: "number", operators: ["lte", "gte"], unit: "%" },
  { id: "uptime.30m", label: "Uptime 30m", type: "number", operators: ["lte", "gte"], unit: "%" },
  { id: "uptime.1d", label: "Uptime 1d", type: "number", operators: ["lte", "gte"], unit: "%" },
  { id: "quantization", label: "Quantization", type: "string", operators: ["eq", "in"] },
  { id: "context.length", label: "Context Length", type: "number", operators: ["lte", "gte"] },
  { id: "context.maxPrompt", label: "Max Prompt Tokens", type: "number", operators: ["lte", "gte"] },
  { id: "context.maxCompletion", label: "Max Completion Tokens", type: "number", operators: ["lte", "gte"] },
  { id: "supportedParameters", label: "Supported Parameter", type: "string[]", operators: ["contains"] },
  { id: "supportsImplicitCaching", label: "Implicit Caching", type: "boolean", operators: ["eq", "exists"] },
  { id: "provider.routingId", label: "Provider Routing ID", type: "string", operators: ["in", "notIn"] },
];

export function getFilterFieldRegistry(endpoints: EndpointDto[] = []): FilterFieldDefinition[] {
  const pricing = new Set<string>();
  for (const endpoint of endpoints) {
    if (!endpoint.pricing || typeof endpoint.pricing !== "object" || Array.isArray(endpoint.pricing)) continue;
    for (const [key, value] of Object.entries(endpoint.pricing)) {
      if (typeof value === "number" || (typeof value === "string" && Number.isFinite(Number(value)))) pricing.add(key);
    }
  }
  return [...definitions, ...Array.from(pricing, (key) => ({ id: `pricing.${key}`, label: key.replaceAll("_", " "), type: "number" as const, operators: ["lte", "gte", "eq"] as const, unit: "$/1M", dynamic: true }))];
}

export const filterFieldRegistry = getFilterFieldRegistry();
