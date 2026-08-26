import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonPolicyStore } from "../src/storage/policies";

describe("JsonPolicyStore", () => {
  it("persists model policy changes across a reload", () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-control-"));
    const path = join(directory, "policies.json");
    try {
      const store = new JsonPolicyStore(path);
      store.set("deepseek/example", { mode: "allowlist", providers: ["relace"], allow_fallbacks: false });
      const reloaded = new JsonPolicyStore(path);
      reloaded.load();
      expect(reloaded.get("deepseek/example")).toMatchObject({ mode: "allowlist", providers: ["relace"], allow_fallbacks: false });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects empty allowlists before persistence", () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-control-"));
    try {
      const store = new JsonPolicyStore(join(directory, "policies.json"));
      expect(() => store.set("deepseek/example", { mode: "allowlist", providers: [] })).toThrow("Allowlist requires at least one provider.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects priority entries outside the allowlist", () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-control-"));
    try {
      const store = new JsonPolicyStore(join(directory, "policies.json"));
      expect(() => store.set("deepseek/example", { mode: "allowlist", providers: ["relace"], provider_order: ["gmicloud"] })).toThrow("Provider order must contain only allowlisted providers.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
