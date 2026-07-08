import type { SxProps, Theme } from "@mui/material/styles";

// Card background for a form column — matches GenerationForm's `<Paper variant="outlined"
// sx={{ p: 2.5 }}>` (paper bg + outlined divider border + default radius + padding) so the
// other form pages read the same as generate and the sticky action bar blends into the card.
// Applied to the left form `<Stack>` of the compare/inpaint/reframe/edit/upscale panels.
export const formCardSx: SxProps<Theme> = {
  p: 2.5,
  bgcolor: "background.paper",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
};
