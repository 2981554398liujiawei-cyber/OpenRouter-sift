import { randomUUID } from "node:crypto";
import type { Logger } from "../util/log.js";
import { OpenRouterClient, OpenRouterMetadataError } from "../openrouter/client.js";
import { parseGenerationResponse } from "../openrouter/generation.js";
import { newRequestRecord, type RequestProtocol, type RequestRecordUpdate } from "./requestRecord.js";
import { JsonRequestLogStore } from "./requestStore.js";

class BoundedQueue {
  private active = 0;
  private readonly jobs: Array<() => Promise<void>> = [];
  constructor(private readonly maxPending: number, private readonly concurrency: number) {}
  enqueue(job: () => Promise<void>): boolean {
    if (this.jobs.length + this.active >= this.maxPending) return false;
    this.jobs.push(job);
    this.run();
    return true;
  }
  private run(): void {
    while (this.active < this.concurrency && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.active++;
      void job().catch(() => undefined).finally(() => { this.active--; this.run(); });
    }
  }
}

function safeError(error: unknown): { code: string | null; message: string } {
  const source = error instanceof Error ? error.message : String(error);
  const message = source
    .replace(/(?:sk-or-|sk-ant-)[\w-]+/gi, "[redacted]")
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
  return { code: error instanceof OpenRouterMetadataError ? `GENERATION_${error.code.toUpperCase()}` : "OBSERVABILITY_ERROR", message };
}

const retryableStatuses = new Set([404, 429, 502, 503, 504]);
const GENERATION_404_POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 45_000, 60_000];

export class RequestTracker {
  private readonly queue = new BoundedQueue(100, 2);
  constructor(
    readonly store: JsonRequestLogStore,
    private readonly logger: Logger,
    private readonly generationClient?: OpenRouterClient,
  ) {}

  begin(protocol: RequestProtocol): string {
    const id = `req_${randomUUID()}`;
    this.store.begin(newRequestRecord(id, protocol));
    return id;
  }
  update(id: string, patch: RequestRecordUpdate): void { this.store.update(id, patch); }
  complete(id: string, patch: RequestRecordUpdate): void {
    const record = this.store.update(id, { ...patch, completedAt: new Date().toISOString() });
    if (!record) return;
    this.persistLater();
    if (!record.generationId) return;
    if (!this.generationClient) {
      this.store.update(id, { enrichmentStatus: "unavailable" });
      this.persistLater();
      return;
    }
    this.store.update(id, { enrichmentStatus: "pending" });
    if (!this.queue.enqueue(async () => this.enrich(id, record.generationId!))) {
      this.store.update(id, { enrichmentStatus: "failed", error: { code: "ENRICHMENT_QUEUE_FULL", message: "Generation enrichment queue is full" } });
      this.persistLater();
    }
  }
  setLimit(limit: number): void { this.store.setLimit(limit); this.persistLater(); }

  private persistLater(): void {
    queueMicrotask(() => {
      try { this.store.persist(); } catch (error) { this.logger.error({ err: safeError(error).message }, "request history persistence failed"); }
    });
  }
  private async enrich(id: string, generationId: string): Promise<void> {
    try {
      let raw: unknown;
      for (let attempt = 0; ; attempt++) {
        try { raw = await this.generationClient!.getGeneration(generationId); break; }
        catch (error) {
          const status = error instanceof OpenRouterMetadataError ? error.status : undefined;
          // OpenRouter's generation index is eventually consistent: a just-finished
          // generation can answer 404 for a while, so poll 404s much longer than
          // transient upstream errors before recording enrichment as failed.
          if (status === 404 && attempt < GENERATION_404_POLL_DELAYS_MS.length) {
            await new Promise((resolve) => setTimeout(resolve, GENERATION_404_POLL_DELAYS_MS[attempt]));
            continue;
          }
          if (attempt >= 2 || !status || !retryableStatuses.has(status)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
      const data = parseGenerationResponse(raw!);
      this.store.update(id, {
        actualProviderName: data.providerName,
        actualProviderRoutingId: data.providerRoutingId,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        totalTokens: data.totalTokens,
        costUsd: data.totalCost,
        openRouterLatencyMs: data.latency,
        generationTimeMs: data.generationTime,
        finishReason: data.finishReason,
        isByok: data.isByok,
        router: data.router,
        serviceTier: data.serviceTier,
        clientCancelled: data.cancelled ?? this.store.get(id)?.clientCancelled ?? false,
        streamed: data.streamed ?? this.store.get(id)?.streamed ?? null,
        enrichmentStatus: "success",
      });
    } catch (error) {
      this.store.update(id, { enrichmentStatus: "failed", error: safeError(error) });
    } finally { this.persistLater(); }
  }
}
