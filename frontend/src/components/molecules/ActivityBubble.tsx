"use client";

import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { Activity } from "@/providers/ActivityProvider";
import { useTranslations } from "@/i18n";

interface ActivityBubbleProps {
  activity: Activity;
  onClick: () => void;
}

/**
 * One floating status card for the ActivityOverlay. Backdrop-free `Paper` (not a
 * Modal) so the page stays interactive; shows a title, a one-line detail and a
 * progress bar (determinate when a percent is given, else indeterminate).
 */
export const ActivityBubble = ({ activity, onClick }: ActivityBubbleProps) => {
  const t = useTranslations();
  const error = activity.status === "error";

  return (
    <Paper
      elevation={6}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={activity.title}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      sx={{
        width: 300,
        maxWidth: "calc(100vw - 32px)",
        p: 2,
        cursor: "pointer",
        borderRadius: 2,
      }}
    >
      <Stack spacing={1}>
        <Typography component="p" variant="subtitle2">{activity.title}</Typography>
        {activity.detail && (
          <Typography variant="body2" color={error ? "error" : "text.secondary"}>
            {activity.detail}
          </Typography>
        )}
        {!error &&
          (activity.percent == null ? (
            <LinearProgress />
          ) : (
            <LinearProgress variant="determinate" value={activity.percent} />
          ))}
        {error && (activity.onRetry || activity.onDismiss) ? (
          <Stack direction="row" spacing={1}>
            {activity.onRetry && (
              <Button
                size="small"
                variant="contained"
                onClick={(e) => {
                  e.stopPropagation();
                  activity.onRetry?.();
                }}
              >
                {t("activity.retry")}
              </Button>
            )}
            {activity.onDismiss && (
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  activity.onDismiss?.();
                }}
              >
                {t("activity.dismiss")}
              </Button>
            )}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t("activity.tapToView")}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
