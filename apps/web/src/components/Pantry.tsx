import { api } from "@pantry/convex/api";
import { removePantryItemOptimistic, setPantryStateOptimistic } from "@pantry/core/convex";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { formatUseBy, isOverdue } from "../lib/expiry";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Cycling forward from "out" wraps to "have": restocking is the common case,
// and it keeps the whole control reachable with one repeated tap.
const NEXT_STATE = { have: "low", low: "out", out: "have" } as const;

const STATE_STYLE = {
  have: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  low: "bg-amber-500/10 text-amber-600",
  out: "bg-border text-muted",
} as const;

export function Pantry() {
  const items = useQuery(api.pantry.list) ?? [];
  const setState = useMutation(api.pantry.setState).withOptimisticUpdate(setPantryStateOptimistic);
  const remove = useMutation(api.pantry.remove).withOptimisticUpdate(removePantryItemOptimistic);
  const setUseItUp = useMutation(api.pantry.setUseItUp);
  const { run, error } = useAsyncAction();
  const now = Date.now();

  // Rows arrive sorted by aisle from Convex; group consecutive runs (same
  // approach as GroceryList).
  const groups: { aisle: string; items: typeof items }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === item.aisle) last.items.push(item);
    else groups.push({ aisle: item.aisle, items: [item] });
  }

  return (
    <Card title="Pantry">
      {items.length === 0 && (
        <p className="text-sm text-muted">
          Nothing here yet — check items off your grocery list and they'll show up, so you don't
          rebuy things you already own.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.aisle}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {titleCase(group.aisle)}
            </h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item._id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-text">{item.display}</span>
                  {/* Relative and tilde-marked on purpose: this date came from a
                      shelf-life table when the item entered the pantry, not off a
                      carton, and an absolute date would imply a precision we
                      don't have. Items we don't recognize get no date at all. */}
                  {item.useBy !== undefined && (
                    <span
                      title="Estimated from typical shelf life, not a printed date"
                      className={`text-xs ${
                        isOverdue(item.useBy, now) ? "text-red-600" : "text-muted"
                      }`}
                    >
                      {formatUseBy(item.useBy, now)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`${item.display} is: ${item.state}. Change.`}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[item.state]}`}
                    onClick={() =>
                      run(() => setState({ id: item._id, state: NEXT_STATE[item.state] }))
                    }
                  >
                    {item.state}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      item.useItUp
                        ? `Stop using up ${item.display}`
                        : `Mark ${item.display} to use up`
                    }
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.useItUp
                        ? "bg-amber-500/20 text-amber-700"
                        : "bg-border text-muted hover:text-text"
                    }`}
                    onClick={() => run(() => setUseItUp({ id: item._id, useItUp: !item.useItUp }))}
                  >
                    use up
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${item.display}`}
                    onClick={() => run(() => remove({ id: item._id }))}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {items.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Only items marked <strong>have</strong> are skipped when building your grocery list.
        </p>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
