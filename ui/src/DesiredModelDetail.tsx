import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Badge, Breadcrumbs } from "./components";
import { useI18n } from "./i18n";
import { display } from "./format";
import { canonicalNumber, numericDraftIsPlausible } from "./numericDraft";
import type {
  Endpoint,
  FilterOperator,
  FilterPreview,
  FilterPreviewEndpoint,
  FilterPreviewReason,
  ModelSummary,
  ProviderFilterCondition,
  ProviderFilterConfig,
} from "./types";

type Field = {
  id: string;
  label: string;
  type: "number" | "text" | "boolean";
  unit?: string;
  operators: FilterOperator[];
};
const baseFields: Field[] = ["p50", "p75", "p90", "p99"]
  .flatMap((p) => [
    {
      id: `performance.throughput.${p}`,
      label: `Throughput ${p.toUpperCase()}`,
      type: "number" as const,
      unit: "t/s",
      operators: ["gte", "lte"] as FilterOperator[],
    },
    {
      id: `performance.latency.${p}`,
      label: `Latency ${p.toUpperCase()}`,
      type: "number" as const,
      unit: "s",
      operators: ["lte", "gte"] as FilterOperator[],
    },
  ])
  .concat([
    ...["5m", "30m", "1d"].map((window) => ({
      id: `uptime.${window}`,
      label: `Uptime ${window}`,
      type: "number" as const,
      unit: "%",
      operators: ["gte", "lte"] as FilterOperator[],
    })),
    {
      id: "quantization",
      label: "Quantization",
      type: "text",
      operators: ["eq", "in"],
    },
    {
      id: "context.length",
      label: "Context Length",
      type: "number",
      unit: "tokens",
      operators: ["gte", "lte"],
    },
    {
      id: "context.maxPrompt",
      label: "Max Prompt Tokens",
      type: "number",
      unit: "tokens",
      operators: ["gte", "lte"],
    },
    {
      id: "context.maxCompletion",
      label: "Max Completion Tokens",
      type: "number",
      unit: "tokens",
      operators: ["gte", "lte"],
    },
    {
      id: "supportedParameters",
      label: "Supported Parameter",
      type: "text",
      operators: ["contains"],
    },
    {
      id: "supportsImplicitCaching",
      label: "Implicit Caching",
      type: "boolean",
      operators: ["eq", "exists"],
    },
    {
      id: "provider.routingId",
      label: "Provider Routing ID",
      type: "text",
      operators: ["in", "notIn"],
    },
  ] as Field[]);
