import { api } from "@pantry/convex/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { DAY_FULL, DAYS } from "../lib/week";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// Dinner-first week plan (BL-0018). weekday 0=Mon … 6=Sun. A basket entry with a
// weekday is scheduled onto that day; without one it waits in the rail. Slots
// beyond dinner, servings, and diff-merge regeneration are deliberately later.

type BasketRow = {
  _id: string;
  recipeId: string;
  title: string;
  weekday?: number;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
};

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
  const items = (useQuery(api.basket.list) ?? []) as BasketRow[];
  const schedule = useMutation(api.basket.schedule);
  const unschedule = useMutation(api.basket.unschedule);
  const setServings = useMutation(api.basket.setServings);
  const setType = useMutation(api.basket.setType);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(
    removeFromBasketOptimistic,
  );
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const act = useAsyncAction();

  const unscheduled = items.filter((i) => i.weekday == null);

  return (
    <div className="flex flex-col gap-4">
      {/* Week grid: agenda (stacked) on phone, 7-column grid on desktop. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {DAYS.map((label, day) => {
          const dayItems = items.filter((i) => i.weekday === day);
          return (
            <div
              key={label}
              className="flex min-h-24 flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            >
              <div className="text-sm font-medium text-text">{DAY_FULL[day]}</div>
              {dayItems.length === 0 ? (
                <p className="text-xs text-muted">No dinner planned</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {dayItems.map((i) => {
                    const mult = i.servingsMultiplier ?? 1;
                    const isLeftover = i.type === "leftover";
                    return (
                      <li
                        key={i._id}
                        className={`flex flex-col gap-1 rounded-lg px-2 py-1.5 ${
                          isLeftover ? "bg-border/30 text-muted" : "bg-primary/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-sm text-text">{i.title}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${i.title} from ${DAY_FULL[day]}`}
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
                          {isLeftover ? (
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
                                      servingsMultiplier: Math.max(0.25, mult - 0.5),
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
                                      servingsMultiplier: mult + 0.5,
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
                              isLeftover ? `Mark ${i.title} as meal` : `Mark ${i.title} as leftover`
                            }
                            onClick={() => {
                              gen.clearError();
                              act.run(() =>
                                setType({
                                  recipeId: i.recipeId,
                                  type: isLeftover ? "meal" : "leftover",
                                }),
                              );
                            }}
                            className="ml-auto hover:text-text"
                          >
                            {isLeftover ? "↩ meal" : "♻ leftover"}
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
          disabled={gen.pending || items.length === 0}
        >
          {gen.pending ? "Generating…" : "Generate grocery list"}
        </Button>
        <ErrorText message={gen.error ?? act.error} />
      </div>
    </div>
  );
}
