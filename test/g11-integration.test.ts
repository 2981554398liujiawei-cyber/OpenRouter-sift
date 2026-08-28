import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";
import { JsonDesiredModelStore } from "../src/access/desiredModelStore";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const MODEL_IDS = ["test/one", "test/two", "test/three"];

function endpointFor(modelId: string) {
  return {
    providerName: "Alpha", providerSlug: "alpha", providerRoutingId: "alpha", tag: "alpha", name: "alpha", modelId,
    pricing: { prompt: "0.000001", completion: "0.000002" }, contextLength: 8192, maxCompletionTokens: null, maxPromptTokens: null,
    quantization: "fp16", supportedParameters: ["tools"], supportsImplicitCaching: false,
    performance: { latencyLast30m: { p50: 0.4, p75: 0.5, p90: 0.6, p99: 0.9 }, throughputLast30m: { p50: 60, p75: 55, p90: 50, p99: 40 }, uptimeLast5m: 99.9, uptimeLast30m: 99.8, uptimeLast1d: 99.5 },
    status: 200,
  };
}

function seedMetadata(dir: string) {
  const now = new Date().toISOString();
  const file = {
    version: 1,
    models: { fetchedAt: now, value: MODEL_IDS.map((id) => ({ id, name: id, contextLength: 8192, pricing: { prompt: "0.000001", completion: "0.000002" } })), raw: { data: [] } },
    endpoints: Object.fromEntries(MODEL_IDS.map((id) => [id, { fetchedAt: now, value: [endpointFor(id)], raw: { data: { endpoints: [] } } }])),
  };
  const path = join(dir, "metadata.json");
  writeFileSync(path, JSON.stringify(file));
  return path;
}

interface Harness {
  base: string;
  control: Record<string, string>;
  upstreamCalls: string[];
  inFlightMax: { value: number };
}

