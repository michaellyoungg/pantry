import { api } from "@pantry/convex/api";
import type { Id } from "@pantry/convex/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { ErrorText } from "../ErrorText";
import { Button } from "../ui/Button";
import { MealCard, type PlanEntry } from "./MealCard";
import { addDays, formatWeekLabel, sundayOf, weekDays, weekdayLabel } from "./weekDates";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Planner({ initialToday }: { initialToday?: string }) {
  const [weekStart, setWeekStart] = useState(() => sundayOf(initialToday ?? todayIso()));
  const entries = (useQuery(api.basket.list) ?? []) as PlanEntry[];
  const assignDay = useMutation(api.basket.assignDay);
  const setServings = useMutation(api.basket.setServings);
  const setType = useMutation(api.basket.setType);
  const removeEntry = useMutation(api.basket.removeEntry);
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const navigate = useNavigate();

  const days = weekDays(weekStart);
  const unscheduled = entries.filter((e) => !e.plannedDate);
  const byDay = (iso: string) => entries.filter((e) => e.plannedDate === iso);

  const cardHandlers = {
    onServings: (id: string, mult: number) =>
      setServings({ id: id as Id<"basket">, servingsMultiplier: mult }),
    onToggleLeftover: (id: string, type: "meal" | "leftover") =>
      setType({ id: id as Id<"basket">, type }),
    onRemove: (id: string) => removeEntry({ id: id as Id<"basket"> }),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold text-text">Plan</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            ‹
          </Button>
          <span className="min-w-32 text-center text-sm text-muted">
            {formatWeekLabel(weekStart)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            ›
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(sundayOf(todayIso()))}>
            This week
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {days.map((iso) => (
          <div
            key={iso}
            data-testid={`day-${iso}`}
            className="flex min-h-24 flex-col gap-2 rounded-xl border border-border bg-surface p-2"
          >
            <div className="text-xs font-medium text-muted">
              {weekdayLabel(iso)} {Number(iso.slice(8, 10))}
            </div>
            {byDay(iso).map((e) => (
              <MealCard key={e._id} entry={e} {...cardHandlers} />
            ))}
            {byDay(iso).length === 0 && <span className="text-xs text-muted">—</span>}
          </div>
        ))}
      </div>

      <div
        data-testid="unscheduled-tray"
        className="rounded-xl border border-border bg-surface p-3"
      >
        <h3 className="mb-2 text-sm font-semibold text-text">Unscheduled</h3>
        {unscheduled.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting. Add recipes from the Recipes tab.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((e) => (
              <div key={e._id} className="flex flex-col gap-1">
                <MealCard entry={e} {...cardHandlers} />
                <div className="flex flex-wrap gap-1">
                  {days.map((iso) => (
                    <Button
                      key={iso}
                      variant="secondary"
                      size="sm"
                      aria-label={`Move ${e.title} to ${weekdayLabel(iso)}`}
                      onClick={() => assignDay({ id: e._id as Id<"basket">, plannedDate: iso })}
                    >
                      {weekdayLabel(iso)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          disabled={gen.pending}
          onClick={async () => {
            const res = await gen.run(() => generate({ weekStart }));
            if (res) navigate({ to: "/list" });
          }}
        >
          {gen.pending ? "Generating…" : "Generate grocery list"}
        </Button>
        <ErrorText message={gen.error} />
      </div>
    </div>
  );
}
