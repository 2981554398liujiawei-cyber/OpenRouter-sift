import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
});

describe("metadata API", () => {
  it("returns stable model and endpoint DTOs without raw metadata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-api-"));
    try {
      globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith("/models")
        ? { data: [{ id: "openai/gpt-test", name: "GPT Test", context_length: 100 }] }
        : { data: { endpoints: [{ provider_name: "OpenAI", tag: "openai", status: 0 }] } }), { status: 200 })) as typeof fetch;
      const cfg = loadConfig({});
      cfg.port = 0;
      cfg.upstream_api_key = "sk-or-test";
      cfg.metadata_cache_path = join(directory, "metadata.json");
      cfg.log_level = "silent";
      const server = startServer(cfg);
      servers.push(server);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      const models = await (await nativeFetch(`http://127.0.0.1:${address.port}/api/models/refresh`, { method: "POST" })).json() as any;
      const endpoints = await (await nativeFetch(`http://127.0.0.1:${address.port}/api/models/openai%2Fgpt-test/endpoints`)).json() as any;
      expect(models).toMatchObject({ state: "fresh", data: [{ id: "openai/gpt-test", contextLength: 100 }] });
      expect(models.data[0]).not.toHaveProperty("raw");
      expect(endpoints).toMatchObject({ state: "fresh", data: [{ providerName: "OpenAI", providerRoutingId: "openai", status: 0 }] });
      expect(endpoints.data[0]).not.toHaveProperty("raw");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps data-plane requests working when the metadata cache is corrupt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-api-"));
    const path = join(directory, "broken.json");
    try {
      await import("node:fs/promises").then(({ writeFile }) => writeFile(path, "not json"));
      globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      const cfg = loadConfig({});
      cfg.port = 0;
      cfg.upstream_api_key = "sk-or-test";
      cfg.metadata_cache_path = path;
      cfg.log_level = "silent";
      const server = startServer(cfg);
      servers.push(server);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      const response = await nativeFetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-test", messages: [] }) });
      expect(response.status).toBe(200);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("applies local API authentication to metadata routes", async () => {
    const cfg = loadConfig({});
    cfg.port = 0;
    cfg.local_api_key = "local-secret";
    cfg.log_level = "silent";
    const server = startServer(cfg);
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const unauthorized = await nativeFetch(`http://127.0.0.1:${address.port}/api/models`);
    expect(unauthorized.status).toBe(401);
  });
});
