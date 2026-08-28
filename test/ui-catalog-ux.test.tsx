// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;

type Call = { url: string; method: string };

const endpointItem = { providerName: "Relace", providerRoutingId: "relace", pricing: { prompt: "0.000001", completion: "0.000002" }, quantization: null, status: null, performance: { latencyLast30m: null, throughputLast30m: null, uptimeLast5m: null, uptimeLast30m: null, uptimeLast1d: null } };

function catalogItem(id: string, name: string) {
  return { id, name, creator: id.split("/")[0], description: "Demo model", contextLength: 128000, pricing: { prompt: "0.000001", completion: "0.000002" }, policySummary: "inherit" };
}

function install(options: { count?: number; endpointStatus?: number } = {}) {
  const calls: Call[] = [];
  let endpointStatus = options.endpointStatus ?? 200;
  const count = options.count ?? 1;
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    let body: unknown = {};
    if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
    else if (url.includes("/desired-models")) body = { items: [] };
    else if (url.endsWith("/models/refresh")) body = {};
    else if (url.endsWith("/models") || url.startsWith("/api/models?")) {
      body = { items: count === 1 ? [catalogItem("openai/gpt-demo", "GPT Demo")] : Array.from({ length: count }, (_, index) => catalogItem(`demo/model-${String(index + 1).padStart(3, "0")}`, `Model ${index + 1}`)), total: count };
    } else if (url.endsWith("/endpoints/refresh")) body = {};
    else if (url.endsWith("/endpoints")) {
      if (endpointStatus !== 200) return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: endpointStatus, headers: { "content-type": "application/json" } });
      body = { items: [endpointItem] };
    } else if (url.startsWith("/api/models/")) {
      const id = decodeURIComponent(url.slice("/api/models/".length));
      body = { model: catalogItem(id, count === 1 ? "GPT Demo" : `Model ${id.split("-")[1]}`), policy: { mode: "inherit" } };
    } else if (url.endsWith("/policies/preview")) body = { openRouterProviderPayload: { allow_fallbacks: true } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, setEndpointStatus: (status: number) => { endpointStatus = status; } };
}

const endpointCalls = (calls: Call[]) => calls.filter((call) => call.url.endsWith("/endpoints") && call.method === "GET");
const inputValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const selectValue = (label: string) => (screen.getByLabelText(label) as HTMLSelectElement).value;

beforeEach(() => { window.history.replaceState(null, "", "/ui/models"); });
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

