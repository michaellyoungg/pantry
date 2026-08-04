import type { PrepSource } from "@pantry/types";

/**
 * Where a prep task came from (BL-0044).
 *
 * The point is not decoration. A task the user wrote and a task the app derived
 * from a rule are trusted differently: without the distinction, one unhelpful
 * rule ("preheat the oven" on a recipe that never bakes) reads as the whole
 * feature being unreliable, and the user has no reason to think it is theirs to
 * fix. Labelling it makes the derived one recognisably a guess — and a guess is
 * something you can override.
 *
 * `manual` is deliberately the loudest. It is the only one carrying a promise:
 * this is yours, nothing will rewrite it.
 */
const LABELS: Record<PrepSource, { text: string; title: string; className: string }> = {
  rule: {
    text: "auto",
    title: "Derived from a prep rule. Edit the recipe to replace it with your own.",
    className: "border-border text-muted",
  },
  llm: {
    text: "suggested",
    title: "Matched by the recipe importer. Edit the recipe to replace it with your own.",
    className: "border-border text-muted",
  },
  manual: {
    text: "yours",
    title: "You wrote this. Nothing derives over it.",
    className: "border-primary/40 text-primary",
  },
};

export function PrepSourceBadge({ source }: { source: PrepSource }) {
  const label = LABELS[source];
  if (!label) return null;
  return (
    <span
      title={label.title}
      className={`ml-1 rounded-full border px-1.5 py-px align-middle text-[0.625rem] uppercase tracking-wide ${label.className}`}
    >
      {label.text}
    </span>
  );
}
