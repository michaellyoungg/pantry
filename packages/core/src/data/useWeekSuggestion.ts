import { api } from "@pantry/convex/api";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { PlannedItem } from "../planner";
import { useAsyncAction } from "../react/useAsyncAction";
import { type SuggestionCandidate, suggestWeek, type WeekSuggestion } from "../weekSuggestion";

/**
 * A ranked candidate, taken from the action's own return type. Structurally a
 * `SuggestionCandidate` already, which is what keeps selection free of any wire
 * format — see `weekSuggestion.ts`.
 */
type Candidate = FunctionReturnType<typeof api.recommendations.weekCandidates>[number];

/** Recipes the user has turned down this session. */
type Dismissed = ReadonlySet<string>;

export type UseWeekSuggestion = {
  /** The week on offer, or null when nothing has been proposed yet. */
  proposal: WeekSuggestion | null;
  /** True while the candidate pool is being fetched. */
  thinking: boolean;
  /** True while an accepted proposal is being written to the basket. */
  applying: boolean;
  /** A failed fetch or a failed accept, already stringified. */
  error: string | null;
  /** Fetch candidates and propose a week. */
  suggest: () => void;
  /** Turn the whole proposal down and offer a different one. */
  regenerate: () => void;
  /** Turn one dinner down and refill its day from what is left. */
  dropPick: (recipeId: string) => void;
  /** Throw the proposal away, writing nothing. */
  discard: () => void;
  /** Accept the proposal — the only thing here that writes. */
  accept: () => void;
};

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

/**
 * "Suggest my week" (BL-0033) as state, with no view attached (BL-0055).
 *
 * The load-bearing property is that this PROPOSES and never applies. Nothing
 * reaches the basket until `accept` is called; until then the whole week lives
 * in this hook's state, where dropping a dinner costs one tap and changes
 * nothing. The UX plan is explicit that a suggestion you have to undo is worse
 * than no suggestion at all, and a planner that silently rewrote itself would
 * be exactly that — so the property is worth stating in one place both clients
 * read, rather than being re-established in each of their views.
 *
 * Selection itself is pure and lives in `@pantry/core`; this is only the
 * session around it.
 *
 * @param planned The basket as it stands. Scheduled rows lock their day, so a
 *   proposal never touches a day the user has already planned.
 */
export function useWeekSuggestion(planned: readonly PlannedItem[]): UseWeekSuggestion {
  const fetchCandidates = useAction(api.recommendations.weekCandidates);
  const addToBasket = useMutation(api.basket.add);
  const schedule = useMutation(api.basket.schedule);
  const ask = useAsyncAction();
  const apply = useAsyncAction();

  // The candidate pool is fetched once per "Suggest" press and reused for every
  // local edit, so dropping a dinner and trying again costs no round trip.
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [proposal, setProposal] = useState<WeekSuggestion | null>(null);
  const [dismissed, setDismissed] = useState<Dismissed>(() => new Set<string>());

  const discard = () => {
    setProposal(null);
    setCandidates(null);
    setDismissed(new Set());
  };

  const suggest = () =>
    void ask.run(async () => {
      apply.clearError();
      const found = await fetchCandidates({});
      setCandidates(found);
      setDismissed(new Set());
      setProposal(proposalFor(found, planned, new Set()));
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
    setProposal(proposalFor(candidates, planned, next));
  };

  const dropPick = (recipeId: string) => {
    if (!candidates) return;
    const next = new Set(dismissed).add(recipeId);
    setDismissed(next);
    setProposal(proposalFor(candidates, planned, next));
  };

  /**
   * `add` is idempotent and `schedule` patches whatever row exists, so a pick
   * that is already in the basket (an unscheduled one off the rail) is placed
   * rather than duplicated. Days the user had already planned were never in the
   * proposal, so they cannot be touched from here.
   */
  const accept = () =>
    void apply.run(async () => {
      if (!proposal) return;
      for (const pick of proposal.picks) {
        await addToBasket({ recipeId: pick.recipeId, title: pick.title });
        await schedule({ recipeId: pick.recipeId, weekday: pick.weekday });
      }
      discard();
    });

  return {
    proposal,
    thinking: ask.pending,
    applying: apply.pending,
    error: ask.error ?? apply.error,
    suggest,
    regenerate,
    dropPick,
    discard,
    accept,
  };
}
