import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

const nativeFetch = globalThis.fetch; const servers: ReturnType<typeof startServer>[] = [];
afterEach(async () => { globalThis.fetch = nativeFetch; await Promise.all(servers.splice(0).map(async (s) => { s.close(); await once(s, "close"); })); });

describe("provider filter API and proxy", () => it("previews and hard-limits managed inference by endpoint tag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sift-filter-")); const forwarded: any[] = []; let endpointCalls = 0;
  try {
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/endpoints")) { endpointCalls++; return new Response(JSON.stringify({ data: { endpoints: [
        { provider_name: "Good", tag: "good", pricing: { prompt: "0.0000001" }, throughput_last_30m: { p50: 50 }, uptime_last_5m: 99.9 },
        { provider_name: "Slow", tag: "slow", pricing: { prompt: "0.0000003" }, throughput_last_30m: { p50: 20 }, uptime_last_5m: 99.9 },
      ] } }), { status: 200 }); }
      forwarded.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const cfg = loadConfig({}); cfg.port = 0; cfg.upstream_api_key = "sk-or-test"; cfg.log_level = "silent"; cfg.desired_model_store_path = join(dir, "desired.json"); cfg.access_key_store_path = join(dir, "keys.json");
    const server = startServer(cfg); servers.push(server); await once(server, "listening"); const a = server.address(); if (!a || typeof a === "string") throw new Error("listener"); const base = `http://127.0.0.1:${a.port}`;
    await nativeFetch(`${base}/api/desired-models/demo%2Fmodel`, { method: "POST" });
    const filter = { enabled: true, mode: "all", maxTelemetryAgeMs: 300000, updatedAt: new Date().toISOString(), conditions: [{ id: "price", field: "pricing.prompt", operator: "lte", value: 0.2, enabled: true }, { id: "speed", field: "performance.throughput.p50", operator: "gte", value: 40, enabled: true }] };
    const preview = await (await nativeFetch(`${base}/api/desired-models/demo%2Fmodel/filter/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateFilter: filter }) })).json() as any;
    expect(preview.eligibleRoutingIds).toEqual(["good"]); expect(preview.excludedEndpoints[0].reasons).toHaveLength(2);
    expect((await nativeFetch(`${base}/api/desired-models/demo%2Fmodel/filter`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(filter) })).status).toBe(200);
    const key = await (await nativeFetch(`${base}/api/access-keys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "A", allowedModels: ["demo/model"] }) })).json() as any;
    const callsBeforeInference = endpointCalls;
    expect((await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "demo/model", messages: [] }) })).status).toBe(200);
    expect(endpointCalls).toBe(callsBeforeInference);
    expect(forwarded.at(-1).provider.only).toEqual(["good"]);
    expect((await nativeFetch(`${base}/api/access-keys/${key.id}/models/demo%2Fmodel/override`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerMode: "allowlist", providers: ["good"], providerOrder: ["good"], allowFallbacks: false }) })).status).toBe(200);
    const savedOverride = await (await nativeFetch(`${base}/api/access-keys/${key.id}/models/demo%2Fmodel/override`)).json() as any;
    expect(savedOverride.override).toMatchObject({ providerMode: "allowlist", providers: ["good"] });
    const overridePreview = await (await nativeFetch(`${base}/api/access-keys/${key.id}/models/demo%2Fmodel/override/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateOverride: { providerMode: "allowlist", providers: ["good"] }, incomingProviderPolicy: { only: ["good", "slow"], max_price: { prompt: 0.2 }, quantizations: ["fp16"], require_parameters: true } }) })).json() as any;
    expect(overridePreview.final.eligible).toEqual(["good"]);
    expect(overridePreview.final.providerPolicy).toMatchObject({ only: ["good"], max_price: { prompt: 0.2 }, quantizations: ["fp16"], require_parameters: true });
    for (const [path, body] of [
      ["/v1/chat/completions", { model: "demo/model", messages: [] }],
      ["/v1/responses", { model: "demo/model", input: "x" }],
      ["/v1/messages", { model: "demo/model", messages: [] }],
    ] as const) {
      expect((await nativeFetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(200);
      expect(forwarded.at(-1).provider).toMatchObject({ only: ["good"], order: ["good"], allow_fallbacks: false });
    }
    expect((await nativeFetch(`${base}/v1/responses`, { method: "POST", headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "demo/model", input: "x", provider: { only: ["slow"] } }) })).status).toBe(403);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}));
