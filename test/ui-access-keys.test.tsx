// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("managed access key UI", () => {
  it("creates a Local Access Key and shows its secret once", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input); const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
      else if (url.endsWith("/models")) body = { items: [{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek", contextLength: 128000, pricing: {}, policySummary: "inherit" }], total: 1 };
      else if (url.endsWith("/desired-models")) body = { items: [{ modelId: "deepseek/deepseek-v4-flash", enabled: true, assignedApiCount: 0 }] };
      else if (url.endsWith("/access-keys") && method === "GET") body = { items: [] };
      else if (url.endsWith("/access-keys") && method === "POST") body = { id: "key_1", name: "Codex", secret: "sift_sk_once_only_1234", keyPrefix: "sift_sk_", keyLast4: "1234", enabled: true, allowedModels: ["deepseek/deepseek-v4-flash"], lastUsedAt: null };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    render(<App />);
    fireEvent.click(await screen.findByText("API Keys"));
    fireEvent.click(await screen.findByText("Create"));
    fireEvent.change(screen.getByPlaceholderText("Codex"), { target: { value: "Codex" } });
    fireEvent.click(screen.getByLabelText("deepseek/deepseek-v4-flash"));
    fireEvent.click(screen.getByText("Create key"));
    expect(await screen.findByText("sift_sk_once_only_1234")).toBeTruthy();
    expect(screen.getByText(/It will not be shown again/)).toBeTruthy();
    expect(JSON.parse(calls.find((call) => call.method === "POST")?.body ?? "{}").allowedModels).toEqual(["deepseek/deepseek-v4-flash"]);
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByText("sift_sk_once_only_1234")).toBeNull();
  });
});
