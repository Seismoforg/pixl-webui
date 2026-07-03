import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppChrome } from "@/app-shell/AppChrome";
import { I18nProvider } from "@/i18n";
import { ColorModeProvider } from "@/theme/ColorModeProvider";

export const metadata: Metadata = {
  title: "Pixl WebUI",
  description: "Local image generation WebUI",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
