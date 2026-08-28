import { OpenRouterClient, OpenRouterMetadataError } from "./client.js";
import { parseEndpointsResponse, type EndpointDto } from "./endpoints.js";
import { parseModelsResponse, type ModelDto } from "./models.js";
import { JsonMetadataStore, type CachedValue } from "../storage/metadata.js";

export type CacheState = "fresh" | "stale" | "unavailable";
export interface CatalogResult<T> { data: T; fetchedAt: string | null; state: CacheState; }
/** A cache-only view for latency-sensitive inference paths. This method never performs network IO. */
export interface EndpointSnapshot {
  data: EndpointDto[];
  fetchedAt: string | null;
  ageMs: number | null;
  available: boolean;
}
export interface CatalogStatus { lastSuccessfulMetadataRequestAt: string | null; lastError: string | null; modelCount: number; fetchedAt: string | null; stale: boolean; }

export class OpenRouterCatalog {
  private modelsInFlight: Promise<CatalogResult<ModelDto[]>> | undefined;
  private endpointsInFlight = new Map<string, Promise<CatalogResult<EndpointDto[]>>>();
  private lastSuccessfulMetadataRequestAt: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly client: OpenRouterClient, private readonly store: JsonMetadataStore, private ttlMs = 5 * 60_000) {}

  load(): void { this.store.load(); }

  async syncModels(force = false): Promise<CatalogResult<ModelDto[]>> {
    if (this.modelsInFlight) return this.modelsInFlight;
    const operation = this.fetchCached(this.store.getModels(), force, async () => {
      const parsed = parseModelsResponse(await this.client.getModels());
      return { value: parsed.models, raw: parsed.raw };
    }, (cached) => this.store.setModels(cached));
    this.modelsInFlight = operation;
    try { return await operation; } finally { this.modelsInFlight = undefined; }
  }

  async getModelEndpoints(modelId: string, force = false): Promise<CatalogResult<EndpointDto[]>> {
    const existing = this.endpointsInFlight.get(modelId);
    if (existing) return existing;
    const operation = this.fetchCached(this.store.getEndpoints(modelId), force, async () => {
      const parsed = parseEndpointsResponse(await this.client.getModelEndpoints(modelId));
      return { value: parsed.endpoints, raw: parsed.raw };
    }, (cached) => this.store.setEndpoints(modelId, cached));
    this.endpointsInFlight.set(modelId, operation);
    try { return await operation; } finally { this.endpointsInFlight.delete(modelId); }
  }

  getModelEndpointsSnapshot(modelId: string): EndpointSnapshot {
    const cached = this.store.getEndpoints(modelId);
    if (!cached) return { data: [], fetchedAt: null, ageMs: null, available: false };
    const fetchedAtMs = Date.parse(cached.fetchedAt);
    const ageMs = Number.isFinite(fetchedAtMs) ? Math.max(0, Date.now() - fetchedAtMs) : null;
    return { data: cached.value, fetchedAt: cached.fetchedAt, ageMs, available: true };
  }

  getModelsSnapshot(): CatalogResult<ModelDto[]> {
    const cached = this.store.getModels();
    if (!cached) return { data: [], fetchedAt: null, state: "unavailable" };
    return { data: cached.value, fetchedAt: cached.fetchedAt, state: this.isFresh(cached.fetchedAt) ? "fresh" : "stale" };
  }

  getStatus(): CatalogStatus {
    const snapshot = this.getModelsSnapshot();
    return { lastSuccessfulMetadataRequestAt: this.lastSuccessfulMetadataRequestAt, lastError: this.lastError, modelCount: snapshot.data.length, fetchedAt: snapshot.fetchedAt, stale: snapshot.state !== "fresh" };
  }

  getTtlMs(): number { return this.ttlMs; }
  setTtlMs(ttlMs: number): void { this.ttlMs = ttlMs; }

  private async fetchCached<T>(
    cached: CachedValue<T> | undefined,
    force: boolean,
    refresh: () => Promise<{ value: T; raw: unknown }>,
    save: (value: CachedValue<T>) => void,
  ): Promise<CatalogResult<T>> {
    if (cached && !force && this.isFresh(cached.fetchedAt)) {
      return { data: cached.value, fetchedAt: cached.fetchedAt, state: "fresh" };
    }
    try {
      const refreshed = await refresh();
      const value = { ...refreshed, fetchedAt: new Date().toISOString() };
      save(value);
      this.lastSuccessfulMetadataRequestAt = value.fetchedAt;
      this.lastError = null;
      return { data: value.value, fetchedAt: value.fetchedAt, state: "fresh" };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "OpenRouter metadata request failed";
      if (cached) return { data: cached.value, fetchedAt: cached.fetchedAt, state: "stale" };
      if (error instanceof OpenRouterMetadataError) throw error;
      throw new OpenRouterMetadataError("OpenRouter metadata response was invalid", undefined, "invalid_response");
    }
  }

  private isFresh(fetchedAt: string): boolean { return Date.now() - Date.parse(fetchedAt) < this.ttlMs; }
}
