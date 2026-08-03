import { api } from "@pantry/convex/api";
import {
  type DayExclusionReason,
  type DaySummary,
  exclusionLabel,
  formatNutrientAmount,
  HEADLINE_NUTRIENTS,
  habitReview,
  type NutrientTrend,
  startOfWeek,
  toISODate,
  windowEndingOn,
} from "@pantry/core";
import { useAsyncAction } from "@pantry/core/react";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

/**
 * Nutrition habit review (BL-0039) — "how have I been eating?"
 *
 * Two honesty rules run through every element here:
 *
 * 1. **Say which signal this is.** A meal you marked cooked (BL-0028) and a meal
 *    you merely scheduled are different claims, and the banner distinguishes
 *    them — derived from the rows in the window, never hard-coded, so a window
 *    of confirmed cooks says so and a window of intentions admits it.
 * 2. **A day we cannot account for is left out, not counted as zero.** Averaging
 *    missing days in as zeroes under-reports everything on the page, and it does
 *    so worst when coverage is worst.
 */

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

const DIRECTION_LABEL = {
  rising: "trending up",
  falling: "trending down",
  steady: "holding steady",
  unknown: "not enough days to call a trend",
} as const;

const DIRECTION_STYLE = {
  rising: "text-amber-600",
  falling: "text-[var(--color-primary)]",
  steady: "text-muted",
  unknown: "text-muted",
} as const;

