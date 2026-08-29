// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

afterEach(() => { vi.restoreAllMocks(); });

describe("Desired Model provider filters UI", () => {
  it("opens a model, edits a condition, previews eligibility, saves and deletes", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: false } };
      else if (url.endsWith("/models")) body = { items: [{ id: "deepseek/demo", name: "DeepSeek Demo", contextLength: 8192, pricing: {}, policySummary: "inherit" }], total: 1 };
      else if (url.endsWith("/desired-models")) body = { items: [{ modelId: "deepseek/demo", enabled: true }] };
      else if (url.endsWith("/endpoints")) body = { items: [{ providerName: "Relace", providerRoutingId: "relace", pricing: { prompt: "0.0000002" }, performance: { latencyLast30m: { p90: 1.2 }, throughputLast30m: { p50: 63 }, uptimeLast5m: 99.8 } }] };
      // Real control-API contract (ProviderFilterResult), not a UI-shaped guess.
      else if (url.endsWith("/filter")) body = { filter: { enabled: true, mode: "all", conditions: [], maxTelemetryAgeMs: 1800000, updatedAt: new Date().toISOString() }, preview: { modelId: "deepseek/demo", totalEndpoints: 1, eligibleEndpoints: [{ endpoint: { providerName: "Relace", providerRoutingId: "relace" }, eligible: true, reasons: [] }], excludedEndpoints: [], eligibleRoutingIds: ["relace"], metadataFetchedAt: new Date().toISOString(), metadataState: "fresh", usable: true, failureReason: null } };
      else if (url.includes("/filter/preview")) body = { modelId: "deepseek/demo", totalEndpoints: 1, eligibleEndpoints: [{ endpoint: { providerName: "Relace", providerRoutingId: "relace" }, eligible: true, reasons: [] }], excludedEndpoints: [], eligibleRoutingIds: ["relace"], evaluatedAt: new Date().toISOString(), metadataFetchedAt: new Date().toISOString(), metadataState: "fresh", usable: true, failureReason: null };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    fireEvent.click(await screen.findByText("Desired Models"));
    fireEvent.click(await screen.findByText("DeepSeek Demo"));
    expect(await screen.findByText("Provider Filters")).toBeTruthy();
    fireEvent.click(screen.getByText("+ Add condition"));
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "40" } });
    expect(await screen.findByText("1 endpoints → 1 eligible")).toBeTruthy();
    fireEvent.click(screen.getByText("Save Filter"));
    await waitFor(() => expect(calls.some((call) => call === "PUT /api/desired-models/deepseek%2Fdemo/filter")).toBe(true));
    fireEvent.click(screen.getByText("Delete filter"));
    await waitFor(() => expect(calls.some((call) => call === "DELETE /api/desired-models/deepseek%2Fdemo/filter")).toBe(true));
  });
});
