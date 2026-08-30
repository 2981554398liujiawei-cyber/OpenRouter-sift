import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer } from "../src/server";
import { NoopSecureStore } from "../src/auth/secureStore";
import { isolatedConfig } from "./helpers";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];
const tempDirs: string[] = [];
const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const noopSecureStore = new NoopSecureStore();

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("G14 cache and session passthrough", () => {
  it("passes explicit affinity through all protocols and records cache metadata only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-g14-cache-")); tempDirs.push(dir);
    const upstreamCalls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let generationNumber = 0;
    globalThis.fetch = vi.fn(async (url, init) => {
      const value = String(url);
      if (value.includes("/generation?")) return new Response(JSON.stringify({ data: { provider_name: "Cache Provider", tokens_prompt: 100, tokens_completion: 10, total_cost: 0.002 } }), { status: 200 });
      if (value === "https://openrouter.ai/api/v1/chat/completions" || value === "https://openrouter.ai/api/v1/responses" || value === "https://openrouter.ai/api/v1/messages") {
        upstreamCalls.push({ url: value, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: typeof init?.body === "string" ? init.body : "" });
        generationNumber += 1;
        return new Response(JSON.stringify({ id: `gen-g14-${generationNumber}`, usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 } }, cache_discount: 0.001 }), { status: 200, headers: { "content-type": "application/json", "x-generation-id": `gen-g14-${generationNumber}`, "x-openrouter-cache-status": "HIT", "x-openrouter-cache-age": "7", "x-session-id": "upstream-session" } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const cfg = isolatedConfig(dir, { upstream_api_key: "sk-or-g14-upstream", local_api_key: "control-g14" });
    const server = startServer(cfg, { secureStore: noopSecureStore }); servers.push(server); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const path of ["/v1/chat/completions", "/v1/responses", "/v1/messages"]) {
      const response = await nativeFetch(`${base}${path}`, { method: "POST", headers: { authorization: "Bearer control-g14", "content-type": "application/json", "x-session-id": "session-g14" }, body: JSON.stringify({ model: "demo/model", session_id: "session-g14", messages: [{ role: "user", content: "SUPER_SECRET_PROMPT_G14" }] }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-session-id")).toBe("upstream-session");
    }
    expect(upstreamCalls).toHaveLength(3);
    for (const call of upstreamCalls) {
      expect(call.headers.authorization).toBe("Bearer sk-or-g14-upstream");
      expect(call.headers["x-session-id"]).toBe("session-g14");
      expect(call.body).toContain("\"session_id\":\"session-g14\"");
      expect(call.body).not.toContain("control-g14");
    }
    await pause(300);
    const list = await (await nativeFetch(`${base}/api/requests?limit=10`, { headers: { authorization: "Bearer control-g14" } })).json() as any;
    expect(list.total).toBe(3);
    expect(list.items[0]).toMatchObject({ cacheStatus: "HIT", cachedPromptTokens: 80, cacheWriteTokens: 0, cacheDiscountUsd: 0.001, sessionAffinity: "explicit" });
    const persisted = readFileSync(cfg.request_log_store_path, "utf8");
    expect(persisted).not.toContain("SUPER_SECRET_PROMPT_G14");
    expect(persisted).not.toContain("SUPER_SECRET_RESPONSE_G14");
    expect(persisted).not.toContain("session-g14");
    expect(persisted).not.toContain("sk-or-g14-upstream");
  });

  it("keeps x-session-id and body session_id intact for streaming responses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-g14-stream-")); tempDirs.push(dir);
    let upstreamBody = "";
    let upstreamSession = "";
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url) === "https://openrouter.ai/api/v1/chat/completions") {
        upstreamBody = typeof init?.body === "string" ? init.body : "";
        upstreamSession = new Headers(init?.headers).get("x-session-id") ?? "";
        return new Response("data: {\"id\":\"stream-g14\"}\n\ndata: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream", "x-session-id": "stream-upstream" } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;
    const cfg = isolatedConfig(dir, { upstream_api_key: "sk-or-g14-stream", local_api_key: "control-g14-stream" });
    const server = startServer(cfg, { secureStore: noopSecureStore }); servers.push(server); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const response = await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer control-g14-stream", "content-type": "application/json", "x-session-id": "stream-g14" }, body: JSON.stringify({ model: "demo/model", stream: true, session_id: "stream-g14", messages: [{ role: "user", content: "stream" }] }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-session-id")).toBe("stream-upstream");
    expect(await response.text()).toContain("stream-g14");
    expect(upstreamSession).toBe("stream-g14");
    expect(upstreamBody).toContain("\"session_id\":\"stream-g14\"");
  });
});
