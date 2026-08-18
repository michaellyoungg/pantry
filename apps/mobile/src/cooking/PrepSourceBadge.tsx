/**
 * Where a prep task came from (BL-0044), native.
 *
 * The web counterpart is `apps/web/src/components/PrepSourceBadge.tsx` and the
 * reasoning is the same: a task the user wrote and a task the app derived from
 * a rule are trusted differently. Without the distinction, one unhelpful rule
 * ("preheat the oven" on a recipe that never bakes) reads as the whole feature
 * being unreliable, and the user has no reason to think it is theirs to fix.
 *
 * What differs is the explanation. Web puts it in a `title` tooltip, which does
 * not exist on a touch device, so it goes to `accessibilityHint` — the nearest
 * native equivalent, and one that reaches a screen reader rather than only a
 * mouse.
 *
 * `manual` is deliberately the loudest. It is the only one carrying a promise:
 * this is yours, nothing will rewrite it.
 */
import type { PrepSource } from "@pantry/types";
import { Text } from "react-native";

const LABELS: Record<PrepSource, { text: string; hint: string; className: string }> = {
  rule: {
    text: "auto",
    hint: "Derived from a prep rule. Edit the recipe to replace it with your own.",
    className: "border-border text-muted",
  },
  llm: {
    text: "suggested",
    hint: "Matched by the recipe importer. Edit the recipe to replace it with your own.",
    className: "border-border text-muted",
  },
  manual: {
    text: "yours",
    hint: "You wrote this. Nothing derives over it.",
    className: "border-primary/40 text-primary",
  },
};

export function PrepSourceBadge({ source, testID }: { source: PrepSource; testID?: string }) {
  const label = LABELS[source];
  if (!label) return null;
  return (
    <Text
      accessibilityHint={label.hint}
      className={`self-start rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${label.className}`}
      testID={testID}
    >
      {label.text}
    </Text>
  );
}
