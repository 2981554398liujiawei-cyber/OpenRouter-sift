import http, { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { readJsonBody, writeJson, writeError, pipeFetchResponse, getInboundAuth } from "./util/http.js";
import { applyResolvedProviderPolicy, resolveProviderPolicy } from "./policy/resolver.js";
import { ModelPolicySchema, type ModelPolicy } from "./policy/modelPolicy.js";
import { validateLocalAuth, validateMethod } from "./policy/validation.js";
import { JsonPolicyStore } from "./storage/policies.js";
import { JsonMetadataStore } from "./storage/metadata.js";
import { OpenRouterCatalog } from "./openrouter/catalog.js";
import { OpenRouterClient, OpenRouterMetadataError } from "./openrouter/client.js";
import { makeLogger } from "./util/log.js";
import { redactBody } from "./util/redact.js";
import { getVersion } from "./util/version.js";
import { ProviderPolicySchema, type ShimConfig } from "./config.js";
import { JsonSettingsStore, type ControlSettings } from "./storage/settings.js";
import { serveControlUi } from "./controlUi.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OPENROUTER_BASE_V1 = "https://openrouter.ai/api/v1";
// In the bundled CLI, the UI lives beside `dist/server`, not beside the caller's cwd.
const CONTROL_UI_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ui");

// Anthropic model names that Claude Code uses internally (for title generation, etc.)
// These need to be remapped to the user's preferred model
const ANTHROPIC_MODEL_PREFIXES = ["claude-", "claude-haiku-", "claude-sonnet-", "claude-opus-"];

function isAnthropicModel(model: string): boolean {
  return ANTHROPIC_MODEL_PREFIXES.some(prefix => model.toLowerCase().startsWith(prefix));
}

function getTargetModel(): string {
  // Use ANTHROPIC_MODEL env var (what the user configured for Claude Code)
  // Fall back to a sensible default
  return process.env.ANTHROPIC_MODEL || "moonshotai/kimi-k2.5";
}

function upstreamUrlForPath(pathname: string, config: ShimConfig): string | null {
  if (pathname === "/v1/messages" && config.enable_anthropic) {
    return `${OPENROUTER_BASE_V1}/messages`;
  }
  if (pathname === "/v1/chat/completions" && config.enable_chat) {
    return `${OPENROUTER_BASE_V1}/chat/completions`;
  }
  if (pathname === "/v1/responses" && config.enable_responses) {
    return `${OPENROUTER_BASE_V1}/responses`;
  }
  if (pathname === "/v1/models") {
    return `${OPENROUTER_BASE_V1}/models`;
  }
  return null;
}

function looksLikeAnthropicKey(auth: string): boolean {
  // Anthropic API keys typically start with "sk-ant-" or "sk-ant-api-"
  const key = auth.replace(/^Bearer\s+/i, "");
  return key.startsWith("sk-ant");
}

function looksLikeOpenRouterKey(auth: string): boolean {
  // OpenRouter API keys start with "sk-or-"
  const key = auth.replace(/^Bearer\s+/i, "");
  return key.startsWith("sk-or-");
}

function getUpstreamAuth(req: IncomingMessage, cfg: ShimConfig): string | undefined {
  if (cfg.auth_mode === "upstream-key") {
    if (!cfg.upstream_api_key) return undefined;
    return `Bearer ${cfg.upstream_api_key}`;
  }

  // passthrough mode with smart substitution
  const inboundAuth = getInboundAuth(req);

  if (inboundAuth) {
    // If inbound auth looks like an Anthropic key and we have an OpenRouter key,
    // substitute it automatically (common case: user has ANTHROPIC_API_KEY set for
    // other tools but wants to use OpenRouter via this shim)
    const isAnthropicKey = looksLikeAnthropicKey(inboundAuth);
    if (isAnthropicKey && cfg.upstream_api_key) {
      return `Bearer ${cfg.upstream_api_key}`;
    }
    // If it's already an OpenRouter key or some other key, pass it through
    return inboundAuth;
  }

  // No inbound auth, fall back to configured upstream key
  return cfg.upstream_api_key ? `Bearer ${cfg.upstream_api_key}` : undefined;
}

export function safeResponseBodyForLogging(body: string, redact: boolean): string {
  if (!redact) return body.slice(0, 2000);
  try {
    return JSON.stringify(redactBody(JSON.parse(body))).slice(0, 2000);
  } catch {
    return "[non-JSON response body omitted because redact_body is enabled]";
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error("Upstream request aborted")); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function maskedKey(key: string | undefined): string | null {
  if (!key) return null;
  return `••••${key.slice(-4)}`;
}

function policyForApi(modelPolicy: ModelPolicy | undefined): Record<string, unknown> {
  if (!modelPolicy) return { mode: "inherit" };
  return {
    mode: modelPolicy.mode,
    providers: modelPolicy.providers ?? [],
    providerOrder: modelPolicy.provider_order ?? [],
    allowFallbacks: modelPolicy.allow_fallbacks,
    policy: modelPolicy.policy,
    enabled: modelPolicy.enabled ?? true,
  };
}

function parseApiPolicy(value: unknown): ModelPolicy {
  if (!value || typeof value !== "object") throw new Error("Policy body must be a JSON object");
  const input = value as Record<string, unknown>;
  const customFields = {
    only: input.only,
    ignore: input.ignore,
    order: input.order,
    sort: input.sort,
    allow_fallbacks: input.allowFallbacks ?? input.allow_fallbacks,
    require_parameters: input.requireParameters ?? input.require_parameters,
    data_collection: input.dataCollection ?? input.data_collection,
    zdr: input.zdr,
    quantizations: input.quantizations,
    preferred_min_throughput: input.preferredMinThroughput ?? input.preferred_min_throughput,
    preferred_max_latency: input.preferredMaxLatency ?? input.preferred_max_latency,
    max_price: input.maxPrice ?? input.max_price,
  };
  const customPolicy = input.policy ?? (input.mode === "custom" && Object.values(customFields).some((field) => field !== undefined) ? customFields : undefined);
  return ModelPolicySchema.parse({
    mode: input.mode,
    providers: input.providers,
    provider_order: input.providerOrder ?? input.provider_order,
    allow_fallbacks: input.allowFallbacks ?? input.allow_fallbacks,
    policy: customPolicy,
    enabled: input.enabled,
  });
}

export function startServer(cfg: ShimConfig): http.Server {
  const log = makeLogger(cfg);
  const modelPolicies = new JsonPolicyStore(cfg.model_policy_store_path);
  try {
    modelPolicies.load();
  } catch (err: any) {
    log.error({ err: err?.message ?? String(err), path: cfg.model_policy_store_path }, "model policy store unavailable; using global policy only");
  }
  const metadataCatalog = new OpenRouterCatalog(
    new OpenRouterClient({ apiKey: cfg.upstream_api_key ?? "" }),
    new JsonMetadataStore(cfg.metadata_cache_path),
  );
  try {
    metadataCatalog.load();
  } catch (err: any) {
    log.error({ err: err?.message ?? String(err), path: cfg.metadata_cache_path }, "metadata cache unavailable; continuing without cached metadata");
  }
  const settingsStore = new JsonSettingsStore(cfg.settings_store_path);
  let controlSettings: ControlSettings = { mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs() };
  try {
    const saved = settingsStore.load();
    if (saved.mergeMode) cfg.merge_mode = saved.mergeMode;
    if (saved.globalPolicy) cfg.policy = ProviderPolicySchema.parse(saved.globalPolicy);
    if (typeof saved.metadataTtlMs === "number" && Number.isInteger(saved.metadataTtlMs) && saved.metadataTtlMs >= 1_000) metadataCatalog.setTtlMs(saved.metadataTtlMs);
    controlSettings = { mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs() };
  } catch (err: any) {
    log.error({ err: err?.message ?? String(err), path: cfg.settings_store_path }, "settings store unavailable; using configured defaults");
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", `http://${cfg.host}:${cfg.port}`);

    try {
      // Convenience endpoints
      if (req.method === "GET" && url.pathname === "/healthz") {
        return writeJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
      }

      if (req.method === "GET" && url.pathname === "/version") {
        return writeJson(res, 200, {
          name: "openrouter-provider-shim",
          version: cfg._runtime.version,
        });
      }

      if (req.method === "GET" && url.pathname === "/config") {
        // Return sanitized config (never includes upstream_api_key)
        const { upstream_api_key, local_api_key, ...safe } = cfg as any;
        return writeJson(res, 200, safe);
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        if (url.pathname.startsWith("/api/")) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, x-api-key",
        });
        res.end();
        return;
      }

      // Apply optional local authentication to both control-plane and proxy routes.
      if (cfg.local_api_key) {
        const authError = validateLocalAuth(req, cfg.local_api_key);
        if (authError) return writeError(res, authError.status, authError.message, authError.code);
      }

      // The control UI is a local, separately built asset bundle. Keep it outside
      // the management and proxy namespaces so it cannot alter their behavior.
      if (serveControlUi(req, res, url.pathname, CONTROL_UI_DIRECTORY)) return;

      if (url.pathname.startsWith("/api/")) {
        const endpointMatch = url.pathname.match(/^\/api\/models\/(.+)\/endpoints$/);
        const endpointRefreshMatch = url.pathname.match(/^\/api\/models\/(.+)\/endpoints\/refresh$/);
        const modelDetailMatch = url.pathname.match(/^\/api\/models\/(.+)$/);
        const policyMatch = url.pathname.match(/^\/api\/policies\/(.+)$/);
        const decodeModelId = (encoded: string): string | null => {
          try { const value = decodeURIComponent(encoded); return value ? value : null; } catch { return null; }
        };
        const metadataError = (err: unknown) => {
          const status = err instanceof OpenRouterMetadataError && err.status ? err.status : 502;
          return writeError(res, status, err instanceof OpenRouterMetadataError ? err.message : "OpenRouter metadata is unavailable", "ERR_METADATA_UNAVAILABLE");
        };
        try {
          if (url.pathname === "/api/status" && req.method === "GET") {
            const catalogStatus = metadataCatalog.getStatus();
            return writeJson(res, 200, { proxy: { running: true, host: cfg.host, port: cfg.port }, openrouter: { configured: Boolean(cfg.upstream_api_key), lastSuccessfulMetadataRequestAt: catalogStatus.lastSuccessfulMetadataRequestAt, lastError: catalogStatus.lastError }, catalog: { modelCount: catalogStatus.modelCount, fetchedAt: catalogStatus.fetchedAt, stale: catalogStatus.stale }, version: cfg._runtime.version });
          }
          if (url.pathname === "/api/models" && req.method === "GET") {
            const snapshot = metadataCatalog.getModelsSnapshot();
            const query = url.searchParams.get("q")?.trim().toLowerCase();
            const filter = url.searchParams.get("policy");
            const items = snapshot.data.filter((model) => {
              const policy = modelPolicies.get(model.id);
              const summary = policy?.mode ?? "inherit";
              return (!query || model.id.toLowerCase().includes(query) || model.name?.toLowerCase().includes(query)) && (!filter || summary === filter);
            }).map((model) => ({ id: model.id, name: model.name, contextLength: model.contextLength, pricing: model.pricing, policySummary: modelPolicies.get(model.id)?.mode ?? "inherit" }));
            return writeJson(res, 200, { items, total: items.length, cache: { fetchedAt: snapshot.fetchedAt, stale: snapshot.state !== "fresh" } });
          }
          if (url.pathname === "/api/models/refresh" && req.method === "POST") return writeJson(res, 200, await metadataCatalog.syncModels(true));
          if ((endpointMatch || endpointRefreshMatch) && req.method === (endpointMatch ? "GET" : "POST")) {
            const modelId = decodeModelId((endpointMatch ?? endpointRefreshMatch)![1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            const result = await metadataCatalog.getModelEndpoints(modelId, Boolean(endpointRefreshMatch));
            return writeJson(res, 200, { items: result.data, cache: { fetchedAt: result.fetchedAt, stale: result.state !== "fresh" } });
          }
          if (modelDetailMatch && req.method === "GET") {
            const modelId = decodeModelId(modelDetailMatch[1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            const model = metadataCatalog.getModelsSnapshot().data.find((item) => item.id === modelId);
            if (!model) return writeError(res, 404, "Model not found in local catalog", "MODEL_NOT_FOUND");
            return writeJson(res, 200, { model, policy: policyForApi(modelPolicies.get(modelId)) });
          }
          if (url.pathname === "/api/policies" && req.method === "GET") {
            return writeJson(res, 200, { items: Object.entries(modelPolicies.list()).map(([modelId, policy]) => ({ modelId, ...policyForApi(policy) })) });
          }
          if (policyMatch && req.method === "GET") {
            const modelId = decodeModelId(policyMatch[1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            return writeJson(res, 200, { modelId, ...policyForApi(modelPolicies.get(modelId)) });
          }
          if (policyMatch && req.method === "PUT") {
            const modelId = decodeModelId(policyMatch[1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            try {
              const policy = parseApiPolicy(await readJsonBody(req, cfg.max_body_bytes));
              modelPolicies.set(modelId, policy);
              return writeJson(res, 200, { modelId, ...policyForApi(modelPolicies.get(modelId)) });
            } catch (err: any) { return writeError(res, 400, err?.message ?? "Invalid policy", "INVALID_POLICY"); }
          }
          if (policyMatch && req.method === "DELETE") {
            const modelId = decodeModelId(policyMatch[1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            modelPolicies.delete(modelId);
            return writeJson(res, 200, { modelId, deleted: true });
          }
          if (url.pathname === "/api/policies/preview" && req.method === "POST") {
            try {
              const preview = await readJsonBody(req, cfg.max_body_bytes) as { modelId?: string; candidatePolicy?: unknown; incomingPolicy?: unknown };
              const candidate = parseApiPolicy(preview.candidatePolicy);
              const effectivePolicy = resolveProviderPolicy({ globalPolicy: cfg.policy, modelPolicy: candidate, incomingPolicy: preview.incomingPolicy as any, mergeMode: cfg.merge_mode, softEnforceOnly: cfg._runtime.soft_enforce_only });
              return writeJson(res, 200, { modelId: preview.modelId ?? null, effectivePolicy, openRouterProviderPayload: effectivePolicy });
            } catch (err: any) { return writeError(res, 400, err?.message ?? "Invalid policy preview", "INVALID_POLICY"); }
          }
          if (url.pathname === "/api/settings" && req.method === "GET") {
            return writeJson(res, 200, { openRouterApiKeyConfigured: Boolean(cfg.upstream_api_key), openRouterApiKeyMasked: maskedKey(cfg.upstream_api_key), mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs() });
          }
          if (url.pathname === "/api/settings" && req.method === "PUT") {
            try {
              const update = await readJsonBody(req, cfg.max_body_bytes) as Record<string, unknown>;
              if (typeof update.openRouterApiKey === "string" && update.openRouterApiKey) return writeError(res, 422, "Runtime OpenRouter API key updates are not supported; configure the key externally.", "API_KEY_EXTERNAL_ONLY");
              let nextMergeMode = cfg.merge_mode;
              let nextGlobalPolicy = cfg.policy;
              let nextMetadataTtlMs = metadataCatalog.getTtlMs();
              if (update.mergeMode !== undefined) {
                if (update.mergeMode !== "merge" && update.mergeMode !== "override" && update.mergeMode !== "strict") return writeError(res, 400, "Invalid merge mode", "INVALID_SETTINGS");
                nextMergeMode = update.mergeMode;
              }
              if (update.globalPolicy !== undefined) nextGlobalPolicy = ProviderPolicySchema.parse(update.globalPolicy);
              if (update.metadataTtlMs !== undefined) {
                if (typeof update.metadataTtlMs !== "number" || !Number.isInteger(update.metadataTtlMs) || update.metadataTtlMs < 1_000) return writeError(res, 400, "metadataTtlMs must be an integer of at least 1000", "INVALID_SETTINGS");
                nextMetadataTtlMs = update.metadataTtlMs;
              }
              const nextSettings = { mergeMode: nextMergeMode, globalPolicy: nextGlobalPolicy, metadataTtlMs: nextMetadataTtlMs };
              settingsStore.save(nextSettings);
              cfg.merge_mode = nextMergeMode;
              cfg.policy = nextGlobalPolicy;
              metadataCatalog.setTtlMs(nextMetadataTtlMs);
              controlSettings = nextSettings;
              return writeJson(res, 200, { openRouterApiKeyConfigured: Boolean(cfg.upstream_api_key), openRouterApiKeyMasked: maskedKey(cfg.upstream_api_key), mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs() });
            } catch { return writeError(res, 400, "Invalid settings", "INVALID_SETTINGS"); }
          }
          const knownRoute = url.pathname === "/api/status" || url.pathname === "/api/models" || url.pathname === "/api/models/refresh" || url.pathname === "/api/policies" || url.pathname === "/api/policies/preview" || url.pathname === "/api/settings" || endpointMatch || endpointRefreshMatch || modelDetailMatch || policyMatch;
          return writeError(res, knownRoute ? 405 : 404, knownRoute ? "Method not allowed" : "Management API endpoint not found", knownRoute ? "ERR_METHOD_NOT_ALLOWED" : "API_NOT_FOUND");
        } catch (err) {
          if (err instanceof OpenRouterMetadataError) return metadataError(err);
          return writeError(res, 500, "Management API operation failed", "ERR_MANAGEMENT_INTERNAL");
        }
      }

      // Find upstream URL
      const upstream = upstreamUrlForPath(url.pathname, cfg);
      if (!upstream) {
        return writeError(res, 404, "Not found");
      }

      // Method validation
      const methodError = validateMethod(req.method ?? "GET", url.pathname);
      if (methodError) {
        return writeError(res, methodError.status, methodError.message, methodError.code);
      }

      // Get upstream auth
      const upstreamAuth = getUpstreamAuth(req, cfg);
      if (!upstreamAuth) {
        return writeError(res, 401, "Missing upstream authentication", "ERR_MISSING_AUTH");
      }

      // For GET /v1/models, no body to process
      let body: any = undefined;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req, cfg.max_body_bytes);
        } catch (err: any) {
          if (err.code === "ERR_BODY_TOO_LARGE") {
            return writeError(res, 413, err.message, "ERR_BODY_TOO_LARGE");
          }
          return writeError(res, 400, err.message, "ERR_INVALID_BODY");
        }

        // Log body if configured
        if (cfg.log_body) {
          const bodyToLog = cfg.redact_body ? redactBody(body) : body;
          log.debug({ body: bodyToLog }, "request body");
        }
        
        // Debug: log model name and tools for troubleshooting
        if (cfg.log_level === "debug") {
          log.debug({ 
            model: body?.model, 
            modelLength: body?.model?.length,
            hasTools: !!body?.tools?.length,
            toolCount: body?.tools?.length ?? 0,
            toolNames: body?.tools?.map((t: any) => t.name),
            stream: body?.stream,
          }, "request details");
        }

        // Remap Anthropic model names to user's preferred model
        // Claude Code sends internal model names (claude-haiku, etc.) for helper functions
        if (body?.model && isAnthropicModel(body.model)) {
          const originalModel = body.model;
          const targetModel = getTargetModel();
          if (originalModel !== targetModel) {
            body.model = targetModel;
            if (cfg.log_level === "debug") {
              log.debug({ originalModel, targetModel }, "remapped model");
            }
          }
        }

        // Truncate metadata.user_id if it's too long (OpenRouter has 128 char limit)
        if (body?.metadata?.user_id && typeof body.metadata.user_id === "string") {
          if (body.metadata.user_id.length > 128) {
            if (cfg.log_level === "debug") {
              log.debug({ 
                originalLength: body.metadata.user_id.length,
                truncated: body.metadata.user_id.slice(0, 128)
              }, "truncating user_id");
            }
            body.metadata.user_id = body.metadata.user_id.slice(0, 128);
          }
        }

        // Resolve global/model policy, then apply the configured incoming-request merge behavior.
        try {
          body = applyResolvedProviderPolicy(body, {
            globalPolicy: cfg.policy,
            modelPolicy: modelPolicies.get(body?.model),
            mergeMode: cfg.merge_mode,
            softEnforceOnly: cfg._runtime.soft_enforce_only,
          });
        } catch (err: any) {
          if (err.code === "ERR_PROVIDER_CONFLICT") {
            return writeError(res, 422, err.message, err.code);
          }
          throw err;
        }

        // Optional OpenRouter debug injection for chat completions only (development)
        if (cfg._runtime.debug_openrouter_upstream_body && url.pathname === "/v1/chat/completions") {
          body.stream = true;
          body.debug = { ...(body.debug ?? {}), echo_upstream_body: true };
        }
      }

      // Debug: Check auth header
      if (cfg.log_level === "debug") {
        log.debug({ 
          authLength: upstreamAuth?.length ?? 0, 
          authScheme: upstreamAuth?.split(/\s+/, 1)[0] ?? "none",
          upstreamKeyLength: cfg.upstream_api_key?.length ?? 0,
        }, "auth header");
      }

      // Prepare headers for upstream request
      const headers: Record<string, string> = {
        "authorization": upstreamAuth,
        "content-type": "application/json",
      };

      // Optional attribution headers for OpenRouter analytics
      if (cfg.add_attribution_headers) {
        if (cfg.attribution?.referer) headers["http-referer"] = cfg.attribution.referer;
        if (cfg.attribution?.title) headers["x-title"] = cfg.attribution.title;
      }

      // Make upstream request with retry logic for rate limits
      let upstreamResp: Response;
      let retries = 0;
      const upstreamAbort = new AbortController();
      const cancelUpstreamForDisconnectedClient = () => {
        if (!res.writableEnded && !upstreamAbort.signal.aborted) {
          upstreamAbort.abort(new Error("Client disconnected"));
        }
      };
      req.once("aborted", cancelUpstreamForDisconnectedClient);
      res.once("close", cancelUpstreamForDisconnectedClient);
      const timeout = setTimeout(() => upstreamAbort.abort(new Error("Upstream request timed out")), cfg.request_timeout_ms);
      
      // Custom retry delays: 1, 2, 4, 8, 12, 18, 24, 32 seconds
      const retryDelays = [1000, 2000, 4000, 8000, 12000, 18000, 24000, 32000];
      
      // Auto-enable retry for Claude Code (detected by Anthropic Messages API endpoint)
      // Claude Code uses /v1/messages, while other harnesses use /v1/chat/completions
      const isClaudeCode = url.pathname === "/v1/messages";
      const maxRetries = isClaudeCode ? retryDelays.length : 0;
      
      try {
        while (true) {
          try {
          const requestBody = req.method === "POST" ? JSON.stringify(body) : undefined;
          
          // Debug: log the actual request body for troubleshooting
          if (cfg.log_level === "debug" && cfg.log_body && requestBody) {
            log.debug({ 
              url: upstream, 
              bodySize: requestBody.length,
              bodyPreview: cfg.redact_body ? JSON.stringify(redactBody(body)).slice(0, 1000) : requestBody.slice(0, 1000),
            }, "upstream request body");
          }
          
          upstreamResp = await fetch(upstream, {
            method: req.method,
            headers,
            body: requestBody,
            signal: upstreamAbort.signal,
          });
          
          // If we get a 429 and retries are enabled, retry with custom delays
          if (upstreamResp.status === 429 && retries < maxRetries) {
            const delayMs = retryDelays[retries];
            retries++;
            log.info({ retries, delayMs, status: 429, isClaudeCode }, "rate limited, retrying");
            try { await upstreamResp.body?.cancel(); } catch { /* response has no cancellable body */ }
            await waitForRetry(delayMs, upstreamAbort.signal);
            continue;
          }
          
          break; // Success or non-retryable error
          } catch (err: any) {
            if (upstreamAbort.signal.aborted && res.destroyed) return;
            log.error({ err: err.message, upstream }, "upstream request failed");
            return writeError(res, 502, `Upstream request failed: ${err.message}`, "ERR_UPSTREAM_FAILED");
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      // For error responses or non-streaming responses with tools, capture the body for logging
      let responseBodyForLogging: string | undefined;
      const isStreaming = body?.stream === true;
      const hasTools = !!body?.tools?.length;
      
      if (cfg.log_level === "debug" && cfg.log_body && (upstreamResp.status >= 400 || (!isStreaming && hasTools))) {
        try {
          responseBodyForLogging = await upstreamResp.clone().text();
        } catch {
          // Ignore clone/read errors
        }
      }

      // Pipe response back to caller
      await pipeFetchResponse(upstreamResp, res, upstreamAbort.signal);

      // Log request metadata (never log prompt content by default)
      const model = body?.model ?? body?.models?.[0] ?? "unknown";
      log.info({
        path: url.pathname,
        method: req.method,
        status: upstreamResp.status,
        ms: Date.now() - started,
        model,
      }, "request");
      
      // Log response details for debugging
      if (responseBodyForLogging) {
        log.debug({ responseBody: safeResponseBodyForLogging(responseBodyForLogging, cfg.redact_body) }, "upstream response");
      }

    } catch (err: any) {
      const ms = Date.now() - started;
      const msg = err?.message ?? String(err);
      // Only write error response if headers haven't been sent yet
      // (e.g., if piping already started, we can't send an error)
      if (!res.headersSent) {
        writeError(res, 500, msg, "ERR_INTERNAL");
      }
      log.error({ ms, err: msg, path: url.pathname, headersSent: res.headersSent }, "error");
    }
  });

  server.listen(cfg.port, cfg.host, () => {
    log.info({
      host: cfg.host,
      port: cfg.port,
      upstream: cfg.upstream,
      merge_mode: cfg.merge_mode,
      auth_mode: cfg.auth_mode,
      enable_anthropic: cfg.enable_anthropic,
      enable_chat: cfg.enable_chat,
      enable_responses: cfg.enable_responses,
    }, "server started");
  });

  return server;
}
