import { api } from "@pantry/convex/api";
import {
  type DayNutritionSummary,
  type NutritionGaps,
  type NutritionSummary,
  type PlannedItem,
  planNutritionSignature,
  rollUpWeekNutrition,
} from "@pantry/core";
import { useAsyncData } from "@pantry/core/react";
import { useCallback } from "react";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { PlanGoals } from "./PlanGoals";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

/**
 * The week's estimated nutrition (BL-0037): what each planned day comes to, and
 * what the week comes to.
 *
 * Every figure is labelled *estimated* and every incomplete one says what it is
 * missing. That is the whole point of the surface: a day whose dinner we could
 * not account for must read as a day we could not account for, never as a
 * quietly smaller number. All of the deciding happens in @pantry/core — this
 * component is presentation over `rollUpWeekNutrition`.
 */
export function PlanNutrition({ items }: { items: PlannedItem[] }) {
  const planNutrition = useTracedAction(api.nutrition.planNutrition, "nutrition.planNutrition");
  const load = useCallback(() => planNutrition({}), [planNutrition]);
  const { data, loading, error, reload } = useAsyncData(load, [planNutritionSignature(items)]);

  if (error) {
    return (
      <Card title="Estimated nutrition">
        <div className="flex items-center gap-2">
          <ErrorText message={error} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="Estimated nutrition">
        <p className="text-sm text-muted">
          {loading ? "Estimating this week's nutrition…" : "Nothing to estimate yet."}
        </p>
      </Card>
    );
  }

  const rollup = rollUpWeekNutrition(data);
  if (rollup.plannedDays === 0) {
    return (
      <Card title="Estimated nutrition">
        <p className="text-sm text-muted">Put a recipe on a day to see what your week comes to.</p>
      </Card>
    );
  }

  const planned = rollup.days.filter((d) => d.summary.kind !== "empty");

  return (
    <Card title="Estimated nutrition">
      <div className="flex flex-col gap-4">
        <WeekSummary
          summary={rollup.week}
          dailyAverage={rollup.dailyAverage}
          plannedDays={rollup.plannedDays}
        />
        <ul className="flex flex-col divide-y divide-border">
          {planned.map((day) => (
            <DayRow key={day.weekday} day={day} />
          ))}
        </ul>
        {/* Goal status against the very same rollup (BL-0038). Sharing the
            one fetch is what keeps the two halves of this card from ever
            disagreeing about whether a day is knowable. */}
        <PlanGoals days={data.days} week={data.week} />
        {loading && <p className="text-xs text-muted">Refreshing…</p>}
      </div>
    </Card>
  );
}

function WeekSummary({
  summary,
  dailyAverage,
  plannedDays,
}: {
  summary: NutritionSummary;
  dailyAverage: ReturnType<typeof rollUpWeekNutrition>["dailyAverage"];
  plannedDays: number;
}) {
  const days = `${plannedDays} planned ${plannedDays === 1 ? "day" : "days"}`;

  if (summary.kind !== "estimate") {
    return (
      <div className="rounded-lg bg-border/30 p-3">
        <p className="text-sm text-text">
          Not enough of this week could be identified to estimate it
          {summary.kind === "unavailable" && ` (about ${summary.coveragePercent}% accounted for)`}.
        </p>
        {summary.kind === "unavailable" && <GapNote gaps={summary.gaps} />}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-primary/10 p-3">
      <p className="mb-1 text-xs uppercase tracking-wide text-muted">
        Estimated average per day · across {days}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {dailyAverage.map((row) => (
          <div key={row.id} className="flex flex-col">
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="text-sm font-medium text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        Week total: {summary.rows.map((r) => `${r.label} ${r.value}`).join(" · ")}
      </p>
      <GapNote gaps={summary.gaps} />
    </div>
  );
}

function DayRow({ day }: { day: DayNutritionSummary }) {
  const { summary } = day;
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-text">{day.fullLabel}</span>
        {summary.kind === "estimate" ? (
          <span className="text-sm text-muted">
            {summary.rows.map((r) => `${r.label} ${r.value}`).join(" · ")}
          </span>
        ) : (
          <span className="text-sm text-muted">
            Not enough identified to estimate
            {summary.kind === "unavailable" && ` (about ${summary.coveragePercent}%)`}
          </span>
        )}
      </div>
      {summary.kind !== "empty" && <GapNote gaps={summary.gaps} />}
    </li>
  );
}

/**
 * Names what is unaccounted for. An excluded recipe leads, because it is the
 * gap a coverage percentage physically cannot express — none of its food is in
 * either side of that ratio, so without this line the total would read as
 * complete.
 */
function GapNote({ gaps }: { gaps: NutritionGaps }) {
  if (!gaps.incomplete) return null;
  return (
    <div className="mt-1 flex flex-col text-xs text-muted">
      {gaps.excludedRecipes.length > 0 && (
        <p>
          Excluded — we couldn't read{" "}
          <span className="text-text">{gaps.excludedRecipes.join(", ")}</span>, so none of it is in
          these figures.
        </p>
      )}
      {gaps.partialRecipes.length > 0 && (
        <p>
          Only partly counted: <span className="text-text">{gaps.partialRecipes.join(", ")}</span>
        </p>
      )}
      {gaps.missingItems.length > 0 && (
        <p>
          Not counted: <span className="text-text">{gaps.missingItems.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
