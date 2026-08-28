import type { ProviderPolicy } from "../config.js";
import type { AccessKeyModelOverride } from "../access/schema.js";
import { compileModelPolicy, type ModelPolicy } from "./modelPolicy.js";
import { resolveProviderPolicy } from "./resolver.js";

export interface ManagedRoutingTrace {
  hardFilter: string[] | null;
  accessKeyOverride: string[] | null;
  modelPolicy: string[] | null;
  incoming: string[] | null;
  final: string[] | null;
  rejectedAt: "hard_filter" | "access_key_override" | "model_policy" | "incoming" | null;
}
export interface ManagedRoutingResolution {
  finalProviderPolicy: ProviderPolicy;
  finalEligibleRoutingIds: string[] | null;
  trace: ManagedRoutingTrace;
}
export interface ManagedRoutingInput {
  availableRoutingIds: string[] | null;
  hardFilterEligibleIds: string[] | null;
  accessKeyOverride: AccessKeyModelOverride | undefined;
  globalPolicy: ProviderPolicy;
  modelPolicy: ModelPolicy | undefined;
  incomingProviderPolicy: ProviderPolicy | undefined;
  mergeMode?: "merge" | "override" | "strict";
  softEnforceOnly?: boolean;
}
interface ProviderSetConstraint { only: string[] | null; ignore: string[]; }
const unique = (items: string[]) => [...new Set(items)];
const intersect = (items: string[], restriction: string[]) => items.filter((item) => restriction.includes(item));
const addIgnore = (constraint: ProviderSetConstraint, ignored?: string[]) => ({ ...constraint, ignore: unique([...constraint.ignore, ...(ignored ?? [])]) });
function applyOnly(constraint: ProviderSetConstraint, only?: string[]): ProviderSetConstraint {
  return only ? { ...constraint, only: constraint.only === null ? unique(only) : intersect(constraint.only, only) } : constraint;
}
function visible(constraint: ProviderSetConstraint): string[] | null {
  return constraint.only === null ? null : constraint.only.filter((id) => !constraint.ignore.includes(id));
}
function serverPolicy(globalPolicy: ProviderPolicy, modelPolicy: ModelPolicy | undefined): ProviderPolicy {
  return compileModelPolicy(modelPolicy) ?? globalPolicy;
}

/** Pure managed-key resolver. Null means intentionally unbounded, never empty. */
export function resolveManagedProviderRouting(input: ManagedRoutingInput): ManagedRoutingResolution {
  const override = input.accessKeyOverride?.providerMode === "inherit" ? undefined : input.accessKeyOverride;
  let constraint: ProviderSetConstraint = { only: input.hardFilterEligibleIds ?? input.availableRoutingIds, ignore: [] };
  let current = visible(constraint);
  const trace: ManagedRoutingTrace = { hardFilter: input.hardFilterEligibleIds, accessKeyOverride: null, modelPolicy: null, incoming: null, final: null, rejectedAt: null };
  if (current?.length === 0) { trace.rejectedAt = "hard_filter"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  if (override?.providerMode === "allowlist") constraint = applyOnly(constraint, override.providers);
  if (override?.providerMode === "blocklist") constraint = addIgnore(constraint, override.providers);
  current = visible(constraint); trace.accessKeyOverride = override ? current : null;
  if (current?.length === 0) { trace.rejectedAt = "access_key_override"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  const enforced = serverPolicy(input.globalPolicy, input.modelPolicy);
  constraint = addIgnore(applyOnly(constraint, enforced.only), enforced.ignore);
  current = visible(constraint); trace.modelPolicy = current;
  if (current?.length === 0) { trace.rejectedAt = "model_policy"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  const incoming = input.incomingProviderPolicy;
  constraint = addIgnore(applyOnly(constraint, incoming?.only), incoming?.ignore);
  current = visible(constraint); trace.incoming = incoming ? current : null;
  if (current?.length === 0) { trace.rejectedAt = "incoming"; return { finalProviderPolicy: { only: [] }, finalEligibleRoutingIds: [], trace }; }

  const merged = resolveProviderPolicy({ globalPolicy: input.globalPolicy, modelPolicy: input.modelPolicy, incomingPolicy: incoming, mergeMode: input.mergeMode ?? "merge", softEnforceOnly: input.softEnforceOnly ?? false }) ?? {};
  const { only: _only, ignore: _ignore, order: _order, sort: _sort, allow_fallbacks: _fallback, ...passthrough } = merged;
  const orderSource = override?.providerOrder?.length ? override.providerOrder : enforced.order ?? incoming?.order;
  const order = orderSource?.filter((id) => !constraint.ignore.includes(id) && (current === null || current.includes(id)));
  const sort = order?.length ? undefined : (override?.sort ?? enforced.sort ?? incoming?.sort);
  const allowFallbacks = override?.allowFallbacks ?? enforced.allow_fallbacks ?? incoming?.allow_fallbacks;
  trace.final = current;
  return { finalProviderPolicy: { ...passthrough, ...(current === null ? {} : { only: current }), ...(constraint.ignore.length ? { ignore: constraint.ignore } : {}), ...(order?.length ? { order } : {}), ...(sort === undefined ? {} : { sort }), ...(allowFallbacks === undefined ? {} : { allow_fallbacks: allowFallbacks }) }, finalEligibleRoutingIds: current, trace };
}
