"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { useTranslations } from "@/i18n";
import type { AnalysisReport } from "@/types";

/** Severity → bar colour (used for damage metrics; higher = worse). */
const severityColor = (v: number) =>
  v >= 66 ? "error.main" : v >= 33 ? "warning.main" : "success.main";

interface MetricRowProps {
  label: string;
  value: number;
  color: string;
}

const MetricRow = ({ label, value, color }: MetricRowProps) => (
  <Box
    sx={{ display: "grid", gridTemplateColumns: "5.5rem 1fr 2.2rem", alignItems: "center", gap: 1 }}
  >
    <Typography variant="caption" color="text.secondary" noWrap>
      {label}
    </Typography>
    <Box sx={{ height: 6, borderRadius: 3, bgcolor: "action.hover", overflow: "hidden" }}>
      <Box
        sx={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", bgcolor: color }}
      />
    </Box>
    <MonoText sx={{ fontSize: 11, textAlign: "right" }}>{Math.round(value)}</MonoText>
  </Box>
);

/** The measured analysis report as a compact damage/quality readout with meters. */
export const DamageReport = ({ report }: { report: AnalysisReport }) => {
  const t = useTranslations();
  const q = report.quality;
  const d = report.damage;
  const colorConf = report.color.scores[report.color.mode] ?? 0;

  return (
    <Box>
      <SectionHeading level={3} variant="subtitle2" sx={{ mb: 0.5 }}>
        {t("restore.report.title")}
      </SectionHeading>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        <MonoText>
          {report.width}×{report.height}
        </MonoText>{" "}
        · <MonoText>{report.megapixels}</MonoText> MP ·{" "}
        {t(`restore.report.colorMode.${report.color.mode}`)}{" "}
        <MonoText>{(colorConf * 100).toFixed(1)}%</MonoText> · {t("restore.report.faces")}:{" "}
        <MonoText>{report.face_count}</MonoText> · {t(`restore.report.scene.${report.scene}`)}
      </Typography>

      <Stack spacing={0.5}>
        <MetricRow label={t("restore.report.sharpness")} value={q.sharpness} color="primary.main" />
        <MetricRow label={t("restore.report.contrast")} value={q.contrast} color="primary.main" />
        <MetricRow label={t("restore.report.blur")} value={q.blur} color={severityColor(q.blur)} />
        <MetricRow
          label={t("restore.report.noise")}
          value={q.noise}
          color={severityColor(q.noise)}
        />
        <MetricRow
          label={t("restore.report.scratches")}
          value={d.scratches}
          color={severityColor(d.scratches)}
        />
        <MetricRow label={t("restore.report.dust")} value={d.dust} color={severityColor(d.dust)} />
        <MetricRow
          label={t("restore.report.fading")}
          value={d.fading}
          color={severityColor(d.fading)}
        />
      </Stack>
    </Box>
  );
};
