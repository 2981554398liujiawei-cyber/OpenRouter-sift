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
import { JsonRequestLogStore } from "./observability/requestStore.js";
import { RequestTracker } from "./observability/requestTracker.js";
import type { RequestProtocol } from "./observability/requestRecord.js";
import { JsonDesiredModelStore } from "./access/desiredModelStore.js";
import { JsonAccessKeyStore, type AccessKey } from "./access/accessKeyStore.js";
import { evaluateProviderEndpoints, isTelemetryFresh, providerFilterConfigSchema, type ProviderFilterConfig } from "./providerFilters/index.js";

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

function protocolForPath(pathname: string): RequestProtocol | null {
  if (pathname === "/v1/messages") return "anthropic_messages";
  if (pathname === "/v1/chat/completions") return "chat_completions";
  if (pathname === "/v1/responses") return "responses";
  return null;
}

function inboundBearerToken(req: IncomingMessage): string | null {
  const auth = getInboundAuth(req);
  return auth?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

function accessKeyForApi(key: AccessKey): Omit<AccessKey, "keyHash"> {
  const { keyHash: _keyHash, ...safe } = key;
  return safe;
}

function isManagedKeyCandidate(req: IncomingMessage): boolean {
  return inboundBearerToken(req)?.startsWith("sift_sk_") === true;
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

function safeObservationError(error: unknown, fallbackCode = "ERR_PROXY"): { code: string; message: string } {
  const source = error instanceof Error ? error.message : String(error);
  return { code: fallbackCode, message: source.replace(/(?:sk-or-|sk-ant-)[\w-]+/gi, "[redacted]").replace(/bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500) };
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
  let controlSettings: ControlSettings = { mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs(), requestLogLimit: 1000, desiredEndpointRefreshIntervalMs: 60_000 };
  try {
    const saved = settingsStore.load();
    if (saved.mergeMode) cfg.merge_mode = saved.mergeMode;
    if (saved.globalPolicy) cfg.policy = ProviderPolicySchema.parse(saved.globalPolicy);
    if (typeof saved.metadataTtlMs === "number" && Number.isInteger(saved.metadataTtlMs) && saved.metadataTtlMs >= 1_000) metadataCatalog.setTtlMs(saved.metadataTtlMs);
    const requestLogLimit = typeof saved.requestLogLimit === "number" && Number.isInteger(saved.requestLogLimit) && saved.requestLogLimit >= 100 && saved.requestLogLimit <= 10_000 ? saved.requestLogLimit : 1000;
    const desiredEndpointRefreshIntervalMs = typeof saved.desiredEndpointRefreshIntervalMs === "number" && Number.isInteger(saved.desiredEndpointRefreshIntervalMs) && saved.desiredEndpointRefreshIntervalMs >= 30_000 && saved.desiredEndpointRefreshIntervalMs <= 600_000 ? saved.desiredEndpointRefreshIntervalMs : 60_000;
    controlSettings = { mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs(), requestLogLimit, desiredEndpointRefreshIntervalMs };
  } catch (err: any) {
    log.error({ err: err?.message ?? String(err), path: cfg.settings_store_path }, "settings store unavailable; using configured defaults");
  }
  const requestLogs = new JsonRequestLogStore(cfg.request_log_store_path, controlSettings.requestLogLimit ?? 1000);
  try { requestLogs.load(); } catch (err: any) { log.error({ err: err?.message ?? String(err), path: cfg.request_log_store_path }, "request history unavailable; continuing without stored history"); }
  const requestTracker = new RequestTracker(requestLogs, log, cfg.upstream_api_key ? new OpenRouterClient({ apiKey: cfg.upstream_api_key }) : undefined);
  const desiredModels = new JsonDesiredModelStore(cfg.desired_model_store_path);
  const accessKeys = new JsonAccessKeyStore(cfg.access_key_store_path);
  try { desiredModels.load(); } catch (err: any) { log.error({ err: err?.message ?? String(err), path: cfg.desired_model_store_path }, "desired model store unavailable; using an empty desired model set"); }
  try { accessKeys.load(); } catch (err: any) { log.error({ err: err?.message ?? String(err), path: cfg.access_key_store_path }, "access key store unavailable; managed access keys are unavailable"); }

  const refreshDesiredEndpoints = async () => {
    const models = desiredModels.list().filter((model) => model.enabled);
    for (let index = 0; index < models.length; index += 2) {
      await Promise.all(models.slice(index, index + 2).map(async (model) => {
        try { await metadataCatalog.getModelEndpoints(model.modelId, true); }
        catch (err) { log.error({ modelId: model.modelId, err: safeObservationError(err).message }, "desired endpoint refresh failed"); }
      }));
    }
  };
  let desiredRefreshTimer: ReturnType<typeof setInterval> | undefined;
  const setDesiredRefreshInterval = (intervalMs: number) => {
    if (desiredRefreshTimer) clearInterval(desiredRefreshTimer);
    desiredRefreshTimer = setInterval(() => { void refreshDesiredEndpoints(); }, intervalMs);
    desiredRefreshTimer.unref?.();
  };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", `http://${cfg.host}:${cfg.port}`);
    const protocol = protocolForPath(url.pathname);
    const observationId = protocol ? requestTracker.begin(protocol) : null;
    let observationFinished = false;
    const finishObservation = (patch: Parameters<RequestTracker["complete"]>[1]) => {
      if (observationId && !observationFinished) {
        observationFinished = true;
        requestTracker.complete(observationId, { proxyDurationMs: Date.now() - started, ...patch });
      }
    };
    const isDataPlane = url.pathname.startsWith("/v1/");
    let managedAccessKey: AccessKey | null = null;

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

      // A Local Access Key is an inference credential, never a control-plane
      // credential. Enforce this even when legacy control authentication is off.
      if (!isDataPlane && isManagedKeyCandidate(req)) {
        return writeError(res, 401, "Managed Access Keys are valid only for /v1/*", "MANAGED_KEY_CONTROL_PLANE_FORBIDDEN");
      }

      // Control-plane auth remains the legacy local key. A managed Access Key is
      // valid only for inference and must never unlock /api or /ui.
      if (cfg.local_api_key && (!isDataPlane || !isManagedKeyCandidate(req))) {
        const authError = validateLocalAuth(req, cfg.local_api_key);
        if (authError) {
          finishObservation({ status: authError.status, error: { code: authError.code, message: authError.message } });
          return writeError(res, authError.status, authError.message, authError.code);
        }
      }

      if (isDataPlane && isManagedKeyCandidate(req)) {
        const token = inboundBearerToken(req)!;
        const key = accessKeys.findBySecret(token);
        if (!key) {
          finishObservation({ status: 401, error: { code: "INVALID_ACCESS_KEY", message: "Invalid Local Access Key" } });
          return writeError(res, 401, "Invalid Local Access Key", "INVALID_ACCESS_KEY");
        }
        if (!key.enabled) {
          finishObservation({ status: 401, error: { code: "ACCESS_KEY_DISABLED", message: "Local Access Key is disabled" } });
          return writeError(res, 401, "Local Access Key is disabled", "ACCESS_KEY_DISABLED");
        }
        managedAccessKey = key;
        if (observationId) requestTracker.update(observationId, { accessKeyId: key.id, accessKeyName: key.name });
        queueMicrotask(() => {
          try { accessKeys.touchLastUsed(key.id); } catch (err) { log.error({ err: safeObservationError(err).message }, "access key usage update failed"); }
        });
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
          const desiredModelMatch = url.pathname.match(/^\/api\/desired-models\/([^/]+)$/);
          const filterMatch = url.pathname.match(/^\/api\/desired-models\/([^/]+)\/filter$/);
          const filterPreviewMatch = url.pathname.match(/^\/api\/desired-models\/([^/]+)\/filter\/preview$/);
          const evaluateFilter = async (modelId: string, filter: ProviderFilterConfig | null) => {
            const snapshot = await metadataCatalog.getModelEndpoints(modelId);
            const state = !snapshot.fetchedAt ? "unavailable" : filter?.enabled && !isTelemetryFresh(snapshot.fetchedAt, filter.maxTelemetryAgeMs) ? "stale" : "fresh";
            return evaluateProviderEndpoints(snapshot.data, filter, { modelId, metadataFetchedAt: snapshot.fetchedAt, metadataState: state });
          };
          if (filterMatch && req.method === "GET") {
            const modelId = decodeModelId(filterMatch[1]); if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            const desired = desiredModels.get(modelId); if (!desired) return writeError(res, 404, "Desired model not found", "DESIRED_MODEL_NOT_FOUND");
            return writeJson(res, 200, { filter: desired.providerFilter, preview: await evaluateFilter(modelId, desired.providerFilter) });
          }
          if (filterPreviewMatch && req.method === "POST") {
            const modelId = decodeModelId(filterPreviewMatch[1]); if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            if (!desiredModels.get(modelId)) return writeError(res, 404, "Desired model not found", "DESIRED_MODEL_NOT_FOUND");
            const input = await readJsonBody(req, cfg.max_body_bytes) as { candidateFilter?: unknown };
            const parsed = providerFilterConfigSchema.safeParse(input.candidateFilter);
            if (!parsed.success) return writeError(res, 400, "Invalid provider filter", "INVALID_PROVIDER_FILTER");
            const filter: ProviderFilterConfig = { ...parsed.data, updatedAt: new Date().toISOString() };
            return writeJson(res, 200, await evaluateFilter(modelId, filter));
          }
          if (filterMatch && req.method === "PUT") {
            const modelId = decodeModelId(filterMatch[1]); if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            const parsed = providerFilterConfigSchema.safeParse(await readJsonBody(req, cfg.max_body_bytes));
            if (!parsed.success) return writeError(res, 400, "Invalid provider filter", "INVALID_PROVIDER_FILTER");
            const filter = { ...parsed.data, updatedAt: new Date().toISOString() };
            try { desiredModels.setProviderFilter(modelId, filter); return writeJson(res, 200, { filter, preview: await evaluateFilter(modelId, filter) }); } catch { return writeError(res, 404, "Desired model not found", "DESIRED_MODEL_NOT_FOUND"); }
          }
          if (filterMatch && req.method === "DELETE") {
            const modelId = decodeModelId(filterMatch[1]); if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            try { desiredModels.setProviderFilter(modelId, null); return writeJson(res, 200, { modelId, deleted: true }); } catch { return writeError(res, 404, "Desired model not found", "DESIRED_MODEL_NOT_FOUND"); }
          }
          if (url.pathname === "/api/desired-models" && req.method === "GET") {
            const assignedCounts = new Map<string, number>();
            for (const key of accessKeys.list()) for (const modelId of key.allowedModels) assignedCounts.set(modelId, (assignedCounts.get(modelId) ?? 0) + 1);
            return writeJson(res, 200, { items: desiredModels.list().map((model) => ({ ...model, assignedApiCount: assignedCounts.get(model.modelId) ?? 0 })) });
          }
          if (desiredModelMatch && req.method === "POST") {
            const modelId = decodeModelId(desiredModelMatch[1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            try { return writeJson(res, 201, desiredModels.add(modelId)); } catch (err: any) { return writeError(res, 400, err?.message ?? "Invalid model ID", "INVALID_MODEL_ID"); }
          }
          if (desiredModelMatch && req.method === "DELETE") {
            const modelId = decodeModelId(desiredModelMatch[1]);
            if (!modelId) return writeError(res, 400, "Invalid model ID", "INVALID_MODEL_ID");
            // Remove stale assignments before deletion; enforcement also intersects
            // with Desired Models so a partial persistence failure still fails closed.
            const removedFromKeys = accessKeys.removeModelFromAll(modelId);
            return writeJson(res, 200, { modelId, deleted: desiredModels.remove(modelId), removedFromKeys });
          }
          const accessKeyMatch = url.pathname.match(/^\/api\/access-keys\/([^/]+)$/);
          const validateAllowedModels = (models: unknown): string[] | null => {
            if (!Array.isArray(models) || !models.every((model) => typeof model === "string")) return null;
            const unique = [...new Set(models)];
            return unique.every((model) => desiredModels.has(model)) ? unique : null;
          };
          if (url.pathname === "/api/access-keys" && req.method === "GET") return writeJson(res, 200, { items: accessKeys.list().map(accessKeyForApi) });
          if (url.pathname === "/api/access-keys" && req.method === "POST") {
            try {
              const input = await readJsonBody(req, cfg.max_body_bytes) as { name?: unknown; allowedModels?: unknown };
              if (typeof input.name !== "string") return writeError(res, 400, "name is required", "INVALID_ACCESS_KEY");
              const allowedModels = validateAllowedModels(input.allowedModels);
              if (!allowedModels) return writeError(res, 422, "Every allowed model must be in Desired Models", "MODEL_NOT_DESIRED");
              const created = accessKeys.create(input.name, allowedModels);
              return writeJson(res, 201, { ...accessKeyForApi(created.record), secret: created.secret });
            } catch (err: any) { return writeError(res, 400, err?.message ?? "Invalid access key", "INVALID_ACCESS_KEY"); }
          }
          if (accessKeyMatch && req.method === "GET") {
            const key = accessKeys.get(accessKeyMatch[1]);
            return key ? writeJson(res, 200, accessKeyForApi(key)) : writeError(res, 404, "Access key not found", "ACCESS_KEY_NOT_FOUND");
          }
          if (accessKeyMatch && req.method === "PUT") {
            try {
              const input = await readJsonBody(req, cfg.max_body_bytes) as { name?: unknown; allowedModels?: unknown; enabled?: unknown };
              if (input.name !== undefined && typeof input.name !== "string") return writeError(res, 400, "Invalid name", "INVALID_ACCESS_KEY");
              if (input.enabled !== undefined && typeof input.enabled !== "boolean") return writeError(res, 400, "Invalid enabled flag", "INVALID_ACCESS_KEY");
              const allowedModels = input.allowedModels === undefined ? undefined : validateAllowedModels(input.allowedModels);
              if (input.allowedModels !== undefined && !allowedModels) return writeError(res, 422, "Every allowed model must be in Desired Models", "MODEL_NOT_DESIRED");
              const key = accessKeys.update(accessKeyMatch[1], { ...(input.name !== undefined ? { name: input.name } : {}), ...(allowedModels !== undefined ? { allowedModels } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) });
              return writeJson(res, 200, accessKeyForApi(key));
            } catch (err: any) { return writeError(res, err?.message === "Access key not found" ? 404 : 400, err?.message ?? "Invalid access key", err?.message === "Access key not found" ? "ACCESS_KEY_NOT_FOUND" : "INVALID_ACCESS_KEY"); }
          }
          if (accessKeyMatch && req.method === "DELETE") return writeJson(res, 200, { id: accessKeyMatch[1], deleted: accessKeys.delete(accessKeyMatch[1]) });
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
          if (url.pathname === "/api/requests" && req.method === "GET") {
            const limitValue = url.searchParams.get("limit");
            const limit = limitValue === null ? 100 : Number(limitValue);
            if (!Number.isInteger(limit) || limit < 1 || limit > 500) return writeError(res, 400, "limit must be an integer from 1 to 500", "INVALID_REQUEST_QUERY");
            const statusValue = url.searchParams.get("status");
            const status = statusValue === null ? undefined : Number(statusValue);
            if (statusValue !== null && (!Number.isInteger(status) || status! < 100 || status! > 599)) return writeError(res, 400, "status must be an HTTP status code", "INVALID_REQUEST_QUERY");
            const protocolFilter = url.searchParams.get("protocol") ?? undefined;
            if (protocolFilter && protocolFilter !== "anthropic_messages" && protocolFilter !== "chat_completions" && protocolFilter !== "responses") return writeError(res, 400, "Invalid protocol", "INVALID_REQUEST_QUERY");
            const result = requestLogs.list({ limit, model: url.searchParams.get("model") ?? undefined, provider: url.searchParams.get("provider") ?? undefined, status, protocol: protocolFilter });
            return writeJson(res, 200, { items: result.items.map((record) => ({ id: record.id, startedAt: record.startedAt, protocol: record.protocol, accessKeyId: record.accessKeyId, accessKeyName: record.accessKeyName, model: record.requestedModel ?? record.forwardedModel, provider: record.actualProviderName, status: record.status, durationMs: record.proxyDurationMs, promptTokens: record.promptTokens, completionTokens: record.completionTokens, costUsd: record.costUsd, enrichmentStatus: record.enrichmentStatus })), total: result.total });
          }
          const requestDetailMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
          if (requestDetailMatch && req.method === "GET") {
            const record = requestLogs.get(requestDetailMatch[1]);
            if (!record) return writeError(res, 404, "Request record not found", "REQUEST_NOT_FOUND");
            return writeJson(res, 200, record);
          }
          if (url.pathname === "/api/requests" && req.method === "DELETE") {
            const deleted = requestLogs.clear();
            try { requestLogs.persist(); } catch (err: any) { log.error({ err: safeObservationError(err).message }, "request history clear persistence failed"); }
            return writeJson(res, 200, { deleted });
          }
          if (url.pathname === "/api/settings" && req.method === "GET") {
            return writeJson(res, 200, { openRouterApiKeyConfigured: Boolean(cfg.upstream_api_key), openRouterApiKeyMasked: maskedKey(cfg.upstream_api_key), mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs(), requestLogLimit: requestLogs.getLimit(), desiredEndpointRefreshIntervalMs: controlSettings.desiredEndpointRefreshIntervalMs });
          }
          if (url.pathname === "/api/settings" && req.method === "PUT") {
            try {
              const update = await readJsonBody(req, cfg.max_body_bytes) as Record<string, unknown>;
              if (typeof update.openRouterApiKey === "string" && update.openRouterApiKey) return writeError(res, 422, "Runtime OpenRouter API key updates are not supported; configure the key externally.", "API_KEY_EXTERNAL_ONLY");
              let nextMergeMode = cfg.merge_mode;
              let nextGlobalPolicy = cfg.policy;
              let nextMetadataTtlMs = metadataCatalog.getTtlMs();
              let nextRequestLogLimit = requestLogs.getLimit();
              let nextDesiredEndpointRefreshIntervalMs = controlSettings.desiredEndpointRefreshIntervalMs ?? 60_000;
              if (update.mergeMode !== undefined) {
                if (update.mergeMode !== "merge" && update.mergeMode !== "override" && update.mergeMode !== "strict") return writeError(res, 400, "Invalid merge mode", "INVALID_SETTINGS");
                nextMergeMode = update.mergeMode;
              }
              if (update.globalPolicy !== undefined) nextGlobalPolicy = ProviderPolicySchema.parse(update.globalPolicy);
              if (update.metadataTtlMs !== undefined) {
                if (typeof update.metadataTtlMs !== "number" || !Number.isInteger(update.metadataTtlMs) || update.metadataTtlMs < 1_000) return writeError(res, 400, "metadataTtlMs must be an integer of at least 1000", "INVALID_SETTINGS");
                nextMetadataTtlMs = update.metadataTtlMs;
              }
              if (update.requestLogLimit !== undefined) {
                if (typeof update.requestLogLimit !== "number" || !Number.isInteger(update.requestLogLimit) || update.requestLogLimit < 100 || update.requestLogLimit > 10_000) return writeError(res, 400, "requestLogLimit must be an integer from 100 to 10000", "INVALID_SETTINGS");
                nextRequestLogLimit = update.requestLogLimit;
              }
              if (update.desiredEndpointRefreshIntervalMs !== undefined) {
                if (typeof update.desiredEndpointRefreshIntervalMs !== "number" || !Number.isInteger(update.desiredEndpointRefreshIntervalMs) || update.desiredEndpointRefreshIntervalMs < 30_000 || update.desiredEndpointRefreshIntervalMs > 600_000) return writeError(res, 400, "desiredEndpointRefreshIntervalMs must be an integer from 30000 to 600000", "INVALID_SETTINGS");
                nextDesiredEndpointRefreshIntervalMs = update.desiredEndpointRefreshIntervalMs;
              }
              const nextSettings = { mergeMode: nextMergeMode, globalPolicy: nextGlobalPolicy, metadataTtlMs: nextMetadataTtlMs, requestLogLimit: nextRequestLogLimit, desiredEndpointRefreshIntervalMs: nextDesiredEndpointRefreshIntervalMs };
              settingsStore.save(nextSettings);
              cfg.merge_mode = nextMergeMode;
              cfg.policy = nextGlobalPolicy;
              metadataCatalog.setTtlMs(nextMetadataTtlMs);
              requestTracker.setLimit(nextRequestLogLimit);
              setDesiredRefreshInterval(nextDesiredEndpointRefreshIntervalMs);
              controlSettings = nextSettings;
              return writeJson(res, 200, { openRouterApiKeyConfigured: Boolean(cfg.upstream_api_key), openRouterApiKeyMasked: maskedKey(cfg.upstream_api_key), mergeMode: cfg.merge_mode, globalPolicy: cfg.policy, metadataTtlMs: metadataCatalog.getTtlMs(), requestLogLimit: requestLogs.getLimit(), desiredEndpointRefreshIntervalMs: controlSettings.desiredEndpointRefreshIntervalMs });
            } catch { return writeError(res, 400, "Invalid settings", "INVALID_SETTINGS"); }
          }
          const knownRoute = url.pathname === "/api/status" || url.pathname === "/api/models" || url.pathname === "/api/models/refresh" || url.pathname === "/api/desired-models" || url.pathname === "/api/access-keys" || url.pathname === "/api/policies" || url.pathname === "/api/policies/preview" || url.pathname === "/api/settings" || url.pathname === "/api/requests" || endpointMatch || endpointRefreshMatch || modelDetailMatch || desiredModelMatch || accessKeyMatch || policyMatch || requestDetailMatch;
          return writeError(res, knownRoute ? 405 : 404, knownRoute ? "Method not allowed" : "Management API endpoint not found", knownRoute ? "ERR_METHOD_NOT_ALLOWED" : "API_NOT_FOUND");
        } catch (err) {
          if (err instanceof OpenRouterMetadataError) return metadataError(err);
          return writeError(res, 500, "Management API operation failed", "ERR_MANAGEMENT_INTERNAL");
        }
      }

      // Find upstream URL
      const upstream = upstreamUrlForPath(url.pathname, cfg);
      if (!upstream) {
        finishObservation({ status: 404, error: { code: "ERR_NOT_FOUND", message: "Not found" } });
        return writeError(res, 404, "Not found");
      }

      // Method validation
      const methodError = validateMethod(req.method ?? "GET", url.pathname);
      if (methodError) {
        finishObservation({ status: methodError.status, error: { code: methodError.code, message: methodError.message } });
        return writeError(res, methodError.status, methodError.message, methodError.code);
      }

      // Managed keys see only the locally selected models assigned to that key.
      // This is deliberately local: it never exposes the whole OpenRouter catalog.
      if (url.pathname === "/v1/models" && managedAccessKey) {
        const snapshot = metadataCatalog.getModelsSnapshot();
        const catalogById = new Map(snapshot.data.map((model) => [model.id, model]));
        const data = managedAccessKey.allowedModels.filter((modelId) => desiredModels.has(modelId)).map((modelId) => {
          const model = catalogById.get(modelId);
          return { id: modelId, object: "model", ...(model?.created !== null && model?.created !== undefined ? { created: model.created } : {}), owned_by: "openrouter" };
        });
        return writeJson(res, 200, { object: "list", data });
      }

      // Get upstream auth
      const upstreamAuth = managedAccessKey ? (cfg.upstream_api_key ? `Bearer ${cfg.upstream_api_key}` : undefined) : getUpstreamAuth(req, cfg);
      if (!upstreamAuth) {
        finishObservation({ status: 401, error: { code: "ERR_MISSING_AUTH", message: "Missing upstream authentication" } });
        return writeError(res, 401, "Missing upstream authentication", "ERR_MISSING_AUTH");
      }

      // For GET /v1/models, no body to process
      let body: any = undefined;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req, cfg.max_body_bytes);
        } catch (err: any) {
          if (err.code === "ERR_BODY_TOO_LARGE") {
            finishObservation({ status: 413, error: { code: "ERR_BODY_TOO_LARGE", message: err.message } });
            return writeError(res, 413, err.message, "ERR_BODY_TOO_LARGE");
          }
          finishObservation({ status: 400, error: { code: "ERR_INVALID_BODY", message: err.message } });
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

        const requestedModel = typeof body?.model === "string" ? body.model : null;
        requestTracker.update(observationId ?? "", { requestedModel, forwardedModel: requestedModel, streamed: body?.stream === true });

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

        requestTracker.update(observationId ?? "", { forwardedModel: typeof body?.model === "string" ? body.model : null });

        // Authorize the actual forwarded model, not the client alias. This keeps
        // Anthropic remapping useful without allowing it to bypass model grants.
        if (managedAccessKey) {
          const forwardedModel = typeof body?.model === "string" ? body.model : null;
          if (!forwardedModel || !desiredModels.has(forwardedModel) || !managedAccessKey.allowedModels.includes(forwardedModel)) {
            finishObservation({ status: 403, error: { code: "MODEL_NOT_ALLOWED", message: "Model is not allowed for this Local Access Key" } });
            return writeError(res, 403, "Model is not allowed for this Local Access Key", "MODEL_NOT_ALLOWED");
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
          const effectiveProviderPolicy = resolveProviderPolicy({ globalPolicy: cfg.policy, modelPolicy: modelPolicies.get(body?.model), incomingPolicy: body?.provider, mergeMode: cfg.merge_mode, softEnforceOnly: cfg._runtime.soft_enforce_only });
          requestTracker.update(observationId ?? "", { effectiveProviderPolicy: effectiveProviderPolicy ?? null });
          body = applyResolvedProviderPolicy(body, {
            globalPolicy: cfg.policy,
            modelPolicy: modelPolicies.get(body?.model),
            mergeMode: cfg.merge_mode,
            softEnforceOnly: cfg._runtime.soft_enforce_only,
          });
          const filter = desiredModels.get(typeof body?.model === "string" ? body.model : "")?.providerFilter;
          if (filter?.enabled) {
            const endpointSnapshot = metadataCatalog.getModelEndpointsSnapshot(body.model);
            const filterStatus = !endpointSnapshot.available ? "unavailable" : isTelemetryFresh(endpointSnapshot.fetchedAt, filter.maxTelemetryAgeMs) ? "fresh" : "stale";
            const result = evaluateProviderEndpoints(endpointSnapshot.data, filter, { modelId: body.model, metadataFetchedAt: endpointSnapshot.fetchedAt, metadataState: filterStatus });
            requestTracker.update(observationId ?? "", { providerFilterSnapshot: filter, eligibleProviderRoutingIds: result.eligibleRoutingIds, providerFilterMetadataFetchedAt: endpointSnapshot.fetchedAt, providerFilterMetadataAgeMs: endpointSnapshot.ageMs, providerFilterStatus: filterStatus });
            if (filterStatus !== "fresh" || !result.usable || result.eligibleRoutingIds.length === 0) {
              finishObservation({ status: 503, error: { code: result.failureReason ?? "NO_ELIGIBLE_PROVIDER", message: "Provider filter has no current eligible endpoint" } });
              return writeError(res, 503, "Provider filter has no current eligible endpoint", result.failureReason ?? "NO_ELIGIBLE_PROVIDER");
            }
            const currentOnly = body?.provider?.only as string[] | undefined;
            const hardOnly = currentOnly ? result.eligibleRoutingIds.filter((id) => currentOnly.includes(id)) : result.eligibleRoutingIds;
            if (!hardOnly.length) {
              finishObservation({ status: 403, error: { code: "NO_ELIGIBLE_PROVIDER", message: "Provider policy excludes every eligible endpoint" } });
              return writeError(res, 403, "Provider policy excludes every eligible endpoint", "NO_ELIGIBLE_PROVIDER");
            }
            body = { ...body, provider: { ...(body.provider ?? {}), only: hardOnly } };
            requestTracker.update(observationId ?? "", { effectiveProviderPolicy: body.provider });
          }
        } catch (err: any) {
          if (err.code === "ERR_PROVIDER_CONFLICT") {
            finishObservation({ status: 422, error: { code: err.code, message: err.message } });
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
      let abortReason: "client" | "timeout" | null = null;
      const cancelUpstreamForDisconnectedClient = () => {
        if (!res.writableEnded && !upstreamAbort.signal.aborted) {
          abortReason = "client";
          upstreamAbort.abort(new Error("Client disconnected"));
        }
      };
      req.once("aborted", cancelUpstreamForDisconnectedClient);
      res.once("close", cancelUpstreamForDisconnectedClient);
      const timeout = setTimeout(() => { abortReason = "timeout"; upstreamAbort.abort(new Error("Upstream request timed out")); }, cfg.request_timeout_ms);
      
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
            if (upstreamAbort.signal.aborted && res.destroyed) {
              finishObservation({ status: null, clientCancelled: true, error: { code: "ERR_CLIENT_CANCELLED", message: "Client disconnected" } });
              return;
            }
            log.error({ err: err.message, upstream }, "upstream request failed");
            finishObservation({ status: 502, clientCancelled: abortReason === "client", error: safeObservationError(err, abortReason === "timeout" ? "ERR_UPSTREAM_TIMEOUT" : "ERR_UPSTREAM_FAILED") });
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

      const generationId = upstreamResp.headers.get("x-generation-id");
      const cacheStatus = upstreamResp.headers.get("x-openrouter-cache-status");
      const cacheAge = upstreamResp.headers.get("x-openrouter-cache-age");

      // Pipe response back to caller without decoding, buffering, or changing any chunks.
      const pipeResult = await pipeFetchResponse(upstreamResp, res, upstreamAbort.signal);
      finishObservation({ status: upstreamResp.status, generationId, cacheStatus, cacheAge, clientCancelled: pipeResult.clientCancelled || abortReason === "client" });

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
      finishObservation({ status: res.headersSent ? null : 500, clientCancelled: res.destroyed, error: safeObservationError(err, "ERR_INTERNAL") });
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
  // Refresh only enabled Desired Models outside the request path. Server startup
  // and inference remain independent of this best-effort telemetry work.
  void refreshDesiredEndpoints();
  setDesiredRefreshInterval(controlSettings.desiredEndpointRefreshIntervalMs ?? 60_000);
  server.once("close", () => { if (desiredRefreshTimer) clearInterval(desiredRefreshTimer); });

  return server;
}