export function HabitReview({ today = toISODate(new Date()) }: { today?: string }) {
  const [windowDays, setWindowDays] = useState<number>(7);
  const window = useMemo(() => windowEndingOn(today, windowDays), [today, windowDays]);

  const entries = useQuery(api.nutritionLog.listRange, { from: window.from, to: window.to });
  const record = useTracedAction(api.nutritionLog.recordPlannedWeek, "nutritionLog.record");
  const { run, error, pending } = useAsyncAction();

  const review = useMemo(
    () =>
      entries === undefined
        ? undefined
        : habitReview(entries, {
            window,
            nutrientIds: HEADLINE_NUTRIENTS.map((n) => n.id),
          }),
    [entries, window],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="flex gap-1 border-0 p-0">
            <legend className="sr-only">Review window</legend>
            {WINDOWS.map((w) => (
              <Button
                key={w.days}
                size="sm"
                variant={w.days === windowDays ? "primary" : "secondary"}
                aria-pressed={w.days === windowDays}
                onClick={() => setWindowDays(w.days)}
              >
                {w.label}
              </Button>
            ))}
          </fieldset>
          <Button
            className="ml-auto"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => record({ weekStart: startOfWeek(today) }))}
          >
            {pending ? "Recording…" : "Record this week's plan"}
          </Button>
        </div>
        {error && (
          <div className="mt-2">
            <ErrorText message={error} />
          </div>
        )}
      </Card>

      {review === undefined ? (
        <p className="text-sm text-muted">Loading your history…</p>
      ) : (
        <>
          <SignalBanner
            label={review.signal.label}
            caveat={review.signal.caveat}
            meals={review.loggedMeals}
            includedDays={review.includedDays}
            totalDays={review.days.length}
          />
          {review.loggedMeals === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                No meals recorded in this window yet. Plan a week on the Plan tab, then use{" "}
                <span className="text-text">Record this week's plan</span> to start a history.
                Marking a meal cooked there records it as eaten rather than merely scheduled.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {review.trends.map((trend) => (
                  <TrendCard key={trend.nutrientId} trend={trend} />
                ))}
              </div>
              <ExcludedDays days={review.days} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Names the signal before any number is shown.
 *
 * This is the element that stops the page overclaiming, so it leads rather than
 * sitting in a footnote.
 */
function SignalBanner({
  label,
  caveat,
  meals,
  includedDays,
  totalDays,
}: {
  label: string;
  caveat?: string;
  meals: number;
  includedDays: number;
  totalDays: number;
}) {
  return (
    <Card className="border-l-4 border-l-[var(--color-primary)]">
      <p className="text-sm font-medium text-text">{label}</p>
      {caveat && <p className="mt-1 text-sm text-muted">{caveat}</p>}
      <p className="mt-1 text-xs text-muted">
        {meals} {meals === 1 ? "meal" : "meals"} recorded · {includedDays} of {totalDays} days
        counted
      </p>
    </Card>
  );
}

function TrendCard({ trend }: { trend: NutrientTrend }) {
  const label =
    HEADLINE_NUTRIENTS.find((n) => n.id === trend.nutrientId)?.label ?? trend.nutrientId;

  if (trend.average === null) {
    return (
      <Card>
        <h3 className="text-sm font-semibold text-text">{label}</h3>
        {/* No figure at all, rather than a zero that reads as a real average. */}
        <p className="mt-1 text-sm text-muted">
          No day in this window could be counted, so there is no average to show.
        </p>
        <p className="mt-1 text-xs text-muted">{trend.excludedDays} days not counted</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{label}</h3>
        <span className={`text-xs ${DIRECTION_STYLE[trend.direction]}`}>
          {DIRECTION_LABEL[trend.direction]}
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold text-text">
        {formatNutrientAmount({
          nutrientId: trend.nutrientId,
          amount: trend.average,
          unit: trend.unit,
        })}
        <span className="ml-1 text-sm font-normal text-muted">avg / day</span>
      </p>
      <p className="text-xs text-muted">
        estimated · averaged over {trend.includedDays}{" "}
        {trend.includedDays === 1 ? "counted day" : "counted days"}
        {trend.excludedDays > 0 && `, ${trend.excludedDays} not counted`}
      </p>
      <Sparkline trend={trend} label={label} />
    </Card>
  );
}

/**
 * A bar per day of the window.
 *
 * Excluded days render as an empty slot, never a zero-height bar sitting on the
 * axis — a flat bar reads as "you ate nothing", which is precisely the claim we
 * are refusing to make.
 */
function Sparkline({ trend, label }: { trend: NutrientTrend; label: string }) {
  const values = trend.points.filter((p) => p.value !== null).map((p) => p.value as number);
  const max = Math.max(...values, 0);

  return (
    <ul className="mt-3 flex h-16 items-end gap-1" aria-label={`${label} by day`}>
      {trend.points.map((point) => {
        const value = point.value;
        const height = value === null || max === 0 ? 0 : Math.max(4, (value / max) * 100);
        return (
          <li key={point.date} className="flex h-full flex-1 items-end">
            {value === null ? (
              <span
                className="h-full w-full rounded-sm border border-dashed border-border"
                title={`${point.date}: not counted — ${exclusionLabel(point.reason as DayExclusionReason)}`}
              />
            ) : (
              <span
                className="w-full rounded-sm bg-[var(--color-primary)]/70"
                style={{ height: `${height}%` }}
                title={`${point.date}: ${formatNutrientAmount({
                  nutrientId: trend.nutrientId,
                  amount: value,
                  unit: trend.unit,
                })}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The days that did not count, and why.
 *
 * Deliberately prominent rather than a footnote: an average over 3 of 30 days is
 * a different claim from an average over 30, and the user cannot tell them apart
 * from the headline figure alone.
 */
function ExcludedDays({ days }: { days: DaySummary[] }) {
  const excluded = days.filter((d) => !d.included);
  if (excluded.length === 0) return null;

  const grouped = new Map<DayExclusionReason, string[]>();
  for (const day of excluded) {
    const reason = day.reason as DayExclusionReason;
    grouped.set(reason, [...(grouped.get(reason) ?? []), day.date]);
  }

  return (
    <Card title="Days not counted">
      <p className="mb-2 text-sm text-muted">
        These days are left out of every average above rather than counted as zero — treating a day
        we can't account for as an empty one would under-report everything on this page.
      </p>
      <dl className="flex flex-col gap-2">
        {[...grouped].map(([reason, dates]) => (
          <div key={reason}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              {exclusionLabel(reason)} · {dates.length}
            </dt>
            <dd className="text-sm text-text">{dates.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
