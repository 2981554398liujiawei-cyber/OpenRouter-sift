/**
 * Live OpenRouter smoke test — disabled by default.
 *
 * Run only with an upstream key in the environment:
 *   SIFT_LIVE_TEST=1 OPENROUTER_API_KEY=... npm test -- --run test/live-openrouter.test.ts
 *
 * Guarantees (G11 §125–§131):
 *  - never runs as part of the default `npm test`
 *  - reads the upstream key from the environment only (never written to disk or fixtures)
 *  - uses an isolated temporary data directory (the developer's real stores are untouched)
 *  - one cheap model, one short prompt, one inference
 *  - cleans up temporary state afterwards
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";

const enabled = process.env.SIFT_LIVE_TEST === "1";
const upstreamKey = process.env.OPENROUTER_API_KEY ?? "";

const servers: ReturnType<typeof startServer>[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

interface CatalogModel { id: string; pricing?: unknown; contextLength?: number | null }

function promptPrice(model: CatalogModel): number | null {
  if (!model.pricing || typeof model.pricing !== "object") return null;
  const raw = (model.pricing as Record<string, unknown>).prompt;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

describe.skipIf(!enabled || !upstreamKey)("live OpenRouter smoke", () => {
  it("refreshes the real catalog, mints a local key, and completes one short inference", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sift-live-"));
    tempDirs.push(directory);
    const cfg = loadConfig({});
    cfg.port = 0;
    cfg.upstream_api_key = upstreamKey;
    cfg.local_api_key = "live-control-secret";
    cfg.log_level = "silent";
    cfg.metadata_cache_path = join(directory, "metadata.json");
    cfg.model_policy_store_path = join(directory, "policies.json");
    cfg.settings_store_path = join(directory, "settings.json");
    cfg.request_log_store_path = join(directory, "requests.json");
    cfg.desired_model_store_path = join(directory, "desired.json");
    cfg.access_key_store_path = join(directory, "keys.json");

    const server = startServer(cfg); servers.push(server); await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const base = `http://127.0.0.1:${address.port}`;
    const control = { authorization: "Bearer live-control-secret", "content-type": "application/json" };

    // 1. Real catalog refresh (§10)
    const refreshed = await fetch(`${base}/api/models/refresh`, { method: "POST", headers: control });
    expect(refreshed.status).toBe(200);
    const catalog = await (await fetch(`${base}/api/models`, { headers: control })).json() as { items: CatalogModel[]; cache: { stale: boolean; available: boolean } };
    expect(catalog.items.length).toBeGreaterThan(0);
    expect(catalog.cache.available).toBe(true);

    const status = await (await fetch(`${base}/api/status`, { headers: control })).json() as { openrouter: { lastSuccessfulMetadataRequestAt: string | null; lastError: string | null } };
    expect(status.openrouter.lastSuccessfulMetadataRequestAt).toBeTruthy();
    expect(status.openrouter.lastError).toBeNull();

    // 2. Cheapest priced model keeps the smoke cheap (§129)
    const model = catalog.items.filter((item) => promptPrice(item) !== null).sort((a, b) => (promptPrice(a) ?? 0) - (promptPrice(b) ?? 0))[0] ?? catalog.items[0];
    expect(model).toBeTruthy();

    // 3. Desired model + local key (§29)
    expect((await fetch(`${base}/api/desired-models/${encodeURIComponent(model.id)}`, { method: "POST", headers: control })).status).toBe(201);
    const created = await (await fetch(`${base}/api/access-keys`, { method: "POST", headers: control, body: JSON.stringify({ name: "Live QA", allowedModels: [model.id] }) })).json() as { id: string; secret: string; keyPrefix: string };
    expect(created.secret.startsWith(created.keyPrefix)).toBe(true);

    // 4. Key-scoped /v1/models (§33)
    const scoped = await (await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${created.secret}` } })).json() as { data: Array<{ id: string }> };
    expect(scoped.data.map((item) => item.id)).toEqual([model.id]);

    // 5. One short inference (§53/§128)
    const completion = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.id, max_tokens: 16, messages: [{ role: "user", content: "Reply only: OK" }] }),
    });
    expect(completion.status).toBe(200);
    const body = await completion.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string };
    expect(body.choices?.[0]?.message?.content?.length ?? 0).toBeGreaterThan(0);

    // 6. Request record: metadata only, no prompt/response/secret (§68/§136)
    await new Promise((resolve) => setTimeout(resolve, 1500)); // allow async enrichment to settle
    const requests = await (await fetch(`${base}/api/requests?limit=5`, { headers: control })).json() as { items: Array<{ id: string; model: string | null; status: number | string | null; actualProviderName?: string | null }> };
    const record = requests.items.find((item) => item.model === model.id);
    expect(record).toBeTruthy();
    expect(Number(record?.status)).toBeGreaterThanOrEqual(200);
    expect(Number(record?.status)).toBeLessThan(300);
    const detail = await (await fetch(`${base}/api/requests/${record!.id}`, { headers: control })).json() as Record<string, unknown>;
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("Reply only: OK");
    expect(serialized).not.toContain(created.secret);
    expect(serialized).not.toContain(upstreamKey);

    // 7. Local key plaintext never lands on disk (§31/§79)
    const keyStore = readFileSync(cfg.access_key_store_path, "utf8");
    expect(keyStore).not.toContain(created.secret);
  }, 120_000);
});
