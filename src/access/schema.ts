import { z } from "zod";
import type { ProviderSort } from "../config.js";

export interface AccessKeyModelOverride {
  providerMode: "inherit" | "allowlist" | "blocklist";
  providers?: string[];
  providerOrder?: string[];
  allowFallbacks?: boolean;
  sort?: ProviderSort | null;
}

const providerList = z.array(z.string().trim().min(1).max(256)).max(100);
export const accessKeyModelOverrideSchema = z.object({
  providerMode: z.enum(["inherit", "allowlist", "blocklist"]),
  providers: providerList.optional(),
  providerOrder: providerList.optional(),
  allowFallbacks: z.boolean().optional(),
  sort: z.enum(["price", "latency", "throughput"]).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.providerMode === "inherit" && ((value.providers?.length ?? 0) > 0 || (value.providerOrder?.length ?? 0) > 0 || value.allowFallbacks !== undefined || value.sort !== undefined && value.sort !== null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inherit mode cannot include routing settings", path: ["providers"] });
  if (value.providerMode === "allowlist" && !value.providers?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providers"], message: "Allowlist requires at least one provider" });
  if (value.providerMode === "allowlist" && value.providerOrder?.some((provider) => !value.providers?.includes(provider))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerOrder"], message: "Provider order must contain only allowlisted providers" });
  if (value.providerMode === "blocklist" && (value.providerOrder?.length ?? 0) > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Blocklist cannot include provider order", path: ["providerOrder"] });
  if (value.providerOrder && new Set(value.providerOrder).size !== value.providerOrder.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["providerOrder"], message: "Provider order must not contain duplicates" });
  if (value.providerOrder?.length && value.sort) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provider order and sort cannot be used together", path: ["sort"] });
});

/** A per-access-key mapping from model id to provider routing preferences. */
export const modelIdSchema = z.string().trim().min(1).max(512).refine((value) => !/[\r\n]/.test(value), "Model IDs must not contain newlines");

export const modelOverridesSchema = z.record(modelIdSchema, accessKeyModelOverrideSchema).default({});
export type ModelOverrides = z.infer<typeof modelOverridesSchema>;

export function validateModelOverrides(value: unknown, allowedModels?: Iterable<string>): ModelOverrides {
  const parsed = modelOverridesSchema.parse(value);
  if (!allowedModels) return parsed;
  const allowed = new Set(allowedModels);
  for (const source of Object.keys(parsed)) {
    if (!allowed.has(source)) throw new Error("Every model override model must be allowed for this Access Key");
  }
  return parsed;
}
