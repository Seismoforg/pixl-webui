import type { SxProps, Theme } from "@mui/material/styles";

// Pin a form's primary action row to the viewport bottom while the form scrolls, then let
// it settle at the form's natural end. A solid paper backdrop + top divider so the
// scrolling fields don't peek through; z-index above the fields. Sibling of formLock.ts;
// shared by the 5 form pages (generate/compare/inpaint/reframe/edit).
export const stickyActionBarSx: SxProps<Theme> = {
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  bgcolor: "background.paper",
  borderTop: 1,
  borderColor: "divider",
  pt: 2,
  pb: 0.5,
  mt: 1,
};