describe("G9.1 catalog UX closure", () => {
  it("lazy-fetches provider endpoints only from the Providers tab and reuses them", async () => {
    const { calls } = install();
    render(<App />);
    await screen.findByText("GPT Demo");
    const count = () => endpointCalls(calls).length;
    expect(count()).toBe(0); // catalog open → 0 endpoint calls
    fireEvent.click(screen.getByText("GPT Demo"));
    await screen.findByText("Demo model"); // Overview loaded
    expect(count()).toBe(0); // Overview → 0
    fireEvent.click(screen.getByRole("tab", { name: "Capabilities" }));
    expect(await screen.findByText("Capability metadata is unavailable for this model.")).toBeTruthy();
    expect(count()).toBe(0); // Capabilities → 0
    fireEvent.click(screen.getByRole("tab", { name: "Providers" }));
    await screen.findByText("Relace");
    expect(count()).toBe(1); // Providers → exactly 1
    expect(endpointCalls(calls).every((call) => call.url.includes("openai%2Fgpt-demo"))).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("Demo model")).toBeTruthy();
    expect(screen.queryByText("Refresh Providers")).toBeNull(); // hidden off-tab
    fireEvent.click(screen.getByRole("tab", { name: "Providers" }));
    expect(await screen.findByText("Relace")).toBeTruthy();
    expect(count()).toBe(1); // reopen reuses cached data, no refetch
    expect(screen.getByText("Refresh Providers")).toBeTruthy(); // shown after first load
    fireEvent.click(screen.getByText("Refresh Providers"));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/endpoints/refresh") && call.method === "POST")).toBe(true));
    await waitFor(() => expect(count()).toBe(2)); // refresh increments for current model only
    expect(endpointCalls(calls).every((call) => call.url.includes("openai%2Fgpt-demo"))).toBe(true);
  });

  it("keeps Overview and Capabilities alive when provider endpoints fail, and supports retry", async () => {
    const { setEndpointStatus } = install({ endpointStatus: 500 });
    render(<App />);
    fireEvent.click(await screen.findByText("GPT Demo"));
    fireEvent.click(await screen.findByRole("tab", { name: "Providers" }));
    expect(await screen.findByText("Failed to load provider endpoints.")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("Demo model")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Capabilities" }));
    expect(screen.getByText("Capability metadata is unavailable for this model.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Providers" }));
    expect(await screen.findByText("Failed to load provider endpoints.")).toBeTruthy();
    setEndpointStatus(200);
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("Relace")).toBeTruthy();
  });

  it("parses catalog state from URL query params", async () => {
    install({ count: 120 });
    window.history.replaceState(null, "", "/ui/models?q=model-0&sort=input&page=2");
    render(<App />);
    await screen.findByText(/page 2 of/);
    expect(inputValue("Search models")).toBe("model-0");
    expect(selectValue("Sort models")).toBe("input");
  });

  it("writes catalog state to the URL without reloading and resets page on filter change", async () => {
    install({ count: 120 });
    render(<App />);
    await screen.findByText("Model 1");
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "model" } });
    await waitFor(() => expect(window.location.search).toContain("q=model"));
    expect(window.location.search).toContain("page=1");
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(window.location.search).toContain("page=2"));
    fireEvent.change(screen.getByLabelText("Sort models"), { target: { value: "az" } });
    await waitFor(() => expect(window.location.search).toContain("sort=az"));
    expect(window.location.search).toContain("page=1"); // sort change resets page
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(window.location.search).toContain("page=2"));
    fireEvent.click(screen.getByLabelText("Free only"));
    await waitFor(() => expect(window.location.search).toContain("free=1"));
    expect(window.location.search).toContain("page=1"); // filter change resets page
  });

  it("falls back safely on invalid URL values", async () => {
    install();
    window.history.replaceState(null, "", "/ui/models?page=-1&context=abc&sort=banana&free=hello");
    render(<App />);
    await screen.findByText("GPT Demo");
    expect(inputValue("Search models")).toBe("");
    expect(selectValue("Context length")).toBe("0");
    expect(selectValue("Sort models")).toBe("default");
    expect((screen.getByLabelText("Free only") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/page 1 of 1/)).toBeTruthy();
  });

  it("restores catalog state on back and forward navigation", async () => {
    install();
    render(<App />);
    await screen.findByText("GPT Demo");
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "nomatch" } });
    await waitFor(() => expect(window.location.search).toContain("q=nomatch"));
    expect(screen.queryByText("GPT Demo")).toBeNull();
    window.history.back();
    await waitFor(() => expect(inputValue("Search models")).toBe(""));
    expect(screen.getByText("GPT Demo")).toBeTruthy();
    window.history.forward();
    await waitFor(() => expect(inputValue("Search models")).toBe("nomatch"));
  });

  it("keeps the initial catalog free of endpoint calls (N+1 regression)", async () => {
    const { calls } = install({ count: 120 });
    render(<App />);
    await screen.findByText("Model 1");
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "model" } });
    fireEvent.change(screen.getByLabelText("Sort models"), { target: { value: "context" } });
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(window.location.search).toContain("page=2"));
    expect(endpointCalls(calls)).toHaveLength(0);
    expect(calls.filter((call) => call.url.startsWith("/api/models?")).length).toBeLessThanOrEqual(1);
  });
});
