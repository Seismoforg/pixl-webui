"use client";

import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createAppTheme, type ColorMode } from "@/theme/theme";

interface ColorModeContextValue {
  mode: ColorMode;
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

const STORAGE_KEY = "pixl.colorMode";

export const useColorMode = (): ColorModeContextValue => {
  const ctx = useContext(ColorModeContext);
  if (!ctx) throw new Error("useColorMode must be used within ColorModeProvider");
  return ctx;
};

export const ColorModeProvider = ({ children }: { children: ReactNode }) => {
  // Deterministic default so SSR and the first client render match (no hydration
  // mismatch); the real preference is applied on mount below.
  const [mode, setMode] = useState<ColorMode>("dark");

  // On mount: honor a previously chosen mode, else fall back to the OS preference.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        setMode(stored);
        return;
      }
    } catch {
      // localStorage unavailable (private mode / blocked) — fall through to system.
    }
    if (window.matchMedia?.("(prefers-color-scheme: light)")?.matches) setMode("light");
  }, []);

  // Persist an explicit toggle so the choice survives a reload.
  const toggle = useCallback(() => {
    setMode((m) => {
      const next: ColorMode = m === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Best-effort; a failed write just means the choice isn't remembered.
      }
      return next;
    });
  }, []);

  const value = useMemo<ColorModeContextValue>(() => ({ mode, toggle }), [mode, toggle]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
};
