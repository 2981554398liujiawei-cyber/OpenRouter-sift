// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;

afterEach(() => { cleanup(); globalThis.fetch = originalFetch; vi.restoreAllMocks(); window.localStorage.clear(); });

describe("G12 control-key unlock flow", () => {
  it("shows the unlock screen on 401 and attaches the in-memory control key to later requests", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, authorization: headers.authorization });
      if (!headers.authorization) {
        return new Response(JSON.stringify({ error: { code: "ERR_UNAUTHORIZED", message: "Unauthorized: invalid or missing local API key" } }), { status: 401, headers: { "content-type": "application/json" } });
      }
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
      else if (url.endsWith("/models") || url.startsWith("/api/models?")) body = { items: [{ id: "openai/gpt-demo", name: "GPT Demo", contextLength: 128000, pricing: {}, policySummary: "inherit" }], total: 1 };
      else if (url.includes("/desired-models")) body = { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    render(<App />);
    expect(await screen.findByText("Unlock Control Plane")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Control key"), { target: { value: "control-secret" } });
    fireEvent.click(screen.getByText("Unlock"));
    expect(await screen.findByText("GPT Demo")).toBeTruthy();
    expect(screen.queryByText("Unlock Control Plane")).toBeNull();

    const authed = calls.filter((call) => call.authorization === "Bearer control-secret");
    expect(authed.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("controlKey")).toBeNull();
    expect(window.location.search).not.toContain("control");
  });

  it("keeps working normally when no control key is required", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      let body: unknown = {};
      if (url.endsWith("/status")) body = { proxy: { running: true }, openrouter: { configured: true } };
      else if (url.endsWith("/models")) body = { items: [{ id: "openai/gpt-demo", name: "GPT Demo", contextLength: 128000, pricing: {}, policySummary: "inherit" }], total: 1 };
      else if (url.includes("/desired-models")) body = { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    render(<App />);
    expect(await screen.findByText("GPT Demo")).toBeTruthy();
    expect(screen.queryByText("Unlock Control Plane")).toBeNull();
    await waitFor(() => expect((screen.getByRole("button", { name: "All Models" }) as HTMLElement).className).toContain("nav-active"));
  });
});
