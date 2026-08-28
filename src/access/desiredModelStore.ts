import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { providerFilterConfigSchema } from "../providerFilters/schema.js";
import type { ProviderFilterConfig } from "../providerFilters/types.js";

export interface DesiredModel {
  modelId: string;
  enabled: boolean;
  providerFilter: ProviderFilterConfig | null;
  createdAt: string;
  updatedAt: string;
}

interface DesiredModelFile { version: 1; models: Record<string, DesiredModel>; }

function validModelId(modelId: string): boolean {
  return modelId.trim().length > 0 && modelId.length <= 512 && !/[\r\n]/.test(modelId);
}

export class JsonDesiredModelStore {
  private models: Record<string, DesiredModel> = {};

  constructor(private readonly path: string) {}

  load(): void {
    if (!existsSync(this.path)) return;
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as DesiredModelFile;
    if (parsed.version !== 1 || !parsed.models || typeof parsed.models !== "object") throw new Error("Invalid desired model store format");
    for (const [id, model] of Object.entries(parsed.models)) {
      if (id !== model.modelId || !validModelId(id) || typeof model.enabled !== "boolean" || typeof model.createdAt !== "string" || typeof model.updatedAt !== "string") {
        throw new Error("Invalid desired model entry");
      }
      if (model.providerFilter !== undefined && model.providerFilter !== null && !providerFilterConfigSchema.safeParse(model.providerFilter).success) throw new Error("Invalid desired model provider filter");
    }
    this.models = Object.fromEntries(Object.entries(parsed.models).map(([id, model]) => [id, { ...model, providerFilter: model.providerFilter ?? null }]));
  }

  get(modelId: string): DesiredModel | undefined { return this.models[modelId] ? structuredClone(this.models[modelId]) : undefined; }
  has(modelId: string): boolean { return this.models[modelId]?.enabled === true; }
  list(): DesiredModel[] { return Object.values(this.models).map((model) => structuredClone(model)); }

  add(modelId: string): DesiredModel {
    if (!validModelId(modelId)) throw new Error("Invalid model ID");
    const now = new Date().toISOString();
    const existing = this.models[modelId];
    const model = existing ? { ...existing, enabled: true, updatedAt: now } : { modelId, enabled: true, providerFilter: null, createdAt: now, updatedAt: now };
    this.models[modelId] = model;
    this.persist();
    return structuredClone(model);
  }

  remove(modelId: string): boolean {
    if (!validModelId(modelId)) return false;
    const existed = modelId in this.models;
    delete this.models[modelId];
    if (existed) this.persist();
    return existed;
  }

  setEnabled(modelId: string, enabled: boolean): DesiredModel {
    const existing = this.models[modelId];
    if (!existing) throw new Error("Desired model not found");
    const model = { ...existing, enabled, updatedAt: new Date().toISOString() };
    this.models[modelId] = model;
    this.persist();
    return structuredClone(model);
  }

  setProviderFilter(modelId: string, providerFilter: ProviderFilterConfig | null): DesiredModel {
    const existing = this.models[modelId];
    if (!existing) throw new Error("Desired model not found");
    const model = { ...existing, providerFilter, updatedAt: new Date().toISOString() };
    this.models[modelId] = model;
    this.persist();
    return structuredClone(model);
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, models: this.models }, null, 2) + "\n", "utf8");
    renameSync(temporary, this.path);
  }
}
