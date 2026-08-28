import type { ProviderPolicy } from "../config.js";
import type { AccessKeyModelOverride } from "../access/schema.js";
import { compileModelPolicy, type ModelPolicy } from "./modelPolicy.js";

export interface ManagedRoutingTrace {
  hardFilter: string[] | null;
  accessKeyOverride: string[] | null;
  modelPolicy: string[] | null;
  incoming: string[] | null;
  final: string[];
  rejectedAt: "hard_filter" | "access_key_override" | "model_policy" | "incoming" | null;
}

export interface ManagedRoutingResolution {
  finalProviderPolicy: ProviderPolicy;
  finalEligibleRoutingIds: string[];
  trace: ManagedRoutingTrace;
}

export interface ManagedRoutingInput {
  availableRoutingIds: string[];
  hardFilterEligibleIds: string[] | null;
  accessKeyOverride: AccessKeyModelOverride | undefined;
  globalPolicy: ProviderPolicy;
  modelPolicy: ModelPolicy | undefined;
  incomingProviderPolicy: ProviderPolicy | undefined;
}

const unique = (items: string[]) => [...new Set(items)];
const intersect = (items: string[], restriction?: string[]) => restriction ? items.filter((item) => restriction.includes(item)) : items;
const exclude = (items: string[], ignored?: string[]) => ignored?.length ? items.filter((item) => !ignored.includes(item)) : items;

function serverPolicy(globalPolicy: ProviderPolicy, modelPolicy: ModelPolicy | undefined): ProviderPolicy {
  return compileModelPolicy(modelPolicy) ?? globalPolicy;
}

/**
 * Resolves managed-key provider routing without I/O. Every stage starts from
 * known endpoint routing tags and can only preserve or shrink that set.
 */
export function resolveManagedProviderRouting(input: ManagedRoutingInput): ManagedRoutingResolution {
  const available = unique(input.availableRoutingIds);
  let final = input.hardFilterEligibleIds === null ? available : intersect(available, unique(input.hardFilterEligibleIds));
  const trace: ManagedRoutingTrace = { hardFilter: input.hardFilterEligibleIds === null ? null : [...final], accessKeyOverride: null, modelPolicy: null, incoming: null, final: [], rejectedAt: null };
  if (!final.length) { trace.rejectedAt = "hard_filter"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  const override = input.accessKeyOverride;
  if (override?.providerMode === "allowlist") final = intersect(final, override.providers ?? []);
  else if (override?.providerMode === "blocklist") final = exclude(final, override.providers);
  if (override) trace.accessKeyOverride = [...final];
  if (!final.length) { trace.rejectedAt = "access_key_override"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  const policy = serverPolicy(input.globalPolicy, input.modelPolicy);
  final = exclude(intersect(final, policy.only), policy.ignore);
  trace.modelPolicy = [...final];
  if (!final.length) { trace.rejectedAt = "model_policy"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  const incoming = input.incomingProviderPolicy;
  final = exclude(intersect(final, incoming?.only), incoming?.ignore);
  trace.incoming = incoming ? [...final] : null;
  if (!final.length) { trace.rejectedAt = "incoming"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  // Explicit key order wins; all other order values are merely client hints
  // and must never introduce an endpoint outside the enforced final set.
  const order = (override?.providerOrder?.length ? override.providerOrder : policy.order ?? incoming?.order)?.filter((id) => final.includes(id));
  const sort = order?.length ? undefined : (override?.sort ?? policy.sort ?? incoming?.sort);
  const allowFallbacks = override?.allowFallbacks ?? policy.allow_fallbacks ?? incoming?.allow_fallbacks;
  trace.final = [...final];
  return {
    finalProviderPolicy: {
      ...policy,
      only: final,
      ...(order?.length ? { order } : {}),
      ...(sort === undefined ? {} : { sort }),
      ...(allowFallbacks === undefined ? {} : { allow_fallbacks: allowFallbacks }),
    },
    finalEligibleRoutingIds: final,
    trace,
  };
}
