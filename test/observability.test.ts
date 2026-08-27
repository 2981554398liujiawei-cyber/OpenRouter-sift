import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseGenerationResponse } from "../src/openrouter/generation";
import { newRequestRecord } from "../src/observability/requestRecord";
import { JsonRequestLogStore } from "../src/observability/requestStore";

describe("request observability storage", () => {
  it("persists only bounded metadata records and recovers them after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-requests-"));
    try {
      const path = join(directory, "requests.json");
      const store = new JsonRequestLogStore(path, 2);
      for (const id of ["req_one", "req_two", "req_three"]) store.begin({ ...newRequestRecord(id, "chat_completions"), requestedModel: "openai/gpt-demo" });
      store.persist();
      const serialized = readFileSync(path, "utf8");
      expect(serialized).not.toContain("requestBody");
      expect(serialized).not.toContain("responseBody");
      expect(store.list({ limit: 10 }).items.map((record) => record.id).sort()).toEqual(["req_three", "req_two"]);
      const restarted = new JsonRequestLogStore(path, 2);
      restarted.load();
      expect(restarted.get("req_one")).toBeUndefined();
      expect(restarted.clear()).toBe(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("maps only known generation metadata fields and preserves zero cost", () => {
    const parsed = parseGenerationResponse({ data: { provider_name: "Confirmed Provider", tokens_prompt: 12, tokens_completion: 4, total_cost: 0, latency: 123, generation_time: 99, streamed: true, cancelled: false, router: "openrouter/auto", unknown_future_field: "ignored" } });
    expect(parsed).toMatchObject({ providerName: "Confirmed Provider", providerRoutingId: null, promptTokens: 12, completionTokens: 4, totalCost: 0, latency: 123, generationTime: 99, streamed: true, cancelled: false, router: "openrouter/auto" });
  });
});
