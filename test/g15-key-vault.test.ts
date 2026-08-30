import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonDesiredModelStore } from "../src/access/desiredModelStore";
import { JsonAccessKeyStore } from "../src/access/accessKeyStore";
import type { SecureKeyStore } from "../src/auth/secureStore";
import { NoopSecureStore } from "../src/auth/secureStore";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

class MemorySecureStore implements SecureKeyStore {
  readonly label = "memory";
  constructor(private readonly values: Map<string, string>, private readonly id: string) {}
  available(): boolean { return true; }
  load(): string | null { return this.values.get(this.id) ?? null; }
  save(key: string): void { this.values.set(this.id, key); }
  clear(): void { this.values.delete(this.id); }
}

describe("G15 Local Access Key vault API", () => {
  const nativeFetch = globalThis.fetch;
  const servers: ReturnType<typeof startServer>[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it("requires control auth, returns only verified secure-store secrets, and revokes on delete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-g15-vault-")); dirs.push(dir);
    const values = new Map<string, string>();
    const factory = (id: string) => new MemorySecureStore(values, id);
    const desired = new JsonDesiredModelStore(join(dir, "desired.json")); desired.add("demo/model");
    const cfg = loadConfig({});
    cfg.host = "127.0.0.1"; cfg.port = 0; cfg.local_api_key = "control-secret"; cfg.upstream_api_key = "sk-or-test"; cfg.log_level = "silent";
    cfg.model_policy_store_path = join(dir, "policies.json"); cfg.metadata_cache_path = join(dir, "metadata.json"); cfg.settings_store_path = join(dir, "settings.json"); cfg.request_log_store_path = join(dir, "requests.json"); cfg.desired_model_store_path = join(dir, "desired.json"); cfg.access_key_store_path = join(dir, "keys.json");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })));
    const server = startServer(cfg, { secureStore: new NoopSecureStore(), accessKeySecureStoreFactory: factory }); servers.push(server); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("listener");
    const base = `http://127.0.0.1:${address.port}`;
    const control = { authorization: "Bearer control-secret", "content-type": "application/json" };
    const createdResponse = await nativeFetch(`${base}/api/access-keys`, { method: "POST", headers: control, body: JSON.stringify({ name: "G15", allowedModels: ["demo/model"] }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; secret: string; secretStorage: string };
    expect(created.secretStorage).toBe("secure-store");
    expect(readFileSync(cfg.access_key_store_path, "utf8")).not.toContain(created.secret);
    expect((await nativeFetch(`${base}/api/access-keys/${created.id}/secret`, { method: "POST" })).status).toBe(401);
    expect((await nativeFetch(`${base}/api/access-keys/${created.id}/secret`, { method: "POST", headers: { authorization: `Bearer ${created.secret}` } })).status).toBe(401);
    const secretResponse = await nativeFetch(`${base}/api/access-keys/${created.id}/secret`, { method: "POST", headers: control });
    expect(secretResponse.status).toBe(200);
    expect(await secretResponse.json()).toEqual({ secret: created.secret });
    expect(secretResponse.headers.get("cache-control")).toBe("no-store");
    expect((await nativeFetch(`${base}/api/access-keys/${created.id}`, { method: "DELETE", headers: control })).status).toBe(200);
    expect((await nativeFetch(`${base}/api/access-keys/${created.id}/secret`, { method: "POST", headers: control })).status).toBe(404);
    const reloaded = new JsonAccessKeyStore(cfg.access_key_store_path, factory); reloaded.load();
    expect(reloaded.findBySecret(created.secret)).toBeUndefined();
  });
});
