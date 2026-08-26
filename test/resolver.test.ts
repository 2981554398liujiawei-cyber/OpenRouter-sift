import { describe, expect, it } from "vitest";
import { resolveProviderPolicy } from "../src/policy/resolver";

describe("resolveProviderPolicy", () => {
  const globalPolicy = { ignore: ["coreweave"], sort: "price" as const };

  it("uses the global policy when no model rule exists", () => {
    expect(resolveProviderPolicy({ globalPolicy, mergeMode: "merge", softEnforceOnly: false })).toEqual(globalPolicy);
  });

  it("uses global policy for inherit", () => {
    expect(resolveProviderPolicy({ globalPolicy, modelPolicy: { mode: "inherit" }, mergeMode: "merge", softEnforceOnly: false })).toEqual(globalPolicy);
  });

  it("compiles an allowlist with explicit order and fallback setting", () => {
    expect(resolveProviderPolicy({
      globalPolicy,
      modelPolicy: { mode: "allowlist", providers: ["relace", "gmicloud"], provider_order: ["relace", "gmicloud"], allow_fallbacks: false },
      mergeMode: "merge",
      softEnforceOnly: false,
    })).toEqual({ only: ["relace", "gmicloud"], order: ["relace", "gmicloud"], allow_fallbacks: false });
  });

  it("compiles a blocklist and replaces global routing selection", () => {
    expect(resolveProviderPolicy({
      globalPolicy,
      modelPolicy: { mode: "blocklist", providers: ["coreweave"] },
      mergeMode: "merge",
      softEnforceOnly: false,
    })).toEqual({ ignore: ["coreweave"] });
  });

  it("treats an empty blocklist as inherit/default", () => {
    expect(resolveProviderPolicy({
      globalPolicy,
      modelPolicy: { mode: "blocklist", providers: [] },
      mergeMode: "merge",
      softEnforceOnly: false,
    })).toEqual(globalPolicy);
  });

  it("keeps advanced custom policy fields, including sort", () => {
    expect(resolveProviderPolicy({
      globalPolicy,
      modelPolicy: { mode: "custom", policy: { sort: { by: "latency", partition: "none" }, require_parameters: true } },
      mergeMode: "merge",
      softEnforceOnly: false,
    })).toEqual({ sort: { by: "latency", partition: "none" }, require_parameters: true });
  });

  it("keeps incoming fields in merge mode", () => {
    expect(resolveProviderPolicy({
      globalPolicy,
      modelPolicy: { mode: "allowlist", providers: ["relace"] },
      incomingPolicy: { allow_fallbacks: true },
      mergeMode: "merge",
      softEnforceOnly: false,
    })).toEqual({ only: ["relace"], allow_fallbacks: true });
  });

  it("replaces incoming fields in override mode and rejects conflicts in strict mode", () => {
    const input = { globalPolicy, modelPolicy: { mode: "allowlist" as const, providers: ["relace"] }, incomingPolicy: { only: ["gmicloud"] }, softEnforceOnly: false };
    expect(resolveProviderPolicy({ ...input, mergeMode: "override" })).toEqual({ only: ["relace"] });
    expect(() => resolveProviderPolicy({ ...input, mergeMode: "strict" })).toThrow("provider.only conflicts with enforced policy");
  });
});
