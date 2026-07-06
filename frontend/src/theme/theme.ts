"use client";

import { alpha, createTheme, lighten, type Theme } from "@mui/material/styles";

export type ColorMode = "light" | "dark";

// Layout dimensions that were previously hard-coded in components. Exposed on the
// theme so panels read them from one place instead of using magic pixel values.
declare module "@mui/material/styles" {
  interface Theme {
    layout: {
      controlColumn: number;
      resultMinHeight: number;
      thumbSize: number;
      contentMaxWidth: number;
    };
  }
  interface ThemeOptions {
    layout?: {
      controlColumn?: number;
      resultMinHeight?: number;
      thumbSize?: number;
      contentMaxWidth?: number;
    };
  }
  // Tabular mono family for numeric readouts, read via `theme.typography.fontFamilyMono`.
  interface TypographyVariants {
    fontFamilyMono: string;
  }
  interface TypographyVariantsOptions {
    fontFamilyMono?: string;
  }
}

/**
 * Central design tokens. Components must read from the theme rather than
 * hard-coding values; global tweaks belong in `components` below.
 */
export const createAppTheme = (mode: ColorMode): Theme => {
  const isDark = mode === "dark";
  // Indigo deep enough that white text on the contained button clears WCAG AA
  // (contrast ~5.5:1); the previous #6366f1 was ~4.47:1.
  const primaryMain = "#5457e0";
  // Same indigo lifted for use as text/border on the dark paper, where the base
  // primary.main only reaches ~3.3:1 (fails AA) as an outlined-chip label.
  const primaryOnDark = lighten(primaryMain, 0.35);

  const base = createTheme({
    palette: {
      mode,
      primary: { main: primaryMain },
      // Unused as a text/icon color anywhere in the app today (grep confirms only
      // `text.secondary` — a different, unrelated token — is referenced); as plain
      // text on light paper this pink is ≈3.1:1, failing WCAG AA (4.5:1). If it
      // starts being used for text, give it the same per-mode darkening treatment
      // as primary/warning/error/info above.
      secondary: { main: "#ec4899" },
      // Light-mode semantic mains darkened so small outlined-chip labels (fit
      // badges: offload/too-large/cpu) clear WCAG AA (4.5:1) on the near-white
      // paper — MUI's defaults (#ed6c02 / #0288d1) fail at chip-label size. Dark
      // mode keeps MUI defaults, which already pass on the dark paper.
      ...(isDark
        ? {}
        : {
            warning: { main: "#b45309" },
            error: { main: "#c62828" },
            info: { main: "#0277bd" },
          }),
      // A cohesive surface + divider set per mode so panels, borders and the page
      // background read as one system rather than ad-hoc greys.
      // Off-white paper in light mode (not pure #fff) so panels have depth against
      // the page and shadows read; dark stays near-black layered surfaces.
      background: isDark
        ? { default: "#0a0b10", paper: "#14171f" }
        : { default: "#f4f5f8", paper: "#fcfcfd" },
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(16,18,27,0.10)",
      text: isDark
        ? { primary: "#e7e9ee", secondary: "#a2a8b6" }
        : { primary: "#1b1e28", secondary: "#5b6474" },
    },
    shape: { borderRadius: 12 },
    layout: { controlColumn: 400, resultMinHeight: 360, thumbSize: 72, contentMaxWidth: 1700 },
    typography: {
      fontFamily:
        'var(--font-inter), system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      // Tabular mono for numbers; tabular-nums is applied at the readout component.
      fontFamilyMono:
        'var(--font-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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
      // Kept monotonic (below h5); MUI DialogTitle's default size is restored via
      // components.MuiDialogTitle below and the AppBar title sets its own size,
      // so this variant no longer needs to be inflated for either of them.
      h6: { fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
      subtitle2: { fontSize: "0.8125rem", fontWeight: 600, lineHeight: 1.4 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          // Tactile press: the button dips slightly when pressed for physical
          // feedback. Motion is disabled under prefers-reduced-motion.
          root: {
            transition: "transform 120ms cubic-bezier(0.16, 1, 0.3, 1)",
            "&:active": { transform: "scale(0.98)" },
            "@media (prefers-reduced-motion: reduce)": {
              transition: "none",
              "&:active": { transform: "none" },
            },
          },
        },
      },
      MuiTextField: {
        defaultProps: { size: "small", fullWidth: true },
      },
      // DialogTitle defaults to the h6 typography variant; scope its larger size
      // here instead of inflating the shared h6 variant (which also drives the
      // AppBar title and would otherwise break the type scale's monotonicity).
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontSize: "1.15rem", lineHeight: 1.4 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      // Dark mode: lift the outlined-primary chip label/border off the base
      // indigo (~3.3:1 on paper, fails AA) to the lighter shade (~5.6:1). Light
      // mode already passes, so leave it untouched.
      MuiChip: isDark
        ? {
            styleOverrides: {
              outlinedPrimary: {
                color: primaryOnDark,
                borderColor: alpha(primaryOnDark, 0.7),
              },
            },
          }
        : {},
    },
  });

  // Tinted, soft elevation shadows (no pure black on light) so panels can lift off
  // the page instead of relying only on 1px borders. Overrides levels 1-2 (cards),
  // 8 (Menu's default elevation) and 24 (Dialog's default elevation) — the ones
  // actually used in the app — leaving the rest at MUI's untinted defaults.
  const shadows = [...base.shadows] as typeof base.shadows;
  shadows[1] = isDark
    ? "0 1px 2px rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.35)"
    : "0 1px 2px rgba(16,18,27,0.06), 0 4px 14px rgba(16,18,27,0.06)";
  shadows[2] = isDark
    ? "0 2px 6px rgba(0,0,0,0.55), 0 10px 28px rgba(0,0,0,0.4)"
    : "0 2px 6px rgba(16,18,27,0.08), 0 10px 28px rgba(16,18,27,0.08)";
  shadows[8] = isDark
    ? "0 4px 10px rgba(0,0,0,0.55), 0 16px 40px rgba(0,0,0,0.45)"
    : "0 4px 10px rgba(16,18,27,0.10), 0 16px 40px rgba(16,18,27,0.12)";
  shadows[24] = isDark
    ? "0 8px 20px rgba(0,0,0,0.6), 0 32px 64px rgba(0,0,0,0.5)"
    : "0 8px 20px rgba(16,18,27,0.14), 0 32px 64px rgba(16,18,27,0.16)";
  return createTheme(base, { shadows });
}
