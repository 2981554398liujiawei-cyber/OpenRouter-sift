import { z } from "zod";

const numberOrNull = z.unknown().transform((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
const stringOrNull = z.unknown().transform((value) => typeof value === "string" ? value : null);
const booleanOrNull = z.unknown().transform((value) => typeof value === "boolean" ? value : null);
const generationSchema = z.object({
  provider_name: stringOrNull,
  tokens_prompt: numberOrNull,
  tokens_completion: numberOrNull,
  total_tokens: numberOrNull,
  total_cost: numberOrNull,
  latency: numberOrNull,
  generation_time: numberOrNull,
  finish_reason: stringOrNull,
  is_byok: booleanOrNull,
  router: stringOrNull,
  service_tier: stringOrNull,
  cancelled: booleanOrNull,
  streamed: booleanOrNull,
}).passthrough();

export interface GenerationMetadata {
  providerName: string | null;
  providerRoutingId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  latency: number | null;
  generationTime: number | null;
  finishReason: string | null;
  isByok: boolean | null;
  router: string | null;
  serviceTier: string | null;
  cancelled: boolean | null;
  streamed: boolean | null;
}

/** Generation responses are additive: only copy fields safe for local metadata history. */
export function parseGenerationResponse(raw: unknown): GenerationMetadata {
  const container = raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw;
  const parsed = generationSchema.safeParse(container);
  if (!parsed.success) throw new Error("OpenRouter generation response has an invalid object");
  const data = parsed.data;
  // The documented generation response exposes provider_name, but no stable provider routing slug.
  return { providerName: data.provider_name, providerRoutingId: null, promptTokens: data.tokens_prompt, completionTokens: data.tokens_completion, totalTokens: data.total_tokens, totalCost: data.total_cost, latency: data.latency, generationTime: data.generation_time, finishReason: data.finish_reason, isByok: data.is_byok, router: data.router, serviceTier: data.service_tier, cancelled: data.cancelled, streamed: data.streamed };
}
