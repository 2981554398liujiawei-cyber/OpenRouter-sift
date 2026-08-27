import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];
afterEach(async () => { globalThis.fetch = nativeFetch; await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); })); });
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("request observability API", () => {
  it("records three protocols, enriches from generation metadata, and never persists content or keys", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-observability-"));
    try {
      globalThis.fetch = vi.fn(async (url) => {
        const value = String(url);
        if (value.includes("/generation?")) return new Response(JSON.stringify({ data: { provider_name: "Verified Provider", tokens_prompt: 7, tokens_completion: 3, total_cost: 0.0042, latency: 88, generation_time: 55, finish_reason: "stop", is_byok: false, router: "openrouter/auto" } }), { status: 200 });
        return new Response("SUPER_SECRET_RESPONSE_67890", { status: 200, headers: { "content-type": "text/plain", "x-generation-id": "gen-test" } });
      }) as typeof fetch;
      const cfg = loadConfig({});
      cfg.port = 0; cfg.log_level = "silent"; cfg.upstream_api_key = "test-upstream-key";
      cfg.request_log_store_path = join(directory, "requests.json"); cfg.model_policy_store_path = join(directory, "policies.json"); cfg.metadata_cache_path = join(directory, "metadata.json"); cfg.settings_store_path = join(directory, "settings.json");
      const server = startServer(cfg); servers.push(server); await once(server, "listening");
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      const base = `http://127.0.0.1:${address.port}`;
      for (const path of ["/v1/chat/completions", "/v1/responses", "/v1/messages"]) {
        const response = await nativeFetch(`${base}${path}`, { method: "POST", headers: { authorization: "Bearer inbound-secret", "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-demo", stream: path.endsWith("messages"), messages: [{ role: "user", content: "SUPER_SECRET_PROMPT_12345" }] }) });
        expect(response.status).toBe(200);
      }
      await pause(350);
      const list = await (await nativeFetch(`${base}/api/requests?limit=10`)).json() as any;
      expect(list).toMatchObject({ total: 3 });
      expect(list.items.map((item: any) => item.protocol).sort()).toEqual(["anthropic_messages", "chat_completions", "responses"]);
      expect(list.items[0]).toMatchObject({ provider: "Verified Provider", promptTokens: 7, completionTokens: 3, costUsd: 0.0042, enrichmentStatus: "success" });
      const detail = await (await nativeFetch(`${base}/api/requests/${list.items[0].id}`)).json() as any;
      expect(detail).toMatchObject({ generationId: "gen-test", actualProviderName: "Verified Provider", actualProviderRoutingId: null, openRouterLatencyMs: 88 });
      expect(JSON.stringify(detail)).not.toContain("SUPER_SECRET_PROMPT_12345");
      expect(JSON.stringify(detail)).not.toContain("SUPER_SECRET_RESPONSE_67890");
      const persisted = readFileSync(cfg.request_log_store_path, "utf8");
      expect(persisted).not.toContain("SUPER_SECRET_PROMPT_12345");
      expect(persisted).not.toContain("SUPER_SECRET_RESPONSE_67890");
      expect(persisted).not.toContain("inbound-secret");
      expect(persisted).not.toContain("test-upstream-key");
      expect((await nativeFetch(`${base}/api/requests`, { method: "DELETE" })).status).toBe(200);
      expect((await (await nativeFetch(`${base}/api/requests`)).json() as any).total).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps inference successful when generation enrichment fails and records local policy rejection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-observability-failure-"));
    try {
      globalThis.fetch = vi.fn(async (url) => String(url).includes("/generation?") ? new Response("unavailable", { status: 500 }) : new Response("ok", { status: 200, headers: { "x-generation-id": "gen-unavailable" } })) as typeof fetch;
      const cfg = loadConfig({}); cfg.port = 0; cfg.log_level = "silent"; cfg.upstream_api_key = "configured-key"; cfg.merge_mode = "strict"; cfg.policy = { only: ["relace"] };
      cfg.request_log_store_path = join(directory, "requests.json"); cfg.model_policy_store_path = join(directory, "policies.json"); cfg.metadata_cache_path = join(directory, "metadata.json"); cfg.settings_store_path = join(directory, "settings.json");
      const server = startServer(cfg); servers.push(server); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP listener"); const base = `http://127.0.0.1:${address.port}`;
      expect((await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-demo", messages: [], provider: { only: ["other"] } }) })).status).toBe(422);
      expect((await nativeFetch(`${base}/v1/responses`, { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-demo", input: "not persisted" }) })).status).toBe(200);
      await pause(350);
      const list = await (await nativeFetch(`${base}/api/requests?status=422`)).json() as any;
      expect(list.items[0]).toMatchObject({ status: 422, enrichmentStatus: "unavailable" });
      const failed = await (await nativeFetch(`${base}/api/requests?status=200`)).json() as any;
      expect(failed.items[0]).toMatchObject({ enrichmentStatus: "failed", provider: null });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
