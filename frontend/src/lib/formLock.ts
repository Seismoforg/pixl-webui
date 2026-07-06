// Reset-styled fieldset that locks (and dims) a form's controls while a job runs.
// Shared by every feature form (Generation/Reframe/Upscale/Inpaint/Edit).
import type { CSSProperties } from "react";

export const formLockStyle = (locked: boolean): CSSProperties => ({
  border: 0,
  margin: 0,
  padding: 0,
  minInlineSize: 0,
  opacity: locked ? 0.6 : 1,
  pointerEvents: locked ? "none" : "auto",
});
