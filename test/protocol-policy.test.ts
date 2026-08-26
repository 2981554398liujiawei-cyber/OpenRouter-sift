import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";
import { JsonPolicyStore } from "../src/storage/policies";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

describe("per-model policy protocol injection", () => {
  it("injects the same model policy for Messages, Chat Completions, and Responses", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-control-"));
    const storePath = join(directory, "policies.json");
    try {
      new JsonPolicyStore(storePath).set("example/model", { mode: "allowlist", providers: ["relace"], allow_fallbacks: false });
      const received: unknown[] = [];
      globalThis.fetch = vi.fn(async (_url, init) => {
        received.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch;

      const cfg = loadConfig({});
      cfg.port = 0;
      cfg.model_policy_store_path = storePath;
      cfg.upstream_api_key = "test-key";
      cfg.log_level = "silent";
      const server = startServer(cfg);
      servers.push(server);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");

      for (const [path, body] of [
        ["/v1/messages", { model: "example/model", messages: [] }],
        ["/v1/chat/completions", { model: "example/model", messages: [] }],
        ["/v1/responses", { model: "example/model", input: "ignored by test" }],
      ] as const) {
        const response = await nativeFetch(`http://127.0.0.1:${address.port}${path}`, {
          method: "POST",
          headers: { authorization: "Bearer test-key", "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
      }

      expect(received).toHaveLength(3);
      expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: { only: ["relace"], allow_fallbacks: false } }),
      ]));
      for (const request of received as Array<{ provider: unknown }>) {
        expect(request.provider).toEqual({ only: ["relace"], allow_fallbacks: false });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads persisted policy after a server restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-control-"));
    const storePath = join(directory, "policies.json");
    try {
      new JsonPolicyStore(storePath).set("example/restart", { mode: "blocklist", providers: ["coreweave"] });
      const received: unknown[] = [];
      globalThis.fetch = vi.fn(async (_url, init) => {
        received.push(JSON.parse(String(init?.body)));
        return new Response("{}", { headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const cfg = loadConfig({});
      cfg.port = 0;
      cfg.model_policy_store_path = storePath;
      cfg.upstream_api_key = "test-key";
      cfg.log_level = "silent";
      const server = startServer(cfg);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      await nativeFetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer test-key", "content-type": "application/json" },
        body: JSON.stringify({ model: "example/restart", messages: [] }),
      });
      server.close();
      await once(server, "close");
      expect(received).toEqual([expect.objectContaining({ provider: { ignore: ["coreweave"] } })]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves OpenAI-compatible streaming content while injecting policy", async () => {
    const received: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      received.push(JSON.parse(String(init?.body)));
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: first\n\n"));
          controller.enqueue(encoder.encode("data: second\n\n"));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const cfg = loadConfig({});
    cfg.port = 0;
    cfg.policy = { only: ["relace"], allow_fallbacks: false };
    cfg.upstream_api_key = "test-key";
    cfg.log_level = "silent";
    const server = startServer(cfg);
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ model: "example/stream", messages: [], stream: true }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe("data: first\n\ndata: second\n\n");
    expect(received).toEqual([expect.objectContaining({ provider: { only: ["relace"], allow_fallbacks: false }, stream: true })]);
  });
});
