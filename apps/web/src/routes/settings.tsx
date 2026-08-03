import { createFileRoute } from "@tanstack/react-router";
import { NutritionGoals } from "../components/NutritionGoals";
import { Preferences } from "../components/Preferences";

/**
 * Settings hosts two independently-built sections that arrived on the same
 * route from different branches: nutrition goals (BL-0038) and ingredient
 * preferences (BL-0005).
 *
 * The nutrition caveat is scoped to its own section rather than left under the
 * page heading, where it would read as a statement about everything on the page
 * — including the avoid list, which is not an estimate and is not subject to
 * the identification caveat at all.
 */
function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Settings</h2>

      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Nutrition goals are checked against estimates of as-purchased ingredients. Where too
          little of a meal can be identified, the goal is reported as unchecked rather than met.
        </p>
        <NutritionGoals />
      </div>

      <Preferences />
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
