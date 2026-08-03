import { api } from "@pantry/convex/api";
import {
  canGenerateList,
  DAY_FULL,
  DAYS,
  decreaseServings,
  increaseServings,
  isCooked,
  isLeftover,
  type PlannedItem,
  planWeek,
  servingsMultiplier,
  toggledType,
  unscheduledItems,
} from "@pantry/core";
import { removeFromBasketOptimistic } from "@pantry/core/convex";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// Dinner-first week plan (BL-0018). weekday 0=Mon … 6=Sun. A basket entry with a
// weekday is scheduled onto that day; without one it waits in the rail. Slots
// beyond dinner, servings, and diff-merge regeneration are deliberately later.
// The bucketing and the servings clamp live in @pantry/core (BL-0024); this
// component is presentation over that.

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
  const items = (useQuery(api.basket.list) ?? []) as PlannedItem[];
  const schedule = useMutation(api.basket.schedule);
  const unschedule = useMutation(api.basket.unschedule);
  const setServings = useMutation(api.basket.setServings);
  const setType = useMutation(api.basket.setType);
  const markCooked = useMutation(api.basket.markCooked);
  const unmarkCooked = useMutation(api.basket.unmarkCooked);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(
    removeFromBasketOptimistic,
  );
  const generate = useTracedAction(api.recipes.generateGroceryList, "recipes.generateGroceryList");
  const gen = useAsyncAction();
  const act = useAsyncAction();

  const week = planWeek(items);
  const unscheduled = unscheduledItems(items);

  return (
    <div className="flex flex-col gap-4">
      {/* Week grid: agenda (stacked) on phone, 7-column grid on desktop. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {week.map((day) => {
          return (
            <div
              key={day.label}
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
                            onClick={() => {
                              gen.clearError();
                              act.run(() => unschedule({ recipeId: i.recipeId }));
                            }}
                            className="shrink-0 text-muted hover:text-text"
                          >
                            ×
                          </button>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted">
                          {leftover ? (
                            <span>leftovers — not on list</span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label={`Decrease servings for ${i.title}`}
                                onClick={() => {
                                  gen.clearError();
                                  act.run(() =>
                                    setServings({
                                      recipeId: i.recipeId,
                                      servingsMultiplier: decreaseServings(mult),
                                    }),
                                  );
                                }}
                                className="h-5 w-5 rounded border border-border hover:border-primary hover:text-text"
                              >
                                −
                              </button>
                              <span className="tabular-nums">×{mult}</span>
                              <button
                                type="button"
                                aria-label={`Increase servings for ${i.title}`}
                                onClick={() => {
                                  gen.clearError();
                                  act.run(() =>
                                    setServings({
                                      recipeId: i.recipeId,
                                      servingsMultiplier: increaseServings(mult),
                                    }),
                                  );
                                }}
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
                            onClick={() => {
                              gen.clearError();
                              act.run(() =>
                                setType({
                                  recipeId: i.recipeId,
                                  type: toggledType(i),
                                }),
                              );
                            }}
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
                            onClick={() => {
                              gen.clearError();
                              act.run(() =>
                                cooked
                                  ? unmarkCooked({ recipeId: i.recipeId })
                                  : markCooked({ recipeId: i.recipeId }),
                              );
                            }}
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
            </div>
          );
        })}
      </div>

      {/* Unscheduled rail: basket recipes waiting to be placed on a day. */}
      <Card title="Not yet planned">
        {unscheduled.length === 0 ? (
          <p className="text-sm text-muted">
            Everything in your basket is planned. Add recipes from the Recipes tab to plan more.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {unscheduled.map((i) => (
              <li key={i._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-text">{i.title}</span>
                <div className="flex items-center gap-2">
                  <DayPicker
                    onPick={(weekday) => {
                      gen.clearError();
                      act.run(() => schedule({ recipeId: i.recipeId, weekday }));
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      gen.clearError();
                      act.run(() => removeFromBasket({ recipeId: i.recipeId }));
                    }}
                  >
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
          onClick={() => {
            act.clearError();
            gen.run(() => generate({}));
          }}
          disabled={gen.pending || !canGenerateList(items)}
        >
          {gen.pending ? "Generating…" : "Generate grocery list"}
        </Button>
        <ErrorText message={gen.error ?? act.error} />
      </div>
    </div>
  );
}
