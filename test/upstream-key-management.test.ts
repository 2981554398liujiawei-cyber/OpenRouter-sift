import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";
import type { SecureKeyStore } from "../src/auth/secureStore";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

class FakeSecureStore implements SecureKeyStore {
  readonly label = "Test credential store";
  constructor(private value: string | null = null, public failSave = false) {}
  available(): boolean { return true; }
  load(): string | null { return this.value; }
  save(key: string): void {
    if (this.failSave) throw new Error("simulated OS refusal");
    this.value = key;
  }
  clear(): void { this.value = null; }
}

interface UpstreamCall { url: string; auth: string | null; }
let upstreamCalls: UpstreamCall[] = [];

/** Mock OpenRouter: authenticated /key probe, public catalog, endpoints, inference and generation. */
function mockUpstream(options: { keyProbeStatus?: number; keyProbeFail?: "network" } = {}) {
  upstreamCalls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const target = String(url);
    const auth = typeof init?.headers?.authorization === "string" ? init.headers.authorization : (init?.headers?.get?.("authorization") ?? null);
    upstreamCalls.push({ url: target, auth });
    if (target.endsWith("/key")) {
      if (options.keyProbeFail === "network") throw new Error("getaddrinfo ENOTFOUND openrouter.ai");
      const status = options.keyProbeStatus ?? 200;
      return new Response(JSON.stringify({ data: {} }), { status, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/endpoints")) {
      const modelId = decodeURIComponent(target.split("/models/")[1]?.split("/endpoints")[0] ?? "test/one");
      return new Response(JSON.stringify({ data: { endpoints: [{ provider_name: "Alpha", tag: "alpha", pricing: { prompt: "0.000001", completion: "0.000002" } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/generation")) {
      return new Response(JSON.stringify({ data: { provider_name: "Alpha", tokens_prompt: 1, tokens_completion: 1, total_cost: 0.000001 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/chat/completions")) {
      return new Response(JSON.stringify({ id: "gen-rot-1", model: "test/one", choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json", "x-generation-id": "gen-rot-1" } });
    }
    return new Response(JSON.stringify({ data: [{ id: "test/one", name: "one", context_length: 8192, pricing: { prompt: "0.000001", completion: "0.000002" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const SECRET_ENV = "sk-or-env-key-AAAA";
const SECRET_B = "sk-or-ui-key-BBBBBBBBBB";

function seedMetadata(dir: string): string {
  const now = new Date().toISOString();
  const file = { version: 1, models: { fetchedAt: now, value: [{ id: "test/one", name: "one", contextLength: 8192, pricing: { prompt: "0.000001", completion: "0.000002" } }], raw: { data: [] } }, endpoints: { "test/one": { fetchedAt: now, value: [{ providerName: "Alpha", providerSlug: null, providerRoutingId: "alpha", tag: "alpha", name: null, modelId: "test/one", pricing: { prompt: "0.000001", completion: "0.000002" }, contextLength: 8192, maxCompletionTokens: null, maxPromptTokens: null, quantization: null, supportedParameters: null, supportsImplicitCaching: null, performance: { latencyLast30m: null, throughputLast30m: null, uptimeLast5m: null, uptimeLast30m: null, uptimeLast1d: null }, status: null }], raw: { data: { endpoints: [] } } } } };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(file));
  return join(dir, "metadata.json");
}

interface Harness { base: string; dir: string; store: FakeSecureStore; control: Record<string, string>; }

async function boot(dir: string, store: SecureKeyStore, envKey: string | null): Promise<Harness> {
  const cfg = loadConfig({});
  cfg.port = 0;
  cfg.upstream_api_key = envKey ?? undefined;
  cfg.log_level = "silent";
  cfg.metadata_cache_path = seedMetadata(dir);
  cfg.model_policy_store_path = join(dir, "policies.json");
  cfg.settings_store_path = join(dir, "settings.json");
  cfg.request_log_store_path = join(dir, "requests.json");
  cfg.desired_model_store_path = join(dir, "desired.json");
  cfg.access_key_store_path = join(dir, "keys.json");
  const server = startServer(cfg, { secureStore: store });
  servers.push(server);
  await once(server, "listening");
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, dir, store, control: { "content-type": "application/json" } };
}

async function setKey(h: Harness, body: Record<string, unknown>) {
  return nativeFetch(`${h.base}/api/settings/openrouter-key`, { method: "PUT", headers: h.control, body: JSON.stringify(body) });
}

describe("OpenRouter key management API", () => {
  it("saves a verified key, remembers it, and never leaks the secret through GET responses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-basic-")); tempDirs.push(dir);
    mockUpstream();
    const store = new FakeSecureStore();
    const h = await boot(dir, store, null);

    const saved = await setKey(h, { apiKey: SECRET_B, remember: true });
    expect(saved.status).toBe(200);
    const body = await saved.json() as any;
    expect(body.openRouterApiKey.configured).toBe(true);
    expect(body.openRouterApiKey.source).toBe("secure-store");
    expect(body.openRouterApiKey.masked).toBe("••••" + SECRET_B.slice(-4));
    expect(JSON.stringify(body)).not.toContain(SECRET_B);

    // GET /api/settings and /api/status expose mask only (§37)
    for (const path of ["/api/settings", "/api/status"]) {
      const serialized = JSON.stringify(await (await nativeFetch(`${h.base}${path}`)).json());
      expect(serialized).not.toContain("sk-or-");
      expect(serialized).not.toContain(SECRET_B);
    }

    // Remember ON persisted into the credential store only — no plaintext in any JSON store (§58)
    expect(store.load()).toBe(SECRET_B);
    for (const file of ["settings.json", "metadata.json", "requests.json", "keys.json", "policies.json", "desired.json"]) {
      const path = join(dir, file);
      if (existsSync(path)) expect(readFileSync(path, "utf8")).not.toContain(SECRET_B);
    }
  });

  it("rejects a key OpenRouter refuses, without storing it (§17)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-invalid-")); tempDirs.push(dir);
    mockUpstream({ keyProbeStatus: 401 });
    const store = new FakeSecureStore();
    const h = await boot(dir, store, null);
    const saved = await setKey(h, { apiKey: SECRET_B, remember: true });
    expect(saved.status).toBe(422);
    expect((await saved.json() as any).error.code).toBe("INVALID_UPSTREAM_KEY");
    expect(store.load()).toBeNull();
  });

  it("distinguishes network failure from auth failure and allows saving unverified (§18)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-network-")); tempDirs.push(dir);
    mockUpstream({ keyProbeFail: "network" });
    const h = await boot(dir, new FakeSecureStore(), null);
    const blocked = await setKey(h, { apiKey: SECRET_B, remember: false });
    expect(blocked.status).toBe(502);
    const body = await blocked.json() as any;
    expect(body.error.code).toBe("UPSTREAM_UNREACHABLE");
    expect(body.allowUnverified).toBe(true);
    expect(JSON.stringify(body.error.message)).not.toContain("rejected");
    const unverified = await setKey(h, { apiKey: SECRET_B, remember: false, verify: false });
    expect(unverified.status).toBe(200);
    expect((await unverified.json() as any).openRouterApiKey.source).toBe("ui-session");
  });

  it("offers session-only mode when secure persistence fails (§47)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-storefail-")); tempDirs.push(dir);
    mockUpstream();
    const store = new FakeSecureStore();
    store.failSave = true;
    const h = await boot(dir, store, null);
    const saved = await setKey(h, { apiKey: SECRET_B, remember: true });
    expect(saved.status).toBe(503);
    const body = await saved.json() as any;
    expect(body.error.code).toBe("SECURE_STORE_UNAVAILABLE");
    expect(body.allowSessionOnly).toBe(true);
    const session = await setKey(h, { apiKey: SECRET_B, remember: false });
    expect(session.status).toBe(200);
    expect((await session.json() as any).openRouterApiKey.source).toBe("ui-session");
  });

  it("validates input and keeps managed keys and control auth boundaries intact (§35/§36)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-auth-")); tempDirs.push(dir);
    mockUpstream();
    const h = await boot(dir, new FakeSecureStore(), null);
    expect((await setKey(h, { apiKey: "   " })).status).toBe(422);

    const managed = await nativeFetch(`${h.base}/api/settings/openrouter-key`, { method: "PUT", headers: { authorization: "Bearer sift_sk_somekey", "content-type": "application/json" }, body: JSON.stringify({ apiKey: SECRET_B }) });
    expect(managed.status).toBe(401);
    expect((await managed.json() as any).error.code).toBe("MANAGED_KEY_CONTROL_PLANE_FORBIDDEN");

    const cfg = loadConfig({});
    cfg.port = 0; cfg.upstream_api_key = undefined; cfg.local_api_key = "control-secret"; cfg.log_level = "silent";
    cfg.metadata_cache_path = join(dir, "m2.json"); cfg.model_policy_store_path = join(dir, "p2.json");
    cfg.settings_store_path = join(dir, "s2.json"); cfg.request_log_store_path = join(dir, "r2.json");
    cfg.desired_model_store_path = join(dir, "d2.json"); cfg.access_key_store_path = join(dir, "k2.json");
    const server = startServer(cfg, { secureStore: new FakeSecureStore() });
    servers.push(server);
    await once(server, "listening");
    const authed = `http://127.0.0.1:${(server.address() as any).port}`;
    const unauth = await nativeFetch(`${authed}/api/settings/openrouter-key`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: SECRET_B }) });
    expect(unauth.status).toBe(401);
  });

  it("rotates the active key at runtime across catalog, endpoints, inference and enrichment (P0 §54-§57)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-rotate-")); tempDirs.push(dir);
    mockUpstream();
    const h = await boot(dir, new FakeSecureStore(), SECRET_ENV);

    // Prepare a managed inference path (desired model + local key).
    expect((await nativeFetch(`${h.base}/api/desired-models/test%2Fone`, { method: "POST", headers: h.control })).status).toBe(201);
    const created = await (await nativeFetch(`${h.base}/api/access-keys`, { method: "POST", headers: h.control, body: JSON.stringify({ name: "Rotation QA", allowedModels: ["test/one"] }) })).json() as any;

    const inference = async () => nativeFetch(`${h.base}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${created.secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "test/one", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }) });

    // Environment key is active first.
    expect((await inference()).status).toBe(200);
    const firstInference = [...upstreamCalls].reverse().find((c) => c.url.includes("/chat/completions"))!;
    expect(firstInference.auth).toBe(`Bearer ${SECRET_ENV}`);

    // Save a new runtime key → every consumer immediately uses it, no restart (§42).
    expect((await setKey(h, { apiKey: SECRET_B, remember: false })).status).toBe(200);

    await nativeFetch(`${h.base}/api/models/refresh`, { method: "POST", headers: h.control });
    expect(upstreamCalls.filter((c) => c.url.endsWith("/models")).at(-1)!.auth).toBe(`Bearer ${SECRET_B}`);

    await nativeFetch(`${h.base}/api/models/test%2Fone/endpoints/refresh`, { method: "POST", headers: h.control });
    expect(upstreamCalls.find((c) => c.url.includes("/endpoints"))!.auth).toBe(`Bearer ${SECRET_B}`);

    expect((await inference()).status).toBe(200);
    const secondInference = [...upstreamCalls].reverse().find((c) => c.url.includes("/chat/completions"))!;
    expect(secondInference.auth).toBe(`Bearer ${SECRET_B}`);

    // Generation enrichment for the second inference must also use the new key (§43).
    await vi.waitFor(() => {
      // The first inference was already in flight pre-rotation and may legitimately finish with the old key (§23);
      // the second inference's enrichment must carry the new one.
      const generation = upstreamCalls.filter((c) => c.url.includes("/generation")).at(-1);
      expect(generation?.auth).toBe(`Bearer ${SECRET_B}`);
    }, { timeout: 3000 });

    // Key writes never land in the request history (§34).
    const requests = await (await nativeFetch(`${h.base}/api/requests`, { headers: h.control })).json() as any;
    expect(JSON.stringify(requests)).not.toContain("openrouter-key");
    expect(JSON.stringify(requests)).not.toContain(SECRET_B);
  });

  it("fails closed with OPENROUTER_KEY_REQUIRED when a managed key has no upstream key (§45/§46)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-required-")); tempDirs.push(dir);
    mockUpstream();
    const h = await boot(dir, new FakeSecureStore(), null);
    expect((await nativeFetch(`${h.base}/api/desired-models/test%2Fone`, { method: "POST", headers: h.control })).status).toBe(201);
    const created = await (await nativeFetch(`${h.base}/api/access-keys`, { method: "POST", headers: h.control, body: JSON.stringify({ name: "QA", allowedModels: ["test/one"] }) })).json() as any;
    const inference = await nativeFetch(`${h.base}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${created.secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "test/one", messages: [{ role: "user", content: "hi" }] }) });
    expect(inference.status).toBe(503);
    expect((await inference.json() as any).error.code).toBe("OPENROUTER_KEY_REQUIRED");
    // Legacy passthrough is unaffected: a client's own OpenRouter key still flows through (§68).
    const legacy = await nativeFetch(`${h.base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer sk-or-client-own-key", "content-type": "application/json" }, body: JSON.stringify({ model: "test/one", messages: [{ role: "user", content: "hi" }] }) });
    expect(legacy.status).toBe(200);
    const forwarded = [...upstreamCalls].reverse().find((c) => c.url.includes("/chat/completions"))!;
    expect(forwarded.auth).toBe("Bearer sk-or-client-own-key");
  });
});

describe("OpenRouter key persistence across restarts", () => {
  it("keeps remembered keys after restart, drops session keys, and restores env fallback after forget (§38-§41)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-key-restart-")); tempDirs.push(dir);
    mockUpstream();
    const store = new FakeSecureStore();
    const first = await boot(dir, store, SECRET_ENV);

    expect((await setKey(first, { apiKey: SECRET_B, remember: true })).status).toBe(200);
    await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));

    const second = await boot(dir, store, SECRET_ENV);
    let status = (await (await nativeFetch(`${second.base}/api/settings`)).json() as any).openRouterApiKey;
    expect(status.configured).toBe(true);
    expect(status.source).toBe("secure-store");

    // Session-only: remember=false survives until the server restarts (§39).
    expect((await setKey(second, { apiKey: SECRET_B, remember: false })).status).toBe(200);
    expect(((await (await nativeFetch(`${second.base}/api/settings`)).json() as any).openRouterApiKey.source)).toBe("ui-session");
    await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));

    const third = await boot(dir, store, SECRET_ENV);
    status = (await (await nativeFetch(`${third.base}/api/settings`)).json() as any).openRouterApiKey;
    expect(status.source).toBe("secure-store");

    // Forget removes both managed layers and falls back to the environment (§14/§41).
    expect((await nativeFetch(`${third.base}/api/settings/openrouter-key`, { method: "DELETE", headers: third.control })).status).toBe(200);
    status = (await (await nativeFetch(`${third.base}/api/settings`)).json() as any).openRouterApiKey;
    expect(status.source).toBe("environment");
    expect(store.load()).toBeNull();
    await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));

    const fourth = await boot(dir, store, SECRET_ENV);
    status = (await (await nativeFetch(`${fourth.base}/api/settings`)).json() as any).openRouterApiKey;
    expect(status.source).toBe("environment");
    expect((await setKey(fourth, { apiKey: SECRET_B, remember: true })).status).toBe(200);
    await nativeFetch(`${fourth.base}/api/settings/openrouter-key`, { method: "DELETE", headers: fourth.control });
    await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
    const fifth = await boot(dir, store, SECRET_ENV);
    status = (await (await nativeFetch(`${fifth.base}/api/settings`)).json() as any).openRouterApiKey;
    expect(status.source).toBe("environment"); // forgotten key stays forgotten after restart (§40)
  });
});