const pricingLabels: Record<string, string> = {
  prompt: "Input",
  completion: "Output",
  input_cache_read: "Cache Read",
  input_cache_write: "Cache Write",
  cache_read: "Cache Read",
  cache_write: "Cache Write",
  cache_write_5m: "Cache Write 5m",
  cache_write_1h: "Cache Write 1h",
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const emptyFilter = (): ProviderFilterConfig => ({
  enabled: false,
  mode: "all",
  conditions: [],
  maxTelemetryAgeMs: 1_800_000,
});
function conditionIsComplete(condition: ProviderFilterCondition, fields: Field[]): boolean {
  if (!condition.enabled) return true;
  if (condition.operator === "in" || condition.operator === "notIn") {
    return Array.isArray(condition.value) && condition.value.length > 0;
  }
  const field = [...fields, ...baseFields].find((item) => item.id === condition.field);
  if (field?.type === "number") return canonicalNumber(String(condition.value ?? "")) !== null;
  if (field?.type === "boolean") return typeof condition.value === "boolean";
  return String(condition.value ?? "").trim().length > 0;
}
function canonicalizeFilter(filter: ProviderFilterConfig, fields: Field[]): ProviderFilterConfig | null {
  const conditions: ProviderFilterCondition[] = [];
  for (const condition of filter.conditions) {
    if (!condition.enabled) continue;
    if (!conditionIsComplete(condition, fields)) return null;
    const field = [...fields, ...baseFields].find((item) => item.id === condition.field);
    const value = field?.type === "number"
      ? canonicalNumber(String(condition.value ?? ""))
      : condition.value;
    if (field?.type === "number" && value === null) return null;
    conditions.push({ ...condition, value });
  }
  const telemetryAgeSeconds = canonicalNumber(String(filter.maxTelemetryAgeMs / 1000));
  if (telemetryAgeSeconds === null || telemetryAgeSeconds < 30) return null;
  return { ...filter, conditions, maxTelemetryAgeMs: telemetryAgeSeconds * 1000 };
}
function localizedFieldLabel(field: Field, t: Translate): string {
  const parts = field.id.split(".");
  if (field.id.startsWith("performance.throughput.")) return t("provider.fieldThroughput", { percentile: parts.at(-1)?.toUpperCase() ?? "" });
  if (field.id.startsWith("performance.latency.")) return t("provider.fieldLatency", { percentile: parts.at(-1)?.toUpperCase() ?? "" });
  if (field.id.startsWith("uptime.")) return t("provider.fieldUptime", { window: parts.at(-1) ?? "" });
  const labels: Record<string, Parameters<Translate>[0]> = {
    quantization: "provider.fieldQuantization",
    "context.length": "provider.fieldContextLength",
    "context.maxPrompt": "provider.fieldMaxPrompt",
    "context.maxCompletion": "provider.fieldMaxCompletion",
    supportedParameters: "provider.fieldSupportedParameter",
    supportsImplicitCaching: "provider.fieldImplicitCaching",
    "provider.routingId": "provider.fieldRoutingId",
  };
  return labels[field.id] ? t(labels[field.id]) : field.label;
}
function fieldsFor(endpoints: Endpoint[]): Field[] {
  const keys = new Set<string>();
  endpoints.forEach((endpoint) =>
    Object.entries((endpoint.pricing ?? {}) as Record<string, unknown>).forEach(
      ([key, value]) => {
        if (
          typeof value === "number" ||
          (typeof value === "string" && Number.isFinite(Number(value)))
        )
          keys.add(key);
      },
    ),
  );
  return [...keys].map((key) => ({
    id: `pricing.${key}`,
    label: pricingLabels[key] ?? key.replaceAll("_", " "),
    type: "number" as const,
    unit: key === "discount" ? "" : "$/M",
    operators: ["lte", "gte", "eq"] as FilterOperator[],
  }));
}
function unwrap(value: unknown): ProviderFilterConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if ("providerFilter" in record)
    return (record.providerFilter as ProviderFilterConfig | null) ?? null;
  if ("filter" in record)
    return (record.filter as ProviderFilterConfig | null) ?? null;
  return "enabled" in record && "conditions" in record
    ? (value as ProviderFilterConfig)
    : null;
}
function previewFromEndpoints(
  modelId: string,
  endpoints: Endpoint[],
): FilterPreview {
  const entries = endpoints.map((endpoint) => ({
    endpoint: endpoint as FilterPreviewEndpoint,
    eligible: true,
    reasons: [] as FilterPreviewReason[],
  }));
  return {
    modelId,
    totalEndpoints: endpoints.length,
    eligibleEndpoints: entries,
    excludedEndpoints: [],
    eligibleRoutingIds: endpoints
      .map((item) => item.providerRoutingId)
      .filter((item): item is string => Boolean(item)),
    evaluatedAt: new Date().toISOString(),
    metadataFetchedAt: new Date().toISOString(),
    metadataState: "fresh",
    usable: true,
    failureReason: null,
  };
}

