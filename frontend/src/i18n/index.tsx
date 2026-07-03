"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import en from "@/locales/en.json";

/**
 * Minimal i18n layer. Static UI text lives in `src/locales/<locale>.json` and is
 * referenced by dot-path keys. Adding a language = add a JSON file and register
 * it in `resources`; no component changes required.
 */
export const resources = { en } as const;
export type Locale = keyof typeof resources;
export const defaultLocale: Locale = "en";

type Vars = Record<string, string | number>;

function resolve(dict: unknown, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], dict);
  return typeof value === "string" ? value : path;
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

interface I18nContextValue {
  locale: Locale;
  t: (key: string, vars?: Vars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function useTranslations() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslations must be used within I18nProvider");
  return ctx.t;
}

export function I18nProvider({
  locale = defaultLocale,
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, vars) => interpolate(resolve(resources[locale], key), vars),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
