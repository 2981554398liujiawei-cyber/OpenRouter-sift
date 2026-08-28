import { describe, expect, it } from "vitest";
import { resolveManagedProviderRouting } from "../src/policy/managedRouting.js";

const base = { availableRoutingIds: ["a", "b", "c"], hardFilterEligibleIds: ["a", "b", "c"], globalPolicy: {}, modelPolicy: undefined, incomingProviderPolicy: undefined };

describe("managed provider routing", () => {
  it("only permits a key allowlist within hard-filter eligibility", () => {
    const result = resolveManagedProviderRouting({ ...base, accessKeyOverride: { providerMode: "allowlist", providers: ["a", "c"], providerOrder: ["c", "a"], allowFallbacks: false } });
    expect(result.finalProviderPolicy).toMatchObject({ only: ["a", "c"], order: ["c", "a"], allow_fallbacks: false });
  });
  it("removes a blocklist and fails closed on an empty server intersection", () => {
    expect(resolveManagedProviderRouting({ ...base, accessKeyOverride: { providerMode: "blocklist", providers: ["b"] } }).finalEligibleRoutingIds).toEqual(["a", "c"]);
    const result = resolveManagedProviderRouting({ ...base, hardFilterEligibleIds: ["a", "b"], accessKeyOverride: { providerMode: "allowlist", providers: ["c"] } });
    expect(result.trace.rejectedAt).toBe("access_key_override");
  });
  it("intersects key, model policy and client policy without a bypass", () => {
    const result = resolveManagedProviderRouting({ ...base, accessKeyOverride: { providerMode: "allowlist", providers: ["a", "b"] }, modelPolicy: { mode: "allowlist", providers: ["b", "c"] }, incomingProviderPolicy: { only: ["b", "c", "d"] } });
    expect(result.finalEligibleRoutingIds).toEqual(["b"]);
    expect(result.finalProviderPolicy.only).toEqual(["b"]);
  });
  it("allows inherit without re-expanding the hard boundary", () => {
    const result = resolveManagedProviderRouting({ ...base, hardFilterEligibleIds: ["a", "b"], accessKeyOverride: { providerMode: "inherit" }, incomingProviderPolicy: { only: ["c"] } });
    expect(result.finalEligibleRoutingIds).toEqual([]);
    expect(result.trace.rejectedAt).toBe("incoming");
  });
  it("does not let inherit override a model fallback setting", () => {
    const result = resolveManagedProviderRouting({ ...base, accessKeyOverride: { providerMode: "inherit", allowFallbacks: true }, modelPolicy: { mode: "allowlist", providers: ["a"], allow_fallbacks: false } });
    expect(result.finalProviderPolicy.allow_fallbacks).toBe(false);
  });
  it("keeps an unavailable provider universe unbounded when no hard filter exists", () => {
    const inherited = resolveManagedProviderRouting({ ...base, availableRoutingIds: null, hardFilterEligibleIds: null, accessKeyOverride: { providerMode: "inherit" } });
    expect(inherited.finalEligibleRoutingIds).toBeNull();
    expect(inherited.finalProviderPolicy.only).toBeUndefined();
    const allowlisted = resolveManagedProviderRouting({ ...base, availableRoutingIds: null, hardFilterEligibleIds: null, accessKeyOverride: { providerMode: "allowlist", providers: ["a", "b"] } });
    expect(allowlisted.finalProviderPolicy.only).toEqual(["a", "b"]);
    const blocked = resolveManagedProviderRouting({ ...base, availableRoutingIds: null, hardFilterEligibleIds: null, accessKeyOverride: { providerMode: "blocklist", providers: ["c"] } });
    expect(blocked.finalProviderPolicy).toMatchObject({ ignore: ["c"] });
  });
  it("preserves merged client provider preferences behind the managed boundary", () => {
    const result = resolveManagedProviderRouting({ ...base, accessKeyOverride: { providerMode: "allowlist", providers: ["a"] }, incomingProviderPolicy: { max_price: { prompt: 1 }, quantizations: ["fp16"], require_parameters: true, only: ["a", "b"] } });
    expect(result.finalProviderPolicy).toMatchObject({ only: ["a"], max_price: { prompt: 1 }, quantizations: ["fp16"], require_parameters: true });
  });
});
