/** Pure freshness predicate used by both preview and inference enforcement. */
export function isTelemetryFresh(
  fetchedAt: string | null | undefined,
  maxTelemetryAgeMs: number,
  nowMs = Date.now(),
): boolean {
  if (!fetchedAt || !Number.isFinite(maxTelemetryAgeMs) || maxTelemetryAgeMs < 0) return false;
  const timestamp = Date.parse(fetchedAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = nowMs - timestamp;
  return age >= 0 && age <= maxTelemetryAgeMs;
}

export function telemetryAgeMs(fetchedAt: string | null | undefined, nowMs = Date.now()): number | null {
  if (!fetchedAt) return null;
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp) ? Math.max(0, nowMs - timestamp) : null;
}
