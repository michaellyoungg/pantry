import type { EquipmentFitStatus } from "@pantry/types";

/**
 * How each fit status is painted on the web.
 *
 * The judgement about the data — sectioning, the wording, what a filter hides —
 * moved to `@pantry/core` with BL-0063 so the native catalog reaches the same
 * conclusions. What is left here is Tailwind, which does not port.
 */
export const FIT_BADGE_CLASS: Record<EquipmentFitStatus, string> = {
  makeable: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  blocked: "bg-amber-500/10 text-amber-600",
  unknown: "bg-border text-muted",
};
