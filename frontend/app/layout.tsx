import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { AppChrome } from "@/app-shell/AppChrome";
import { I18nProvider } from "@/i18n";
import { ColorModeProvider } from "@/theme/ColorModeProvider";

// Self-hosted at build time by next/font (no runtime request to Google), exposed
// as a CSS variable the theme reads for its fontFamily.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Pixl WebUI",
  description: "Local image generation WebUI",
};

const RootLayout = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AppRouterCacheProvider>
          <ColorModeProvider>
            <I18nProvider>
              <AppChrome>{children}</AppChrome>
            </I18nProvider>
          </ColorModeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

export default RootLayout;
