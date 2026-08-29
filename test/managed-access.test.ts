import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";
import { NoopSecureStore } from "../src/auth/secureStore";
const noopSecureStore = new NoopSecureStore();

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
});

describe("managed Local Access Keys", () => {
  it("scopes model lists, enforces all three inference protocols, and attributes Requests without retaining the secret", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sift-managed-"));
    const forwarded: Array<{ url: string; auth: string | null; body: any }> = [];
    try {
      globalThis.fetch = vi.fn(async (url, init) => {
        forwarded.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const cfg = loadConfig({});
      cfg.port = 0; cfg.upstream_api_key = "sk-or-upstream-secret"; cfg.local_api_key = "control-secret"; cfg.log_level = "silent";
      cfg.desired_model_store_path = join(directory, "desired.json");
      cfg.access_key_store_path = join(directory, "keys.json");
      cfg.request_log_store_path = join(directory, "requests.json");
      const server = startServer(cfg, { secureStore: noopSecureStore }); servers.push(server); await once(server, "listening");
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      const base = `http://127.0.0.1:${address.port}`;
      const controlHeaders = { authorization: "Bearer control-secret", "content-type": "application/json" };
      for (const model of ["deepseek/demo", "openai/demo"]) {
        expect((await nativeFetch(`${base}/api/desired-models/${encodeURIComponent(model)}`, { method: "POST", headers: controlHeaders })).status).toBe(201);
      }
      const create = async (name: string, allowedModels: string[]) => (await (await nativeFetch(`${base}/api/access-keys`, { method: "POST", headers: controlHeaders, body: JSON.stringify({ name, allowedModels }) })).json()) as any;
      const keyA = await create("Codex", ["deepseek/demo"]);
      const keyB = await create("Other", ["openai/demo"]);
      const undesired = await nativeFetch(`${base}/api/access-keys`, { method: "POST", headers: controlHeaders, body: JSON.stringify({ name: "Invalid", allowedModels: ["anthropic/not-desired"] }) });
      expect(undesired.status).toBe(422); expect((await undesired.json() as any).error.code).toBe("MODEL_NOT_DESIRED");
      expect(keyA.secret).toMatch(/^sift_sk_/);
      expect(JSON.stringify(await (await nativeFetch(`${base}/api/access-keys`, { headers: controlHeaders })).json())).not.toContain(keyA.secret);
      expect(readFileSync(cfg.access_key_store_path, "utf8")).not.toContain(keyA.secret);
      const keyAHeaders = { authorization: `Bearer ${keyA.secret}`, "content-type": "application/json" };
      const modelsA = await (await nativeFetch(`${base}/v1/models`, { headers: keyAHeaders })).json() as any;
      expect(modelsA).toEqual({ object: "list", data: [{ id: "deepseek/demo", object: "model", owned_by: "openrouter" }] });
      const modelsB = await (await nativeFetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${keyB.secret}` } })).json() as any;
      expect(modelsB.data.map((model: any) => model.id)).toEqual(["openai/demo"]);
      for (const [path, payload] of [["/v1/chat/completions", { model: "deepseek/demo", messages: [] }], ["/v1/responses", { model: "deepseek/demo", input: "x" }], ["/v1/messages", { model: "deepseek/demo", messages: [] }]] as const) {
        expect((await nativeFetch(`${base}${path}`, { method: "POST", headers: keyAHeaders, body: JSON.stringify(payload) })).status).toBe(200);
      }
      const rejected = await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: keyAHeaders, body: JSON.stringify({ model: "openai/demo", messages: [] }) });
      expect(rejected.status).toBe(403); expect((await rejected.json() as any).error.code).toBe("MODEL_NOT_ALLOWED");
      expect(forwarded).toHaveLength(3);
      expect(forwarded.every((call) => call.auth === "Bearer sk-or-upstream-secret")).toBe(true);
      await vi.waitFor(async () => expect((await (await nativeFetch(`${base}/api/requests`, { headers: controlHeaders })).json() as any).items.length).toBeGreaterThanOrEqual(4));
      const requests = await (await nativeFetch(`${base}/api/requests`, { headers: controlHeaders })).json() as any;
      const details = await (await nativeFetch(`${base}/api/requests/${requests.items[0].id}`, { headers: controlHeaders })).json() as any;
      expect(details).toMatchObject({ accessKeyId: keyA.id, accessKeyName: "Codex" });
      expect(JSON.stringify(details)).not.toContain(keyA.secret);
      const management = await nativeFetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${keyA.secret}` } });
      expect(management.status).toBe(401);
      await nativeFetch(`${base}/api/desired-models/deepseek%2Fdemo`, { method: "DELETE", headers: controlHeaders });
      expect((await (await nativeFetch(`${base}/v1/models`, { headers: keyAHeaders })).json() as any).data).toEqual([]);
      expect((await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: keyAHeaders, body: JSON.stringify({ model: "deepseek/demo", messages: [] }) })).status).toBe(403);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("fails closed for disabled, deleted, malformed, removed desired, and remapped models", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sift-managed-"));
    const previousModel = process.env.ANTHROPIC_MODEL;
    try {
      process.env.ANTHROPIC_MODEL = "openai/allowed";
      globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      const cfg = loadConfig({}); cfg.port = 0; cfg.upstream_api_key = "sk-or-upstream"; cfg.log_level = "silent";
      cfg.desired_model_store_path = join(directory, "desired.json"); cfg.access_key_store_path = join(directory, "keys.json");
      const server = startServer(cfg, { secureStore: noopSecureStore }); servers.push(server); await once(server, "listening");
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP listener"); const base = `http://127.0.0.1:${address.port}`;
      const admin = { "content-type": "application/json" };
      await nativeFetch(`${base}/api/desired-models/openai%2Fallowed`, { method: "POST", headers: admin });
      const key = await (await nativeFetch(`${base}/api/access-keys`, { method: "POST", headers: admin, body: JSON.stringify({ name: "A", allowedModels: ["openai/allowed"] }) })).json() as any;
      const headers = { authorization: `Bearer ${key.secret}`, "content-type": "application/json" };
      const controlPlane = await nativeFetch(`${base}/api/settings`, { headers });
      expect(controlPlane.status).toBe(401); expect((await controlPlane.json() as any).error.code).toBe("MANAGED_KEY_CONTROL_PLANE_FORBIDDEN");
      expect((await nativeFetch(`${base}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ model: "claude-haiku-test", messages: [] }) })).status).toBe(200);
      await nativeFetch(`${base}/api/access-keys/${key.id}`, { method: "PUT", headers: admin, body: JSON.stringify({ enabled: false }) });
      const disabled = await nativeFetch(`${base}/v1/models`, { headers }); expect(disabled.status).toBe(401); expect((await disabled.json() as any).error.code).toBe("ACCESS_KEY_DISABLED");
      await nativeFetch(`${base}/api/access-keys/${key.id}`, { method: "DELETE", headers: admin });
      const deleted = await nativeFetch(`${base}/v1/models`, { headers }); expect(deleted.status).toBe(401); expect((await deleted.json() as any).error.code).toBe("INVALID_ACCESS_KEY");
      const malformed = await nativeFetch(`${base}/v1/models`, { headers: { authorization: "Bearer sift_sk_nope" } }); expect(malformed.status).toBe(401);
    } finally { process.env.ANTHROPIC_MODEL = previousModel; rmSync(directory, { recursive: true, force: true }); }
  });
});
