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
  quantization: z.string().nullable().optional(),
  supported_parameters: z.array(z.string()).nullable().optional(),
  latency_last_30m: nullableUnknown,
  throughput_last_30m: nullableUnknown,
  uptime_last_5m: nullableUnknown,
  uptime_last_30m: nullableUnknown,
  uptime_last_1d: nullableUnknown,
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
  pricing: unknown | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  quantization: string | null;
  supportedParameters: string[] | null;
  latencyLast30m: unknown | null;
  throughputLast30m: unknown | null;
  uptimeLast5m: unknown | null;
  uptimeLast30m: unknown | null;
  uptimeLast1d: unknown | null;
  status: string | number | null;
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
      providerRoutingId: endpoint.tag ?? endpoint.provider_slug ?? null,
      tag: endpoint.tag ?? null,
      name: endpoint.name ?? null,
      modelId: endpoint.model_id ?? null,
      pricing: endpoint.pricing,
      contextLength: endpoint.context_length ?? null,
      maxCompletionTokens: endpoint.max_completion_tokens ?? null,
      quantization: endpoint.quantization ?? null,
      supportedParameters: endpoint.supported_parameters ?? null,
      latencyLast30m: endpoint.latency_last_30m,
      throughputLast30m: endpoint.throughput_last_30m,
      uptimeLast5m: endpoint.uptime_last_5m,
      uptimeLast30m: endpoint.uptime_last_30m,
      uptimeLast1d: endpoint.uptime_last_1d,
      status: endpoint.status ?? null,
    })),
    raw,
  };
}
