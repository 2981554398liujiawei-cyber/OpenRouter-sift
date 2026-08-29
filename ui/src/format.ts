import type { PolicyMode, RequestListItem } from "./types";
import type { Locale } from "./i18n";
import { en } from "./i18n/en";
import { zhCN } from "./i18n/zh-CN";

const copy = (locale: Locale) => locale === "zh-CN" ? zhCN : en;

export function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function perMillion(pricing: unknown, key: "prompt" | "completion"): string {
  if (!pricing || typeof pricing !== "object") return "—";
  const raw = (pricing as Record<string, unknown>)[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  // OpenRouter uses -1 for "no fixed price" (e.g. the auto router), which must render as unavailable.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  return `$${(value * 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} / M`;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function policyLabel(mode: PolicyMode): string {
  return { inherit: "Inherit", allowlist: "Allowlist", blocklist: "Blocklist", custom: "Custom" }[mode];
}

export function protocolLabel(protocol: string, locale: Locale = "en"): string {
  const labels = copy(locale);
  return ({ anthropic_messages: labels["format.anthropic"], chat_completions: labels["format.chatCompletions"], responses: labels["format.responses"] } as Record<string, string>)[protocol] ?? protocol;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function formatTokens(input: number | null | undefined, output: number | null | undefined): string {
  if (input === null || input === undefined || output === null || output === undefined) return "—";
  const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(value);
  return `${compact(input)} → ${compact(output)}`;
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.000001) return "<$0.000001";
  return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function requestStatus(value: RequestListItem["status"], cancelled?: boolean | null, locale: Locale = "en"): { label: string; className: string } {
  if (cancelled) return { label: copy(locale)["format.cancelled"], className: "cancelled" };
  const code = Number(value);
  if (Number.isFinite(code) && code >= 200 && code < 400) return { label: String(code), className: "success" };
  if (Number.isFinite(code)) return { label: String(code), className: "failure" };
  return { label: display(value) || copy(locale)["format.unknown"], className: "unknown" };
}

const errorExplanations: Record<string, string> = {
  NO_ELIGIBLE_PROVIDER: "No provider passed the Desired Model filters and routing policy for this request.",
  FILTER_DATA_STALE: "Provider telemetry was older than the allowed maximum age, so routing stopped for safety.",
  MODEL_NOT_ALLOWED: "The requested model is not enabled for this API key.",
};

export function explainError(code: string | null | undefined, locale: Locale = "en"): string | null {
  if (!code) return null;
  const labels = copy(locale);
  return ({ NO_ELIGIBLE_PROVIDER: labels["format.noEligibleProvider"], FILTER_DATA_STALE: labels["format.filterDataStale"], MODEL_NOT_ALLOWED: labels["format.modelNotAllowed"] } as Record<string, string>)[code] ?? labels["format.requestFailed"];
}
