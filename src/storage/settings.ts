import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "../util/atomicWrite.js";
import type { MergeMode, ProviderPolicy } from "../config.js";

export interface ControlSettings {
  mergeMode?: MergeMode;
  globalPolicy?: ProviderPolicy;
  metadataTtlMs?: number;
  requestLogLimit?: number;
  desiredEndpointRefreshIntervalMs?: number;
}

interface SettingsFile { version: 1; settings: ControlSettings; }

export class JsonSettingsStore {
  constructor(private readonly path: string) {}

  load(): ControlSettings {
    if (!existsSync(this.path)) return {};
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as SettingsFile;
    if (parsed.version !== 1 || !parsed.settings || typeof parsed.settings !== "object") throw new Error("Invalid settings store format");
    return parsed.settings;
  }

  save(settings: ControlSettings): void {
    atomicWriteJson(this.path, { version: 1, settings });
  }
}
