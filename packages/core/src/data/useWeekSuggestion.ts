import { api } from "@pantry/convex/api";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { PlannedItem } from "../planner";
import { useAsyncAction } from "../react/useAsyncAction";
import { type SuggestionCandidate, suggestWeek, type WeekSuggestion } from "../weekSuggestion";

/** Already structurally a `SuggestionCandidate`; see `weekSuggestion.ts`. */
type Candidate = FunctionReturnType<typeof api.recommendations.weekCandidates>[number];

/** Recipes the user has turned down this session. */
type Dismissed = ReadonlySet<string>;

export type UseWeekSuggestion = {
  /** The week on offer; null when nothing has been proposed yet. */
  proposal: WeekSuggestion | null;
  thinking: boolean;
  applying: boolean;
  error: string | null;
  suggest: () => void;
  /** Turn the whole proposal down and offer a different one. */
  regenerate: () => void;
  /** Turn one dinner down and refill its day from what is left. */
  dropPick: (recipeId: string) => void;
  discard: () => void;
  /** The only thing here that writes. */
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
 * "Suggest my week" as a session. Selection itself is `suggestWeek()`.
 *
 * This PROPOSES and never applies: nothing reaches the basket until `accept`,
 * because a suggestion you have to undo is worse than no suggestion at all.
 *
 * @param planned The basket as it stands; scheduled rows lock their day.
 */
export function useWeekSuggestion(planned: readonly PlannedItem[]): UseWeekSuggestion {
  const fetchCandidates = useAction(api.recommendations.weekCandidates);
  const addToBasket = useMutation(api.basket.add);
  const schedule = useMutation(api.basket.schedule);
  const ask = useAsyncAction();
  const apply = useAsyncAction();

  // Fetched once per "Suggest" press and reused for local edits, so dropping a
  // dinner costs no round trip.
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

  // Selection is deterministic, so this has to turn the current picks down —
  // re-running it unchanged would hand back the identical week.
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

  // `add` is idempotent and `schedule` patches whatever row exists, so a pick
  // already on the rail is placed rather than duplicated.
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
