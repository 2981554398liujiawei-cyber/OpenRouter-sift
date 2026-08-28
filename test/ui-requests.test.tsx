// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("Requests UI", () => {
  it("lists pending metadata, filters, opens a detail without content, and clears with confirmation", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
      else if (url.endsWith("/models")) body = { items: [], total: 0 };
      else if (url.includes("/requests/") && !url.endsWith("/requests/")) body = {
        id: "req_demo", startedAt: "2026-08-27T10:00:00Z", completedAt: "2026-08-27T10:00:01Z", protocol: "responses", model: "openai/gpt-demo", requestedModel: "openai/gpt-demo", forwardedModel: "openai/gpt-demo", provider: "Relace", actualProviderName: "Relace", status: 200, durationMs: 840, promptTokens: 8200, completionTokens: 1400, totalTokens: 9600, costUsd: 0.00421, enrichmentStatus: "success", streamed: true, clientCancelled: false, generationId: "gen_demo", effectiveProviderPolicy: { only: ["relace"], allow_fallbacks: false }, openRouterLatencyMs: 120, generationTimeMs: 700, finishReason: "stop", isByok: false, router: null, serviceTier: null, error: null,
      };
      else if (url.includes("/requests")) body = { items: [{ id: "req_demo", startedAt: "2026-08-27T10:00:00Z", protocol: "responses", model: "openai/gpt-demo", provider: null, status: 200, durationMs: 4812, promptTokens: 8200, completionTokens: 1400, costUsd: 0.00421, enrichmentStatus: "pending" }], total: 1 };
      else if (url.endsWith("/settings")) body = { openRouterApiKeyConfigured: false, openRouterApiKeyMasked: null, mergeMode: "merge", globalPolicy: {}, metadataTtlMs: 300000, requestLogLimit: 1000 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Requests" }));
    expect(await screen.findByText("Resolving…")).toBeTruthy();
    expect(screen.getByText("4.8 s")).toBeTruthy();
    expect(screen.getByText("8.2K → 1.4K")).toBeTruthy();
    expect(screen.getByText("$0.00421")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search model"), { target: { value: "gpt-demo" } });
    await waitFor(() => expect(calls.join("\n")).toContain("model=gpt-demo"));
    fireEvent.click(screen.getByText("openai/gpt-demo"));
    expect(await screen.findByText("Routing Decision")).toBeTruthy();
    expect(screen.queryByText("SUPER_SECRET_PROMPT_12345")).toBeNull();
    fireEvent.click(screen.getByText("Close"));
    fireEvent.click(screen.getByText("Clear history"));
    await waitFor(() => expect(calls.some((call) => call === "DELETE /api/requests")).toBe(true));
  });
});
