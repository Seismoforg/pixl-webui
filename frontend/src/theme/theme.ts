"use client";

import { createTheme, type Theme } from "@mui/material/styles";

export type ColorMode = "light" | "dark";

// Layout dimensions that were previously hard-coded in components. Exposed on the
// theme so panels read them from one place instead of using magic pixel values.
declare module "@mui/material/styles" {
  interface Theme {
    layout: { controlColumn: number; resultMinHeight: number; thumbSize: number };
  }
  interface ThemeOptions {
    layout?: { controlColumn?: number; resultMinHeight?: number; thumbSize?: number };
  }
}

/**
 * Central design tokens. Components must read from the theme rather than
 * hard-coding values; global tweaks belong in `components` below.
 */
export function createAppTheme(mode: ColorMode): Theme {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      // Indigo deep enough that white text on the contained button clears WCAG AA
      // (contrast ~5.5:1); the previous #6366f1 was ~4.47:1.
      primary: { main: "#5457e0" },
      secondary: { main: "#ec4899" },
      background: isDark
        ? { default: "#0b0d12", paper: "#151922" }
        : { default: "#f6f7f9", paper: "#ffffff" },
    },
    shape: { borderRadius: 12 },
    layout: { controlColumn: 400, resultMinHeight: 360, thumbSize: 72 },
    typography: {
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      // Emphasis weight token; components use fontWeight="medium" instead of a
      // magic 600 so the emphasis weight is defined in exactly one place.
      fontWeightMedium: 600,
      // Explicit type scale so headline/text hierarchy is consistent app-wide.
      // h1 is the app title; h2 = page/section titles; h3 = sub-sections.
      h1: { fontSize: "2rem", fontWeight: 700, lineHeight: 1.2 },
      h2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.25 },
      h3: { fontSize: "1.15rem", fontWeight: 600, lineHeight: 1.3 },
      h4: { fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.35 },
      h5: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
      // h6 also drives MUI DialogTitle + the AppBar title, so keep it near default.
      h6: { fontSize: "1.15rem", fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
      subtitle2: { fontSize: "0.8125rem", fontWeight: 600, lineHeight: 1.4 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
      },
      MuiTextField: {
        defaultProps: { size: "small", fullWidth: true },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
    },
  });
}
