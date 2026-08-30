export interface CacheMetadata {
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  cacheWriteTokens: number | null;
  cacheDiscountUsd: number | null;
}

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const recordOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Extract metadata only; never return or retain prompt/response content. */
export function parseCacheMetadata(raw: unknown): CacheMetadata {
  const root = recordOf(raw);
  const data = recordOf(root.data ?? raw);
  const usage = recordOf(data.usage ?? root.usage);
  const promptDetails = recordOf(usage.prompt_tokens_details ?? usage.input_tokens_details);
  return {
    promptTokens: finiteNumber(usage.prompt_tokens ?? usage.input_tokens),
    cachedPromptTokens: finiteNumber(promptDetails.cached_tokens ?? promptDetails.cache_read_tokens ?? usage.cached_tokens),
    cacheWriteTokens: finiteNumber(promptDetails.cache_write_tokens ?? usage.cache_write_tokens),
    cacheDiscountUsd: finiteNumber(data.cache_discount ?? root.cache_discount ?? promptDetails.cache_discount ?? usage.cache_discount),
  };
}

export function mergeCacheMetadata(primary: CacheMetadata, fallback: CacheMetadata): CacheMetadata {
  return {
    promptTokens: primary.promptTokens ?? fallback.promptTokens,
    cachedPromptTokens: primary.cachedPromptTokens ?? fallback.cachedPromptTokens,
    cacheWriteTokens: primary.cacheWriteTokens ?? fallback.cacheWriteTokens,
    cacheDiscountUsd: primary.cacheDiscountUsd ?? fallback.cacheDiscountUsd,
  };
}
