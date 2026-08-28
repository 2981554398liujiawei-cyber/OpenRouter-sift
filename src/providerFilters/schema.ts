import { z } from "zod";
import type { FilterOperator } from "./types.js";

const operators: FilterOperator[] = ["lte", "gte", "eq", "in", "notIn", "contains", "exists"];
const fieldOperators: Record<string, FilterOperator[]> = {
  quantization: ["eq", "in"],
  supportedParameters: ["contains"],
  supportsImplicitCaching: ["eq", "exists"],
  "provider.routingId": ["in", "notIn"],
};
const knownField = /^(?:performance\.(?:latency|throughput)\.(?:p50|p75|p90|p99)|uptime\.(?:5m|30m|1d)|context\.(?:length|maxPrompt|maxCompletion)|pricing\.[A-Za-z0-9_.-]+)$/;

export const providerFilterConditionSchema = z.object({
  id: z.string().min(1).max(128),
  field: z.string().min(1).max(256),
  operator: z.enum(operators as [FilterOperator, ...FilterOperator[]]),
  value: z.unknown(),
  enabled: z.boolean(),
}).strict().superRefine((condition, ctx) => {
  if (!(condition.field in fieldOperators) && !knownField.test(condition.field)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["field"], message: "Unknown provider filter field" });
    return;
  }
  const allowed = fieldOperators[condition.field] ?? (condition.field.startsWith("pricing.") ? ["lte", "gte", "eq"] : ["lte", "gte"]);
  if (!allowed.includes(condition.operator)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operator"], message: `Operator ${condition.operator} is not valid for ${condition.field}` });
  }
  if (condition.operator === "exists") return;
  if ((condition.operator === "in" || condition.operator === "notIn") && (!Array.isArray(condition.value) || condition.value.length === 0 || condition.value.some((item) => typeof item !== "string" || item.trim().length === 0))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Membership filters require a non-empty string array" });
  }
  if (condition.operator === "contains" && typeof condition.value !== "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Contains filters require a string" });
  }
  if (["lte", "gte", "eq"].includes(condition.operator) && (typeof condition.value !== "number" || !Number.isFinite(condition.value) || condition.value < 0 || (condition.field.startsWith("uptime.") && condition.value > 100) || (condition.field.startsWith("context.") && !Number.isInteger(condition.value)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Threshold filters require a finite number" });
  }
});

export const providerFilterConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.literal("all"),
  conditions: z.array(providerFilterConditionSchema).max(100),
  maxTelemetryAgeMs: z.number().int().min(30_000).max(24 * 60 * 60 * 1000),
  updatedAt: z.string().min(1).max(64),
}).strict().superRefine((filter, ctx) => {
  const ids = new Set<string>();
  for (const [index, condition] of filter.conditions.entries()) {
    if (ids.has(condition.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conditions", index, "id"], message: "Condition IDs must be unique" });
    ids.add(condition.id);
  }
});

export type ValidatedProviderFilterConfig = z.infer<typeof providerFilterConfigSchema>;
