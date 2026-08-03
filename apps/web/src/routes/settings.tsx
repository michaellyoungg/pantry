import { createFileRoute, Link } from "@tanstack/react-router";
import { NutritionGoals } from "../components/NutritionGoals";
import { Preferences } from "../components/Preferences";
import { Card } from "../components/ui/Card";

/**
 * Settings collects standing setup from several independently-built branches:
 * nutrition goals (BL-0038), the kitchen-inventory pointer (BL-0043) and
 * ingredient preferences (BL-0005).
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

      {/* The inventory itself lives with the recipes it filters (BL-0043), but
          it is standing setup like the goals above, so this is where someone
          looks for it. A pointer rather than a second copy of the surface. */}
      <Card title="My Kitchen">
        <p className="text-sm text-muted">
          Tell us what equipment you own and we'll flag recipes you can't make yet — and show you
          what a new gadget unlocks.{" "}
          <Link to="/recipes/kitchen" className="text-primary underline">
            Manage your kitchen
          </Link>
          .
        </p>
      </Card>

      <Preferences />
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
