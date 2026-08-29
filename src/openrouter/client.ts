export class OpenRouterMetadataError extends Error {
  constructor(message: string, readonly status?: number, readonly code: "timeout" | "aborted" | "http" | "invalid_response" | "network" | "no_key" = "network") {
    super(message);
    this.name = "OpenRouterMetadataError";
  }
}

export interface OpenRouterClientOptions {
  apiKey?: string;
  /** Resolved per request so a key rotated at runtime (e.g. saved from the UI) is picked up without a restart. */
  getApiKey?: () => string | null;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenRouterClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private apiKeyFor(): string | null {
    if (this.options.getApiKey) return this.options.getApiKey();
    return this.options.apiKey ?? null;
  }

  async getModels(signal?: AbortSignal): Promise<unknown> {
    return this.getJson("/models", signal);
  }

  async getModelEndpoints(modelId: string, signal?: AbortSignal): Promise<unknown> {
    const slash = modelId.indexOf("/");
    if (slash <= 0 || slash === modelId.length - 1) {
      throw new OpenRouterMetadataError("Model ID must be in author/model form", undefined, "invalid_response");
    }
    const author = modelId.slice(0, slash);
    const slug = modelId.slice(slash + 1);
    return this.getJson(`/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`, signal);
  }

  async getGeneration(generationId: string, signal?: AbortSignal): Promise<unknown> {
    if (!generationId.trim()) throw new OpenRouterMetadataError("Generation ID is required", undefined, "invalid_response");
    return this.getJson(`/generation?id=${encodeURIComponent(generationId)}`, signal, true);
  }

  /** Lightweight authenticated probe used to validate a candidate upstream key before saving it. */
  async getKeyInfo(signal?: AbortSignal): Promise<unknown> {
    return this.getJson("/key", signal, true);
  }

  private async getJson(path: string, externalSignal?: AbortSignal, requireAuth = false): Promise<unknown> {
    const apiKey = this.apiKeyFor();
    if (requireAuth && !apiKey) {
      throw new OpenRouterMetadataError("OpenRouter API key is not configured", undefined, "no_key");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OpenRouterMetadataError(`OpenRouter metadata request failed with HTTP ${response.status}`, response.status, "http");
      }
      try {
        return await response.json();
      } catch {
        throw new OpenRouterMetadataError("OpenRouter metadata response was not valid JSON", response.status, "invalid_response");
      }
    } catch (error) {
      if (error instanceof OpenRouterMetadataError) throw error;
      if (controller.signal.aborted) {
        throw new OpenRouterMetadataError(externalSignal?.aborted ? "OpenRouter metadata request was aborted" : "OpenRouter metadata request timed out", undefined, externalSignal?.aborted ? "aborted" : "timeout");
      }
      throw new OpenRouterMetadataError("OpenRouter metadata request failed", undefined, "network");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
}
