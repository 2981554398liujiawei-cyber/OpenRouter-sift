/**
 * Numeric form fields keep the user's edit string until a complete value is
 * needed. This preserves useful intermediate states such as `0.` and `-0.`.
 */
export function parseNumericDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "-" || trimmed === "-." || trimmed.endsWith(".")) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function numericDraftIsPlausible(value: string): boolean {
  return /^-?(?:\d+(?:\.\d*)?|\.\d*)?$/.test(value);
}

export function canonicalNumber(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parseNumericDraft(value);
}
