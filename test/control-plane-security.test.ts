import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";
import { NoopSecureStore } from "../src/auth/secureStore";
import { isolatedConfig } from "./helpers";

const nativeFetch = globalThis.fetch;
const noopSecureStore = new NoopSecureStore();
const servers: ReturnType<typeof startServer>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function boot(overrides: Partial<ReturnType<typeof loadConfig>>) {
  const dir = mkdtempSync(join(tmpdir(), "g12-sec-"));
  tempDirs.push(dir);
  const cfg = isolatedConfig(dir, overrides);
  const server = startServer(cfg, { secureStore: noopSecureStore });
  servers.push(server);
  return once(server, "listening").then(() => {
    const address = server.address() as { port: number };
    return { base: `http://127.0.0.1:${address.port}`, port: address.port };
  });
}

function rawRequest(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

describe("G12 control plane security", () => {
  it("rejects foreign Host headers on a loopback bind (DNS rebinding guard)", async () => {
    const { base, port } = await boot({});
    const host = new URL(base).host;
    const good = await rawRequest(port, "/healthz", { headers: { host } });
    expect(good.status).toBe(200);
    const localhost = await rawRequest(port, "/healthz", { headers: { host: `localhost:${port}` } });
    expect(localhost.status).toBe(200);
    const evil = await rawRequest(port, "/api/status", { headers: { host: "attacker.example" } });
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.body).error.code).toBe("ERR_INVALID_HOST");
    const ipv6 = await rawRequest(port, "/healthz", { headers: { host: `[::1]:${port}` } });
    expect(ipv6.status).toBe(200);
  });

  it("rejects cross-origin state-changing /api requests but allows loopback and keyless clients", async () => {
    const { base, port } = await boot({});
    const evilOrigin = await nativeFetch(`${base}/api/desired-models/deepseek%2Fdemo`, { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(evilOrigin.status).toBe(403);
    expect((await evilOrigin.json() as any).error.code).toBe("ERR_ORIGIN_FORBIDDEN");
    const loopbackOrigin = await nativeFetch(`${base}/api/desired-models/deepseek%2Fdemo`, { method: "POST", headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" }, body: "{}" });
    expect(loopbackOrigin.status).toBe(201);
    const noOrigin = await nativeFetch(`${base}/api/desired-models/deepseek%2Fdemo`, { method: "DELETE" });
    expect(noOrigin.status).toBe(200);
  });

  it("never emits a wildcard CORS grant and answers preflight only for loopback origins", async () => {
    const { base, port } = await boot({});
    const evilPreflight = await nativeFetch(`${base}/v1/chat/completions`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(evilPreflight.headers.get("access-control-allow-origin")).toBeNull();
    const apiPreflight = await nativeFetch(`${base}/api/status`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(apiPreflight.headers.get("access-control-allow-origin")).toBeNull();
    const loopbackPreflight = await nativeFetch(`${base}/v1/chat/completions`, { method: "OPTIONS", headers: { origin: `http://127.0.0.1:${port}` } });
    expect(loopbackPreflight.headers.get("access-control-allow-origin")).toBe(`http://127.0.0.1:${port}`);
    expect(loopbackPreflight.headers.get("access-control-allow-origin")).not.toContain("*");
  });

  it("refuses to start on a non-loopback bind without control auth", () => {
    const dir = mkdtempSync(join(tmpdir(), "g12-sec-bind-"));
    tempDirs.push(dir);
    expect(() => startServer(isolatedConfig(dir, { host: "0.0.0.0" }), { secureStore: noopSecureStore })).toThrow(/Refusing to bind/);
    expect(() => startServer(isolatedConfig(dir, { host: "192.168.1.50" }), { secureStore: noopSecureStore })).toThrow(/Refusing to bind/);
    const allowed = startServer(isolatedConfig(dir, { host: "0.0.0.0", local_api_key: "control-secret" }), { secureStore: noopSecureStore });
    servers.push(allowed);
    allowed.listen(0, "0.0.0.0");
  });

  it("maps oversized and malformed /api bodies to 413 and 400 instead of 500", async () => {
    const { base } = await boot({ max_body_bytes: 128 });
    const tooLarge = await nativeFetch(`${base}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ globalPolicy: { only: ["x".repeat(500)] } }) });
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json() as any).error.code).toBe("ERR_BODY_TOO_LARGE");
    const malformed = await nativeFetch(`${base}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: "this is not json" });
    expect(malformed.status).toBe(400);
  });

  it("never forwards the control key upstream in passthrough mode", async () => {
    let upstreamAuth: string | undefined;
    globalThis.fetch = vi.fn(async (url, init) => {
      const value = String(url);
      if (value === "https://openrouter.ai/api/v1/chat/completions") {
        upstreamAuth = (init?.headers as Record<string, string>)?.authorization;
        return new Response(JSON.stringify({ id: "gen_test" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const { base } = await boot({ upstream_api_key: "sk-or-upstream-real", local_api_key: "control-secret" });
    const response = await nativeFetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer control-secret", "content-type": "application/json" }, body: JSON.stringify({ model: "example/model", messages: [] }) });
    expect(response.status).toBe(200);
    expect(upstreamAuth).toBe("Bearer sk-or-upstream-real");
  });

  it("keeps the control key out of /config and never leaks store paths or runtime internals", async () => {
    const { base } = await boot({ upstream_api_key: "sk-or-config-secret", local_api_key: "control-secret" });
    const body = await (await nativeFetch(`${base}/config`)).json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("store_path");
    expect(serialized).not.toContain("_runtime");
    expect(serialized).not.toContain("C:\\");
    expect(body.host).toBe("127.0.0.1");
    expect(body.control_ui_requires_auth).toBe(true);
  });

  it("applies security headers to every control response", async () => {
    const { base } = await boot({});
    const response = await nativeFetch(`${base}/healthz`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("loads the static UI without auth while /api stays protected", async () => {
    const { base } = await boot({ local_api_key: "control-secret" });
    const ui = await nativeFetch(`${base}/ui/`);
    expect(ui.status).not.toBe(401);
    expect(ui.status).not.toBe(403);
    const apiNoAuth = await nativeFetch(`${base}/api/status`);
    expect(apiNoAuth.status).toBe(401);
    const apiWithAuth = await nativeFetch(`${base}/api/status`, { headers: { authorization: "Bearer control-secret" } });
    expect(apiWithAuth.status).toBe(200);
    const managed = await nativeFetch(`${base}/api/status`, { headers: { authorization: "Bearer sift_sk_managed_key_1234567890" } });
    expect(managed.status).toBe(401);
    expect((await managed.json() as any).error.code).toBe("MANAGED_KEY_CONTROL_PLANE_FORBIDDEN");
  });

  it("exposes the product name and package version from /version", async () => {
    const { base } = await boot({});
    const body = await (await nativeFetch(`${base}/version`)).json() as { name: string; version: string };
    expect(body.name).toBe("openrouter-sift");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
