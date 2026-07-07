/** Format a duration in seconds as a compact readout: "6.9s" below a minute,
 *  "1:04" (m:ss) at or above one minute. Unit-only symbols, so no i18n needed. */
export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};
