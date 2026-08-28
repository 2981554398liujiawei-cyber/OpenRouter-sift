import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const endpoints = ["alpha", "beta", "gamma", "delta"].map((routingId) => ({
  providerName: routingId.toUpperCase(), providerSlug: routingId, providerRoutingId: routingId, tag: routingId, name: `${routingId}-endpoint`, modelId: "test/model-x",
  pricing: { prompt: "0.000001", completion: "0.000002" }, contextLength: 8192, maxCompletionTokens: null, maxPromptTokens: null,
  quantization: "fp16", supportedParameters: ["tools"], supportsImplicitCaching: false,
  performance: { latencyLast30m: { p50: 0.4, p75: 0.5, p90: 0.6, p99: 0.9 }, throughputLast30m: { p50: 60, p75: 55, p90: 50, p99: 40 }, uptimeLast5m: 99.9, uptimeLast30m: 99.8, uptimeLast1d: 99.5 },
  status: 200,
}));

function seedMetadata(dir: string) {
  const now = new Date().toISOString();
  const file = { version: 1, models: { fetchedAt: now, value: [{ id: "test/model-x", name: "Test Model X", contextLength: 8192, pricing: { prompt: "0.000001", completion: "0.000002" } }], raw: { data: [] } }, endpoints: { "test/model-x": { fetchedAt: now, value: endpoints, raw: { data: { endpoints: [] } } } } };
  const path = join(dir, "metadata.json");
  require("node:fs").writeFileSync(path, JSON.stringify(file));
  return path;
}

const PROMPT_FIXTURE = "G11_SECRET_PROMPT_9137";
const RESPONSE_FIXTURE = "G11_SECRET_RESPONSE_4242";
const UPSTREAM_KEY_FIXTURE = "sk-or-test-upstream-key-g11";

