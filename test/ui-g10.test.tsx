// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;

const endpointItem = { providerName: "Relace", providerRoutingId: "relace", pricing: { prompt: "0.000001", completion: "0.000002" }, quantization: null, status: null, performance: { latencyLast30m: null, throughputLast30m: null, uptimeLast5m: null, uptimeLast30m: null, uptimeLast1d: null } };

type Handler = (url: string, method: string, body: string | undefined) => unknown | undefined;

function install(handler?: Handler) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body: rawBody });
    const handled = handler?.(url, method, rawBody);
    const responseBody = handled !== undefined ? handled : {};
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const baseFixtures: Handler = (url, method) => {
  if (url.endsWith("/status")) return { proxy: { running: true }, openrouter: { configured: true } };
  if (url.endsWith("/models") || url.startsWith("/api/models?")) return { items: [{ id: "deepseek/demo", name: "DeepSeek Demo", creator: "deepseek", description: "Demo model", contextLength: 128000, pricing: { prompt: "0.000001", completion: "0.000002" }, policySummary: "inherit" }], total: 1 };
  if (url.includes("/desired-models")) return { items: [] };
  if (url.endsWith("/access-keys") && method === "GET") return { items: [] };
  if (url.includes("/requests")) return { items: [], total: 0 };
  if (url.endsWith("/settings")) return { openRouterApiKeyConfigured: true, openRouterApiKeyMasked: "sk-••••abcd", mergeMode: "merge", globalPolicy: {}, metadataTtlMs: 300000, requestLogLimit: 1000, desiredEndpointRefreshIntervalMs: 60000 };
  if (url.endsWith("/policies")) return { items: [] };
  if (url.endsWith("/endpoints")) return { items: [endpointItem] };
  if (url.startsWith("/api/models/")) return { model: { id: "deepseek/demo", name: "DeepSeek Demo", contextLength: 128000, pricing: {} }, policy: { mode: "inherit" } };
  if (url.endsWith("/policies/preview")) return { openRouterProviderPayload: { allow_fallbacks: true } };
  return {};
};

const navButton = (name: string) => screen.getByRole("button", { name });
const heading = (name: string) => screen.getByRole("heading", { name });

