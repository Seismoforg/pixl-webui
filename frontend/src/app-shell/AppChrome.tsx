"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CollectionsIcon from "@mui/icons-material/Collections";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import PhotoSizeSelectLargeIcon from "@mui/icons-material/PhotoSizeSelectLarge";
import SettingsIcon from "@mui/icons-material/Settings";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { ActivityProvider } from "@/activity/ActivityProvider";
import { DownloadProvider } from "@/activity/DownloadProvider";
import { GenerationProvider } from "@/generation/GenerationProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useColorMode } from "@/theme/ColorModeProvider";
import { UpscaleProvider } from "@/upscale/UpscaleProvider";
import type { ModelEntry, SystemInfo } from "@/types";

import { Logo } from "@/components/atoms/Logo";
import { ConnectionStatus } from "@/components/molecules/ConnectionStatus";
import { NavDrawer } from "@/components/molecules/NavDrawer";
import { ActivityOverlay } from "@/components/organisms/ActivityOverlay";
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

export const useAppData = () => {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppChrome");
  return ctx;
}

const NAV = [
  { href: "/generate", key: "nav.generate", icon: AutoAwesomeIcon },
  { href: "/upscale", key: "nav.upscale", icon: PhotoSizeSelectLargeIcon },
  { href: "/models", key: "nav.models", icon: ViewInArIcon },
  { href: "/gallery", key: "nav.gallery", icon: CollectionsIcon },
] as const;

export const AppChrome = ({ children }: { children: ReactNode }) => {
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Nav items for the mobile drawer: the tab routes plus Settings.
  const drawerItems = [
    ...NAV.map((n) => ({ href: n.href, label: t(n.key), icon: n.icon })),
    { href: "/settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  return (
    <AppDataContext.Provider value={{ models, system, reloadModels, galleryToken }}>
     <ActivityProvider>
      <DownloadProvider onFinished={reloadModels}>
       <GenerationProvider models={models} onGenerated={handleGenerated}>
        <UpscaleProvider onUpscaled={refreshGallery}>
        <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
          <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Toolbar>
              <IconButton
                edge="start"
                onClick={() => setDrawerOpen(true)}
                aria-label={t("nav.menu")}
                sx={{ display: { xs: "inline-flex", md: "none" }, mr: 0.5 }}
              >
                <MenuIcon />
              </IconButton>

              <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1.5 }}>
                <Logo size={36} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h6" component="h1" noWrap>
                    {t("app.title")}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: { xs: "none", sm: "block" } }}
                  >
                    {t("app.subtitle")}
                  </Typography>
                </Box>
              </Box>

              <ConnectionStatus />
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

            <Box sx={{ display: { xs: "none", md: "block" } }}>
              <Tabs value={tabValue} sx={{ px: 2 }}>
                {NAV.map((n) => {
                  const Icon = n.icon;
                  return (
                    <Tab
                      key={n.href}
                      component={NextLink}
                      href={n.href}
                      icon={<Icon fontSize="small" />}
                      iconPosition="start"
                      label={t(n.key)}
                      sx={{ minHeight: 48 }}
                    />
                  );
                })}
              </Tabs>
            </Box>

            <SystemStatusBar />
          </AppBar>

          <NavDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            items={drawerItems}
            activeHref={pathname}
            title={t("nav.menu")}
          />

          <Container
            maxWidth={false}
            component="main"
            sx={{ py: 4, maxWidth: (theme) => theme.layout.contentMaxWidth, mx: "auto" }}
          >
            {children}
          </Container>

          <ActivityOverlay />
        </Box>
        </UpscaleProvider>
       </GenerationProvider>
      </DownloadProvider>
     </ActivityProvider>
    </AppDataContext.Provider>
  );
}