describe("G11 preview/inference parity and privacy", () => {
  it("keeps preview final.providerPolicy deepEqual to the inference forwarded body.provider, with zero metadata network IO", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sift-g11-"));
    tempDirs.push(directory);
    const forwarded: Array<{ url: string; body: any }> = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      forwarded.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "gen-1", choices: [{ message: { content: RESPONSE_FIXTURE } }] }), { status: 200, headers: { "content-type": "application/json", "x-generation-id": "gen-1" } });
    }) as typeof fetch;
    const cfg = loadConfig({});
    cfg.port = 0; cfg.upstream_api_key = UPSTREAM_KEY_FIXTURE; cfg.local_api_key = "control-secret"; cfg.log_level = "silent";
    cfg.metadata_cache_path = seedMetadata(directory);
    cfg.model_policy_store_path = join(directory, "policies.json");
    cfg.settings_store_path = join(directory, "settings.json");
    cfg.request_log_store_path = join(directory, "requests.json");
    cfg.desired_model_store_path = join(directory, "desired.json");
    cfg.access_key_store_path = join(directory, "keys.json");
    const server = startServer(cfg); servers.push(server); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const base = `http://127.0.0.1:${address.port}`;
    const controlHeaders = { authorization: "Bearer control-secret", "content-type": "application/json" };

    // Desired model with a hard filter bounding providers to alpha/beta/gamma
    expect((await nativeFetch(`${base}/api/desired-models/${encodeURIComponent("test/model-x")}`, { method: "POST", headers: controlHeaders })).status).toBe(201);
    const filter = { enabled: true, mode: "all", conditions: [{ id: "c1", field: "provider.routingId", operator: "in", value: ["alpha", "beta", "gamma"], enabled: true }], maxTelemetryAgeMs: 3_600_000 };
    const filtered = await nativeFetch(`${base}/api/desired-models/${encodeURIComponent("test/model-x")}/filter`, { method: "PUT", headers: controlHeaders, body: JSON.stringify(filter) });
    expect(filtered.status).toBe(200);
    const filterPreview = (await filtered.json() as any).preview;
    expect(filterPreview.totalEndpoints).toBe(4);
    expect(filterPreview.eligibleEndpoints).toHaveLength(3);
    expect(filterPreview.excludedEndpoints).toHaveLength(1);

    // Model policy allows beta/gamma
    expect((await nativeFetch(`${base}/api/policies/${encodeURIComponent("test/model-x")}`, { method: "PUT", headers: controlHeaders, body: JSON.stringify({ mode: "allowlist", providers: ["beta", "gamma"], allowFallbacks: true }) })).status).toBe(200);

    // Local Access Key with allowlist alpha/beta override
    const key = await (await nativeFetch(`${base}/api/access-keys`, { method: "POST", headers: controlHeaders, body: JSON.stringify({ name: "QA", allowedModels: ["test/model-x"] }) })).json() as any;
    const override = { providerMode: "allowlist", providers: ["alpha", "beta"], providerOrder: ["beta", "alpha"], allowFallbacks: true };
    expect((await nativeFetch(`${base}/api/access-keys/${key.id}/models/${encodeURIComponent("test/model-x")}/override`, { method: "PUT", headers: controlHeaders, body: JSON.stringify(override) })).status).toBe(200);

    // Complex incoming policy (client wants beta/delta, ignores gamma, adds price/quantization/parameter preferences)
    const incoming = { only: ["beta", "delta"], ignore: ["gamma"], max_price: { prompt: 0.5, completion: 1 }, quantizations: ["fp16"], require_parameters: true, allow_fallbacks: false };

    // Preview → final.providerPolicy
    const preview = await (await nativeFetch(`${base}/api/access-keys/${key.id}/models/${encodeURIComponent("test/model-x")}/override/preview`, { method: "POST", headers: controlHeaders, body: JSON.stringify({ candidateOverride: override, incomingProviderPolicy: incoming }) })).json() as any;
    expect(preview.final.eligible).toEqual(["beta"]);
    const previewPolicy = preview.final.providerPolicy;
    expect(previewPolicy).toMatchObject({ only: ["beta"], allow_fallbacks: true, max_price: { prompt: 0.5, completion: 1 }, quantizations: ["fp16"], require_parameters: true });

    // Inference → forwarded body.provider must deepEqual the preview policy
    const keyHeaders = { authorization: `Bearer ${key.secret}`, "content-type": "application/json" };
    const inferenceStart = forwarded.length;
    const response = await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: keyHeaders, body: JSON.stringify({ model: "test/model-x", max_tokens: 5, messages: [{ role: "user", content: `Reply only: OK (${PROMPT_FIXTURE})` }], provider: incoming }) });
    expect(response.status).toBe(200);
    expect((await response.json() as any).choices[0].message.content).toBe(RESPONSE_FIXTURE);

    // G11 §65: inference reads the endpoint snapshot — no catalog/endpoint metadata IO at all.
    // The only tolerated extra call is the asynchronous generation-metadata enrichment (§70/§73).
    const inferenceForwards = forwarded.slice(inferenceStart);
    const completions = inferenceForwards.filter((call) => call.url.includes("/chat/completions"));
    const metadataCalls = inferenceForwards.filter((call) => /\/models|\/endpoints/.test(call.url));
    expect(metadataCalls).toHaveLength(0);
    expect(completions).toHaveLength(1);
    expect(inferenceForwards.filter((call) => !call.url.includes("/chat/completions")).every((call) => call.url.includes("generation"))).toBe(true);
    expect(completions[0].body.provider).toEqual(previewPolicy); // deepEqual preview vs inference
    expect(completions[0].body.messages[0].content).toContain(PROMPT_FIXTURE); // upstream got the real prompt…

    // …but the persisted request log contains neither the prompt, the response, nor any secret.
    const requestLog = readFileSync(cfg.request_log_store_path, "utf8");
    expect(requestLog).not.toContain(PROMPT_FIXTURE);
    expect(requestLog).not.toContain(RESPONSE_FIXTURE);
    expect(requestLog).not.toContain(key.secret);
    expect(requestLog).not.toContain(UPSTREAM_KEY_FIXTURE);
    const keyStore = readFileSync(cfg.access_key_store_path, "utf8");
    expect(keyStore).not.toContain(key.secret);
    const metadataStore = readFileSync(cfg.metadata_cache_path, "utf8");
    expect(metadataStore).not.toContain(UPSTREAM_KEY_FIXTURE);

    // Client cannot widen: only delta must fail closed with NO_ELIGIBLE_PROVIDER.
    const widened = await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: keyHeaders, body: JSON.stringify({ model: "test/model-x", max_tokens: 5, messages: [{ role: "user", content: "hi" }], provider: { only: ["delta"] } }) });
    expect(widened.status).toBe(403);
    expect((await widened.json() as any).error.code).toBe("NO_ELIGIBLE_PROVIDER");
    const requestLogAfter = readFileSync(cfg.request_log_store_path, "utf8");
    expect(requestLogAfter).toContain("NO_ELIGIBLE_PROVIDER");
    expect(requestLogAfter).not.toContain(key.secret);
    expect(requestLogAfter).not.toContain(UPSTREAM_KEY_FIXTURE);
  });
});
