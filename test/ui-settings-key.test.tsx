// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/src/App";

const originalFetch = globalThis.fetch;

type Handler = (url: string, method: string, body: string | undefined) => unknown | undefined;

const keyStatus = (over: Partial<{ configured: boolean; source: string }> = {}) => ({
  configured: over.configured ?? false,
  masked: over.configured ? "••••abcd" : null,
  source: over.source ?? "none",
  secureStoreAvailable: true,
  secureStoreLabel: "Test store",
});

function install(handler?: Handler) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body: rawBody });
    const handled = handler?.(url, method, rawBody);
    const responseBody = handled !== undefined ? handled : {};
    const status = (responseBody as any).__status ?? 200;
    return new Response(JSON.stringify(responseBody), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const baseFixtures: Handler = (url, method, body) => {
  if (url.endsWith("/status")) return { proxy: { running: true }, openrouter: { configured: false } };
  if (url.endsWith("/models") || url.startsWith("/api/models?")) return { items: [], total: 0 };
  if (url.includes("/desired-models")) return { items: [] };
  if (url.endsWith("/access-keys") && method === "GET") return { items: [] };
  if (url.includes("/requests")) return { items: [], total: 0 };
  if (url.endsWith("/settings")) return { openRouterApiKey: keyStatus(), mergeMode: "merge", globalPolicy: {}, metadataTtlMs: 300000, requestLogLimit: 1000, desiredEndpointRefreshIntervalMs: 60000 };
  if (url.endsWith("/policies")) return { items: [] };
  return {};
};

const navButton = (name: string) => screen.getByRole("button", { name });

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("Settings OpenRouter key management UI", () => {
  it("shows the unconfigured onboarding form and saves a pasted key with remember on (§52)", async () => {
    let savedKey = false;
    const calls = install((url, method, body) => {
      if (url.endsWith("/settings/openrouter-key") && method === "PUT") {
        const payload = JSON.parse(body ?? "{}");
        savedKey = true;
        return { openRouterApiKey: keyStatus({ configured: true, source: payload.remember ? "secure-store" : "ui-session" }) };
      }
      if (url.endsWith("/settings")) return { openRouterApiKey: keyStatus(savedKey ? { configured: true, source: "secure-store" } : {}), mergeMode: "merge", globalPolicy: {}, metadataTtlMs: 300000, requestLogLimit: 1000, desiredEndpointRefreshIntervalMs: 60000 };
      return baseFixtures(url, method, body);
    });
    render(<App />);
    fireEvent.click(navButton("Settings"));
    expect(await screen.findByText("Connect OpenRouter to enable inference and provider metadata.")).toBeTruthy();
    const input = screen.getByLabelText("OpenRouter API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    const remember = screen.getByRole("checkbox") as HTMLInputElement;
    expect(remember.checked).toBe(true); // Remember defaults ON
    fireEvent.change(input, { target: { value: "sk-or-v1-testing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    await waitFor(() => {
      const put = calls.find((c) => c.url.endsWith("/settings/openrouter-key"));
      expect(put).toBeTruthy();
      const payload = JSON.parse(put!.body ?? "{}");
      expect(payload.apiKey).toBe("sk-or-v1-testing");
      expect(payload.remember).toBe(true);
      expect(payload.verify).toBe(true);
    });
    // After save the configured state shows the mask and the plaintext form is unmounted (§31).
    expect(await screen.findByLabelText("Configured OpenRouter API key")).toBeTruthy();
    expect((screen.getByLabelText("Configured OpenRouter API key") as HTMLInputElement).value).toBe("••••abcd");
    expect((screen.getByLabelText("OpenRouter key storage") as HTMLInputElement).value).toBe("Securely stored on this device");
    expect(screen.queryByLabelText("OpenRouter API key")).toBeNull();
  });

  it("surfaces OpenRouter's rejection without storing the key (§17)", async () => {
    install((url, method) => {
      if (url.endsWith("/settings/openrouter-key") && method === "PUT") return { __status: 422, error: { code: "INVALID_UPSTREAM_KEY", message: "OpenRouter rejected this API key." } };
      if (url.endsWith("/settings")) return baseFixtures(url, method, undefined);
      return baseFixtures(url, method, undefined);
    });
    render(<App />);
    fireEvent.click(navButton("Settings"));
    fireEvent.change(await screen.findByLabelText("OpenRouter API key"), { target: { value: "sk-or-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    expect(await screen.findByText("OpenRouter rejected this API key.")).toBeTruthy();
  });

  it("offers save-without-verification when OpenRouter is unreachable (§18)", async () => {
    const calls = install((url, method, body) => {
      if (url.endsWith("/settings/openrouter-key") && method === "PUT") {
        const payload = JSON.parse(body ?? "{}");
        if (payload.verify) return { __status: 502, error: { code: "UPSTREAM_UNREACHABLE", message: "Could not verify the key because OpenRouter is unreachable." }, allowUnverified: true };
        return { openRouterApiKey: keyStatus({ configured: true, source: "ui-session" }) };
      }
      return baseFixtures(url, method, body);
    });
    render(<App />);
    fireEvent.click(navButton("Settings"));
    fireEvent.change(await screen.findByLabelText("OpenRouter API key"), { target: { value: "sk-or-offline" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    expect(await screen.findByText(/Could not verify the key because OpenRouter is unreachable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save without verification" }));
    await waitFor(() => {
      const puts = calls.filter((c) => c.url.endsWith("/settings/openrouter-key"));
      expect(JSON.parse(puts.at(-1)!.body ?? "{}").verify).toBe(false);
    });
  });

  it("supports replace and confirm-guarded forget on the configured state (§27/§28)", async () => {
    const calls = install((url, method, body) => {
      if (url.endsWith("/settings/openrouter-key") && method === "DELETE") return { openRouterApiKey: keyStatus({ source: "environment", configured: true }) };
      if (url.endsWith("/settings")) return { openRouterApiKey: keyStatus({ configured: true, source: "environment" }), mergeMode: "merge", globalPolicy: {}, metadataTtlMs: 300000, requestLogLimit: 1000, desiredEndpointRefreshIntervalMs: 60000 };
      return baseFixtures(url, method, body);
    });
    render(<App />);
    fireEvent.click(navButton("Settings"));
    expect((await screen.findByLabelText("OpenRouter key storage") as HTMLInputElement).value).toBe("Environment variable");
    expect(await screen.findByLabelText("Configured OpenRouter API key")).toBeTruthy();
    // Replace reveals an empty input, never the old secret (§27).
    console.log("BTNS:", JSON.stringify(Array.from(document.querySelectorAll("button")).map(b => b.textContent)));
    console.log("PANEL:", document.querySelector("section.panel")?.innerHTML?.slice(0, 400));
    const clickButton = (name: string) => {
      const all = Array.from(document.querySelectorAll("button"));
      console.log("FIND DEBUG:", JSON.stringify(all.map((b) => [b.textContent, b.textContent === name, name])));
      const button = all.find((b) => b.textContent === name);
      expect(button, `button ${name} should exist`).toBeTruthy();
      fireEvent.click(button!);
    };
    clickButton("Replace Key");
    // The form opens empty — the old secret is never filled in (§27) — and cancel returns without changing it.
    expect((screen.getByLabelText("OpenRouter API key") as HTMLInputElement).value).toBe("");
    clickButton("Cancel");
    expect(screen.getByLabelText("Configured OpenRouter API key")).toBeTruthy();
    // Forget requires a second confirming click.
    clickButton("Forget Key");
    expect(screen.getByText(/Remove the OpenRouter API key saved by Sift\?/)).toBeTruthy();
    clickButton("Remove key");
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/settings/openrouter-key") && c.method === "DELETE")).toBe(true));
  });

  it("explains unavailable secure storage and defaults to session-only there (§9)", async () => {
    install((url, method, body) => {
      if (url.endsWith("/settings")) return { ...baseFixtures(url, method, body), openRouterApiKey: { configured: false, masked: null, source: "none", secureStoreAvailable: false, secureStoreLabel: "unavailable" } };
      return baseFixtures(url, method, body);
    });
    render(<App />);
    fireEvent.click(navButton("Settings"));
    const remember = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(remember.checked).toBe(false);
    expect(remember.disabled).toBe(true);
    expect(screen.getByText(/secure storage unavailable/)).toBeTruthy();
  });
});
