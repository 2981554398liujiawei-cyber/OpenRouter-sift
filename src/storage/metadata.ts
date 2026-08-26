import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EndpointDto } from "../openrouter/endpoints.js";
import type { ModelDto } from "../openrouter/models.js";

export interface CachedValue<T> {
  fetchedAt: string;
  value: T;
  raw: unknown;
}

interface MetadataFile {
  version: 1;
  models?: CachedValue<ModelDto[]>;
  endpoints: Record<string, CachedValue<EndpointDto[]>>;
}

function isCachedArray(value: unknown): value is CachedValue<unknown[]> {
  return !!value && typeof value === "object" && typeof (value as any).fetchedAt === "string" && !Number.isNaN(Date.parse((value as any).fetchedAt)) && Array.isArray((value as any).value) && "raw" in (value as object);
}

export class JsonMetadataStore {
  private data: MetadataFile = { version: 1, endpoints: {} };

  constructor(private readonly path: string) {}

  load(): void {
    if (!existsSync(this.path)) return;
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as MetadataFile;
    if (parsed.version !== 1 || !parsed.endpoints || typeof parsed.endpoints !== "object") throw new Error("Invalid metadata cache format");
    if (parsed.models !== undefined && !isCachedArray(parsed.models)) throw new Error("Invalid models metadata cache entry");
    if (!Object.values(parsed.endpoints).every(isCachedArray)) throw new Error("Invalid endpoint metadata cache entry");
    this.data = parsed;
  }

  getModels(): CachedValue<ModelDto[]> | undefined { return this.data.models; }
  getEndpoints(modelId: string): CachedValue<EndpointDto[]> | undefined { return this.data.endpoints[modelId]; }

  setModels(value: CachedValue<ModelDto[]>): void {
    this.data.models = value;
    this.persist();
  }

  setEndpoints(modelId: string, value: CachedValue<EndpointDto[]>): void {
    this.data.endpoints[modelId] = value;
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.data, null, 2) + "\n", "utf8");
    renameSync(temporary, this.path);
  }
}
