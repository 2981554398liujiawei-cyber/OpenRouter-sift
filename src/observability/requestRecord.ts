import type { ProviderPolicy } from "../config.js";

export type RequestProtocol = "anthropic_messages" | "chat_completions" | "responses";
export type EnrichmentStatus = "pending" | "success" | "failed" | "unavailable";

export interface RequestRecord {
  id: string;
  startedAt: string;
  completedAt: string | null;
  protocol: RequestProtocol;
  accessKeyId: string | null;
  accessKeyName: string | null;
  requestedModel: string | null;
  forwardedModel: string | null;
  streamed: boolean | null;
  status: number | null;
  proxyDurationMs: number | null;
  clientCancelled: boolean;
  generationId: string | null;
  cacheStatus: string | null;
  cacheAge: string | null;
  effectiveProviderPolicy: ProviderPolicy | null;
  actualProviderName: string | null;
  actualProviderRoutingId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  openRouterLatencyMs: number | null;
  generationTimeMs: number | null;
  finishReason: string | null;
  isByok: boolean | null;
  router: string | null;
  serviceTier: string | null;
  enrichmentStatus: EnrichmentStatus;
  error: { code: string | null; message: string | null } | null;
}

export type RequestRecordUpdate = Partial<Omit<RequestRecord, "id" | "startedAt" | "protocol">>;

export function newRequestRecord(id: string, protocol: RequestProtocol): RequestRecord {
  return {
    id,
    startedAt: new Date().toISOString(),
    completedAt: null,
    protocol,
    accessKeyId: null,
    accessKeyName: null,
    requestedModel: null,
    forwardedModel: null,
    streamed: null,
    status: null,
    proxyDurationMs: null,
    clientCancelled: false,
    generationId: null,
    cacheStatus: null,
    cacheAge: null,
    effectiveProviderPolicy: null,
    actualProviderName: null,
    actualProviderRoutingId: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    costUsd: null,
    openRouterLatencyMs: null,
    generationTimeMs: null,
    finishReason: null,
    isByok: null,
    router: null,
    serviceTier: null,
    enrichmentStatus: "unavailable",
    error: null,
  };
}

export function requestListItem(record: RequestRecord) {
  return {
    id: record.id,
    startedAt: record.startedAt,
    protocol: record.protocol,
    model: record.requestedModel ?? record.forwardedModel,
    provider: record.actualProviderName,
    status: record.status,
    durationMs: record.proxyDurationMs,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    costUsd: record.costUsd,
    enrichmentStatus: record.enrichmentStatus,
  };
}