async function boot(dir: string, options: { intervalMs?: number; fakeTimers?: boolean } = {}): Promise<Harness> {
  const upstreamCalls: string[] = [];
  const inFlightMax = { value: 0 };
  let inFlight = 0;
  globalThis.fetch = vi.fn(async (url, init) => {
    const target = String(url);
    upstreamCalls.push(target);
    if (target.includes("/endpoints")) {
      inFlight += 1;
      inFlightMax.value = Math.max(inFlightMax.value, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const modelId = decodeURIComponent(target.split("/models/")[1]?.split("/endpoints")[0] ?? "");
      return new Response(JSON.stringify({ data: { endpoints: [endpointFor(modelId)] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/generation")) return new Response(JSON.stringify({ data: { provider_name: "Alpha", tokens_prompt: 1, tokens_completion: 1, total_tokens: 2, total_cost: 0.000001, latency: 100, generation_time: 90, finish_reason: "stop", is_byok: false, router: null, service_tier: null, cancelled: false, streamed: false } }), { status: 200, headers: { "content-type": "application/json", "x-generation-id": "gen-1" } });
    return new Response(JSON.stringify({ id: "gen-1", model: "test/one", choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json", "x-generation-id": "gen-1" } });
  }) as typeof fetch;

  const cfg = loadConfig({});
  cfg.port = 0; cfg.upstream_api_key = "sk-or-test-upstream"; cfg.local_api_key = "control-secret"; cfg.log_level = "silent";
  cfg.metadata_cache_path = seedMetadata(dir);
  cfg.model_policy_store_path = join(dir, "policies.json");
  cfg.settings_store_path = join(dir, "settings.json");
  cfg.request_log_store_path = join(dir, "requests.json");
  cfg.desired_model_store_path = join(dir, "desired.json");
  cfg.access_key_store_path = join(dir, "keys.json");
  const server = startServer(cfg); servers.push(server); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  if (options.intervalMs) {
    const saved = await nativeFetch(`http://127.0.0.1:${address.port}/api/settings`, { method: "PUT", headers: { authorization: "Bearer control-secret", "content-type": "application/json" }, body: JSON.stringify({ desiredEndpointRefreshIntervalMs: options.intervalMs }) });
    expect(saved.status).toBe(200);
  }
  return { base: `http://127.0.0.1:${address.port}`, control: { authorization: "Bearer control-secret", "content-type": "application/json" }, upstreamCalls, inFlightMax };
}

// The upstream client keeps the model slash unencoded, so match both forms.
const endpointCallsFor = (calls: string[], modelId: string) => calls.filter((call) => call.includes(`/models/${modelId}/endpoints`) || call.includes(`/models/${encodeURIComponent(modelId)}/endpoints`)).length;

describe("G11 background refresh, persistence and resilience", () => {
  it("refreshes only enabled Desired Models with concurrency 2 (§66)", async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), "sift-g11-refresh-")); tempDirs.push(directory);
    // There is no HTTP route for enabling/disabling a Desired Model, so seed the store directly.
    const store = new JsonDesiredModelStore(join(directory, "desired.json"));
    for (const modelId of MODEL_IDS) store.add(modelId);
    store.setEnabled("test/three", false);
    const harness = await boot(directory, { intervalMs: 30_000 });
    harness.upstreamCalls.length = 0;

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(50);

    expect(endpointCallsFor(harness.upstreamCalls, "test/one")).toBe(1);
    expect(endpointCallsFor(harness.upstreamCalls, "test/two")).toBe(1);
    expect(endpointCallsFor(harness.upstreamCalls, "test/three")).toBe(0); // disabled models are never refreshed
    expect(harness.inFlightMax.value).toBeLessThanOrEqual(2); // concurrency = 2
  });

  it("replaces the refresh timer instead of stacking duplicates (§67)", async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), "sift-g11-timer-")); tempDirs.push(directory);
    const harness = await boot(directory, { intervalMs: 30_000 });
    expect((await nativeFetch(`${harness.base}/api/desired-models/${encodeURIComponent("test/one")}`, { method: "POST", headers: harness.control })).status).toBe(201);
    harness.upstreamCalls.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(50);
    expect(endpointCallsFor(harness.upstreamCalls, "test/one")).toBe(1);

    const saved = await nativeFetch(`${harness.base}/api/settings`, { method: "PUT", headers: harness.control, body: JSON.stringify({ desiredEndpointRefreshIntervalMs: 60_000 }) });
    expect(saved.status).toBe(200);
    harness.upstreamCalls.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endpointCallsFor(harness.upstreamCalls, "test/one")).toBe(1); // one round per interval — no stacked timers
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endpointCallsFor(harness.upstreamCalls, "test/one")).toBe(2);
  });

  it("keeps serving when the request log and desired store are corrupt (§85/§86)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sift-g11-corrupt-")); tempDirs.push(directory);
    writeFileSync(join(directory, "requests.json"), "{ not valid json");
    writeFileSync(join(directory, "desired.json"), "}}broken{{");
    const harness = await boot(directory);
    // Control plane keeps serving even though both stores are unreadable.
    expect((await nativeFetch(`${harness.base}/api/status`, { headers: harness.control })).status).toBe(200);
    const desired = await (await nativeFetch(`${harness.base}/api/desired-models`, { headers: harness.control })).json() as { items: unknown[] };
    expect(desired.items).toHaveLength(0); // managed set is empty → fail closed, never an open proxy
    // Creating a key for a non-Desired model is rejected rather than silently granted.
    expect((await nativeFetch(`${harness.base}/api/access-keys`, { method: "POST", headers: harness.control, body: JSON.stringify({ name: "QA", allowedModels: ["test/one"] }) })).status).toBe(422);
    const inference = await nativeFetch(`${harness.base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer sift_sk_missing", "content-type": "application/json" }, body: JSON.stringify({ model: "test/one", messages: [{ role: "user", content: "hi" }] }) });
    expect(inference.status).toBe(401);
  });

  it("restores Desired Models, filters, keys, overrides and settings after a restart (§82/§135)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sift-g11-restart-")); tempDirs.push(directory);
    const first = await boot(directory, { intervalMs: 45_000 });
    expect((await nativeFetch(`${first.base}/api/desired-models/${encodeURIComponent("test/one")}`, { method: "POST", headers: first.control })).status).toBe(201);
    const filter = { enabled: true, mode: "all", conditions: [{ id: "c1", field: "provider.routingId", operator: "in", value: ["alpha"], enabled: true }], maxTelemetryAgeMs: 3_600_000 };
    expect((await nativeFetch(`${first.base}/api/desired-models/${encodeURIComponent("test/one")}/filter`, { method: "PUT", headers: first.control, body: JSON.stringify(filter) })).status).toBe(200);
    const created = await (await nativeFetch(`${first.base}/api/access-keys`, { method: "POST", headers: first.control, body: JSON.stringify({ name: "QA", allowedModels: ["test/one"] }) })).json() as { id: string; secret: string; keyPrefix: string; keyLast4: string };
    expect((await nativeFetch(`${first.base}/api/access-keys/${created.id}/models/${encodeURIComponent("test/one")}/override`, { method: "PUT", headers: first.control, body: JSON.stringify({ providerMode: "allowlist", providers: ["alpha"], providerOrder: ["alpha"], allowFallbacks: false }) })).status).toBe(200);

    const running = servers.splice(0);
    await Promise.all(running.map(async (server) => { server.close(); await once(server, "close"); }));

    const second = await boot(directory);
    const desired = await (await nativeFetch(`${second.base}/api/desired-models`, { headers: second.control })).json() as { items: Array<{ modelId: string }> };
    expect(desired.items.map((item) => item.modelId)).toEqual(["test/one"]);
    const savedFilter = await (await nativeFetch(`${second.base}/api/desired-models/${encodeURIComponent("test/one")}/filter`, { headers: second.control })).json() as { filter: { conditions: unknown[]; mode: string } };
    expect(savedFilter.filter.conditions).toHaveLength(1);
    expect(savedFilter.filter.mode).toBe("all");
    const keys = await (await nativeFetch(`${second.base}/api/access-keys`, { headers: second.control })).json() as { items: Array<{ id: string; keyPrefix: string; keyLast4: string }> };
    expect(keys.items[0].keyPrefix).toBe(created.keyPrefix);
    expect(keys.items[0].keyLast4).toBe(created.keyLast4);
    const override = await (await nativeFetch(`${second.base}/api/access-keys/${created.id}/models/${encodeURIComponent("test/one")}/override`, { headers: second.control })).json() as { mode: string; providersSelected: string[] };
    expect(override.mode).toBe("allowlist");
    expect(override.providersSelected).toEqual(["alpha"]);
    const settings = await (await nativeFetch(`${second.base}/api/settings`, { headers: second.control })).json() as { desiredEndpointRefreshIntervalMs: number; mergeMode: string };
    expect(settings.desiredEndpointRefreshIntervalMs).toBe(45_000);
    // Secret is never recoverable from disk — only a hash with prefix/last4.
    const keyStore = readFileSync(join(directory, "keys.json"), "utf8");
    expect(keyStore).not.toContain(created.secret);
    expect(keyStore).toContain(created.keyPrefix);
  });
});
