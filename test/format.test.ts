import { describe, expect, it } from "vitest";
import { percent, perMillion } from "../ui/src/format";

describe("real-catalog formatting regressions", () => {
  it("renders OpenRouter's -1 no-fixed-price sentinel as unavailable, not a negative amount", () => {
    expect(perMillion({ prompt: "-1", completion: "-1" }, "prompt")).toBe("—");
    expect(perMillion({ prompt: "-1", completion: "-1" }, "completion")).toBe("—");
    expect(perMillion({ prompt: "0.000000834", completion: "0.000002501" }, "prompt")).toContain("$0.834");
  });

  it("rounds uptime percentages coming from real endpoint telemetry", () => {
    expect(percent(98.82767009135375)).toBe("98.83%");
    expect(percent(null)).toBe("—");
  });
});
