import { createFileRoute } from "@tanstack/react-router";
import { WeekPlan } from "../components/WeekPlan";

function PlanPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-text">Plan your week</h2>
        <p className="mt-1 text-sm text-muted">
          Put dinners on days, then build one grocery list for the week.
        </p>
      </div>
      <WeekPlan />
    </div>
  );
}

export const Route = createFileRoute("/plan")({ component: PlanPage });
