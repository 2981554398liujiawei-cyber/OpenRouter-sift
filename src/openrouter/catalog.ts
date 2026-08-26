import { OpenRouterClient, OpenRouterMetadataError } from "./client.js";
import { parseEndpointsResponse, type EndpointDto } from "./endpoints.js";
import { parseModelsResponse, type ModelDto } from "./models.js";
import { JsonMetadataStore, type CachedValue } from "../storage/metadata.js";

export type CacheState = "fresh" | "stale" | "unavailable";
export interface CatalogResult<T> { data: T; fetchedAt: string | null; state: CacheState; }

export class OpenRouterCatalog {
  constructor(private readonly client: OpenRouterClient, private readonly store: JsonMetadataStore, private readonly ttlMs = 5 * 60_000) {}

  load(): void { this.store.load(); }

  async syncModels(force = false): Promise<CatalogResult<ModelDto[]>> {
    return this.fetchCached(this.store.getModels(), force, async () => {
      const parsed = parseModelsResponse(await this.client.getModels());
      return { value: parsed.models, raw: parsed.raw };
    }, (cached) => this.store.setModels(cached));
  }

  async getModelEndpoints(modelId: string, force = false): Promise<CatalogResult<EndpointDto[]>> {
    return this.fetchCached(this.store.getEndpoints(modelId), force, async () => {
      const parsed = parseEndpointsResponse(await this.client.getModelEndpoints(modelId));
      return { value: parsed.endpoints, raw: parsed.raw };
    }, (cached) => this.store.setEndpoints(modelId, cached));
  }

  private async fetchCached<T>(
    cached: CachedValue<T> | undefined,
    force: boolean,
    refresh: () => Promise<{ value: T; raw: unknown }>,
    save: (value: CachedValue<T>) => void,
  ): Promise<CatalogResult<T>> {
    if (cached && !force && Date.now() - Date.parse(cached.fetchedAt) < this.ttlMs) {
      return { data: cached.value, fetchedAt: cached.fetchedAt, state: "fresh" };
    }
    try {
      const refreshed = await refresh();
      const value = { ...refreshed, fetchedAt: new Date().toISOString() };
      save(value);
      return { data: value.value, fetchedAt: value.fetchedAt, state: "fresh" };
    } catch (error) {
      if (cached) return { data: cached.value, fetchedAt: cached.fetchedAt, state: "stale" };
      if (error instanceof OpenRouterMetadataError) throw error;
      throw new OpenRouterMetadataError("OpenRouter metadata response was invalid", undefined, "invalid_response");
    }
  }
}
