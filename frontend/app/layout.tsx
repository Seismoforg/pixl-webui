import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { AppChrome } from "@/app-shell/AppChrome";
import { I18nProvider } from "@/i18n";
import { AppDataProvider } from "@/providers/AppDataProvider";
import { ColorModeProvider } from "@/providers/ColorModeProvider";
import en from "@/i18n/locales/en.json";

// Self-hosted at build time by next/font (no runtime request to Google), exposed
// as a CSS variable the theme reads for its fontFamily.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Sourced from the locale file (single source of UI copy); metadata is a
// server-side export so it can't use the client `useTranslations` hook.
export const metadata: Metadata = {
  title: en.app.title,
  description: en.app.subtitle,
};

const RootLayout = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AppRouterCacheProvider>
          <ColorModeProvider>
            <I18nProvider>
              <AppDataProvider>
                <AppChrome>{children}</AppChrome>
              </AppDataProvider>
            </I18nProvider>
          </ColorModeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

export default RootLayout;
