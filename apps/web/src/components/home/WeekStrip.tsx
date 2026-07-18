import { Link } from "@tanstack/react-router";
import type { BasketRow } from "../../lib/homeState";
import { DAY_FULL, DAYS } from "../../lib/week";

// Read-and-route: cells link to /plan rather than deep-linking a focused day, because
// /plan has no day parameter yet. Adding one is a follow-up once BL-0018 settles.
export function WeekStrip({ basket }: { basket: BasketRow[] }) {
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
                  : `${DAY_FULL[day]} — ${dayItems.map((i) => i.title).join(", ")}`
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
    </section>
  );
}
