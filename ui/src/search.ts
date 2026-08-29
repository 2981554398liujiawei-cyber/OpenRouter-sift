import type { ModelSummary } from "./types";

type SearchField = { value: string; exact: number; startsWith: number; contains: number };

const normalize = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();

function fieldScore(field: SearchField, token: string): number {
  if (!field.value) return 0;
  if (field.value === token) return field.exact;
  if (field.value.startsWith(token)) return field.startsWith;
  if (field.value.includes(token)) return field.contains;
  return 0;
}

/** Returns null when at least one query token has no searchable-field match. */
export function modelRelevance(model: ModelSummary, query: string): number | null {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const fields: SearchField[] = [
    { value: normalize(model.name), exact: 1000, startsWith: 900, contains: 800 },
    { value: normalize(model.id), exact: 760, startsWith: 720, contains: 680 },
    { value: normalize(model.creator), exact: 620, startsWith: 580, contains: 540 },
    { value: normalize(model.description), exact: 100, startsWith: 100, contains: 100 },
  ];
  let total = 0;
  for (const token of tokens) {
    const best = Math.max(...fields.map((field) => fieldScore(field, token)));
    if (best === 0) return null;
    total += best;
  }
  return total;
}
