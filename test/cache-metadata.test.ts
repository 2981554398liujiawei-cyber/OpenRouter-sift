import { describe, expect, it } from "vitest";
import { parseCacheMetadata } from "../src/observability/cacheMetadata";

describe("cache metadata parsing", () => {
  it("extracts documented usage metadata without retaining content", () => {
    expect(parseCacheMetadata({ data: { usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 50 }, completion_tokens: 12 }, cache_discount: 0.003, choices: [{ message: { content: "SUPER_SECRET_RESPONSE_G14" } }] } })).toEqual({ promptTokens: 1000, cachedPromptTokens: 800, cacheWriteTokens: 50, cacheDiscountUsd: 0.003 });
  });

  it("supports input token details and leaves missing values null", () => {
    expect(parseCacheMetadata({ usage: { input_tokens: 40, input_tokens_details: { cache_read_tokens: 20 } } })).toEqual({ promptTokens: 40, cachedPromptTokens: 20, cacheWriteTokens: null, cacheDiscountUsd: null });
    expect(parseCacheMetadata({ usage: { prompt_tokens: "40", prompt_tokens_details: { cached_tokens: Infinity } } })).toEqual({ promptTokens: null, cachedPromptTokens: null, cacheWriteTokens: null, cacheDiscountUsd: null });
  });
});
