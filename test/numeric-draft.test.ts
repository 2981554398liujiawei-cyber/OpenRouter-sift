import { describe, expect, it } from "vitest";
import { canonicalNumber, numericDraftIsPlausible, parseNumericDraft } from "../ui/src/numericDraft";

describe("numeric draft parsing", () => {
  it("preserves intermediate editor states without treating them as numbers", () => {
    for (const draft of ["", ".", "-", "-.", "0."]) {
      expect(numericDraftIsPlausible(draft)).toBe(true);
      expect(parseNumericDraft(draft)).toBeNull();
    }
  });

  it("accepts precise decimal values and rejects non-finite drafts", () => {
    expect(parseNumericDraft("0.01")).toBe(0.01);
    expect(parseNumericDraft("0.001")).toBe(0.001);
    expect(parseNumericDraft("10")).toBe(10);
    expect(parseNumericDraft("1e309")).toBeNull();
    expect(numericDraftIsPlausible("1e309")).toBe(false);
    expect(canonicalNumber(" 1.25 ")).toBe(1.25);
    expect(canonicalNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
