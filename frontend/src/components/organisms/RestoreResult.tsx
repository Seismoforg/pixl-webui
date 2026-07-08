"use client";

import HealingIcon from "@mui/icons-material/Healing";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { BeforeAfterSlider } from "@/components/molecules/BeforeAfterSlider";
import { DamageReport } from "@/components/molecules/DamageReport";
import { BatchImageResult } from "@/components/organisms/BatchImageResult";
import { useTranslations } from "@/i18n";
import { useRestore } from "@/providers/RestoreProvider";
import type { StationResult } from "@/types";

const STATUS_COLOR = {
  done: "success",
  running: "info",
  skipped: "default",
  pending: "default",
} as const;

/** The restore result column: damage report + live pipeline (per-station status) +
 *  a per-station Before/After inspector, then the saved image via BatchImageResult. */
export const RestoreResult = () => {
  const t = useTranslations();
  const { running, progress, resultId } = useRestore();

  const stations = progress?.stations ?? [];
  const comparable = stations.filter((s) => s.status === "done" && s.before && s.after);

  // Which completed station is shown in the Before/After inspector; default to the
  // last comparable one so the freshest effect is visible.
  const [inspect, setInspect] = useState<string>("");
  useEffect(() => {
    if (comparable.length && !comparable.some((s) => s.name === inspect)) {
      setInspect(comparable[comparable.length - 1].name);
    }
  }, [comparable, inspect]);

  const selected = comparable.find((s) => s.name === inspect);

  const stationRow = (s: StationResult) => (
    <Box
      key={s.name}
      sx={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 1 }}
    >
      <Typography variant="body2" color={s.status === "skipped" ? "text.disabled" : "text.primary"}>
        {t(`restore.station.${s.name}`)}
        {s.detail && s.status === "skipped" && (
          <Typography component="span" variant="caption" color="text.secondary">
            {" "}
            — {s.detail}
          </Typography>
        )}
      </Typography>
      {s.status === "done" && s.elapsed > 0 ? (
        <MonoText sx={{ fontSize: 11, color: "text.secondary" }}>{s.elapsed.toFixed(1)}s</MonoText>
      ) : (
        <span />
      )}
      <Chip
        size="small"
        variant={s.status === "done" ? "filled" : "outlined"}
        color={STATUS_COLOR[s.status]}
        label={t(`restore.status.${s.status}`)}
      />
    </Box>
  );

  const pipeline =
    stations.length > 0 ? (
      <Box>
        <SectionHeading level={3} variant="subtitle2" sx={{ mb: 0.75 }}>
          {t("restore.pipeline.title")}
        </SectionHeading>
        <Stack spacing={0.5}>{stations.map(stationRow)}</Stack>

        {comparable.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <TextField
              select
              size="small"
              fullWidth
              label={t("restore.pipeline.inspect")}
              value={selected?.name ?? ""}
              onChange={(e) => setInspect(e.target.value)}
              sx={{ mb: 1 }}
            >
              {comparable.map((s) => (
                <MenuItem key={s.name} value={s.name}>
                  {t(`restore.station.${s.name}`)}
                </MenuItem>
              ))}
            </TextField>
            {selected?.before && selected?.after && (
              <BeforeAfterSlider
                before={selected.before}
                after={selected.after}
                beforeLabel={t("restore.pipeline.before")}
                afterLabel={t("restore.pipeline.after")}
              />
            )}
          </Box>
        )}
      </Box>
    ) : null;

  // Overall Original→Restored wipe (whole pipeline), shown once the run completes.
  const overall =
    progress?.original && progress?.result ? (
      <Box>
        <SectionHeading level={3} variant="subtitle2" sx={{ mb: 0.75 }}>
          {t("restore.overall.title")}
        </SectionHeading>
        <BeforeAfterSlider
          before={progress.original}
          after={progress.result}
          beforeLabel={t("restore.overall.original")}
          afterLabel={t("restore.overall.restored")}
        />
      </Box>
    ) : null;

  const beforeContent =
    overall || progress?.analysis || pipeline ? (
      <Stack spacing={2} sx={{ mb: 2 }}>
        {overall}
        {overall && (progress?.analysis || pipeline) && <Divider />}
        {progress?.analysis && <DamageReport report={progress.analysis} />}
        {progress?.analysis && pipeline && <Divider />}
        {pipeline}
      </Stack>
    ) : undefined;

  return (
    <BatchImageResult
      icon={HealingIcon}
      keyPrefix="restore.result"
      running={running}
      progress={progress}
      resultIds={resultId ? [resultId] : []}
      beforeContent={beforeContent}
    />
  );
};
