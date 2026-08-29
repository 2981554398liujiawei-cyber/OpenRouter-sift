// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider, useI18n } from "../ui/src/i18n";

function LocaleProbe() {
  const { locale, setLocale, t } = useI18n();
  return <div><span>{locale}</span><h1>{t("catalog.title")}</h1><label>{t("locale.label")}<select aria-label={t("locale.label")} value={locale} onChange={(event) => setLocale(event.target.value as "en" | "zh-CN")}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label></div>;
}

afterEach(() => { window.localStorage.clear(); document.documentElement.lang = "en"; });

describe("global locale", () => {
  it("defaults to English and updates html metadata and storage", async () => {
    render(<LocaleProvider><LocaleProbe /></LocaleProvider>);
    expect(screen.getByRole("heading", { name: "All Models" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("OpenRouter Sift");
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-CN" } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "全部模型" })).toBeTruthy());
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe("OpenRouter Sift 控制台");
    expect(window.localStorage.getItem("openrouter-sift.locale")).toBe("zh-CN");
  });
});
