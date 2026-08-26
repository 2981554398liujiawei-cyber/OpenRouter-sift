import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MergeMode, ProviderPolicy } from "../config.js";

export interface ControlSettings {
  mergeMode?: MergeMode;
  globalPolicy?: ProviderPolicy;
  metadataTtlMs?: number;
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
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, settings }, null, 2) + "\n", "utf8");
    renameSync(temporary, this.path);
  }
}
