import { z } from "zod";

const nullableUnknown = z.unknown().nullable().optional().transform((value) => value ?? null);
const modelSchema = z.object({
  id: z.string(),
  canonical_slug: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  context_length: z.number().nullable().optional(),
  pricing: nullableUnknown,
  architecture: nullableUnknown,
  supported_parameters: z.array(z.string()).nullable().optional(),
  created: z.number().nullable().optional(),
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
}

export interface ParsedModels { models: ModelDto[]; raw: unknown; }

export function parseModelsResponse(raw: unknown): ParsedModels {
  const parsed = modelsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("OpenRouter models response has an invalid data array");
  return {
    models: parsed.data.data.map((model) => ({
      id: model.id,
      canonicalSlug: model.canonical_slug ?? null,
      name: model.name ?? null,
      contextLength: model.context_length ?? null,
      pricing: model.pricing,
      architecture: model.architecture,
      supportedParameters: model.supported_parameters ?? null,
      created: model.created ?? null,
    })),
    raw,
  };
}
