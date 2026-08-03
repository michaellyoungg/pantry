import { DAY_FULL, DAYS } from "@pantry/core";
import { Link } from "@tanstack/react-router";
import type { BasketRow } from "../../lib/homeState";

// Read-and-route: cells link to /plan rather than deep-linking a focused day, because
// /plan has no day parameter yet. Adding one is a follow-up once BL-0018 settles.
/** aria-label text for one planned row. Mirrors the visible chip, leftovers included. */
function describe(row: BasketRow): string {
  return row.type === "leftover" ? `${row.title} (leftovers)` : row.title;
}

export function WeekStrip({ basket }: { basket: BasketRow[] }) {
  // Rows without a weekday sit in the planner's unscheduled rail and appear in no cell
  // here — but they still count toward "N meals ready", so say where they went.
  const unscheduled = basket.filter((row) => row.weekday == null).length;

  return (
    <section aria-label="This week's plan">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {DAYS.map((label, day) => {
          const dayItems = basket.filter((row) => row.weekday === day);
          return (
            <Link
              key={label}
              to="/plan"
              aria-label={
                dayItems.length === 0
                  ? `${DAY_FULL[day]} — nothing planned, add a meal`
                  : `${DAY_FULL[day]} — ${dayItems.map(describe).join(", ")}`
              }
              className="flex min-h-20 flex-col gap-1 rounded-xl border border-border bg-surface p-2 hover:border-primary"
            >
              <span className="text-xs font-medium text-muted">{label}</span>
              {dayItems.length === 0 ? (
                <span className="text-sm text-muted">+ add</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {dayItems.map((row) => (
                    <li
                      key={row._id}
                      className={`truncate rounded px-1.5 py-0.5 text-xs ${
                        row.type === "leftover"
                          ? "bg-border/30 text-muted"
                          : "bg-primary/10 text-text"
                      }`}
                    >
                      {row.type === "leftover" ? `${row.title} (leftovers)` : row.title}
                    </li>
                  ))}
                </ul>
              )}
            </Link>
          );
        })}
      </div>
      {unscheduled > 0 && (
        <Link to="/plan" className="mt-2 inline-block text-sm text-muted hover:text-text">
          {unscheduled === 1 ? "1 meal not on a day yet" : `${unscheduled} meals not on a day yet`}
        </Link>
      )}
    </section>
  );
}
