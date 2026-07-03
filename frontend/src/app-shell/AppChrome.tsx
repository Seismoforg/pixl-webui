"use client";

import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import SettingsIcon from "@mui/icons-material/Settings";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { GenerationProvider, useGeneration } from "@/generation/GenerationProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useColorMode } from "@/theme/ColorModeProvider";
import type { ModelEntry, SystemInfo } from "@/types";

import { Logo } from "@/components/atoms/Logo";
import { InferenceOverlay } from "@/components/organisms/InferenceOverlay";
import { SystemStatusBar } from "@/components/organisms/SystemStatusBar";

/** App-wide data (models + system info) shared across every route. */
interface AppData {
  models: ModelEntry[];
  system: SystemInfo | null;
  reloadModels: () => void;
  // Bumped whenever the gallery should refetch (navigation to it, or a finished
  // generation). GalleryPanel reads it so it stays fresh without a page reload.
  galleryToken: number;
}

const AppDataContext = createContext<AppData | null>(null);

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppChrome");
  return ctx;
}

const NAV = [
  { href: "/generate", key: "nav.generate" },
  { href: "/models", key: "nav.models" },
  { href: "/gallery", key: "nav.gallery" },
] as const;

export function AppChrome({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { mode, toggle } = useColorMode();
  const pathname = usePathname();

  const [models, setModels] = useState<ModelEntry[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [galleryToken, setGalleryToken] = useState(0);

  const reloadModels = useCallback(() => {
    api.getModels().then(setModels).catch(() => setModels([]));
  }, []);

  const refreshGallery = useCallback(() => setGalleryToken((v) => v + 1), []);

  // A finished generation may add a gallery image and can change model state;
  // refresh both so the generate dropdown and gallery reflect it immediately.
  const handleGenerated = useCallback(() => {
    reloadModels();
    refreshGallery();
  }, [reloadModels, refreshGallery]);

  useEffect(() => {
    api.getSystem().then(setSystem).catch(() => setSystem(null));
  }, []);

  // Refetch shared data on every navigation so freshly downloaded models and
  // freshly generated images appear without a full page reload (route segments
  // are otherwise reused from Next's router cache and never refetch on mount).
  useEffect(() => {
    reloadModels();
    if (pathname.startsWith("/gallery")) refreshGallery();
  }, [pathname, reloadModels, refreshGallery]);

  const activeIndex = NAV.findIndex((n) => pathname.startsWith(n.href));
  const tabValue = activeIndex === -1 ? false : activeIndex;

  return (
    <AppDataContext.Provider value={{ models, system, reloadModels, galleryToken }}>
      <GenerationProvider models={models} onGenerated={handleGenerated}>
        <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
          <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Toolbar>
              <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 1.5 }}>
                <Logo size={36} />
                <Box>
                  <Typography variant="h6" component="h1">
                    {t("app.title")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("app.subtitle")}
                  </Typography>
                </Box>
              </Box>

              <IconButton onClick={toggle} aria-label={t("nav.toggleTheme")}>
                {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
              <IconButton
                component={NextLink}
                href="/settings"
                aria-label={t("nav.settings")}
              >
                <SettingsIcon />
              </IconButton>
            </Toolbar>

            <Tabs value={tabValue} sx={{ px: 2 }}>
              {NAV.map((n) => (
                <Tab key={n.href} component={NextLink} href={n.href} label={t(n.key)} />
              ))}
            </Tabs>

            <SystemStatusBar />
          </AppBar>

          <Container maxWidth="xl" component="main" sx={{ py: 4 }}>
            {children}
          </Container>

          <OverlayGate />
        </Box>
      </GenerationProvider>
    </AppDataContext.Provider>
  );
}

/** Shows the floating progress overlay while generating off the generate route. */
function OverlayGate() {
  const { running } = useGeneration();
  const pathname = usePathname();
  const router = useRouter();

  if (!running || pathname.startsWith("/generate")) return null;
  return <InferenceOverlay onClick={() => router.push("/generate")} />;
}
