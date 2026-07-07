"use client";

import Box from "@mui/material/Box";
import { usePathname, useRouter } from "next/navigation";

import { useActivity } from "@/providers/ActivityProvider";
import { ActivityBubble } from "@/components/molecules/ActivityBubble";

/**
 * Renders a stacked set of floating bubbles (bottom-right) for every running
 * activity whose home route isn't the current page. One shared overlay for
 * generation, upscaling, downloads and anything else that publishes an activity.
 */
export const ActivityOverlay = () => {
  const { activities } = useActivity();
  const pathname = usePathname();
  const router = useRouter();

  const shown = activities.filter((a) => a.status !== "done" && !pathname.startsWith(a.route));
  if (shown.length === 0) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: (theme) => theme.zIndex.snackbar,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 1.5,
      }}
    >
      {shown.map((a) => (
        <ActivityBubble key={a.id} activity={a} onClick={() => router.push(a.route)} />
      ))}
    </Box>
  );
};
