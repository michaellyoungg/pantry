import { createFileRoute, Link } from "@tanstack/react-router";
import { NutritionGoals } from "../components/NutritionGoals";
import { Card } from "../components/ui/Card";

function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-text">Settings</h2>
        <p className="mt-1 text-sm text-muted">
          Nutrition goals are checked against estimates of as-purchased ingredients. Where too
          little of a meal can be identified, the goal is reported as unchecked rather than met.
        </p>
      </div>
      <NutritionGoals />
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
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
