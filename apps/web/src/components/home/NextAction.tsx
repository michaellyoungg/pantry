import { Link } from "@tanstack/react-router";
import type { HomeState } from "../../lib/homeState";
import { ErrorText } from "../ErrorText";
import { Button } from "../ui/Button";

const ctaLink =
  "inline-flex items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The single state-aware CTA. Presentational: Home owns the generate action so this
 * stays testable without mocking convex.
 */
export function NextAction({
  state,
  onBuildList,
  pending,
  error,
}: {
  state: HomeState;
  onBuildList: () => void;
  pending: boolean;
  error: string | null;
}) {
  if (state.kind === "loading") {
    return (
      <section
        aria-label="Next step"
        aria-busy="true"
        className="h-28 animate-pulse rounded-xl border border-border bg-surface"
      />
    );
  }

  // The couch → in-store handoff: the highest-value moment in the weekly loop.
  if (state.kind === "shopping") {
    return (
      <section
        aria-label="Next step"
        className="rounded-xl border border-primary bg-primary/5 p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-text">Shopping day</h2>
        <p className="mt-1 text-muted">
          {plural(state.remaining, "item", "items")} left to pick up
          {state.checked > 0 ? ` — ${state.checked} of ${state.total} already checked off` : ""}.
        </p>
        <Link to="/list" className={`${ctaLink} mt-4`}>
          Shop {plural(state.remaining, "item", "items")}
        </Link>
      </section>
    );
  }

  // Nothing clears a fully-checked list, so this state persists while the user plans
  // the following week. It must keep offering the build action, or Home dead-ends.
  if (state.kind === "shopped") {
    return (
      <section aria-label="Next step" className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text">Shopping done</h2>
        <p className="mt-1 text-muted">
          All {plural(state.total, "item", "items")} checked off. Time to cook — or start next week.
        </p>
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/plan" className={ctaLink}>
              Plan next week
            </Link>
            {state.mealCount > 0 && (
              <Button variant="secondary" onClick={onBuildList} disabled={pending}>
                {pending
                  ? "Building…"
                  : `Rebuild grocery list (${plural(state.mealCount, "meal", "meals")})`}
              </Button>
            )}
          </div>
          <ErrorText message={error} />
        </div>
      </section>
    );
  }

  if (state.kind === "planned") {
    return (
      <section aria-label="Next step" className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text">Your week is planned</h2>
        <p className="mt-1 text-muted">
          {plural(state.mealCount, "meal", "meals")} ready to turn into one grocery list.
        </p>
        <div className="mt-4 flex flex-col gap-1">
          <Button onClick={onBuildList} disabled={pending}>
            {pending
              ? "Building…"
              : `Build grocery list (${plural(state.mealCount, "meal", "meals")})`}
          </Button>
          <ErrorText message={error} />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Next step" className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-text">Start your week</h2>
      <p className="mt-1 text-muted">
        Pick a few dinners and Pantry turns them into one grocery list.
      </p>
      <Link to="/plan" className={`${ctaLink} mt-4`}>
        Plan this week
      </Link>
    </section>
  );
}
