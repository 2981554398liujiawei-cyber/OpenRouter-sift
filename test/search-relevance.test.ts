import { describe, expect, it } from "vitest";
import { modelRelevance } from "../ui/src/search";
import type { ModelSummary } from "../ui/src/types";

const model = (id: string, name: string, creator: string, description = ""): ModelSummary => ({ id, name, creator, description, contextLength: 128000, pricing: {}, policySummary: "inherit" });

describe("model search relevance", () => {
  it("ranks name, id, and creator matches above description-only matches", () => {
    const direct = model("deepseek/deepseek-chat", "DeepSeek Chat", "deepseek");
    const creatorMatch = model("lab/fast-chat", "Fast Chat", "deepseek");
    const descriptionMatch = model("aion/aion-2", "Aion 2", "aion", "A general model informed by DeepSeek research.");
    expect(modelRelevance(direct, "DeepSeek")).toBeGreaterThan(modelRelevance(creatorMatch, "DeepSeek") ?? -1);
    expect(modelRelevance(creatorMatch, "DeepSeek")).toBeGreaterThan(modelRelevance(descriptionMatch, "DeepSeek") ?? -1);
  });

  it("requires every token and scores multi-token matches", () => {
    expect(modelRelevance(model("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek"), "deepseek flash")).not.toBeNull();
    expect(modelRelevance(model("deepseek/deepseek-chat", "DeepSeek Chat", "deepseek"), "deepseek flash")).toBeNull();
  });
});
