import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "zh-CN" | "en";
type Key = keyof typeof en;
type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: Key, values?: Record<string, string | number>) => string; formatDate: (value: string | number | Date) => string };
const fallback: LocaleContextValue = { locale: "en", setLocale: () => undefined, t: (key) => en[key], formatDate: (value) => new Date(value).toLocaleString("en") };
const LocaleContext = createContext<LocaleContextValue>(fallback);
const storageKey = "openrouter-sift.locale";
const initialLocale = (): Locale => { if (typeof window === "undefined") return "en"; const saved = window.localStorage.getItem(storageKey); return saved === "zh-CN" || saved === "en" ? saved : "en"; };

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = (next: Locale) => { setLocaleState(next); window.localStorage.setItem(storageKey, next); };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "zh-CN" ? zhCN["app.title"] : en["app.title"];
  }, [locale]);
  const value = useMemo<LocaleContextValue>(() => {
    const dictionary = locale === "zh-CN" ? zhCN : en;
    return { locale, setLocale, t: (key, values) => { let value = dictionary[key]; for (const [name, replacement] of Object.entries(values ?? {})) value = value.replaceAll(`{${name}}`, String(replacement)); return value; }, formatDate: (input) => new Intl.DateTimeFormat(locale).format(new Date(input)) };
  }, [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useI18n = () => useContext(LocaleContext);

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return <label className="locale-switcher"><span aria-hidden="true">🌐</span><span className="sr-only">{t("locale.label")}</span><select aria-label={t("locale.label")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="zh-CN">{t("locale.zh")}</option><option value="en">{t("locale.en")}</option></select></label>;
}
