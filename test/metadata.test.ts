import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { OpenRouterCatalog } from "../src/openrouter/catalog";
import { OpenRouterClient, OpenRouterMetadataError } from "../src/openrouter/client";
import { JsonMetadataStore } from "../src/storage/metadata";

const modelResponse = { data: [{ id: "openai/gpt-test", canonical_slug: "gpt-test", name: "GPT Test", description: "Catalog fixture", context_length: 128000, pricing: { prompt: "0.1" }, architecture: { modality: "text", input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools"], created: 1, top_provider: { max_completion_tokens: 4096 } }] };
const endpointResponse = { data: { endpoints: [{ provider_name: "Provider Display", provider_slug: "provider-routing-id", tag: "fp8", pricing: { prompt: "0.1" }, max_prompt_tokens: 64000, max_completion_tokens: 8000, latency_last_30m: { p50: 1, p75: 2, p90: 3, p99: 4 }, throughput_last_30m: { p50: 100, p75: 90, p90: 80, p99: 70 }, uptime_last_5m: 0.99, uptime_last_30m: 0.98, uptime_last_1d: 0.97, quantization: "fp8", status: "available" }] } };

function catalogWith(fetchImpl: typeof fetch, ttlMs = 300_000) {
  const directory = mkdtempSync(join(tmpdir(), "openrouter-metadata-"));
  const store = new JsonMetadataStore(join(directory, "metadata.json"));
  return {
    directory,
    store,
    catalog: new OpenRouterCatalog(new OpenRouterClient({ apiKey: "sk-or-secret", fetchImpl, timeoutMs: 20 }), store, ttlMs),
  };
}

describe("OpenRouter metadata catalog", () => {
  it("syncs models into a stable DTO without storing the API key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(modelResponse), { status: 200 }));
    const { catalog, store, directory } = catalogWith(fetchImpl as typeof fetch);
    try {
      const result = await catalog.syncModels();
      expect(result).toMatchObject({ state: "fresh", data: [{ id: "openai/gpt-test", canonicalSlug: "gpt-test", contextLength: 128000, description: "Catalog fixture", inputModalities: ["text", "image"], outputModalities: ["text"], maxCompletionTokens: 4096 }] });
      expect(fetchImpl.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ authorization: "Bearer sk-or-secret" }));
      expect(JSON.stringify(store.getModels())).not.toContain("sk-or-secret");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects malformed, unauthorized, and server-error model responses without exposing credentials", async () => {
    for (const response of [new Response("{}", { status: 200 }), new Response("no", { status: 401 }), new Response("no", { status: 500 })]) {
      const { catalog, directory } = catalogWith(vi.fn(async () => response) as typeof fetch);
      try {
        await expect(catalog.syncModels()).rejects.toBeInstanceOf(OpenRouterMetadataError);
        await expect(catalog.syncModels()).rejects.not.toThrow("sk-or-secret");
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });

  it("reports a timeout without exposing the API key", async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")))));
    const { catalog, directory } = catalogWith(fetchImpl as typeof fetch);
    try {
      await expect(catalog.syncModels()).rejects.toMatchObject({ code: "timeout" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("propagates a caller AbortSignal to the metadata request", async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")))));
    const controller = new AbortController();
    const client = new OpenRouterClient({ apiKey: "sk-or-secret", fetchImpl: fetchImpl as typeof fetch, timeoutMs: 1_000 });
    const request = client.getModels(controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "aborted" });
  });

  it("uses stale model cache when refresh fails", async () => {
    const { catalog, store, directory } = catalogWith(vi.fn(async () => new Response("no", { status: 500 })) as typeof fetch, 0);
    try {
      store.setModels({ fetchedAt: "2020-01-01T00:00:00.000Z", value: [{ id: "cached", canonicalSlug: null, name: null, contextLength: null, pricing: null, architecture: null, supportedParameters: null, created: null }], raw: { data: [] } });
      await expect(catalog.syncModels()).resolves.toMatchObject({ state: "stale", data: [{ id: "cached" }] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("supports empty model results", async () => {
    const { catalog, directory } = catalogWith(vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch);
    try { await expect(catalog.syncModels()).resolves.toMatchObject({ state: "fresh", data: [] }); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("deduplicates concurrent model and endpoint refreshes", async () => {
    let resolveModels!: (response: Response) => void;
    let resolveEndpoints!: (response: Response) => void;
    const fetchImpl = vi.fn((url) => new Promise<Response>((resolve) => {
      if (String(url).endsWith("/models")) resolveModels = resolve;
      else resolveEndpoints = resolve;
    }));
    const { catalog, directory } = catalogWith(fetchImpl as typeof fetch);
    try {
      const modelsOne = catalog.syncModels(true);
      const modelsTwo = catalog.syncModels(true);
      resolveModels(new Response(JSON.stringify(modelResponse), { status: 200 }));
      await Promise.all([modelsOne, modelsTwo]);
      const endpointsOne = catalog.getModelEndpoints("openai/gpt-demo", true);
      const endpointsTwo = catalog.getModelEndpoints("openai/gpt-demo", true);
      resolveEndpoints(new Response(JSON.stringify(endpointResponse), { status: 200 }));
      await Promise.all([endpointsOne, endpointsTwo]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("fetches endpoints lazily and preserves provider display name separately from routing ID", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(endpointResponse), { status: 200 }));
    const { catalog, directory } = catalogWith(fetchImpl as typeof fetch);
    try {
      const result = await catalog.getModelEndpoints("openai/gpt test");
      expect(fetchImpl.mock.calls[0][0]).toContain("/models/openai/gpt%20test/endpoints");
      expect(result.data[0]).toMatchObject({ providerName: "Provider Display", providerSlug: "provider-routing-id", providerRoutingId: "fp8", tag: "fp8", maxPromptTokens: 64000, maxCompletionTokens: 8000, performance: { latencyLast30m: { p50: 1, p75: 2, p90: 3, p99: 4 }, throughputLast30m: { p50: 100, p75: 90, p90: 80, p99: 70 }, uptimeLast5m: 0.99, uptimeLast30m: 0.98, uptimeLast1d: 0.97 } });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("handles optional endpoint metrics, 404s, invalid IDs, stale cache, and force refresh", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { endpoints: [{ provider_name: "Only Name" }] } }), { status: 200 }));
    const { catalog, store, directory } = catalogWith(fetchImpl as typeof fetch);
    try {
      await expect(catalog.getModelEndpoints("bad-id")).rejects.toMatchObject({ code: "invalid_response" });
      await expect(catalog.getModelEndpoints("openai/minimal")).resolves.toMatchObject({ data: [{ providerName: "Only Name", providerSlug: null, performance: { latencyLast30m: null, throughputLast30m: null, uptimeLast5m: null, uptimeLast30m: null, uptimeLast1d: null } }] });
      store.setEndpoints("openai/not-found", { fetchedAt: "2020-01-01T00:00:00.000Z", value: [], raw: {} });
      (fetchImpl as any).mockImplementation(async () => new Response("missing", { status: 404 }));
      await expect(catalog.getModelEndpoints("openai/not-found", true)).resolves.toMatchObject({ state: "stale", data: [] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects unknown models and malformed endpoint payloads when no cache exists", async () => {
    const missing = catalogWith(vi.fn(async () => new Response("missing", { status: 404 })) as typeof fetch);
    const malformed = catalogWith(vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch);
    try {
      await expect(missing.catalog.getModelEndpoints("openai/unknown")).rejects.toMatchObject({ status: 404, code: "http" });
      await expect(malformed.catalog.getModelEndpoints("openai/malformed")).rejects.toMatchObject({ code: "invalid_response" });
    } finally {
      rmSync(missing.directory, { recursive: true, force: true });
      rmSync(malformed.directory, { recursive: true, force: true });
    }
  });

  it("rejects structurally corrupt cache entries instead of returning them", () => {
    const { store, directory } = catalogWith(vi.fn() as typeof fetch);
    try {
      store.setModels({ fetchedAt: new Date().toISOString(), value: [], raw: {} });
      const path = join(directory, "metadata.json");
      writeFileSync(path, JSON.stringify({ version: 1, models: { fetchedAt: "not-a-date", value: [], raw: {} }, endpoints: {} }));
      expect(() => new JsonMetadataStore(path).load()).toThrow("Invalid models metadata cache entry");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("normalizes partial or malformed metrics without dropping the endpoint", async () => {
    const response = { data: { endpoints: [{ provider_name: "Provider", tag: "provider", latency_last_30m: { p50: 1, p75: "bad", p90: 3 }, throughput_last_30m: { p50: "bad" }, uptime_last_5m: "bad", uptime_last_30m: 99, uptime_last_1d: null, quantization: null }] } };
    const { catalog, directory } = catalogWith(vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch);
    try {
      await expect(catalog.getModelEndpoints("openai/metrics")).resolves.toMatchObject({ data: [{ providerRoutingId: "provider", quantization: null, performance: { latencyLast30m: { p50: 1, p75: null, p90: 3, p99: null }, throughputLast30m: { p50: null, p75: null, p90: null, p99: null }, uptimeLast5m: null, uptimeLast30m: 99, uptimeLast1d: null } }] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("treats scalar, array, and empty metric values as unavailable", async () => {
    const response = { data: { endpoints: [{ provider_name: "Provider", tag: "provider", latency_last_30m: 3, throughput_last_30m: [], uptime_last_5m: Infinity }] } };
    const { catalog, directory } = catalogWith(vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch);
    try {
      await expect(catalog.getModelEndpoints("openai/odd-metrics")).resolves.toMatchObject({ data: [{ performance: { latencyLast30m: null, throughputLast30m: null, uptimeLast5m: null } }] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
