import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RequestRecord, RequestRecordUpdate } from "./requestRecord.js";

interface RequestLogFile { version: 1; records: RequestRecord[]; }
export interface RequestListOptions { limit?: number; model?: string; provider?: string; status?: number; protocol?: string; }

/** In-memory records are persisted only after proxy response completion. */
export class JsonRequestLogStore {
  private records: RequestRecord[] = [];
  private limit: number;

  constructor(private readonly path: string, limit = 1000) { this.limit = limit; }

  load(): void {
    if (!existsSync(this.path)) return;
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as RequestLogFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid request log store format");
    this.records = parsed.records.filter((record) => record && typeof record.id === "string").slice(-this.limit);
  }

  setLimit(limit: number): void { this.limit = limit; this.prune(); }
  getLimit(): number { return this.limit; }
  begin(record: RequestRecord): void { this.records.push(record); this.prune(); }
  update(id: string, patch: RequestRecordUpdate): RequestRecord | undefined {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) return undefined;
    this.records[index] = { ...this.records[index], ...patch };
    return this.records[index];
  }
  get(id: string): RequestRecord | undefined { return this.records.find((record) => record.id === id); }
  list(options: RequestListOptions = {}): { items: RequestRecord[]; total: number } {
    const includes = (value: string | null, filter: string | undefined) => !filter || Boolean(value?.toLowerCase().includes(filter.toLowerCase()));
    const records = this.records.filter((record) =>
      includes(record.requestedModel ?? record.forwardedModel, options.model)
      && includes(record.actualProviderName, options.provider)
      && (options.status === undefined || record.status === options.status)
      && (!options.protocol || record.protocol === options.protocol),
    ).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { items: records.slice(0, options.limit ?? 100), total: records.length };
  }
  clear(): number { const deleted = this.records.length; this.records = []; return deleted; }

  persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, records: this.records }, null, 2) + "\n", "utf8");
    renameSync(temporary, this.path);
  }

  private prune(): void { if (this.records.length > this.limit) this.records.splice(0, this.records.length - this.limit); }
}
