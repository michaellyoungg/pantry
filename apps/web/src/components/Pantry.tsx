import { formatUseBy, isOverdue, titleCase } from "@pantry/core";
import { usePantry } from "@pantry/core/data";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const STATE_STYLE = {
  have: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  low: "bg-amber-500/10 text-amber-600",
  out: "bg-border text-muted",
} as const;

/**
 * The pantry screen (BL-0055): presentation over `usePantry()`.
 *
 * The Convex subscription, the three mutations and their optimistic updates,
 * the aisle grouping and the have → low → out → have cycle all live in
 * `@pantry/core/data`, so the native pantry screen renders the same state
 * rather than re-deriving it.
 */
export function Pantry() {
  const { items, groups, error, cycleState, toggleUseItUp, remove } = usePantry();
  const now = Date.now();

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
              {group.lines.map((item) => (
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
                    onClick={() => cycleState(item)}
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
                    onClick={() => toggleUseItUp(item)}
                  >
                    use up
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${item.display}`}
                    onClick={() => remove(item)}
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
