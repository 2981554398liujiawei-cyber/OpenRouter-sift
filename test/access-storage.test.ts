import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accessKeyLast4, accessKeyPrefix, hashAccessKey, verifyAccessKey } from "../src/access/crypto";
import { JsonDesiredModelStore } from "../src/access/desiredModelStore";
import { JsonAccessKeyStore } from "../src/access/accessKeyStore";
import { accessKeyModelOverrideSchema } from "../src/access/schema";
import type { SecureKeyStore } from "../src/auth/secureStore";

class MemorySecureStore implements SecureKeyStore {
  readonly label = "memory";
  constructor(private readonly values: Map<string, string>, private readonly id: string) {}
  available(): boolean { return true; }
  load(): string | null { return this.values.get(this.id) ?? null; }
  save(key: string): void { this.values.set(this.id, key); }
  clear(): void { this.values.delete(this.id); }
}

function memoryFactory(values = new Map<string, string>()) {
  return { values, factory: (id: string) => new MemorySecureStore(values, id) };
}

describe("G6 access stores", () => {
  it("persists desired models and removes them cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const models = new JsonDesiredModelStore(join(dir, "desired.json"));
      models.add("deepseek/deepseek-v4-flash");
      expect(models.has("deepseek/deepseek-v4-flash")).toBe(true);
      const reloaded = new JsonDesiredModelStore(join(dir, "desired.json"));
      reloaded.load();
      expect(reloaded.list()).toHaveLength(1);
      expect(reloaded.remove("deepseek/deepseek-v4-flash")).toBe(true);
      expect(reloaded.list()).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("stores only a digest and returns the secret once", () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const path = join(dir, "keys.json");
      const vault = memoryFactory();
      const store = new JsonAccessKeyStore(path, vault.factory);
      const created = store.create("Codex", ["deepseek/deepseek-v4-flash"]);
      expect(created.secret).toMatch(/^sift_sk_[A-Za-z0-9_-]{40,}$/);
      expect(store.get(created.record.id)).not.toHaveProperty("secret");
      const disk = readFileSync(path, "utf8");
      expect(disk).not.toContain(created.secret);
      expect(store.findBySecret(created.secret)?.id).toBe(created.record.id);
      const reloaded = new JsonAccessKeyStore(path, vault.factory); reloaded.load();
      expect(reloaded.findBySecret(created.secret)?.name).toBe("Codex");
      expect(reloaded.list()[0]).not.toHaveProperty("secret");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("uses constant-time-compatible digest verification and supports updates/removal", () => {
    const secret = "sift_sk_example_secret_12345678901234567890";
    expect(verifyAccessKey(secret, hashAccessKey(secret))).toBe(true);
    expect(verifyAccessKey(`${secret}x`, hashAccessKey(secret))).toBe(false);
    expect(accessKeyPrefix(secret)).toBe("sift_sk_example_");
    expect(accessKeyLast4(secret)).toBe("7890");

    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const store = new JsonAccessKeyStore(join(dir, "keys.json"), memoryFactory().factory);
      const first = store.create("A", ["a", "b"]);
      const second = store.create("B", ["b"]);
      store.update(first.record.id, { enabled: false, allowedModels: ["a", "b", "a"] });
      expect(store.get(first.record.id)?.enabled).toBe(false);
      expect(store.removeModelFromAll("b")).toBe(2);
      expect(store.get(first.record.id)?.allowedModels).toEqual(["a"]);
      expect(store.get(second.record.id)?.allowedModels).toEqual([]);
      expect(store.delete(second.record.id)).toBe(true);
      expect(store.findBySecret(first.secret)?.id).toBe(first.record.id);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects malformed names and model identifiers", () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const store = new JsonAccessKeyStore(join(dir, "keys.json"), memoryFactory().factory);
      expect(() => store.create("", [])).toThrow("Invalid access key name");
      expect(() => store.create("ok", [" "])).toThrow("Invalid allowed model");
      const models = new JsonDesiredModelStore(join(dir, "desired.json"));
      expect(() => models.add(" ")).toThrow("Invalid model ID");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("persists model overrides and prunes them when grants change", () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const store = new JsonAccessKeyStore(join(dir, "keys.json"), memoryFactory().factory);
      const override = { providerMode: "allowlist" as const, providers: ["provider-id"] };
      const created = store.create("Codex", ["provider/model", "other/model"], { "provider/model": override });
      expect(store.get(created.record.id)?.modelOverrides).toEqual({ "provider/model": override });
      store.update(created.record.id, { allowedModels: ["other/model"] });
      expect(store.get(created.record.id)?.modelOverrides).toEqual({});
      const reloaded = new JsonAccessKeyStore(join(dir, "keys.json"), memoryFactory().factory);
      reloaded.load();
      expect(reloaded.get(created.record.id)?.modelOverrides).toEqual({});
      expect(() => reloaded.update(created.record.id, { modelOverrides: { "provider/model": override } })).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps inherit overrides free of routing settings", () => {
    expect(accessKeyModelOverrideSchema.safeParse({ providerMode: "inherit" }).success).toBe(true);
    expect(accessKeyModelOverrideSchema.safeParse({ providerMode: "inherit", allowFallbacks: true }).success).toBe(false);
    expect(accessKeyModelOverrideSchema.safeParse({ providerMode: "inherit", providers: ["provider-id"] }).success).toBe(false);
  });

  it("rolls back an in-memory key when persistence fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const blocker = join(dir, "not-a-directory");
      writeFileSync(blocker, "blocker");
      const store = new JsonAccessKeyStore(join(blocker, "keys.json"), memoryFactory().factory);
      expect(() => store.create("Rollback", ["demo/model"])).toThrow();
      expect(store.list()).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("retains recoverable secrets in the OS-store adapter, never JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "sift-access-"));
    try {
      const vault = memoryFactory();
      const path = join(dir, "keys.json");
      const store = new JsonAccessKeyStore(path, vault.factory);
      const created = store.create("Recoverable", ["demo/model"]);
      expect(created.record.secretStorage).toBe("secure-store");
      expect(store.getSecret(created.record.id)).toEqual({ secret: created.secret });
      expect(readFileSync(path, "utf8")).not.toContain(created.secret);
      const reloaded = new JsonAccessKeyStore(path, vault.factory); reloaded.load();
      expect(reloaded.getSecret(created.record.id)).toEqual({ secret: created.secret });
      expect(reloaded.delete(created.record.id)).toBe(true);
      expect(vault.values.has(`local-access-key:${created.record.id}`)).toBe(false);
      expect(reloaded.getSecret(created.record.id)).toEqual({ reason: "missing" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
