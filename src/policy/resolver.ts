import type { MergeMode, ProviderPolicy } from "../config.js";
import { applyProviderPolicy } from "./providerPolicy.js";
import { compileModelPolicy, type ModelPolicy } from "./modelPolicy.js";

export interface PolicyResolutionInput {
  globalPolicy: ProviderPolicy;
  modelPolicy?: ModelPolicy;
  incomingPolicy?: ProviderPolicy;
  mergeMode: MergeMode;
  softEnforceOnly: boolean;
}

/** Resolves provider policy without I/O. A non-inherit model policy replaces the global routing policy. */
export function resolveProviderPolicy(input: PolicyResolutionInput): ProviderPolicy | undefined {
  const modelPolicy = compileModelPolicy(input.modelPolicy);
  const enforced = modelPolicy ?? input.globalPolicy;
  const result = applyProviderPolicy(
    { provider: input.incomingPolicy },
    enforced,
    input.mergeMode,
    input.softEnforceOnly,
  );
  return result.provider;
}

export function applyResolvedProviderPolicy(
  body: unknown,
  input: Omit<PolicyResolutionInput, "incomingPolicy">,
): unknown {
  const request = (body && typeof body === "object" ? body : {}) as { provider?: ProviderPolicy };
  const resolved = resolveProviderPolicy({ ...input, incomingPolicy: request.provider });
  if (!resolved || Object.keys(resolved).length === 0) return body;
  return { ...request, provider: resolved };
}
