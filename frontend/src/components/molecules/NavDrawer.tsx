"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import NextLink from "next/link";

export interface NavDrawerItem {
  href: string;
  label: string;
  icon: SvgIconComponent;
}

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  items: NavDrawerItem[];
  activeHref: string;
  title: string;
}

/**
 * Temporary left drawer used as the mobile navigation (behind the app-bar burger
 * button). Presentational: it renders the given items as links with active state
 * and closes on tap. Shown only on small screens — the desktop keeps the tabs.
 */
export const NavDrawer = ({ open, onClose, items, activeHref, title }: NavDrawerProps) => {
  return (
    <Drawer anchor="left" open={open} onClose={onClose} ModalProps={{ keepMounted: true }}>
      <Box sx={{ width: 260 }} role="navigation" aria-label={title}>
        <List>
          {items.map((item) => {
            const Icon = item.icon;
            const active = activeHref.startsWith(item.href);
            return (
              <ListItemButton
                key={item.href}
                component={NextLink}
                href={item.href}
                selected={active}
                onClick={onClose}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Drawer>
  );
}
