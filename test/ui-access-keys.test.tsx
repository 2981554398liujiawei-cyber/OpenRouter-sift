// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("managed access key UI", () => {
  it("creates a Local Access Key and shows its secret once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let createdRecord: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input); const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
      else if (url.endsWith("/models")) body = { items: [{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek", contextLength: 128000, pricing: {}, policySummary: "inherit" }], total: 1 };
      else if (url.endsWith("/desired-models")) body = { items: [{ modelId: "deepseek/deepseek-v4-flash", enabled: true, assignedApiCount: 0 }] };
      else if (url.endsWith("/access-keys") && method === "GET") body = { items: createdRecord ? [createdRecord] : [] };
      else if (url.endsWith("/access-keys") && method === "POST") {
        createdRecord = { id: "key_1", name: "Codex", keyPrefix: "sift_sk_", keyLast4: "1234", enabled: true, allowedModels: ["deepseek/deepseek-v4-flash"], lastUsedAt: null };
        body = { ...createdRecord, secret: "sift_sk_once_only_1234" };
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    render(<App />);
    fireEvent.click(await screen.findByText("API Keys"));
    fireEvent.click(screen.getAllByText("Create API Key")[0]);
    expect(document.querySelector(".sift-modal-backdrop")).toBeTruthy();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Codex"), { target: { value: "Codex" } });
    fireEvent.click(screen.getByLabelText("deepseek/deepseek-v4-flash"));
    fireEvent.click(screen.getByText("Create key"));
    expect(await screen.findByText("sift_sk_once_only_1234")).toBeTruthy();
    expect(screen.getByText(/won't be shown again/)).toBeTruthy();
    expect(JSON.parse(calls.find((call) => call.method === "POST")?.body ?? "{}").allowedModels).toEqual(["deepseek/deepseek-v4-flash"]);
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByText("sift_sk_once_only_1234")).toBeNull();
    fireEvent.click(await screen.findByText("Copy API key"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sift_sk_once_only_1234"));
  });

  it("explains required fields and keeps creation single-flight", async () => {
    let postCount = 0;
    let resolvePost: ((response: Response) => void) | undefined;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input); const method = init?.method ?? "GET";
      if (url.endsWith("/status")) return new Response(JSON.stringify({ proxy: { running: true }, openrouter: { configured: true } }), { status: 200 });
      if (url.endsWith("/models")) return new Response(JSON.stringify({ items: [{ id: "demo/model", name: "Demo", contextLength: 100, pricing: {}, policySummary: "inherit" }], total: 1 }), { status: 200 });
      if (url.endsWith("/desired-models")) return new Response(JSON.stringify({ items: [{ modelId: "demo/model", enabled: true, assignedApiCount: 0 }] }), { status: 200 });
      if (url.endsWith("/access-keys") && method === "GET") return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.endsWith("/access-keys") && method === "POST") {
        postCount += 1;
        return new Promise<Response>((resolve) => { resolvePost = resolve; });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    render(<App />);
    fireEvent.click(await screen.findByText("API Keys"));
    fireEvent.click(screen.getAllByText("Create API Key")[0]);
    expect(screen.getByText("Name is required.")).toBeTruthy();
    expect(screen.getByText("Select at least one desired model.", { exact: false })).toBeTruthy();
    expect((screen.getByText("Create key") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Codex"), { target: { value: "Codex" } });
    fireEvent.click(screen.getByLabelText("demo/model"));
    const createButton = screen.getByText("Create key");
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    await waitFor(() => expect(postCount).toBe(1));
    expect(screen.getByText("Creating…")).toBeTruthy();
    resolvePost?.(new Response(JSON.stringify({ id: "key_1", name: "Codex", secret: "sift_sk_once_only_1234", keyPrefix: "sift_sk_", keyLast4: "1234", enabled: true, allowedModels: ["demo/model"], lastUsedAt: null }), { status: 200 }));
    expect(await screen.findByText("sift_sk_once_only_1234")).toBeTruthy();
  });
});
