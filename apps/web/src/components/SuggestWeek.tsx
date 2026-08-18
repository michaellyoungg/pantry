import { DAY_FULL, type PlannedItem } from "@pantry/core";
import { useWeekSuggestion } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// "Suggest my week" — the web surface over `useWeekSuggestion()`, which owns
// the candidate pool, the dismissed set, and the accept that is the only thing
// in the flow that writes.

export function SuggestWeek({ items }: { items: readonly PlannedItem[] }) {
  const { proposal, thinking, applying, error, suggest, regenerate, dropPick, discard, accept } =
    useWeekSuggestion(items);

  return (
    // aria-busy marks the window between pressing Add and the server having
    // stored the week. `accept` awaits an add and a schedule per pick, so
    // `apply.pending` only goes false once every one of them was acknowledged
    // — and none of those writes is optimistic, which makes this the only
    // signal on the card that separates "the proposal cleared" from "the week
    // is saved". Same contract as GroceryList and BeforeYouCook (BL-0070).
    <Card title="Suggest my week" busy={apply.pending}>
      <p className="text-sm text-muted">
        Fill your empty days with dinners that share ingredients — one short shopping list, no two
        nights alike.
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          testId={TEST_IDS.plan.suggest}
          onClick={suggest}
          disabled={thinking}
        >
          {thinking ? "Thinking…" : proposal ? "Start over" : "Suggest my week"}
        </Button>
      </div>

      {/* An empty proposal is a real answer, and it has two very different
          causes. Saying which one keeps the user from re-pressing a button that
          cannot help them. */}
      {proposal !== null && proposal.picks.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          {proposal.lockedWeekdays.length === 7
            ? "Every day is already planned — nothing left to suggest."
            : "No recipes to suggest yet. Add some from the Recipes tab and try again."}
        </p>
      )}

      {proposal !== null && proposal.picks.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium text-text">
              A proposed week — nothing is saved until you add it.
            </p>
            {/* The set-level account. Per-recipe scores explain each dinner;
                only these explain why they belong together, which is the whole
                reason this is one action instead of five. */}
            {proposal.setReasons.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {proposal.setReasons.map((reason) => (
                  <li key={reason} className="text-sm text-muted">
                    {reason}
                  </li>
                ))}
              </ul>
            )}
            {proposal.lockedWeekdays.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                Left alone: {proposal.lockedWeekdays.map((d) => DAY_FULL[d]).join(", ")} — already
                planned.
              </p>
            )}
          </div>

          <ul className="flex flex-col divide-y divide-border">
            {proposal.picks.map((pick) => (
              <li key={pick.recipeId} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">
                    <span className="text-muted">{DAY_FULL[pick.weekday]}</span> — {pick.title}
                  </p>
                  {pick.reasons.length > 0 && (
                    <p className="text-xs text-muted">{pick.reasons.slice(0, 2).join(" · ")}</p>
                  )}
                  {pick.sharesWith.length > 0 && (
                    <p className="text-xs text-muted">
                      Shares {pick.sharesWith.slice(0, 3).join(", ")} with the rest of the week
                    </p>
                  )}
                  {pick.addsToList.length > 0 && (
                    <p className="text-xs text-muted">
                      Adds {pick.addsToList.slice(0, 3).join(", ")} to the list
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Not ${pick.title}`}
                  onClick={() => dropPick(pick.recipeId)}
                  disabled={applying}
                >
                  Not this
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              testId={TEST_IDS.plan.suggestAccept}
              onClick={accept}
              disabled={applying}
            >
              {applying ? "Adding…" : "Add to my week"}
            </Button>
            <Button variant="secondary" size="sm" onClick={regenerate} disabled={applying}>
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={discard} disabled={applying}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <ErrorText message={error} />
    </Card>
  );
}
