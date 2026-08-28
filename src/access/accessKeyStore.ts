import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { accessKeyLast4, accessKeyPrefix, createAccessKeySecret, hashAccessKey, isLocalAccessKeySecret, verifyAccessKey } from "./crypto.js";
import { modelOverridesSchema, validateModelOverrides, type ModelOverrides } from "./schema.js";

export interface AccessKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  keyLast4: string;
  enabled: boolean;
  allowedModels: string[];
  /** Optional for backwards compatibility with version-1 files. */
  modelOverrides: ModelOverrides;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

interface AccessKeyFile { version: 1; keys: Record<string, AccessKey>; }
export interface CreatedAccessKey { record: AccessKey; secret: string; }

function cleanName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 120 || /[\r\n]/.test(value)) throw new Error("Invalid access key name");
  return value;
}
function cleanModels(models: string[]): string[] {
  if (!Array.isArray(models)) throw new Error("allowedModels must be an array");
  const values = [...new Set(models.map((model) => model.trim()))];
  if (values.some((model) => !model || model.length > 512 || /[\r\n]/.test(model))) throw new Error("Invalid allowed model");
  return values;
}

export class JsonAccessKeyStore {
  private keys: Record<string, AccessKey> = {};
  private usagePersistTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly path: string) {}

  load(): void {
    if (!existsSync(this.path)) return;
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as AccessKeyFile;
    if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== "object") throw new Error("Invalid access key store format");
    for (const key of Object.values(parsed.keys)) {
      if (!key.id || !key.keyHash || !key.keyPrefix || !key.keyLast4 || typeof key.enabled !== "boolean" || !Array.isArray(key.allowedModels)) throw new Error("Invalid access key entry");
      cleanName(key.name); cleanModels(key.allowedModels);
      modelOverridesSchema.parse(key.modelOverrides ?? {});
    }
    this.keys = Object.fromEntries(Object.entries(parsed.keys).map(([id, key]) => {
      const allowedModels = cleanModels(key.allowedModels);
      const overrides = validateModelOverrides(key.modelOverrides ?? {});
      return [id, { ...key, allowedModels, modelOverrides: Object.fromEntries(Object.entries(overrides).filter(([source]) => allowedModels.includes(source))) }];
    }));
  }

  list(): AccessKey[] { return Object.values(this.keys).map((key) => structuredClone(key)); }
  get(id: string): AccessKey | undefined { return this.keys[id] ? structuredClone(this.keys[id]) : undefined; }

  create(name: string, allowedModels: string[], modelOverrides: ModelOverrides = {}): CreatedAccessKey {
    const secret = createAccessKeySecret();
    const now = new Date().toISOString();
    const cleanedModels = cleanModels(allowedModels);
    const record: AccessKey = { id: randomUUID(), name: cleanName(name), keyHash: hashAccessKey(secret), keyPrefix: accessKeyPrefix(secret), keyLast4: accessKeyLast4(secret), enabled: true, allowedModels: cleanedModels, modelOverrides: validateModelOverrides(modelOverrides, cleanedModels), createdAt: now, updatedAt: now, lastUsedAt: null };
    this.keys[record.id] = record;
    this.persist();
    return { record: structuredClone(record), secret };
  }

  update(id: string, patch: { name?: string; allowedModels?: string[]; enabled?: boolean; modelOverrides?: ModelOverrides }): AccessKey {
    const existing = this.keys[id];
    if (!existing) throw new Error("Access key not found");
    const allowedModels = patch.allowedModels === undefined ? existing.allowedModels : cleanModels(patch.allowedModels);
    const modelOverrides = patch.modelOverrides === undefined
      ? Object.fromEntries(Object.entries(existing.modelOverrides ?? {}).filter(([source]) => allowedModels.includes(source)))
      : validateModelOverrides(patch.modelOverrides, allowedModels);
    const record = { ...existing, allowedModels, modelOverrides, ...(patch.name === undefined ? {} : { name: cleanName(patch.name) }), ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), updatedAt: new Date().toISOString() };
    this.keys[id] = record; this.persist(); return structuredClone(record);
  }

  delete(id: string): boolean { const existed = id in this.keys; delete this.keys[id]; if (existed) this.persist(); return existed; }

  findBySecret(secret: string): AccessKey | undefined {
    if (!isLocalAccessKeySecret(secret)) return undefined;
    const found = Object.values(this.keys).find((key) => verifyAccessKey(secret, key.keyHash));
    return found ? structuredClone(found) : undefined;
  }

  touchLastUsed(id: string, at = new Date().toISOString()): void {
    const key = this.keys[id]; if (!key) return;
    key.lastUsedAt = at; key.updatedAt = at;
    // Usage is best-effort metadata. Coalesce it off the proxy path instead of
    // synchronously rewriting the JSON file for every inference request.
    if (!this.usagePersistTimer) {
      this.usagePersistTimer = setTimeout(() => {
        this.usagePersistTimer = undefined;
        this.persist();
      }, 1_000);
      this.usagePersistTimer.unref?.();
    }
  }

  removeModelFromAll(modelId: string): number {
    let changed = 0;
    for (const key of Object.values(this.keys)) {
      const allowedModels = key.allowedModels.filter((model) => model !== modelId);
      const modelOverrides = Object.fromEntries(Object.entries(key.modelOverrides ?? {}).filter(([source]) => source !== modelId && allowedModels.includes(source)));
      if (allowedModels.length !== key.allowedModels.length || Object.keys(modelOverrides).length !== Object.keys(key.modelOverrides ?? {}).length) { key.allowedModels = allowedModels; key.modelOverrides = modelOverrides; key.updatedAt = new Date().toISOString(); changed++; }
    }
    if (changed) this.persist();
    return changed;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, keys: this.keys }, null, 2) + "\n", "utf8");
    renameSync(temporary, this.path);
  }
}
