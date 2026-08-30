// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesiredModelDetail } from "../ui/src/DesiredModelDetail";

const mocks = vi.hoisted(() => ({
  endpoints: vi.fn(),
  desiredFilter: vi.fn(),
  previewDesiredFilter: vi.fn(),
}));

vi.mock("../ui/src/api", () => ({ api: mocks }));

describe("Desired Model provider result styling", () => {
  afterEach(() => cleanup());
  it("keeps excluded providers visible but visually muted with highlighted reasons", async () => {
    mocks.endpoints.mockResolvedValue({ items: [] });
    mocks.desiredFilter.mockResolvedValue({ filter: { enabled: true, mode: "all", conditions: [], maxTelemetryAgeMs: 1_800_000 } });
    mocks.previewDesiredFilter.mockResolvedValue({
      totalEndpoints: 2,
      eligibleEndpoints: [{ endpoint: { providerName: "Eligible Cloud", providerRoutingId: "eligible" }, eligible: true, reasons: [] }],
      excludedEndpoints: [{ endpoint: { providerName: "Excluded Cloud", providerRoutingId: "excluded" }, eligible: false, reasons: [{ code: "PRICE", message: "Input price $0.23/M > $0.20/M" }] }],
      eligibleRoutingIds: ["eligible"],
      metadataFetchedAt: "2026-08-29T00:00:00.000Z",
      metadataState: "fresh",
      usable: true,
    });

    render(<DesiredModelDetail modelId="demo/model" models={[{ id: "demo/model", name: "Demo Model" }]} onBack={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />);
    await screen.findByText("Eligible Cloud");
    const badge = await screen.findByText("Excluded");
    const row = badge.closest("tr");
    const reason = screen.getByText("✕ Input price $0.23/M > $0.20/M");
    expect(row?.className).toContain("row-excluded");
    expect(badge.className).toContain("badge-danger");
    expect(reason.className).toContain("exclusion-reason");
    await waitFor(() => expect(mocks.previewDesiredFilter).toHaveBeenCalled());
  });

  it("keeps an intermediate numeric draft and canonicalizes it after completion", async () => {
    mocks.endpoints.mockResolvedValue({ items: [] });
    mocks.desiredFilter.mockResolvedValue({ filter: { enabled: true, mode: "all", conditions: [], maxTelemetryAgeMs: 1_800_000 } });
    mocks.previewDesiredFilter.mockResolvedValue({ totalEndpoints: 0, eligibleEndpoints: [], excludedEndpoints: [], eligibleRoutingIds: [], metadataFetchedAt: null, metadataState: "fresh", usable: true });

    render(<DesiredModelDetail modelId="demo/model" models={[{ id: "demo/model", name: "Demo Model" }]} onBack={vi.fn()} setNotice={vi.fn()} setError={vi.fn()} />);
    fireEvent.click(await screen.findByText(/Add condition/));
    const input = screen.getByLabelText("Filter value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0." } });
    expect(input.value).toBe("0.");
    fireEvent.change(input, { target: { value: "0.01" } });
    expect(input.value).toBe("0.01");
    await waitFor(() => expect(mocks.previewDesiredFilter).toHaveBeenCalledWith("demo/model", expect.objectContaining({ conditions: [expect.objectContaining({ value: 0.01 })] })));
  });
});
