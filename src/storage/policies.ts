import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "../util/atomicWrite.js";
import { ModelPolicySchema, type ModelPolicy } from "../policy/modelPolicy.js";

interface PolicyFile {
  version: 1;
  models: Record<string, ModelPolicy>;
}

export class JsonPolicyStore {
  private policies: Record<string, ModelPolicy> = {};

  constructor(private readonly path: string) {}

  load(): void {
    if (!existsSync(this.path)) return;
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as PolicyFile;
    if (parsed.version !== 1 || !parsed.models || typeof parsed.models !== "object") {
      throw new Error("Invalid policy store format");
    }
    this.policies = Object.fromEntries(Object.entries(parsed.models).map(([model, policy]) => [model, ModelPolicySchema.parse(policy)]));
  }

  get(modelId: string): ModelPolicy | undefined {
    return this.policies[modelId];
  }

  list(): Record<string, ModelPolicy> {
    return structuredClone(this.policies);
  }

  set(modelId: string, policy: ModelPolicy): void {
    this.policies[modelId] = ModelPolicySchema.parse({ ...policy, updated_at: new Date().toISOString() });
    this.persist();
  }

  delete(modelId: string): void {
    delete this.policies[modelId];
    this.persist();
  }

  private persist(): void {
    atomicWriteJson(this.path, { version: 1, models: this.policies });
  }
}
