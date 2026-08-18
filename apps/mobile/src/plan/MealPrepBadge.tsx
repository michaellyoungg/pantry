/**
 * Lead-time prep on a planned meal.
 *
 * On the card and not only on Home, for the same reason web puts it here:
 * moving Thursday's roast to Tuesday is a decision you should be able to make
 * knowing it needs three days of thawing.
 */
import { hasLeadTime, PREP_WINDOW_LABELS, stateKey } from "@pantry/core";
import type { PrepMeal } from "@pantry/types";
import { Text } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("plan");

export function MealPrepBadge({
  meal,
  done,
  title,
}: {
  meal?: PrepMeal;
  done: Set<string>;
  /** The meal's title, only to key the testID off the same slug the card uses. */
  title: string;
}) {
  const tasks = (meal?.tasks ?? []).filter(hasLeadTime);
  if (meal === undefined || tasks.length === 0) return null;

  const key = testIDKey(title);
  const outstanding = tasks.filter((t) => !done.has(stateKey(t.key, meal.cookDate)));

  if (outstanding.length === 0) {
    return (
      <Text className="text-sm text-muted" testID={id("prep-done", key)}>
        ✓ Prep done
      </Text>
    );
  }

  // Tasks arrive coarsest-window-first from the service, so the first
  // outstanding one is the earliest deadline.
  const soonest = outstanding[0];
  const missed = outstanding.some((t) => t.missed);
  return (
    <Text
      className={`text-sm ${missed ? "font-medium text-danger" : "text-amber-700"}`}
      testID={id("prep", key)}
    >
      ⏱ {outstanding.length === 1 ? "Prep" : `${outstanding.length} prep`}:{" "}
      {(PREP_WINDOW_LABELS[soonest.window] ?? soonest.window).toLowerCase()}
    </Text>
  );
}
