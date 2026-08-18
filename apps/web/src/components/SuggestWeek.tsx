import { api } from "@pantry/convex/api";
import {
  DAY_FULL,
  type PlannedItem,
  type SuggestionCandidate,
  suggestWeek,
  type WeekSuggestion,
} from "@pantry/core";
import { useAsyncAction } from "@pantry/core/react";
import type { Recommendation } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// "Suggest my week" (BL-0033) — the one action that proposes a whole week.
//
// The load-bearing property is that this component PROPOSES and never applies.
// Nothing reaches the basket until the user presses Add; until then the whole
// week lives in this component's state, where dropping a dinner costs one tap
// and changes nothing. The UX plan's anti-friction principle is explicit that a
// suggestion you have to undo is worse than no suggestion at all, and a planner
// that silently rewrote itself would be exactly that.
//
// Selection itself is pure and lives in @pantry/core; this file is the surface.

/**
 * Recipes the user has already turned down this session.
 *
 * Kept so "Try again" means something. Without it, regenerating re-proposes the
 * dinner just rejected — the top of the ranking has not moved — which reads as
 * the button being broken.
 */
type Dismissed = ReadonlySet<string>;

function proposalFor(
  candidates: readonly SuggestionCandidate[],
  planned: readonly PlannedItem[],
  dismissed: Dismissed,
): WeekSuggestion {
  return suggestWeek({
    candidates: candidates.filter((c) => !dismissed.has(c.recipeId)),
    planned,
  });
}

export function SuggestWeek({ items }: { items: readonly PlannedItem[] }) {
  const fetchCandidates = useAction(api.recommendations.weekCandidates);
  const addToBasket = useMutation(api.basket.add);
  const schedule = useMutation(api.basket.schedule);
  const ask = useAsyncAction();
  const apply = useAsyncAction();

  // The candidate pool is fetched once per "Suggest" press and reused for every
  // local edit, so dropping a dinner and trying again costs no round trip.
  const [candidates, setCandidates] = useState<Recommendation[] | null>(null);
  const [proposal, setProposal] = useState<WeekSuggestion | null>(null);
  const [dismissed, setDismissed] = useState<Dismissed>(new Set<string>());

  const suggest = () =>
    ask.run(async () => {
      apply.clearError();
      const found = await fetchCandidates({});
      setCandidates(found);
      setDismissed(new Set());
      setProposal(proposalFor(found, items, new Set()));
    });

  /**
   * Show a different week.
   *
   * Selection is deterministic, so this has to turn the current picks down to
   * mean anything — re-running it unchanged would hand back the identical week
   * and read as a dead button.
   */
  const regenerate = () => {
    if (!candidates || !proposal) return;
    const next = new Set(dismissed);
    for (const pick of proposal.picks) next.add(pick.recipeId);
    setDismissed(next);
    setProposal(proposalFor(candidates, items, next));
  };

  /** Turn one dinner down and refill its day from what is left. */
  const dropPick = (recipeId: string) => {
    if (!candidates) return;
    const next = new Set(dismissed).add(recipeId);
    setDismissed(next);
    setProposal(proposalFor(candidates, items, next));
  };

  const discard = () => {
    setProposal(null);
    setCandidates(null);
    setDismissed(new Set());
  };

  /**
   * Accept the proposal — the ONLY thing here that writes.
   *
   * `add` is idempotent and `schedule` patches whatever row exists, so a pick
   * that is already in the basket (an unscheduled one off the rail) is placed
   * rather than duplicated. Days the user had already planned were never in the
   * proposal, so they cannot be touched from here.
   */
  const accept = () =>
    apply.run(async () => {
      if (!proposal) return;
      for (const pick of proposal.picks) {
        await addToBasket({ recipeId: pick.recipeId, title: pick.title });
        await schedule({ recipeId: pick.recipeId, weekday: pick.weekday });
      }
      discard();
    });

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
        <Button variant="secondary" size="sm" onClick={suggest} disabled={ask.pending}>
          {ask.pending ? "Thinking…" : proposal ? "Start over" : "Suggest my week"}
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
                  disabled={apply.pending}
                >
                  Not this
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={accept} disabled={apply.pending}>
              {apply.pending ? "Adding…" : "Add to my week"}
            </Button>
            <Button variant="secondary" size="sm" onClick={regenerate} disabled={apply.pending}>
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={discard} disabled={apply.pending}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <ErrorText message={ask.error ?? apply.error} />
    </Card>
  );
}
