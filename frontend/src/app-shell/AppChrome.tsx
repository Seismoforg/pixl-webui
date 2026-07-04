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
import { useState, type ReactNode } from "react";

import { useTranslations } from "@/i18n";
import { useColorMode } from "@/providers/ColorModeProvider";

import { Logo } from "@/components/atoms/Logo";
import { ConnectionStatus } from "@/components/molecules/ConnectionStatus";
import { NavDrawer } from "@/components/molecules/NavDrawer";
import { ActivityOverlay } from "@/components/organisms/ActivityOverlay";
import { SystemStatusBar } from "@/components/organisms/SystemStatusBar";

const NAV = [
  { href: "/generate", key: "nav.generate", icon: AutoAwesomeIcon },
  { href: "/upscale", key: "nav.upscale", icon: PhotoSizeSelectLargeIcon },
  { href: "/models", key: "nav.models", icon: ViewInArIcon },
  { href: "/gallery", key: "nav.gallery", icon: CollectionsIcon },
] as const;

/**
 * Visual chrome shared above every route: app bar, nav tabs/drawer, status bar
 * and the activity overlay. Shared data + the always-mounted feature providers
 * live in AppDataProvider, which wraps this component in the root layout.
 */
export const AppChrome = ({ children }: { children: ReactNode }) => {
  const t = useTranslations();
  const { mode, toggle } = useColorMode();
  const pathname = usePathname();

  const activeIndex = NAV.findIndex((n) => pathname.startsWith(n.href));
  const tabValue = activeIndex === -1 ? false : activeIndex;

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Nav items for the mobile drawer: the tab routes plus Settings.
  const drawerItems = [
    ...NAV.map((n) => ({ href: n.href, label: t(n.key), icon: n.icon })),
    { href: "/settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  return (
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
  );
};