beforeEach(() => { window.history.replaceState(null, "", "/"); });
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("G10 navigation and information architecture", () => {
  it("exposes exactly five primary sections with correct active state", async () => {
    install(baseFixtures);
    render(<App />);
    expect(document.querySelectorAll(".sidebar-nav button")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Policies" })).toBeNull();
    expect((document.querySelector(".sidebar-nav .nav-active") as HTMLElement).textContent).toBe("All Models");
    for (const [label, title] of [["Desired Models", "Desired Models"], ["API Keys", "API Keys"], ["Requests", "Requests"], ["Settings", "Settings"]] as const) {
      fireEvent.click(navButton(label));
      expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
      expect((document.querySelector(".sidebar-nav .nav-active") as HTMLElement).textContent).toBe(label);
    }
    fireEvent.click(navButton("All Models"));
    expect(await screen.findByRole("heading", { name: "All Models" })).toBeTruthy();
  });

  it("shows actionable empty states for Desired Models, API Keys and Requests", async () => {
    install(baseFixtures);
    render(<App />);
    fireEvent.click(navButton("Desired Models"));
    expect(await screen.findByText("No Desired Models")).toBeTruthy();
    fireEvent.click(screen.getByText("Browse All Models"));
    expect(await screen.findByRole("heading", { name: "All Models" })).toBeTruthy();
    fireEvent.click(navButton("API Keys"));
    expect(await screen.findByText("No API Keys")).toBeTruthy();
    expect(screen.getAllByText("Create API Key").length).toBeGreaterThan(0);
    fireEvent.click(navButton("Requests"));
    expect(await screen.findByText("No requests yet")).toBeTruthy();
  });

  it("covers the Desired flow: catalog → add → list → detail with Provider Filters", async () => {
    let desired = false;
    install((url, method) => {
      if (url === "/api/desired-models/deepseek%2Fdemo" && method === "POST") { desired = true; return { modelId: "deepseek/demo", enabled: true, assignedApiCount: 0 }; }
      if (url.includes("/desired-models") && method === "GET") return { items: desired ? [{ modelId: "deepseek/demo", enabled: true, assignedApiCount: 0 }] : [] };
      if (url.includes("/desired-models/deepseek%2Fdemo/filter") && method === "GET") return null;
      return baseFixtures(url, method);
    });
    render(<App />);
    await screen.findByText("DeepSeek Demo");
    fireEvent.click(screen.getByText("Add to Desired"));
    await waitFor(() => expect(desired).toBe(true));
    fireEvent.click(navButton("Desired Models"));
    expect(await screen.findByText("Available")).toBeTruthy();
    expect(screen.getByText("No filter")).toBeTruthy();
    fireEvent.click(screen.getByText("DeepSeek Demo"));
    expect(await screen.findByRole("heading", { name: "Provider Filters" })).toBeTruthy();
    expect(screen.getByText("+ Add condition")).toBeTruthy();
    expect(screen.getByText("Save Filter")).toBeTruthy();
  });

  it("covers the API key flow: list → Provider Access with summary and save", async () => {
    const calls = install((url, method) => {
      if (url.endsWith("/access-keys") && method === "GET") return { items: [{ id: "key_1", name: "Codex", keyPrefix: "sift_sk_", keyLast4: "82QF", enabled: true, allowedModels: ["deepseek/demo"], lastUsedAt: null }] };
      if (url.endsWith("/access-keys/key_1/models/deepseek%2Fdemo/override") && method === "GET") return { models: ["deepseek/demo"], providers: [{ providerRoutingId: "relace", providerName: "Relace", available: true }, { providerRoutingId: "coreweave", providerName: "CoreWeave", available: true }], mode: "inherit", allowFallbacks: true };
      if (url.endsWith("/access-keys/key_1/models/deepseek%2Fdemo/override") && method === "PUT") return { id: "key_1" };
      return baseFixtures(url, method);
    });
    render(<App />);
    fireEvent.click(navButton("API Keys"));
    expect(await screen.findByText("sift_sk_••••82QF")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Provider Access" }));
    expect(await screen.findByRole("heading", { name: "Provider Access" })).toBeTruthy();
    expect(screen.getByText(/Desired Model currently allows/)).toBeTruthy();
    expect(screen.getAllByText("2 providers")).toHaveLength(2);
    fireEvent.click(screen.getByText("Allow selected"));
    fireEvent.click(screen.getByText("Relace"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/access-keys/key_1/models/deepseek%2Fdemo/override") && call.method === "PUT")).toBe(true));
  });

  it("renders a failed routing request with code, explanation and structured sections", async () => {
    install((url, method) => {
      if (url.includes("/requests/req_fail") && method === "GET") return {
        id: "req_fail", startedAt: "2026-08-27T10:00:00Z", completedAt: "2026-08-27T10:00:01Z", protocol: "chat_completions", model: "deepseek/demo", requestedModel: "deepseek/demo", forwardedModel: null, provider: null, actualProviderName: null, status: 403, durationMs: 90, promptTokens: null, completionTokens: null, totalTokens: null, costUsd: null, enrichmentStatus: "success", streamed: false, clientCancelled: false, generationId: null, effectiveProviderPolicy: null, openRouterLatencyMs: null, generationTimeMs: null, finishReason: null, isByok: false, router: null, serviceTier: null,
        error: { code: "NO_ELIGIBLE_PROVIDER", message: "no endpoint satisfied the constraints" },
        managedRoutingTrace: { hardFilter: ["relace", "coreweave"], accessKeyOverride: null, modelPolicy: null, incoming: [], final: [] },
      };
      if (url.includes("/requests")) return { items: [{ id: "req_fail", startedAt: "2026-08-27T10:00:00Z", protocol: "chat_completions", model: "deepseek/demo", provider: null, status: 403, durationMs: 90, promptTokens: null, completionTokens: null, costUsd: null, enrichmentStatus: "success", accessKeyName: "Codex" }], total: 1 };
      return baseFixtures(url, method);
    });
    render(<App />);
    fireEvent.click(navButton("Requests"));
    expect(await screen.findByText("403")).toBeTruthy();
    fireEvent.click(screen.getByText("deepseek/demo"));
    expect(await screen.findByText("Routing Decision")).toBeTruthy();
    expect(screen.getByText("NO_ELIGIBLE_PROVIDER")).toBeTruthy();
    expect(screen.getByText("No provider passed the Desired Model filters and routing policy for this request.")).toBeTruthy();
    expect(screen.getByText("Desired Model")).toBeTruthy();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Usage")).toBeTruthy();
  });

  it("sends human-entered seconds as milliseconds and merge mode in the settings payload", async () => {
    const calls = install((url) => {
      if (url.endsWith("/settings")) return { openRouterApiKeyConfigured: true, openRouterApiKeyMasked: "sk-••••abcd", mergeMode: "merge", globalPolicy: {}, metadataTtlMs: 300000, requestLogLimit: 1000, desiredEndpointRefreshIntervalMs: 60000 };
      return baseFixtures(url, "GET");
    });
    render(<App />);
    fireEvent.click(navButton("Settings"));
    expect(await screen.findByText(/sk-••••abcd/)).toBeTruthy();
    expect(screen.getByDisplayValue("300")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Models catalog TTL"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Request history limit"), { target: { value: "2000" } });
    fireEvent.click(screen.getByText("Override"));
    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() => {
      const put = calls.find((call) => call.url.endsWith("/settings") && call.method === "PUT");
      expect(put).toBeTruthy();
      const payload = JSON.parse(put?.body ?? "{}");
      expect(payload.metadataTtlMs).toBe(120000);
      expect(payload.desiredEndpointRefreshIntervalMs).toBe(60000);
      expect(payload.requestLogLimit).toBe(2000);
      expect(payload.mergeMode).toBe("override");
    });
  });

  it("keeps model detail breadcrumbs and the Providers lazy-fetch flow intact", async () => {
    install(baseFixtures);
    render(<App />);
    await screen.findByText("DeepSeek Demo");
    fireEvent.click(screen.getByText("DeepSeek Demo"));
    expect(await screen.findByText("Add to Desired")).toBeTruthy();
    expect(screen.getAllByText("DeepSeek Demo").length).toBeGreaterThanOrEqual(2); // breadcrumb + heading
    fireEvent.click(screen.getByRole("tab", { name: "Providers" }));
    expect(await screen.findByText("Relace")).toBeTruthy();
    expect(screen.getByText("Refresh Providers")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.queryByText("Refresh Providers")).toBeNull();
  });
});
