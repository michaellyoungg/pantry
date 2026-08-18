import { hasLeadTime, PREP_WINDOW_LABELS, stateKey } from "@pantry/core";
import type { PrepMeal } from "@pantry/types";

/**
 * Lead-time prep on a planned meal (BL-0042).
 *
 * The point is to see the 24-hour thaw WHEN YOU SCHEDULE the meal, not on the
 * night you forgot it. So this is on the planner card and not only on Home:
 * moving Thursday's roast to Tuesday is a decision you should be able to make
 * knowing it needs three days of thawing.
 *
 * `at_start` tasks are excluded — preheating the oven is cooking, and badging
 * every baked dish would make the badge mean nothing.
 */
export function MealPrepBadge({ meal, done }: { meal?: PrepMeal; done: Set<string> }) {
  const tasks = (meal?.tasks ?? []).filter(hasLeadTime);
  if (tasks.length === 0 || meal === undefined) return null;

  const outstanding = tasks.filter((t) => !done.has(stateKey(t.key, meal.cookDate)));
  if (outstanding.length === 0) {
    return (
      <span className="text-xs text-muted" title="All lead-time prep for this meal is done">
        ✓ prep done
      </span>
    );
  }

  // Tasks arrive coarsest-window-first from the service, so the first
  // outstanding one is the earliest deadline — the fact worth putting on a card
  // this small.
  const soonest = outstanding[0];
  const missed = outstanding.some((t) => t.missed);
  return (
    <span
      className={`text-xs ${missed ? "font-medium text-red-600" : "text-amber-700"}`}
      title={outstanding.map((t) => t.text).join("\n")}
    >
      ⏱ {outstanding.length === 1 ? "prep" : `${outstanding.length} prep`}:{" "}
      {(PREP_WINDOW_LABELS[soonest.window] ?? soonest.window).toLowerCase()}
    </span>
  );
}