export function DesiredModelDetail({
  modelId,
  models,
  onBack,
  setNotice,
  setError,
}: {
  modelId: string;
  models: ModelSummary[];
  onBack: () => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
}) {
  const { t, formatDate } = useI18n();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [filter, setFilter] = useState(emptyFilter);
  const [savedFilter, setSavedFilter] = useState<ProviderFilterConfig | null>(
    null,
  );
  const [preview, setPreview] = useState<FilterPreview | null>(null);
  const [busy, setBusy] = useState(true);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [telemetryDraft, setTelemetryDraft] = useState("1800");
  const initialized = useRef(false);
  const requestGeneration = useRef(0);
  const fields = useMemo(() => fieldsFor(endpoints), [endpoints]);
  const model = models.find((item) => item.id === modelId);
  const load = async (refresh = false) => {
    try {
      setBusy(true);
      setEndpointError(null);
      if (refresh) await api.refreshEndpoints(modelId);
      const [result, rawSaved] = await Promise.all([
        api.endpoints(modelId),
        api.desiredFilter(modelId),
      ]);
      const nextSaved = unwrap(rawSaved);
      setEndpoints(result.items);
      setSavedFilter(nextSaved ? clone(nextSaved) : null);
      setFilter(nextSaved ? clone(nextSaved) : emptyFilter());
      setTelemetryDraft(String(Math.round((nextSaved?.maxTelemetryAgeMs ?? 1_800_000) / 1000)));
      const initialPreview =
        rawSaved && typeof rawSaved === "object" && "preview" in rawSaved
          ? (rawSaved as { preview?: FilterPreview | null }).preview
          : null;
      setPreview(initialPreview ?? previewFromEndpoints(modelId, result.items));
      initialized.current = true;
      if (refresh) setNotice(t("provider.refresh") + ".");
    } catch (err) {
      setEndpointError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    initialized.current = false;
    void load();
    return () => {
      initialized.current = false;
    };
  }, [modelId]);
  useEffect(() => {
    if (!initialized.current) return;
    const generation = ++requestGeneration.current;
    if (!filter.conditions.every((condition) => conditionIsComplete(condition, fields))) {
      setError("");
      setPreviewing(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      const candidate = canonicalizeFilter(filter, fields);
      if (!candidate) {
        setPreviewing(false);
        return;
      }
      void api
        .previewDesiredFilter(modelId, candidate)
        .then((next) => {
          if (generation === requestGeneration.current) setPreview(next);
        })
        .catch((err: Error) => {
          if (generation === requestGeneration.current) setError(err.message);
        })
        .finally(() => {
          if (generation === requestGeneration.current) setPreviewing(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [modelId, filter, setError]);
  const canonicalFilter = canonicalizeFilter(filter, fields);
  const hasInvalidDraft = filter.conditions.some((condition) => condition.enabled && !conditionIsComplete(condition, fields))
    || canonicalNumber(telemetryDraft) === null
    || Number(telemetryDraft) < 30;
  const update = (index: number, patch: Partial<ProviderFilterCondition>) =>
    setFilter((current) => ({
      ...current,
      enabled: true,
      conditions: current.conditions.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  const save = async () => {
    if (!canonicalFilter) return;
    try {
      const result = await api.saveDesiredFilter(modelId, canonicalFilter);
      const next = unwrap(result) ?? clone(canonicalFilter);
      setSavedFilter(clone(next));
      setFilter(clone(next));
      setTelemetryDraft(String(Math.round((next.maxTelemetryAgeMs ?? 1_800_000) / 1000)));
      if (
        result &&
        typeof result === "object" &&
        "preview" in result &&
        (result as { preview?: FilterPreview | null }).preview
      )
        setPreview((result as { preview: FilterPreview }).preview);
      setNotice(t("provider.saved") + ".");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const reset = () => {
    setFilter(savedFilter ? clone(savedFilter) : emptyFilter());
    setTelemetryDraft(String(Math.round((savedFilter?.maxTelemetryAgeMs ?? 1_800_000) / 1000)));
    setNotice(t("provider.reset") + ".");
  };
  const remove = async () => {
    if (!window.confirm(t("provider.confirmDelete"))) return;
    try {
      await api.deleteDesiredFilter(modelId);
      setSavedFilter(null);
      setFilter(emptyFilter());
      setTelemetryDraft("1800");
      setPreview(previewFromEndpoints(modelId, endpoints));
      setNotice(t("provider.delete") + ".");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const dirty =
    JSON.stringify(filter) !== JSON.stringify(savedFilter ?? emptyFilter());
  if (busy)
    return (
      <section className="page desired-detail">
        <Breadcrumbs
          trail={[
            { label: t("nav.desiredModels"), onClick: onBack },
            { label: t("common.loading") },
          ]}
        />
        <p className="muted">{t("model.loading")}</p>
      </section>
    );
  const excludedCount = preview?.excludedEndpoints.length ?? 0;
  const eligibleCount = preview?.eligibleEndpoints.length ?? 0;
  const total = preview?.totalEndpoints ?? endpoints.length;
  return (
    <section className="page desired-detail">
      <Breadcrumbs
        trail={[
          { label: t("nav.desiredModels"), onClick: onBack },
          { label: model?.name || modelId },
        ]}
      />
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("provider.eyebrow")}</p>
          <h1>{model?.name || modelId}</h1>
          <code className="mono">{modelId}</code>
          <p>
            {preview?.metadataState === "stale"
              ? t("provider.stale")
              : preview?.metadataState === "unavailable"
                ? t("provider.unavailable")
                : t("provider.fresh")}{" "}
            · {total} {t("provider.endpoints")} · {eligibleCount}{" "}
            {t("provider.eligible")} · {excludedCount} {t("provider.excluded")}
          </p>
        </div>
        <div className="page-actions">
          <Badge
            variant={
              filter.enabled && filter.conditions.length ? "accent" : "neutral"
            }
          >
            {filter.enabled && filter.conditions.length
              ? t("model.filterActive")
              : t("model.noFilter")}
          </Badge>
          <button className="button secondary" onClick={() => void load(true)}>
            {t("provider.refresh")}
          </button>
        </div>
      </div>
      {endpointError ? (
        <section className="panel error-copy">
          <p>{endpointError}</p>
          <button className="button secondary" onClick={() => void load()}>
            {t("common.refresh")}
          </button>
        </section>
      ) : (
        <div className="provider-console-layout">
          <section className="panel provider-filter-panel">
            <div className="panel-title">
              <div>
                <h2>{t("provider.filters")}</h2>
                <p>{t("provider.allConditions")}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  onChange={(event) =>
                    setFilter({ ...filter, enabled: event.target.checked })
                  }
                />
                {t("provider.enabled")}
              </label>
            </div>
            {filter.conditions.map((condition, index) => (
              <ConditionRow
                key={condition.id}
                condition={condition}
                index={index}
                fields={fields}
                update={update}
                remove={() =>
                  setFilter((current) => ({
                    ...current,
                    conditions: current.conditions.filter(
                      (_, i) => i !== index,
                    ),
                  }))
                }
              />
            ))}
            <button
              className="button secondary"
              onClick={() => {
                const field = fields[0] ?? baseFields[0];
                setFilter({
                  ...filter,
                  enabled: true,
                  conditions: [
                    ...filter.conditions,
                    {
                      id: `condition_${Date.now()}`,
                      field: field.id,
                      operator: field.operators[0],
                      value:
                        field.type === "boolean"
                          ? true
                          : field.operators.includes("in") ||
                              field.operators.includes("notIn")
                            ? []
                            : "",
                      enabled: true,
                    },
                  ],
                });
              }}
            >
              {t("provider.addCondition")}
            </button>
            {hasInvalidDraft && <p className="validation-message" role="status">{t("provider.completeValue")}</p>}
            <details className="advanced-block provider-more-filters" open={filter.conditions.length > 0}>
              <summary>{t("provider.moreFilters")}</summary>
              <label className="telemetry-age">
                {t("provider.telemetryAge")}
                <input
                  aria-label="Maximum telemetry age"
                  min="30"
                  type="text"
                  inputMode="decimal"
                  value={telemetryDraft}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTelemetryDraft(next);
                    if (numericDraftIsPlausible(next) && canonicalNumber(next) !== null && Number(next) >= 30) {
                      setFilter({ ...filter, maxTelemetryAgeMs: Number(next) * 1000 });
                    }
                  }}
                />
                <small>{t("provider.telemetryHint")}</small>
              </label>
            </details>
            <div className="actions">
              <button className="button" disabled={!canonicalFilter || hasInvalidDraft} onClick={() => void save()}>
                {t("provider.saveFilters")}
              </button>
              {dirty && (
                <Badge variant="warning">{t("provider.unsaved")}</Badge>
              )}
              <button
                className="button secondary"
                disabled={!dirty}
                onClick={reset}
              >
                {t("provider.resetChanges")}
              </button>
              {savedFilter && (
                <button
                  className="text-button danger-text"
                  onClick={() => void remove()}
                >
                  {t("provider.delete")}
                </button>
              )}
            </div>
          </section>
          <ProviderPreview
            preview={preview}
            loading={previewing}
            formatDate={formatDate}
            t={t}
          />
        </div>
      )}
    </section>
  );
}

function ConditionRow({
  condition,
  index,
  fields,
  update,
  remove,
}: {
  condition: ProviderFilterCondition;
  index: number;
  fields: Field[];
  update: (index: number, patch: Partial<ProviderFilterCondition>) => void;
  remove: () => void;
}) {
  const { t } = useI18n();
  const field = [...fields, ...baseFields].find(
    (item) => item.id === condition.field,
  ) ?? {
    id: condition.field,
    label: condition.field,
    type: "text" as const,
    operators: ["eq"] as FilterOperator[],
  };
  const membership =
    condition.operator === "in" || condition.operator === "notIn";
  const value = Array.isArray(condition.value)
    ? condition.value.join(", ")
    : String(condition.value ?? "");
  return (
    <div className="filter-condition">
      <select
        aria-label={t("provider.filterField")}
        value={condition.field}
        onChange={(event) => {
          const next = [...fields, ...baseFields].find(
            (item) => item.id === event.target.value,
          );
          update(index, {
            field: event.target.value,
            operator: next?.operators[0] ?? "eq",
            value:
              next?.operators.includes("in") ||
              next?.operators.includes("notIn")
                ? []
                : next?.type === "boolean",
          });
        }}
      >
        {fields.length > 0 && (
          <optgroup label={t("provider.pricing")}>
            {fields.map((item) => (
              <option key={item.id} value={item.id}>
                {localizedFieldLabel(item, t)}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={t("provider.performanceCapabilities")}>
          {baseFields.map((item) => (
            <option key={item.id} value={item.id}>
                {localizedFieldLabel(item, t)}
            </option>
          ))}
        </optgroup>
      </select>
      <select
        aria-label={t("provider.filterOperator")}
        value={condition.operator}
        onChange={(event) =>
          update(index, {
            operator: event.target.value as FilterOperator,
            value:
              event.target.value === "in" || event.target.value === "notIn"
                ? []
                : condition.value,
          })
        }
      >
        {field.operators.map((operator) => (
          <option key={operator} value={operator}>
            {
              (
                {
                  lte: "≤",
                  gte: "≥",
                  eq: "=",
                  in: "in",
                  notIn: "not in",
                  contains: "contains",
                  exists: "exists",
                } as Record<string, string>
              )[operator]
            }
          </option>
        ))}
      </select>
      {field.type === "boolean" ? (
        <select
          aria-label={t("provider.filterValue")}
          value={String(condition.value)}
          onChange={(event) =>
            update(index, { value: event.target.value === "true" })
          }
        >
          <option value="true">{t("provider.required")}</option>
          <option value="false">{t("provider.notRequired")}</option>
        </select>
      ) : condition.operator === "exists" ? (
        <span className="muted">{t("provider.present")}</span>
      ) : (
        <input
          aria-label="Filter value"
          type="text"
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(event) =>
            update(index, {
              value: membership
                ? event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                : event.target.value,
            })
          }
        />
      )}
      {field.unit && <span className="filter-unit">{field.unit}</span>}
      <label className="condition-toggle" title={t("provider.enableCondition")}>
        <input
          type="checkbox"
          checked={condition.enabled}
          onChange={(event) => update(index, { enabled: event.target.checked })}
        />
      </label>
      <button
        className="condition-delete"
        aria-label={t("provider.deleteCondition", { index: index + 1 })}
        onClick={remove}
      >
        ✕
      </button>
    </div>
  );
}

type ProviderRow = FilterPreviewEndpoint & {
  performance?: Endpoint["performance"];
  pricing?: unknown;
  quantization?: string | null;
  contextLength?: number | null;
  maxPromptTokens?: number | null;
  maxCompletionTokens?: number | null;
  supportedParameters?: string[] | null;
  supportsImplicitCaching?: boolean | null;
};
type ProviderSort =
  | "default"
  | "provider"
  | "input"
  | "output"
  | "latency"
  | "throughput"
  | "uptime";
type Translate = ReturnType<typeof useI18n>["t"];
const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" &&
        value.trim() !== "" &&
        Number.isFinite(Number(value))
      ? Number(value)
      : null;
const pricingValue = (endpoint: ProviderRow, key: string): number | null => {
  const raw =
    endpoint.pricing && typeof endpoint.pricing === "object"
      ? (endpoint.pricing as Record<string, unknown>)[key]
      : null;
  const value = numberValue(raw);
  return value === null ? null : key === "discount" ? value : value * 1_000_000;
};
const metricValue = (
  endpoint: ProviderRow,
  kind: "latency" | "throughput",
  percentile: string,
): number | null =>
  endpoint.performance?.[
    kind === "latency" ? "latencyLast30m" : "throughputLast30m"
  ]?.[percentile as "p50" | "p75" | "p90" | "p99"] ?? null;
const formatMetric = (value: number | null, unit: string) => {
  if (value === null) return "—";
  if (unit === "s") {
    // OpenRouter telemetry has appeared in both sub-second seconds and
    // millisecond-shaped values; keep the display readable without changing
    // the raw value used by the server-side filter evaluator.
    if (value >= 10) return `${Math.round(value)} ms`;
    return value < 1 ? `${Math.round(value * 1_000)} ms` : `${value.toFixed(2)} s`;
  }
  if (unit === "%") return `${value.toFixed(2)}%`;
  return `${value.toFixed(value >= 100 ? 0 : 2)} ${unit}`;
};
const sortValue = (
  endpoint: ProviderRow,
  sort: ProviderSort,
  percentile: string,
): string | number =>
  sort === "provider"
    ? (endpoint.providerName ?? endpoint.providerRoutingId ?? "")
    : sort === "input"
      ? (pricingValue(endpoint, "prompt") ?? Infinity)
      : sort === "output"
        ? (pricingValue(endpoint, "completion") ?? Infinity)
        : sort === "latency"
          ? (metricValue(endpoint, "latency", percentile) ?? Infinity)
          : sort === "throughput"
            ? -(metricValue(endpoint, "throughput", percentile) ?? -Infinity)
            : sort === "uptime"
              ? -(endpoint.performance?.uptimeLast30m ?? -Infinity)
              : 0;
function compareProviders(
  a: ProviderRow,
  b: ProviderRow,
  sort: ProviderSort,
  percentile: string,
): number {
  const left = sortValue(a, sort, percentile);
  const right = sortValue(b, sort, percentile);
  if (typeof left === "string" && typeof right === "string")
    return (
      left.localeCompare(right) ||
      (a.providerRoutingId ?? "").localeCompare(b.providerRoutingId ?? "")
    );
  return (
    Number(left) - Number(right) ||
    (a.providerName ?? "").localeCompare(b.providerName ?? "") ||
    (a.providerRoutingId ?? "").localeCompare(b.providerRoutingId ?? "")
  );
}
function formatPrice(value: number | null): string {
  return value === null || value < 0
    ? "—"
    : value === 0
      ? "Free"
      : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} / M`;
}
function formatPricingField(key: string, value: number | null): string {
  return key === "discount" && value !== null ? `${value.toFixed(2)}%` : formatPrice(value);
}

function ProviderPreview({
  preview,
  loading,
  formatDate,
  t,
}: {
  preview: FilterPreview | null;
  loading: boolean;
  formatDate: (value: string | number | Date) => string;
  t: Translate;
}) {
  const [search, setSearch] = useState("");
  const [quantization, setQuantization] = useState("");
  const [percentile, setPercentile] = useState("p50");
  const [sort, setSort] = useState<ProviderSort>("default");
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = preview
    ? [
        ...preview.eligibleEndpoints.map((item) => ({
          ...item,
          eligible: true,
        })),
        ...preview.excludedEndpoints.map((item) => ({
          ...item,
          eligible: false,
        })),
      ]
    : [];
  const quantizations = [
    ...new Set(
      entries
        .map((item) => (item.endpoint as ProviderRow).quantization)
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort();
  const rows = entries
    .filter((item) => {
      const endpoint = item.endpoint as ProviderRow;
      return (
        (!search ||
          `${endpoint.providerName ?? ""} ${endpoint.providerRoutingId ?? ""}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase())) &&
        (!quantization || endpoint.quantization === quantization)
      );
    })
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return compareProviders(
        a.endpoint as ProviderRow,
        b.endpoint as ProviderRow,
        sort,
        percentile,
      );
    });
  const state = preview?.metadataState ?? "unavailable";
  const freshness =
    state === "unavailable"
      ? { label: t("provider.unavailable"), variant: "danger" as const }
      : state === "stale"
        ? { label: t("provider.stale"), variant: "warning" as const }
        : { label: t("provider.fresh"), variant: "success" as const };
  return (
    <section className="panel provider-preview">
      <div className="panel-title">
        <div>
          <h2>{t("provider.live")}</h2>
          {loading ? (
            <p>{t("provider.evaluating")}</p>
          ) : (
            <>
              <p>
                {t("provider.summaryEligible", {
                  total: preview?.totalEndpoints ?? 0,
                  eligible: preview?.eligibleEndpoints.length ?? 0,
                })}
              </p>
              <p className="summary-excluded">
                {t("provider.summaryExcluded", {
                  count: preview?.excludedEndpoints.length ?? 0,
                })}
              </p>
            </>
          )}
          <span className="freshness">
            <Badge variant={freshness.variant}>{freshness.label}</Badge>
            {preview?.metadataFetchedAt && (
              <small>
                {t("provider.fetched", {
                  date: formatDate(preview.metadataFetchedAt),
                })}
              </small>
            )}
          </span>
          <p className="routing-hint">{t("provider.stickyGuidance")}</p>
        </div>
        {preview?.failureReason && (
          <Badge variant="danger">{preview.failureReason}</Badge>
        )}
      </div>
      <div className="provider-toolbar">
        <input
          aria-label={t("provider.search")}
          placeholder={t("provider.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={t("provider.quantization")}
          value={quantization}
          onChange={(event) => setQuantization(event.target.value)}
        >
          <option value="">{t("provider.allQuantization")}</option>
          {quantizations.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label className="toolbar-select">
          <span>{t("provider.percentile")}</span>
          <select
            aria-label={t("provider.percentile")}
            value={percentile}
            onChange={(event) => setPercentile(event.target.value)}
          >
            {["p50", "p75", "p90", "p99"].map((item) => (
              <option key={item}>{item.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label className="toolbar-select">
          <span>{t("provider.sort")}</span>
          <select
            aria-label={t("provider.sort")}
            value={sort}
            onChange={(event) => setSort(event.target.value as ProviderSort)}
          >
            <option value="default">{t("provider.sortDefault")}</option>
            <option value="provider">{t("provider.sortProvider")}</option>
            <option value="input">{t("provider.sortInput")}</option>
            <option value="output">{t("provider.sortOutput")}</option>
            <option value="latency">{t("provider.sortLatency")}</option>
            <option value="throughput">{t("provider.sortThroughput")}</option>
            <option value="uptime">{t("provider.sortUptime")}</option>
          </select>
        </label>
      </div>
      <div className="table-wrap provider-table-wrap">
        <table className="provider-table">
          <thead>
            <tr>
              <th>{t("provider.provider")}</th>
              <th>{t("provider.routingId")}</th>
              <th className="num">{t("provider.input")}</th>
              <th className="num">{t("provider.output")}</th>
              <th className="num">{t("provider.cacheRead")}</th>
              <th className="num">{t("provider.latency")}</th>
              <th className="num">{t("provider.throughput")}</th>
              <th className="num">{t("provider.uptime")}</th>
              <th>{t("provider.quantization")}</th>
              <th>{t("provider.result")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!preview ? (
              <tr>
                <td colSpan={11}>{t("provider.noData")}</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11}>{t("provider.noMatch")}</td>
              </tr>
            ) : (
              rows.map((item, index) => {
                const endpoint = item.endpoint as ProviderRow;
                const key = `${endpoint.providerRoutingId ?? "unknown"}-${index}`;
                const reasonText = item.reasons
                  .map((reason) => reason.message)
                  .join(" ");
                const open = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr className={item.eligible ? "" : "row-excluded"}>
                      <td>
                        <strong>
                          {endpoint.providerName ?? t("common.unknown")}
                        </strong>
                      </td>
                      <td>
                        <code className="mono">
                          {endpoint.providerRoutingId ??
                            t("common.unavailable")}
                        </code>
                      </td>
                      <td
                        className={
                          /price|prompt/i.test(reasonText)
                            ? "metric-failed num"
                            : "num"
                        }
                      >
                        {formatPrice(pricingValue(endpoint, "prompt"))}
                      </td>
                      <td
                        className={
                          /price|completion/i.test(reasonText)
                            ? "metric-failed num"
                            : "num"
                        }
                      >
                        {formatPrice(pricingValue(endpoint, "completion"))}
                      </td>
                      <td className="num">
                        {formatPrice(
                          pricingValue(endpoint, "input_cache_read") ??
                            pricingValue(endpoint, "cache_read"),
                        )}
                      </td>
                      <td
                        className={
                          /latency/i.test(reasonText)
                            ? "metric-failed num"
                            : "num"
                        }
                      >
                        {formatMetric(
                          metricValue(endpoint, "latency", percentile),
                          "s",
                        )}
                      </td>
                      <td
                        className={
                          /throughput/i.test(reasonText)
                            ? "metric-failed num"
                            : "num"
                        }
                      >
                        {formatMetric(
                          metricValue(endpoint, "throughput", percentile),
                          "t/s",
                        )}
                      </td>
                      <td
                        className={
                          /uptime/i.test(reasonText)
                            ? "metric-failed num"
                            : "num"
                        }
                      >
                        {formatMetric(
                          endpoint.performance?.uptimeLast30m ?? null,
                          "%",
                        )}
                      </td>
                      <td>{display(endpoint.quantization)}</td>
                      <td>
                        <Badge variant={item.eligible ? "success" : "danger"}>
                          {item.eligible
                            ? t("provider.eligible")
                            : t("provider.excluded")}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setExpanded(open ? null : key)}
                          aria-label={`${t("provider.details")} ${endpoint.providerName ?? ""}`}
                        >
                          {open ? "−" : "+"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="provider-detail-row">
                        <td colSpan={11}>
                          <ProviderRowDetail endpoint={endpoint} t={t} />
                        </td>
                      </tr>
                    )}
                    {!open && item.reasons.length > 0 && !item.eligible && (
                      <tr className="provider-reason-row">
                        <td colSpan={11}>
                          <span className="exclusion-reason">
                            ✕ {item.reasons[0].message}
                          </span>
                          {item.reasons.length > 1 && (
                            <small className="reason-count">
                              {t("provider.reasonCount", {
                                count: item.reasons.length,
                              })}
                            </small>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function ProviderRowDetail({
  endpoint,
  t,
}: {
  endpoint: ProviderRow;
  t: Translate;
}) {
  const pricing =
    endpoint.pricing && typeof endpoint.pricing === "object"
      ? Object.keys(endpoint.pricing as Record<string, unknown>)
          .map((key) => `${key}: ${formatPricingField(key, pricingValue(endpoint, key))}`)
          .join(" · ")
      : "—";
  const metrics = ["p50", "p75", "p90", "p99"]
    .map(
      (p) =>
        `${p.toUpperCase()} ${formatMetric(metricValue(endpoint, "latency", p), "s")} / ${formatMetric(metricValue(endpoint, "throughput", p), "t/s")}`,
    )
    .join(" · ");
  return (
    <div className="provider-detail">
      <strong>{t("provider.details")}</strong>
      <span>
        {t("provider.latency")}/{t("provider.throughput")}: {metrics}
      </span>
      <span>
        {t("provider.uptime")}: 5m{" "}
        {formatMetric(endpoint.performance?.uptimeLast5m ?? null, "%")} · 30m{" "}
        {formatMetric(endpoint.performance?.uptimeLast30m ?? null, "%")} · 1d{" "}
        {formatMetric(endpoint.performance?.uptimeLast1d ?? null, "%")}
      </span>
      <span>
        Context: {display(endpoint.contextLength)} · Max prompt:{" "}
        {display(endpoint.maxPromptTokens)} · Max completion:{" "}
        {display(endpoint.maxCompletionTokens)}
      </span>
      <span>Pricing: {pricing}</span>
      <span>
        Quantization: {display(endpoint.quantization)} ·{" "}
        {endpoint.supportsImplicitCaching ? "Implicit caching" : ""} ·{" "}
        {endpoint.supportedParameters?.join(", ") || "—"}
      </span>
    </div>
  );
}
