import { api } from "@pantry/convex/api";
import { DAY_FULL, DAYS, isCooked, isLeftover, servingsMultiplier } from "@pantry/core";
import { usePlanPrep, usePlanWeek } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { MealPrepBadge } from "./MealPrepBadge";
import { PlanNutrition } from "./PlanNutrition";
import { SuggestWeek } from "./SuggestWeek";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// Dinner-first week plan. weekday 0=Mon … 6=Sun; a basket entry without one
// waits in the rail. Presentation over `usePlanWeek()`, which the native day
// pager renders from too.

/** A compact 7-day selector; the active day is highlighted. */
function DayPicker({ active, onPick }: { active?: number; onPick: (weekday: number) => void }) {
  return (
    <div className="flex gap-1">
      {DAYS.map((label, day) => (
        <button
          key={label}
          type="button"
          aria-label={DAY_FULL[day]}
          aria-pressed={active === day}
          data-active={active === day}
          onClick={() => onPick(day)}
          className="h-6 w-6 rounded-md border border-border text-xs text-muted hover:border-primary hover:text-text data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-white"
        >
          {label[0]}
        </button>
      ))}
    </div>
  );
}

export function WeekPlan() {
  const generate = useTracedAction(api.recipes.generateGroceryList, "recipes.generateGroceryList");
  const {
    items,
    days,
    unscheduled,
    generating,
    error,
    canGenerate,
    schedule,
    unschedule,
    increaseServings,
    decreaseServings,
    toggleType,
    toggleCooked,
    remove,
    buildList,
  } = usePlanWeek({ generate });

  // Derived lead-time prep for the planned week (BL-0042), keyed by recipe: the
  // basket holds one row per recipe, so a recipe id identifies a meal.
  const forPlan = useTracedAction(api.prepTasks.forPlan, "prepTasks.forPlan");
  const { meals: prepMeals, done: prepDone } = usePlanPrep({ forPlan });
  const prepByRecipe = new Map(prepMeals.map((m) => [m.recipeId, m]));

  return (
    <div className="flex flex-col gap-4">
      {/* Week grid: agenda (stacked) on phone, 7-column grid on desktop. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day) => {
          return (
            // A named region per day: the grid is seven peers with identical
            // markup, so the weekday is the only thing that tells them apart —
            // for a screen reader and for anything else addressing one day.
            <section
              key={day.label}
              aria-label={day.fullLabel}
              className="flex min-h-24 flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            >
              <div className="text-sm font-medium text-text">{day.fullLabel}</div>
              {day.items.length === 0 ? (
                <p className="text-xs text-muted">No dinner planned</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {day.items.map((i) => {
                    const mult = servingsMultiplier(i);
                    const leftover = isLeftover(i);
                    const cooked = isCooked(i);
                    return (
                      <li
                        key={i._id}
                        data-testid={TEST_IDS.plan.meal(i.title)}
                        className={`flex flex-col gap-1 rounded-lg px-2 py-1.5 ${
                          leftover ? "bg-border/30 text-muted" : "bg-primary/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className={`text-sm text-text ${cooked ? "line-through" : ""}`}>
                            {i.title}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${i.title} from ${day.fullLabel}`}
                            onClick={() => unschedule(i)}
                            className="shrink-0 text-muted hover:text-text"
                          >
                            ×
                          </button>
                        </div>
                        {/* The 24-hour thaw, visible when you SCHEDULE the meal
                            rather than on the night you forgot it. */}
                        {!leftover && (
                          <MealPrepBadge meal={prepByRecipe.get(i.recipeId)} done={prepDone} />
                        )}
                        <div className="flex items-center gap-1 text-xs text-muted">
                          {leftover ? (
                            <span>leftovers — not on list</span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label={`Decrease servings for ${i.title}`}
                                onClick={() => decreaseServings(i)}
                                className="h-5 w-5 rounded border border-border hover:border-primary hover:text-text"
                              >
                                −
                              </button>
                              <span className="tabular-nums">×{mult}</span>
                              <button
                                type="button"
                                aria-label={`Increase servings for ${i.title}`}
                                onClick={() => increaseServings(i)}
                                className="h-5 w-5 rounded border border-border hover:border-primary hover:text-text"
                              >
                                +
                              </button>
                            </span>
                          )}
                          <button
                            type="button"
                            aria-label={
                              leftover ? `Mark ${i.title} as meal` : `Mark ${i.title} as leftover`
                            }
                            onClick={() => toggleType(i)}
                            className="ml-auto hover:text-text"
                          >
                            {leftover ? "↩ meal" : "♻ leftover"}
                          </button>
                          {/* The pantry's only outflow signal (BL-0028): marking
                              a meal cooked steps its ingredients have→low→out.
                              Leftovers say "eaten" — they consume nothing new. */}
                          <button
                            type="button"
                            aria-label={`Mark ${i.title} as ${cooked ? "not " : ""}${
                              leftover ? "eaten" : "cooked"
                            }`}
                            aria-pressed={cooked}
                            onClick={() => toggleCooked(i)}
                            className="hover:text-text"
                          >
                            {cooked ? "✓" : leftover ? "eaten?" : "cooked?"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* One action for a whole week (BL-0033). It proposes; it never applies,
          and it never touches a day that is already planned. */}
      <SuggestWeek items={items} />

      {/* What the planned week comes to (BL-0037). */}
      <PlanNutrition items={items} />

      {/* Unscheduled rail: basket recipes waiting to be placed on a day. */}
      <Card title="Not yet planned">
        {unscheduled.length === 0 ? (
          <p className="text-sm text-muted">
            Everything in your basket is planned. Add recipes from the Recipes tab to plan more.
          </p>
        ) : (
          <ul aria-label="Not yet planned" className="flex flex-col divide-y divide-border">
            {unscheduled.map((i) => (
              <li
                key={i._id}
                data-testid={TEST_IDS.plan.unplanned(i.title)}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="text-text">{i.title}</span>
                <div className="flex items-center gap-2">
                  <DayPicker onPick={(weekday) => schedule(i, weekday)} />
                  <Button variant="ghost" size="sm" onClick={() => remove(i)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-1">
        <Button
          testId={TEST_IDS.plan.generate}
          onClick={() => void buildList()}
          disabled={generating || !canGenerate}
        >
          {generating ? "Generating…" : "Generate grocery list"}
        </Button>
        <ErrorText message={error} />
      </div>
    </div>
  );
}
