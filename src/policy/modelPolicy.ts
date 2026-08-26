import { z } from "zod";
import { ProviderPolicySchema, type ProviderPolicy } from "../config.js";

export type ModelPolicyMode = "inherit" | "allowlist" | "blocklist" | "custom";

export interface ModelPolicy {
  mode: ModelPolicyMode;
  providers?: string[];
  provider_order?: string[];
  allow_fallbacks?: boolean;
  policy?: ProviderPolicy;
  enabled?: boolean;
  updated_at?: string;
}

const providerList = z.array(z.string().trim().min(1));

export const ModelPolicySchema = z.object({
  mode: z.enum(["inherit", "allowlist", "blocklist", "custom"]),
  providers: providerList.optional(),
  provider_order: providerList.optional(),
  allow_fallbacks: z.boolean().optional(),
  policy: ProviderPolicySchema.optional(),
  enabled: z.boolean().optional(),
  updated_at: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "allowlist" && !value.providers?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Allowlist requires at least one provider.", path: ["providers"] });
  }
  if (value.mode === "custom" && !value.policy) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Custom mode requires a provider policy.", path: ["policy"] });
  }
  if (value.mode === "allowlist" && value.provider_order?.some((provider) => !value.providers?.includes(provider))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provider order must contain only allowlisted providers.", path: ["provider_order"] });
  }
  if (value.provider_order && new Set(value.provider_order).size !== value.provider_order.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provider order must not contain duplicates.", path: ["provider_order"] });
  }
});

export function compileModelPolicy(modelPolicy: ModelPolicy | undefined): ProviderPolicy | undefined {
  if (!modelPolicy || modelPolicy.enabled === false || modelPolicy.mode === "inherit") return undefined;
  if (modelPolicy.mode === "custom") return modelPolicy.policy;

  if (modelPolicy.mode === "allowlist") {
    return {
      only: modelPolicy.providers,
      ...(modelPolicy.provider_order?.length ? { order: modelPolicy.provider_order } : {}),
      ...(modelPolicy.allow_fallbacks !== undefined ? { allow_fallbacks: modelPolicy.allow_fallbacks } : {}),
    };
  }

  if (!modelPolicy.providers?.length) return undefined;
  return {
    ignore: modelPolicy.providers ?? [],
    ...(modelPolicy.allow_fallbacks !== undefined ? { allow_fallbacks: modelPolicy.allow_fallbacks } : {}),
  };
}
