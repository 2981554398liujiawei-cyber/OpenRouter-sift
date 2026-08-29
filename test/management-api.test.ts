import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];
const models = { data: [{ id: "openai/gpt-demo", name: "GPT Demo", context_length: 128000, pricing: { prompt: "0.1" } }] };
const endpoints = { data: { endpoints: [{ provider_name: "OpenAI", tag: "openai", pricing: { prompt: "0.1" }, latency_last_30m: { p50: 1, p75: 2, p90: 3, p99: 4 }, throughput_last_30m: { p50: 100, p75: 90, p90: 80, p99: 70 }, uptime_last_5m: 99, uptime_last_30m: 98, uptime_last_1d: 97, quantization: "fp8", status: 0 }] } };

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
});

describe("management API", () => {
  it("uses one persisted policy and resolver across list, preview, and proxy requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-management-"));
    const upstreamBodies: any[] = [];
    try {
      globalThis.fetch = vi.fn(async (url, init) => {
        const value = String(url);
        if (value.endsWith("/models")) return new Response(JSON.stringify(models), { status: 200 });
        if (value.includes("/endpoints")) return new Response(JSON.stringify(endpoints), { status: 200 });
        upstreamBodies.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const cfg = loadConfig({});
      cfg.port = 0;
      cfg.upstream_api_key = "sk-or-1234";
      cfg.policy = { ignore: ["global-provider"] };
      cfg.model_policy_store_path = join(directory, "policies.json");
      cfg.metadata_cache_path = join(directory, "metadata.json");
      cfg.settings_store_path = join(directory, "settings.json");
      cfg.log_level = "silent";
      const server = startServer(cfg);
      servers.push(server);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      const base = `http://127.0.0.1:${address.port}`;

      const status = await (await nativeFetch(`${base}/api/status`)).json() as any;
      expect(status).toMatchObject({ proxy: { running: true }, openrouter: { configured: true }, catalog: { modelCount: 0 } });
      expect(globalThis.fetch).not.toHaveBeenCalled();

      const updatedSettings = await (await nativeFetch(`${base}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mergeMode: "override", globalPolicy: { ignore: ["settings-provider"] }, metadataTtlMs: 10_000 }) })).json() as any;
      expect(updatedSettings).toMatchObject({ mergeMode: "override", globalPolicy: { ignore: ["settings-provider"] }, metadataTtlMs: 10_000 });

      await nativeFetch(`${base}/api/models/refresh`, { method: "POST" });
      const list = await (await nativeFetch(`${base}/api/models?q=demo`)).json() as any;
      expect(list).toMatchObject({ total: 1, items: [{ id: "openai/gpt-demo", policySummary: "inherit" }] });
      const detail = await (await nativeFetch(`${base}/api/models/openai%2Fgpt-demo`)).json() as any;
      expect(detail).toMatchObject({ model: { id: "openai/gpt-demo" }, policy: { mode: "inherit" } });
      const endpointList = await (await nativeFetch(`${base}/api/models/openai%2Fgpt-demo/endpoints`)).json() as any;
      expect(endpointList).toMatchObject({ items: [{ providerRoutingId: "openai", performance: { latencyLast30m: { p50: 1 }, throughputLast30m: { p50: 100 } } }] });

      const put = await nativeFetch(`${base}/api/policies/openai%2Fgpt-demo`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "allowlist", providers: ["relace"], providerOrder: ["relace"], allowFallbacks: false }) });
      expect(put.status).toBe(200);
      const saved = await (await nativeFetch(`${base}/api/policies/openai%2Fgpt-demo`)).json() as any;
      expect(saved).toMatchObject({ mode: "allowlist", providers: ["relace"], providerOrder: ["relace"], allowFallbacks: false });
      const preview = await (await nativeFetch(`${base}/api/policies/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: "openai/gpt-demo", candidatePolicy: { mode: "allowlist", providers: ["relace"], allowFallbacks: false } }) })).json() as any;
      expect(preview).toMatchObject({ openRouterProviderPayload: { only: ["relace"], allow_fallbacks: false } });

      await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-demo", messages: [] }) });
      expect(upstreamBodies.at(-1)).toMatchObject({ provider: { only: ["relace"], order: ["relace"], allow_fallbacks: false } });
      await nativeFetch(`${base}/api/policies/openai%2Fgpt-demo`, { method: "DELETE" });
      await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-demo", messages: [] }) });
      expect(upstreamBodies.at(-1)).toMatchObject({ provider: { ignore: ["settings-provider"] } });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("validates policy input and keeps keys masked and API routes same-origin", async () => {
    const cfg = loadConfig({});
    cfg.port = 0;
    cfg.upstream_api_key = "sk-or-very-secret";
    cfg.log_level = "silent";
    const server = startServer(cfg);
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const base = `http://127.0.0.1:${address.port}`;
    const invalid = await nativeFetch(`${base}/api/policies/test%2Fmodel`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "allowlist", providers: [] }) });
    expect(invalid.status).toBe(400);
    const duplicate = await nativeFetch(`${base}/api/policies/test%2Fmodel`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "allowlist", providers: ["a"], providerOrder: ["a", "a"] }) });
    expect(duplicate.status).toBe(400);
    const settings = await (await nativeFetch(`${base}/api/settings`)).json() as any;
    expect(JSON.stringify(settings)).not.toContain("very-secret");
    expect(settings.openRouterApiKey.masked).toBe("••••cret");
    expect(settings.openRouterApiKey.configured).toBe(true);
    const updateKey = await nativeFetch(`${base}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ openRouterApiKey: "another-secret" }) });
    expect(updateKey.status).toBe(422);
    const preflight = await nativeFetch(`${base}/api/models`, { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});
