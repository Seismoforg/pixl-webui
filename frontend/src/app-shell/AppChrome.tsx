"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import BrushIcon from "@mui/icons-material/Brush";
import CollectionsIcon from "@mui/icons-material/Collections";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import GridViewIcon from "@mui/icons-material/GridView";
import HealingIcon from "@mui/icons-material/Healing";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import PhotoSizeSelectLargeIcon from "@mui/icons-material/PhotoSizeSelectLarge";
import SettingsIcon from "@mui/icons-material/Settings";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useTranslations } from "@/i18n";
import { useColorMode } from "@/providers/ColorModeProvider";

import { Logo } from "@/components/atoms/Logo";
import { ConnectionStatus } from "@/components/molecules/ConnectionStatus";
import { NavDrawer } from "@/components/molecules/NavDrawer";
import { ActivityOverlay } from "@/components/organisms/ActivityOverlay";
import { SystemStatusBar } from "@/components/organisms/SystemStatusBar";

const NAV = [
  { href: "/generate", key: "nav.generate", icon: AutoAwesomeIcon },
  { href: "/compare", key: "nav.compare", icon: GridViewIcon },
  { href: "/upscale", key: "nav.upscale", icon: PhotoSizeSelectLargeIcon },
  { href: "/reframe", key: "nav.reframe", icon: AspectRatioIcon },
  { href: "/inpaint", key: "nav.inpaint", icon: BrushIcon },
  { href: "/edit", key: "nav.edit", icon: AutoFixHighIcon },
  { href: "/restore", key: "nav.restore", icon: HealingIcon },
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

  // Publish the sticky AppBar's live height as a CSS var so sticky result panels can
  // offset below it (it's responsive: the tab row + status bar change its height), and
  // not have their top edge/heading clipped behind it.
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const apply = () =>
      document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Nav items for the mobile drawer: the tab routes plus Settings.
  const drawerItems = [
    ...NAV.map((n) => ({ href: n.href, label: t(n.key), icon: n.icon })),
    { href: "/settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        ref={headerRef}
        position="sticky"
        color="default"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("nav.menu")}
            sx={{ display: { xs: "inline-flex", md: "none" }, mr: 0.5, p: { xs: 1.25, md: 1 } }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Logo size={36} />
            <Box sx={{ minWidth: 0 }}>
              {/* h6 is now a smaller, monotonic type-scale step (see theme.ts); this
                  title keeps its previous visual size via an explicit override. */}
              <Typography variant="h6" component="h1" noWrap sx={{ fontSize: "1.15rem" }}>
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
          <IconButton
            onClick={toggle}
            aria-label={t(mode === "dark" ? "nav.switchToLight" : "nav.switchToDark")}
            sx={{ p: { xs: 1.25, md: 1 } }}
          >
            {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
          <IconButton
            component={NextLink}
            href="/settings"
            aria-label={t("nav.settings")}
            sx={{ p: { xs: 1.25, md: 1 } }}
          >
            <SettingsIcon />
          </IconButton>
        </Toolbar>

        <Box
          component="nav"
          aria-label={t("nav.mainNavigation")}
          sx={{ display: { xs: "none", md: "flex" }, px: 2, gap: 0.5 }}
        >
          {NAV.map((n, i) => {
            const Icon = n.icon;
            const active = i === activeIndex;
            return (
              <Box
                key={n.href}
                component={NextLink}
                href={n.href}
                aria-current={active ? "page" : undefined}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  minHeight: 48,
                  px: 2,
                  fontSize: (theme) => theme.typography.button.fontSize,
                  fontWeight: (theme) => theme.typography.button.fontWeight,
                  color: active ? "primary.main" : "text.secondary",
                  textDecoration: "none",
                  borderBottom: 2,
                  borderColor: active ? "primary.main" : "transparent",
                  "&:hover": { color: "text.primary" },
                }}
              >
                <Icon fontSize="small" />
                {t(n.key)}
              </Box>
            );
          })}
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
