import { z } from "zod";

const nullableUnknown = z.unknown().nullable().optional().transform((value) => value ?? null);
const endpointSchema = z.object({
  provider_name: z.string().nullable().optional(),
  provider_slug: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  model_id: z.string().nullable().optional(),
  pricing: nullableUnknown,
  context_length: z.number().nullable().optional(),
  max_completion_tokens: z.number().nullable().optional(),
  max_prompt_tokens: z.number().nullable().optional(),
  quantization: z.string().nullable().optional(),
  supported_parameters: z.array(z.string()).nullable().optional(),
  supports_implicit_caching: z.boolean().nullable().optional(),
  latency_last_30m: z.unknown().optional(),
  throughput_last_30m: z.unknown().optional(),
  uptime_last_5m: z.unknown().optional(),
  uptime_last_30m: z.unknown().optional(),
  uptime_last_1d: z.unknown().optional(),
  status: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough();

const endpointsResponseSchema = z.object({
  data: z.object({ endpoints: z.array(endpointSchema) }).passthrough(),
}).passthrough();

export interface EndpointDto {
  providerName: string | null;
  providerSlug: string | null;
  providerRoutingId: string | null;
  tag: string | null;
  name: string | null;
  modelId: string | null;
  /** OpenRouter's raw per-token pricing; do not round or convert units in storage. */
  pricing: unknown | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  maxPromptTokens: number | null;
  quantization: string | null;
  supportedParameters: string[] | null;
  supportsImplicitCaching: boolean | null;
  performance: {
    latencyLast30m: PercentileMetric | null;
    throughputLast30m: PercentileMetric | null;
    uptimeLast5m: number | null;
    uptimeLast30m: number | null;
    uptimeLast1d: number | null;
  };
  status: string | number | null;
}

export interface PercentileMetric { p50: number | null; p75: number | null; p90: number | null; p99: number | null; }

function normalizePercentiles(value: unknown): PercentileMetric | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metric = value as Record<string, unknown>;
  const numberOrNull = (key: keyof PercentileMetric) => typeof metric[key] === "number" && Number.isFinite(metric[key]) ? metric[key] : null;
  return { p50: numberOrNull("p50"), p75: numberOrNull("p75"), p90: numberOrNull("p90"), p99: numberOrNull("p99") };
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ParsedEndpoints { endpoints: EndpointDto[]; raw: unknown; }

export function parseEndpointsResponse(raw: unknown): ParsedEndpoints {
  const parsed = endpointsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("OpenRouter endpoints response has an invalid data.endpoints array");
  return {
    endpoints: parsed.data.data.endpoints.map((endpoint) => ({
      providerName: endpoint.provider_name ?? null,
      providerSlug: endpoint.provider_slug ?? null,
      // `tag` is OpenRouter's documented provider/endpoint selector. Never derive it from display text.
      providerRoutingId: endpoint.tag ?? null,
      tag: endpoint.tag ?? null,
      name: endpoint.name ?? null,
      modelId: endpoint.model_id ?? null,
      pricing: endpoint.pricing,
      contextLength: endpoint.context_length ?? null,
      maxCompletionTokens: endpoint.max_completion_tokens ?? null,
      maxPromptTokens: endpoint.max_prompt_tokens ?? null,
      quantization: endpoint.quantization ?? null,
      supportedParameters: endpoint.supported_parameters ?? null,
      supportsImplicitCaching: endpoint.supports_implicit_caching ?? null,
      performance: {
        latencyLast30m: normalizePercentiles(endpoint.latency_last_30m),
        throughputLast30m: normalizePercentiles(endpoint.throughput_last_30m),
        uptimeLast5m: normalizeNumber(endpoint.uptime_last_5m),
        uptimeLast30m: normalizeNumber(endpoint.uptime_last_30m),
        uptimeLast1d: normalizeNumber(endpoint.uptime_last_1d),
      },
      status: endpoint.status ?? null,
    })),
    raw,
  };
}
