import { z } from "zod";

const modelSchema = z.object({
  id: z.string(),
}).passthrough();

const modelsResponseSchema = z.object({ data: z.array(modelSchema) }).passthrough();

export interface ModelDto {
  id: string;
  canonicalSlug: string | null;
  name: string | null;
  contextLength: number | null;
  pricing: unknown | null;
  architecture: unknown | null;
  supportedParameters: string[] | null;
  created: number | null;
  description: string | null;
  inputModalities: string[] | null;
  outputModalities: string[] | null;
  maxCompletionTokens: number | null;
}

export interface ParsedModels { models: ModelDto[]; raw: unknown; }

export function parseModelsResponse(raw: unknown): ParsedModels {
  const parsed = modelsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("OpenRouter models response has an invalid data array");
  return {
    models: parsed.data.data.map((model) => {
      const record = model as Record<string, unknown>;
      const architecture = objectOrNull(record.architecture);
      const topProvider = objectOrNull(record.top_provider);
      return {
        id: model.id,
        canonicalSlug: stringOrNull(record.canonical_slug),
        name: stringOrNull(record.name),
        contextLength: numberOrNull(record.context_length),
        pricing: record.pricing ?? null,
        architecture: record.architecture ?? null,
        supportedParameters: stringsOrNull(record.supported_parameters),
        created: numberOrNull(record.created),
        description: stringOrNull(record.description),
        inputModalities: stringsOrNull(architecture?.input_modalities),
        outputModalities: stringsOrNull(architecture?.output_modalities),
        maxCompletionTokens: numberOrNull(topProvider?.max_completion_tokens),
      };
    }),
    raw,
  };
}

function stringOrNull(value: unknown): string | null { return typeof value === "string" ? value : null; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function stringsOrNull(value: unknown): string[] | null { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null; }
function objectOrNull(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
