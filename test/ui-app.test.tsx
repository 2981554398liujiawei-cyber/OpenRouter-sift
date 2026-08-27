// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

describe("provider control UI", () => {
  it("saves an allowlist using the server preview and reset workflow", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
      else if (url.startsWith("/api/models?" ) || url.endsWith("/api/models")) body = { items: [{ id: "openai/gpt-demo", name: "GPT Demo", contextLength: 128000, pricing: { prompt: "0.000001", completion: "0.000002" }, policySummary: "inherit" }] };
      else if (url.endsWith("/api/models/openai%2Fgpt-demo")) body = { model: { id: "openai/gpt-demo", name: "GPT Demo", contextLength: 128000, pricing: {} }, policy: { mode: "inherit" } };
      else if (url.endsWith("/endpoints")) body = { items: [{ providerName: "Relace", providerRoutingId: "relace", pricing: {}, quantization: null, status: null, performance: { latencyLast30m: null, throughputLast30m: null, uptimeLast5m: null, uptimeLast30m: null, uptimeLast1d: null } }] };
      else if (url.endsWith("/policies/preview")) body = { openRouterProviderPayload: { only: ["relace"], allow_fallbacks: true } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    render(<App />);
    await screen.findByText("GPT Demo");
    fireEvent.click(screen.getByText("GPT Demo"));
    await screen.findByText("Provider endpoints");
    fireEvent.click(screen.getByLabelText("Allowlist"));
    fireEvent.click(screen.getByLabelText("Relace"));
    await screen.findByText("Policy preview");
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/policies/preview") && call.method === "POST")).toBe(true));
    fireEvent.click(screen.getByText("Save policy"));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/policies/openai%2Fgpt-demo") && call.method === "PUT")).toBe(true));
    fireEvent.click(screen.getByText("Reset to inherit"));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/policies/openai%2Fgpt-demo") && call.method === "DELETE")).toBe(true));
  });
});
