import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { parseGenerationResponse } from "../src/openrouter/generation";
import { newRequestRecord } from "../src/observability/requestRecord";
import { RequestTracker } from "../src/observability/requestTracker";
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

  it("re-queues persisted pending enrichments after a restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-requests-"));
    try {
      const path = join(directory, "requests.json");
      const first = new JsonRequestLogStore(path);
      first.begin({ ...newRequestRecord("req_recover", "chat_completions"), generationId: "gen_recover", enrichmentStatus: "pending" });
      first.persist();
      const store = new JsonRequestLogStore(path);
      store.load();
      const client = { getGeneration: vi.fn(async () => ({ data: { provider_name: "Alpha", tokens_prompt: 5, tokens_completion: 3, total_cost: 0.00001, latency: 42, generation_time: 30, streamed: true } })) };
      new RequestTracker(store, { error: () => undefined, info: () => undefined, debug: () => undefined } as never, client as never);
      await vi.waitFor(() => expect(store.get("req_recover")?.enrichmentStatus).toBe("success"));
      expect(store.get("req_recover")).toMatchObject({ actualProviderName: "Alpha", promptTokens: 5, completionTokens: 3, costUsd: 0.00001, openRouterLatencyMs: 42 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("resolves a recovered pending enrichment to failed once the generation stays unavailable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-requests-"));
    try {
      const path = join(directory, "requests.json");
      const first = new JsonRequestLogStore(path);
      first.begin({ ...newRequestRecord("req_gone", "chat_completions"), generationId: "gen_gone", enrichmentStatus: "pending" });
      first.persist();
      const store = new JsonRequestLogStore(path);
      store.load();
      const error = Object.assign(new Error("not found"), { code: "NOT_FOUND", status: 404 });
      const client = { getGeneration: vi.fn(async () => { throw error; }) };
      new RequestTracker(store, { error: () => undefined, info: () => undefined, debug: () => undefined } as never, client as never);
      await vi.waitFor(() => expect(store.get("req_gone")?.enrichmentStatus).toBe("failed"));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
